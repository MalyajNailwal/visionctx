import type { Config, ContextBlock, CompressionResult, StrategyName } from '../core/types.js';
import { renderText } from '../image-renderer/index.js';

export interface CompressionStrategy {
  readonly name: StrategyName;
  canHandle(block: ContextBlock): boolean;
  estimate(block: ContextBlock): number;
  compress(block: ContextBlock, config: Config): CompressionResult;
  restore(block: ContextBlock): string | null;
  metadata(): Record<string, unknown>;
}

export const passthrough: CompressionStrategy = {
  name: 'passthrough', canHandle: () => true, estimate: b => b.estimatedTokens,
  compress: b => ({ content: b.text, strategy: 'passthrough', changed: false, reason: 'Preserved original context' }),
  restore: b => b.text, metadata: () => ({ lossless: true })
};

export const minify: CompressionStrategy = {
  name: 'minify', canHandle: b => b.type === 'JSON' && b.text !== null && !b.sensitive,
  estimate: b => { try { return Math.ceil(Buffer.byteLength(JSON.stringify(JSON.parse(b.text!))) / 4); } catch { return b.estimatedTokens; } },
  compress: b => {
    try {
      const content = JSON.stringify(JSON.parse(b.text!));
      if (Buffer.byteLength(content) >= b.sizeBytes) return { content: b.text, strategy: 'passthrough', changed: false, reason: 'JSON minification did not reduce size' };
      return { content, strategy: 'minify', changed: true, reason: 'Parsed and serialized JSON without optional whitespace' };
    } catch { return passthrough.compress(b, {} as Config); }
  },
  restore: b => b.text, metadata: () => ({ lossless_semantics: true, byte_exact: false })
};

export const image: CompressionStrategy = {
  name: 'image',
  canHandle: b => b.text !== null && !b.sensitive && b.risk !== 'high' && b.path.endsWith('/content') && ['LOGS','TERMINAL_OUTPUT','TOOL_RESULT','DOCUMENTATION'].includes(b.type),
  estimate: b => Math.ceil(b.sizeBytes / 12),
  compress: (b, config) => {
    const pages = renderText(b.text!, config.compression.image);
    const imageTokens = pages.reduce((sum, page) => sum + page.estimatedImageTokens, 0);
    if (config.mode === 'adaptive' && textCompression.canHandle(b) && textCompression.estimate(b) < imageTokens) return textCompression.compress(b,config);
    if (imageTokens >= b.estimatedTokens) return { content: b.text, strategy: 'passthrough', changed: false, reason: 'Image estimate did not beat text estimate' };
    const blocks = pages.map(page => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: page.bytes.toString('base64') } }));
    return { content: blocks, strategy: 'image', changed: true, reason: `${pages.length} PNG page(s), estimated ${imageTokens} image tokens`, images: pages };
  },
  restore: b => b.text, metadata: () => ({ lossy: true, format: 'png' })
};

function compressRepeatedLines(text: string): string {
  const lines = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/);
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    let end = index + 1;
    while (end < lines.length && lines[end] === lines[index]) end++;
    const run = end - index;
    if (run >= 3) { output.push(lines[index]!, `[VisionCtx: previous line repeated ${run - 1} more times]`); }
    else for (let i = index; i < end; i++) output.push(lines[i]!);
    index = end;
  }
  return output.join('\n');
}

export const textCompression: CompressionStrategy = {
  name: 'text_compression',
  canHandle: b => b.text !== null && !b.sensitive && b.risk !== 'high' && b.sizeBytes >= 4096 && ['LOGS','TERMINAL_OUTPUT'].includes(b.type),
  estimate: b => Math.ceil(Buffer.byteLength(compressRepeatedLines(b.text!)) / 4),
  compress: b => {
    const content = compressRepeatedLines(b.text!);
    if (Buffer.byteLength(content) >= b.sizeBytes) return { content:b.text, strategy:'passthrough', changed:false, reason:'Repeated-line compression did not reduce size' };
    return { content, strategy:'text_compression', changed:true, reason:'Removed ANSI controls and collapsed exact consecutive duplicate lines (lossy)' };
  },
  restore: b => b.text, metadata: () => ({ lossy:true, method:'repeat_line_collapse' })
};

function extractSummary(text: string): string {
  const lines = text.split(/\r?\n/);
  const selected = new Set<number>();
  for (let i = 0; i < Math.min(40, lines.length); i++) selected.add(i);
  for (let i = Math.max(0, lines.length - 40); i < lines.length; i++) selected.add(i);
  let signals = 0;
  for (let i = 0; i < lines.length && signals < 120; i++) {
    if (/\b(?:ERROR|WARN|FAILED|Exception|Traceback)\b/i.test(lines[i]!)) { selected.add(i); signals++; }
  }
  const result: string[] = [];
  let previous = -1;
  for (const index of [...selected].sort((a,b) => a-b)) {
    if (index > previous + 1) result.push(`[VisionCtx: ${index - previous - 1} lines omitted]`);
    result.push(lines[index]!);
    previous = index;
  }
  return result.join('\n');
}

export const summary: CompressionStrategy = {
  name: 'summary',
  canHandle: b => b.text !== null && !b.sensitive && b.risk !== 'high' && ['LOGS','TERMINAL_OUTPUT'].includes(b.type),
  estimate: b => Math.ceil(Buffer.byteLength(extractSummary(b.text!)) / 4),
  compress: b => {
    const content = extractSummary(b.text!);
    if (Buffer.byteLength(content) >= b.sizeBytes) return { content:b.text, strategy:'passthrough', changed:false, reason:'Extractive summary did not reduce size' };
    return { content, strategy:'summary', changed:true, reason:'Extractive head, tail, and diagnostic signal summary (lossy, opt-in)' };
  },
  restore: b => b.text, metadata: () => ({ lossy:true, method:'extractive_log_summary', opt_in:true })
};

function chooseAdaptive(b: ContextBlock, config: Config): CompressionStrategy {
    if (b.sizeBytes < config.compression.adaptive.passthrough_under_bytes) return passthrough;
    if (minify.canHandle(b)) return minify;
    const candidates: CompressionStrategy[] = [passthrough];
    if (textCompression.canHandle(b) && b.sizeBytes >= config.compression.adaptive.minify_under_bytes) candidates.push(textCompression);
    if (config.compression.summary?.enabled && b.sizeBytes >= config.compression.summary.threshold_bytes && summary.canHandle(b)) candidates.push(summary);
    if (config.compression.image.enabled && ['LOGS','TERMINAL_OUTPUT'].includes(b.type) && b.sizeBytes <= (config.compression.image.max_source_bytes ?? 1048576) &&
        b.sizeBytes >= config.compression.adaptive.image_candidate_over_bytes && image.canHandle(b)) candidates.push(image);
    const chosen = candidates.sort((a,bStrategy) => a.estimate(b)-bStrategy.estimate(b))[0]!;
    return chosen;
}

export const adaptive: CompressionStrategy = {
  name:'adaptive', canHandle: () => true,
  estimate: b => Math.min(b.estimatedTokens, minify.canHandle(b) ? minify.estimate(b) : Infinity, textCompression.canHandle(b) ? textCompression.estimate(b) : Infinity),
  compress: (b,config) => chooseAdaptive(b,config).compress(b,config),
  restore: b => b.text, metadata: () => ({ policy:'lowest estimated token candidate subject to risk and size gates' })
};

export function selectStrategy(block: ContextBlock, config: Config): CompressionStrategy {
  if (config.mode === 'passthrough' || block.sensitive || block.risk === 'high') return passthrough;
  if (block.sizeBytes < config.compression.adaptive.passthrough_under_bytes) return passthrough;
  if (config.mode === 'adaptive') return chooseAdaptive(block,config);
  if (minify.canHandle(block) && config.mode === 'text') return minify;
  if (config.mode === 'text' && config.compression.summary?.enabled && block.sizeBytes >= config.compression.summary.threshold_bytes && summary.canHandle(block)) return summary;
  if (config.mode === 'text' && textCompression.canHandle(block)) return textCompression;
  const underImageLimit = block.sizeBytes <= (config.compression.image.max_source_bytes ?? 1048576);
  if (config.mode === 'image' && config.compression.image.enabled && underImageLimit && image.canHandle(block)) return image;
  return passthrough;
}
