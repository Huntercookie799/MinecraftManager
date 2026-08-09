export class RingBuffer<T> {
  private readonly items: T[] = [];
  private cursor = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("RingBuffer capacity must be a positive integer.");
    }
  }

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return;
    }

    this.items[this.cursor] = item;
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  toArray(): T[] {
    if (this.items.length < this.capacity) {
      return [...this.items];
    }

    return [...this.items.slice(this.cursor), ...this.items.slice(0, this.cursor)];
  }
}
