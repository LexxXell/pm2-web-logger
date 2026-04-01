import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readLastLines } from '../../src/logs/tail-reader.js';
import { createTempDir, removeTempDir } from '../helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

describe('readLastLines', () => {
  it('returns only the requested tail', async () => {
    tempDir = await createTempDir();
    const filePath = path.join(tempDir, 'strapi-out.log');
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\n');

    await writeFile(filePath, `${lines}\n`, 'utf8');

    const tail = await readLastLines(filePath, 3, 1024);

    expect(tail.map((entry) => entry.line)).toEqual(['line-18', 'line-19', 'line-20']);
  });

  it('truncates pathological long lines safely', async () => {
    tempDir = await createTempDir();
    const filePath = path.join(tempDir, 'strapi-out.log');

    await writeFile(filePath, `${'x'.repeat(32)}\n`, 'utf8');

    const [entry] = await readLastLines(filePath, 1, 10);

    expect(entry?.line).toBe('xxxxxxxxxx [truncated]');
    expect(entry?.truncated).toBe(true);
  });
});
