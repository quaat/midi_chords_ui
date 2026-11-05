/** Fixed-capacity FIFO that drops the oldest entries once full. */
export class RingBuffer<T> {
  private items: T[] = [];
  private start = 0;
  private dropped = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return;
    }
    this.items[this.start] = item;
    this.start = (this.start + 1) % this.capacity;
    this.dropped += 1;
  }

  /** Entries oldest → newest (a copy). */
  toArray(): T[] {
    if (this.start === 0) {
      return this.items.slice();
    }
    return this.items.slice(this.start).concat(this.items.slice(0, this.start));
  }

  get size(): number {
    return this.items.length;
  }

  /** Number of entries discarded because the buffer was full. */
  get droppedCount(): number {
    return this.dropped;
  }

  clear(): void {
    this.items = [];
    this.start = 0;
    this.dropped = 0;
  }
}
