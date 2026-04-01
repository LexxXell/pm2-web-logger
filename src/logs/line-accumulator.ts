import type { ParsedLine } from '../types/logs.js';

const TRUNCATED_SUFFIX = ' [truncated]';

export class LineAccumulator {
  private currentLine = '';
  private discardingOverflow = false;

  public constructor(private readonly maxLineLength: number) {}

  public pushChunk(text: string): ParsedLine[] {
    const lines: ParsedLine[] = [];
    let segmentStart = 0;

    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '\n') {
        continue;
      }

      let segment = text.slice(segmentStart, index);

      if (segment.endsWith('\r')) {
        segment = segment.slice(0, -1);
      }

      this.consumeSegment(segment, true, lines);
      segmentStart = index + 1;
    }

    if (segmentStart < text.length) {
      this.consumeSegment(text.slice(segmentStart), false, lines);
    }

    return lines;
  }

  public flushRemainder(): ParsedLine[] {
    if (this.currentLine.length === 0 && !this.discardingOverflow) {
      return [];
    }

    const line = this.emitCurrentLine();
    return [line];
  }

  public reset(): void {
    this.currentLine = '';
    this.discardingOverflow = false;
  }

  private consumeSegment(segment: string, complete: boolean, lines: ParsedLine[]): void {
    if (this.discardingOverflow) {
      if (complete) {
        lines.push(this.emitCurrentLine());
      }

      return;
    }

    const available = this.maxLineLength - this.currentLine.length;

    if (segment.length <= available) {
      this.currentLine += segment;
    } else {
      if (available > 0) {
        this.currentLine += segment.slice(0, available);
      }

      this.discardingOverflow = true;
    }

    if (complete) {
      lines.push(this.emitCurrentLine());
    }
  }

  private emitCurrentLine(): ParsedLine {
    const truncated = this.discardingOverflow;
    const line = truncated ? `${this.currentLine}${TRUNCATED_SUFFIX}` : this.currentLine;

    this.reset();

    return {
      line,
      truncated
    };
  }
}

export const parseStaticText = (text: string, maxLineLength: number): ParsedLine[] => {
  const accumulator = new LineAccumulator(maxLineLength);
  const lines = accumulator.pushChunk(text);
  lines.push(...accumulator.flushRemainder());
  return lines;
};
