import type { BlockType, Risk } from '../core/types.js';
export function classify(text: string, role: 'system' | 'user' | 'assistant' | 'tool_result' | 'tool_use'): { type: BlockType; risk: Risk; compressibility: number } {
  if (role === 'system') return { type: 'SYSTEM_PROMPT', risk: 'high', compressibility: 0 };
  if (role === 'assistant') return { type: 'ASSISTANT_MESSAGE', risk: 'high', compressibility: 0 };
  if (role === 'tool_use') return { type: 'TOOL_CALL', risk: 'high', compressibility: 0 };
  if (role === 'user') return { type: 'USER_PROMPT', risk: 'high', compressibility: 0 };
  const trimmed = text.trim();
  if (/\bmcp__\w+\b|"jsonrpc"\s*:\s*"2\.0"|^Resource URI:/m.test(text)) return { type:'MCP_OUTPUT', risk:'medium', compressibility:0.6 };
  if (/^(?:File:|Path:|\/[^\n]+\.(?:py|ts|js|go|rs|java|sql))\s*\n/m.test(text)) return { type:'FILE_CONTENT', risk:'high', compressibility:0.4 };
  if (/^(?:\{|\[)/.test(trimmed)) { try { JSON.parse(trimmed); return { type: 'JSON', risk: 'medium', compressibility: 0.7 }; } catch { /* continue */ } }
  if (/\b(?:Traceback \(most recent call last\)|at\s+\S+\s+\([^\n]+:\d+|Error:|Exception:)\b/m.test(text)) return { type: 'ERROR_TRACE', risk: 'medium', compressibility: 0.5 };
  if (/^\s*(?:\$|>|#)\s+\S+|\b(?:stdout|stderr|exit code)\b/im.test(text)) return { type: 'TERMINAL_OUTPUT', risk: 'medium', compressibility: 0.6 };
  if (/^(?:\[?\d{4}-\d\d-\d\d|INFO\b|WARN\b|DEBUG\b|ERROR\b)/m.test(text)) return { type: 'LOGS', risk: 'medium', compressibility: 0.8 };
  if (/\b(?:function|class|const|def|import|export|SELECT|CREATE TABLE)\b/.test(text)) return { type: 'SOURCE_CODE', risk: 'high', compressibility: 0.4 };
  if (/^#{1,6}\s|https?:\/\//m.test(text)) return { type: 'DOCUMENTATION', risk: 'medium', compressibility: 0.4 };
  return { type: 'TOOL_RESULT', risk: 'medium', compressibility: 0.5 };
}
