import type { ServerResponse } from 'node:http';

export const formatSseEvent = (event: string, payload: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

export const writeSseChunk = (response: ServerResponse, chunk: string): boolean =>
  response.write(chunk);
