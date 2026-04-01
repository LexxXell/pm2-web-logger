import { describe, expect, it } from 'vitest';

import { RingBuffer } from '../../src/logs/ring-buffer.js';

describe('RingBuffer', () => {
  it('keeps only the latest values', () => {
    const buffer = new RingBuffer<number>(3);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.size()).toBe(3);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('returns the requested tail limit', () => {
    const buffer = new RingBuffer<string>(5);

    for (const value of ['a', 'b', 'c', 'd']) {
      buffer.push(value);
    }

    expect(buffer.toArray(2)).toEqual(['c', 'd']);
  });
});
