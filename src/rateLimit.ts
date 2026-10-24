import { RateLimitExceededError } from './types';
export class TokenBucket {
  private rate: number;
  private capacity: number;
  private tokens: number;
  private last: number;
  constructor(ratePerSec: number, capacity?: number) {
    if (!Number.isFinite(ratePerSec) || ratePerSec <= 0) {
      throw new RangeError('ratePerSec must be positive and finite');
    }
    this.rate = ratePerSec;
    this.capacity = capacity ?? ratePerSec;
    if (!Number.isFinite(this.capacity) || this.capacity <= 0) {
      throw new RangeError('capacity must be positive and finite');
    }
    this.tokens = this.capacity;
    this.last = performance.now() / 1000;
  }
  take(cost = 1) {
    if (!Number.isFinite(cost) || cost < 0) {
      throw new RangeError('cost must be nonnegative and finite');
    }
    const now = performance.now() / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
    this.last = now;
    if (this.tokens < cost) throw new RateLimitExceededError('Rate limit exceeded');
    this.tokens -= cost;
  }
}
