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
      return { content, strategy: 'minify', changed: content.length < b.text!.length, reason: 'Parsed and serialized JSON without optional whitespace' };
    } catch { return passthrough.compress(b, {} as Config); }
  },
  restore: b => b.text, metadata: () => ({ lossless_semantics: true, byte_exact: false })
};

export const image: CompressionStrategy = {
  name: 'image',
  canHandle: b => b.text !== null && !b.sensitive && b.risk !== 'high' && ['LOGS','TERMINAL_OUTPUT','TOOL_RESULT','DOCUMENTATION'].includes(b.type),
  estimate: b => Math.ceil(b.sizeBytes / 12),
  compress: (b, config) => {
    const pages = renderText(b.text!, config.compression.image);
    const imageTokens = pages.reduce((sum, page) => sum + page.estimatedImageTokens, 0);
    if (imageTokens >= b.estimatedTokens) return { content: b.text, strategy: 'passthrough', changed: false, reason: 'Image estimate did not beat text estimate' };
    const blocks = pages.map(page => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: page.bytes.toString('base64') } }));
    return { content: blocks, strategy: 'image', changed: true, reason: `${pages.length} PNG page(s), estimated ${imageTokens} image tokens`, images: pages };
  },
  restore: b => b.text, metadata: () => ({ lossy: true, format: 'png' })
};

export const textCompression: CompressionStrategy = {
  name: 'text_compression', canHandle: () => false, estimate: b => b.estimatedTokens,
  compress: b => ({ content: b.text, strategy: 'passthrough', changed: false, reason: 'Text compression is disabled pending accuracy benchmarks' }),
  restore: b => b.text, metadata: () => ({ experimental: true, implemented: false })
};
export const summary: CompressionStrategy = {
  name: 'summary', canHandle: () => false, estimate: b => b.estimatedTokens,
  compress: b => ({ content: b.text, strategy: 'passthrough', changed: false, reason: 'Summarization is disabled pending accuracy benchmarks' }),
  restore: b => b.text, metadata: () => ({ experimental: true, implemented: false })
};

export function selectStrategy(block: ContextBlock, config: Config): CompressionStrategy {
  if (config.mode === 'passthrough' || block.sensitive || block.risk === 'high') return passthrough;
  if (block.sizeBytes < config.compression.adaptive.passthrough_under_bytes) return passthrough;
  if (minify.canHandle(block) && (config.mode === 'text' || config.mode === 'adaptive')) return minify;
  if (config.mode === 'image' && config.compression.image.enabled && image.canHandle(block)) return image;
  if (config.mode === 'adaptive' && config.compression.image.enabled && block.sizeBytes >= config.compression.adaptive.image_candidate_over_bytes && image.canHandle(block)) return image;
  return passthrough;
}
