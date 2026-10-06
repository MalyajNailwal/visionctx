import { gzipSync } from 'node:zlib';

export interface ArchiveEntry { name: string; bytes: Buffer }
function octal(value: number, width: number): string { return value.toString(8).padStart(width - 1, '0') + '\0'; }
function header(name: string, size: number): Buffer {
  if (Buffer.byteLength(name) > 100) throw new Error('Diagnostic filename exceeds tar limit');
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(0o600, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(size, 12), 124, 12, 'ascii');
  block.write(octal(0, 12), 136, 12, 'ascii');
  block.fill(32, 148, 156);
  block.write('0', 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  block.write(octal(checksum, 8), 148, 8, 'ascii');
  return block;
}
export function diagnosticArchive(entries: ArchiveEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('/') || entry.name.includes('..')) throw new Error('Unsafe archive path');
    parts.push(header(entry.name, entry.bytes.length), entry.bytes);
    const remainder = entry.bytes.length % 512;
    if (remainder) parts.push(Buffer.alloc(512 - remainder));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
