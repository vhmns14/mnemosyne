import type { MemoryRecord, CacheStats } from "../types.ts";

/**
 * Dynamic Working Memory L1 Hot Cache
 * High-performance, in-memory LRU ring buffer for sub-millisecond cognitive recall
 */
export class L1HotCache {
  private cache = new Map<string, MemoryRecord>();
  private hits = 0;
  private misses = 0;

  constructor(private capacity: number = 64) {}

  /**
   * Get a memory from L1 hot cache
   */
  get(id: string): MemoryRecord | null {
    if (this.cache.has(id)) {
      this.hits++;
      const val = this.cache.get(id)!;
      // Refresh recency in LRU
      this.cache.delete(id);
      this.cache.set(id, val);
      return val;
    }
    this.misses++;
    return null;
  }

  /**
   * Insert or update a memory in L1 hot cache
   */
  set(id: string, record: MemoryRecord): void {
    if (this.cache.has(id)) {
      this.cache.delete(id);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest item in ring buffer
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(id, record);
  }

  /**
   * Invalidate a memory in L1 hot cache
   */
  delete(id: string): boolean {
    return this.cache.delete(id);
  }

  /**
   * Invalidate alias
   */
  invalidate(id: string): boolean {
    return this.delete(id);
  }

  /**
   * Search through cached hot memories
   */
  find(predicate: (mem: MemoryRecord) => boolean): MemoryRecord[] {
    const results: MemoryRecord[] = [];
    for (const mem of this.cache.values()) {
      if (predicate(mem)) {
        results.push(mem);
      }
    }
    return results;
  }

  /**
   * Get telemetry stats for L1 cache
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRatio = total > 0 ? Number((this.hits / total).toFixed(4)) : 0.0;
    return {
      capacity: this.capacity,
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hit_ratio: hitRatio,
    };
  }

  /**
   * Reset the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
