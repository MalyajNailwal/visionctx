import { createCanvas } from '@napi-rs/canvas';
import { performance } from 'node:perf_hooks';
import type { Config, RenderedImage } from '../core/types.js';

type ImageConfig = Config['compression']['image'];

interface Layout { rows: { line: number; content: string }[]; rowsPerPage: number }

// ponytail: layout is shared by renderText and estimateImageTokens so the estimate can never drift from the real pixel output.
function layout(text: string, config: ImageConfig): Layout {
  const charWidth = Math.ceil(config.font_size * 0.68);
  const gutter = config.line_numbers ? 64 : 0;
  const columns = Math.max(20, Math.floor((config.max_width - config.padding * 2 - gutter) / charWidth));
  const rowsPerPage = Math.max(1, Math.floor((config.max_height - config.padding * 2) / config.line_height));
  const rows: { line: number; content: string }[] = [];
  if (!config.word_wrap && text.split(/\r?\n/).some(line => line.replace(/\t/g, '    ').length > columns)) {
    throw new Error('Line exceeds image width with wrapping disabled');
  }
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, index) => {
    const expanded = line.replace(/\t/g, '    ');
    if (!config.word_wrap || expanded.length <= columns) rows.push({ line: index + 1, content: expanded });
    else for (let offset = 0; offset < expanded.length; offset += columns) rows.push({ line: offset === 0 ? index + 1 : 0, content: expanded.slice(offset, offset + columns) });
  });
  if (Math.ceil(rows.length / rowsPerPage) > (config.max_pages ?? 16)) throw new Error('Image page limit exceeded');
  return { rows, rowsPerPage };
}

function pageSize(pageRows: { content: string }[], config: ImageConfig): { width: number; height: number } {
  const charWidth = Math.ceil(config.font_size * 0.68);
  const gutter = config.line_numbers ? 64 : 0;
  const longest = Math.max(...pageRows.map(row => row.content.length), 1);
  return { width: Math.min(config.max_width, Math.max(240, config.padding * 2 + gutter + longest * charWidth)),
    height: Math.min(config.max_height, config.padding * 2 + pageRows.length * config.line_height) };
}

// Token cost of a text block is decided by rendered pixels, not source bytes. Measures the real layout without drawing.
export function estimateImageTokens(text: string, config: ImageConfig): number {
  const { rows, rowsPerPage } = layout(text, config);
  let tokens = 0;
  for (let offset = 0; offset < rows.length; offset += rowsPerPage) {
    const { width, height } = pageSize(rows.slice(offset, offset + rowsPerPage), config);
    tokens += Math.ceil(width / 28) * Math.ceil(height / 28);
  }
  return tokens;
}

export function renderText(text: string, config: ImageConfig): RenderedImage[] {
  const started = performance.now();
  const fontSize = config.font_size;
  const gutter = config.line_numbers ? 64 : 0;
  const { rows, rowsPerPage } = layout(text, config);
  const pages: RenderedImage[] = [];
  for (let offset = 0; offset < rows.length; offset += rowsPerPage) {
    const pageRows = rows.slice(offset, offset + rowsPerPage);
    const { width, height } = pageSize(pageRows, config);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = config.theme === 'dark' ? '#10151e' : '#fffdf8';
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${fontSize}px ${config.font_family}`;
    ctx.textBaseline = 'top';
    pageRows.forEach((row, i) => {
      const y = config.padding + i * config.line_height;
      if (config.line_numbers) {
        ctx.fillStyle = config.theme === 'dark' ? '#8492a5' : '#667085';
        ctx.fillText(row.line ? String(row.line) : '↳', config.padding, y);
      }
      ctx.fillStyle = config.theme === 'dark' ? '#e7edf4' : '#18212e';
      ctx.fillText(row.content || ' ', config.padding + gutter, y);
    });
    const bytes = canvas.toBuffer('image/png');
    pages.push({ bytes, width, height, format: 'png', renderTimeMs: performance.now() - started,
      estimatedImageTokens: Math.ceil(width / 28) * Math.ceil(height / 28) });
  }
  return pages;
}
