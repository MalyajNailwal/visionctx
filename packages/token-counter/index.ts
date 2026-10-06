import type { SourceLabel } from '../core/types.js';
export interface TokenMeasure { value: number | null; source: SourceLabel; method: string }
export function roughTextTokens(text: string): TokenMeasure { return { value: Math.ceil(Buffer.byteLength(text) / 4), source: 'ESTIMATED', method: 'utf8_bytes_divided_by_four' }; }
export function imagePatchTokens(width: number, height: number): TokenMeasure { return { value: Math.ceil(width / 28) * Math.ceil(height / 28), source: 'ESTIMATED', method: 'pre_resize_28px_patches' }; }
