export class RingBuffer<T> {
  private readonly items: Array<T | undefined>;
  private nextIndex = 0;
  private count = 0;

  public constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('RingBuffer capacity must be a positive integer');
    }

    this.items = new Array<T | undefined>(capacity);
  }

  public push(item: T): void {
    this.items[this.nextIndex] = item;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  public size(): number {
    return this.count;
  }

  public toArray(limit = this.count): T[] {
    const boundedLimit = Math.max(0, Math.min(limit, this.count));
    const result: T[] = [];
    const start = (this.nextIndex - this.count + this.capacity) % this.capacity;

    for (let index = 0; index < boundedLimit; index += 1) {
      const item = this.items[(start + this.count - boundedLimit + index) % this.capacity];

      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }
}
