export type Mode = 'passthrough' | 'text' | 'image' | 'adaptive';
export type BlockType = 'SYSTEM_PROMPT' | 'USER_PROMPT' | 'ASSISTANT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT' | 'SOURCE_CODE' | 'FILE_CONTENT' | 'JSON' | 'LOGS' | 'TERMINAL_OUTPUT' | 'MCP_OUTPUT' | 'DOCUMENTATION' | 'ERROR_TRACE' | 'OLD_CONVERSATION' | 'IMAGE';
export type Risk = 'low' | 'medium' | 'high';
export type StrategyName = 'passthrough' | 'minify' | 'text_compression' | 'summary' | 'image' | 'adaptive';
export type SourceLabel = 'ACTUAL' | 'ESTIMATED';
export type EventStage = 'REQUEST_RECEIVED' | 'REQUEST_PARSED' | 'CONTEXT_ANALYZED' | 'COMPRESSION' | 'TOKEN_COUNT_PREFLIGHT' | 'FINAL_PAYLOAD' | 'UPSTREAM_REQUEST' | 'UPSTREAM_RESPONSE' | 'COMPLETED' | 'FAILED' | 'FALLBACK_USED' | 'IMAGE_RENDER_STARTED' | 'IMAGE_RENDER_COMPLETED';

export interface Config {
  mode: Mode;
  proxy: { host: string; port: number; upstream: string };
  dashboard: { host: string; port: number };
  storage: { path: string; capture_redacted_content: boolean };
  compression: {
    adaptive: { passthrough_under_bytes: number; minify_under_bytes: number; image_candidate_over_bytes: number };
    summary?: { enabled: boolean; threshold_bytes: number };
    image: { enabled: boolean; font_family: string; font_size: number; line_height: number; padding: number; max_width: number; max_height: number; max_pages?: number; max_source_bytes?: number; theme: 'dark' | 'light'; line_numbers: boolean; word_wrap: boolean };
  };
  security: { redact_secrets: boolean; persist_sensitive_content: boolean };
  measurement?: { counterfactual_tokens: boolean };
}

export interface ContextBlock {
  id: string;
  requestId: string;
  path: string;
  type: BlockType;
  text: string | null;
  sizeBytes: number;
  estimatedTokens: number;
  compressibility: number;
  risk: Risk;
  strategy: StrategyName;
  reason: string;
  sensitive: boolean;
}

export interface RenderedImage {
  bytes: Buffer;
  width: number;
  height: number;
  format: 'png';
  renderTimeMs: number;
  estimatedImageTokens: number;
}

export interface CompressionResult {
  content: unknown;
  strategy: StrategyName;
  changed: boolean;
  reason: string;
  images?: RenderedImage[];
}
