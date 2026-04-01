import { open } from 'node:fs/promises';

import type { ParsedLine } from '../types/logs.js';
import { parseStaticText } from './line-accumulator.js';

const DEFAULT_CHUNK_SIZE = 64 * 1024;

const countNewlines = (buffer: Buffer): number => {
  let count = 0;

  for (const byte of buffer) {
    if (byte === 0x0a) {
      count += 1;
    }
  }

  return count;
};

export const readLastLines = async (
  filePath: string,
  lineCount: number,
  maxLineLength: number
): Promise<ParsedLine[]> => {
  if (lineCount < 1) {
    return [];
  }

  const handle = await open(filePath, 'r');

  try {
    const stats = await handle.stat();

    if (stats.size === 0) {
      return [];
    }

    const chunks: Buffer[] = [];
    let position = stats.size;
    let newlineCount = 0;

    while (position > 0 && newlineCount <= lineCount) {
      const readSize = Math.min(DEFAULT_CHUNK_SIZE, position);
      position -= readSize;

      const buffer = Buffer.allocUnsafe(readSize);
      const { bytesRead } = await handle.read(buffer, 0, readSize, position);
      const chunk = buffer.subarray(0, bytesRead);
      chunks.unshift(chunk);
      newlineCount += countNewlines(chunk);
    }

    const text = Buffer.concat(chunks).toString('utf8');
    const lines = parseStaticText(text, maxLineLength);

    return lines.slice(-lineCount);
  } finally {
    await handle.close();
  }
};
