import { readFileSync } from 'node:fs';
import YAML from 'yaml';
export interface Pricing { input_per_million: number; output_per_million: number; cache_read_per_million: number; cache_write_per_million: number }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export function estimateCost(pricing: Pricing, usage: Usage): number {
  return (usage.input * pricing.input_per_million + usage.output * pricing.output_per_million + usage.cacheRead * pricing.cache_read_per_million + usage.cacheWrite * pricing.cache_write_per_million) / 1_000_000;
}
export function lookupPricing(model: string, path = 'pricing.yaml'): { pricing: Pricing; version: string } | null {
  try {
    const file = YAML.parse(readFileSync(path, 'utf8')) as { version?: string; models?: Record<string, Pricing> };
    const pricing = file.models?.[model];
    if (!pricing || Object.values(pricing).some(value => typeof value !== 'number' || value < 0)) return null;
    return { pricing, version: file.version ?? 'unspecified' };
  } catch { return null; }
}
