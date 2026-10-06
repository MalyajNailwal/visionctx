const secretPatterns: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{12,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*["']?[^\s"',}]{6,}/gi,
  /^\s*[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*.+$/gm
];

export function redact(input: string): { text: string; sensitive: boolean } {
  let text = input;
  for (const pattern of secretPatterns) text = text.replace(pattern, '[REDACTED]');
  return { text, sensitive: text !== input };
}

const sensitiveKeys = /authorization|x-api-key|cookie|secret|password|token|credential|private.key|api.key/i;
export function sanitize(value: unknown, key = ''): unknown {
  if (sensitiveKeys.test(key)) return '[REDACTED]';
  if (key === 'data' && typeof value === 'string') return '[BINARY_DATA_OMITTED]';
  if (typeof value === 'string') return redact(value).text;
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  return value;
}

export function sanitizedPayload(body: Buffer): unknown {
  try {
    return sanitize(JSON.parse(body.toString('utf8')));
  } catch {
    return { unavailable: 'Request body is not valid JSON' };
  }
}
