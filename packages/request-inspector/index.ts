import type { ContextBlock } from '../core/types.js';
import { classify } from '../context-classifier/index.js';

export interface InspectedRequest { model: string | null; streaming: boolean; blocks: ContextBlock[]; payload: Record<string, unknown> }
export function inspectAnthropic(body: Buffer, requestId: string): InspectedRequest | null {
  let payload: unknown;
  try { payload = JSON.parse(body.toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  const blocks: ContextBlock[] = [];
  const messages = Array.isArray(obj.messages) ? obj.messages : [];
  const add = (path: string, text: string, role: 'system' | 'user' | 'assistant' | 'tool_result' | 'tool_use') => {
    const kind = classify(text, role);
    const sizeBytes = Buffer.byteLength(text);
    blocks.push({ id: `block_${String(blocks.length + 1).padStart(3, '0')}`, requestId, path, type: kind.type, text, sizeBytes,
      estimatedTokens: Math.ceil(sizeBytes / 4), compressibility: kind.compressibility, risk: kind.risk,
      strategy: 'passthrough', reason: 'No transformation selected', sensitive: false });
  };
  if (typeof obj.system === 'string') add('/system', obj.system, 'system');
  else if (Array.isArray(obj.system)) obj.system.forEach((item, i) => {
    if (item && typeof item === 'object' && typeof item.text === 'string') add(`/system/${i}/text`, item.text, 'system');
  });
  const addImage = (path: string, source: unknown) => {
    const data = source && typeof source === 'object' ? (source as Record<string, unknown>).data : undefined;
    const sizeBytes = typeof data === 'string' ? Math.floor(data.length * 0.75) : 0;
    blocks.push({ id:`block_${String(blocks.length + 1).padStart(3,'0')}`, requestId, path, type:'IMAGE', text:null, sizeBytes,
      estimatedTokens:0, compressibility:0, risk:'high', strategy:'passthrough', reason:'Existing image preserved', sensitive:false });
  };
  messages.forEach((message, i) => {
    if (!message || typeof message !== 'object') return;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    if (typeof message.content === 'string') {
      add(`/messages/${i}/content`, message.content, role);
      if (i < messages.length - 4) blocks[blocks.length - 1]!.type = 'OLD_CONVERSATION';
    }
    else if (Array.isArray(message.content)) message.content.forEach((content: unknown, j: number) => {
      if (!content || typeof content !== 'object') return;
      const block = content as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') {
        add(`/messages/${i}/content/${j}/text`, block.text, role);
        if (i < messages.length - 4) blocks[blocks.length - 1]!.type = 'OLD_CONVERSATION';
      }
      else if (block.type === 'tool_use') add(`/messages/${i}/content/${j}/input`, JSON.stringify(block.input ?? {}), 'tool_use');
      else if (block.type === 'image') addImage(`/messages/${i}/content/${j}`, block.source);
      else if (block.type === 'tool_result' && typeof block.content === 'string') add(`/messages/${i}/content/${j}/content`, block.content, 'tool_result');
      else if (block.type === 'tool_result' && Array.isArray(block.content)) block.content.forEach((part: unknown, k: number) => {
        if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text' && typeof (part as Record<string, unknown>).text === 'string') {
          add(`/messages/${i}/content/${j}/content/${k}/text`, (part as {text: string}).text, 'tool_result');
        }
        if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'image') addImage(`/messages/${i}/content/${j}/content/${k}`, (part as Record<string,unknown>).source);
      });
    });
  });
  if (obj.cache_control) {
    for (const block of blocks) { block.risk = 'high'; block.reason = 'Protected by automatic prompt caching'; }
  } else if (Array.isArray(obj.messages)) {
    let lastCacheMessage = -1;
    obj.messages.forEach((message, index) => {
      if (JSON.stringify(message).includes('"cache_control"')) lastCacheMessage = index;
    });
    for (const block of blocks) {
      const messageIndex = Number(block.path.match(/^\/messages\/(\d+)/)?.[1] ?? -1);
      if (messageIndex >= 0 && messageIndex <= lastCacheMessage) {
        block.risk = 'high'; block.reason = 'Protected by a prompt-cache breakpoint';
      }
    }
  }
  return { model: typeof obj.model === 'string' ? obj.model : null, streaming: obj.stream === true, blocks, payload: obj };
}

export function setAtPath(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const parts = pointer.split('/').slice(1);
  let cursor: unknown = root;
  for (const part of parts.slice(0, -1)) cursor = (cursor as Record<string, unknown>)[part];
  (cursor as Record<string, unknown>)[parts.at(-1)!] = value;
}
