import { RateLimitExceededError } from './types';
export class TokenBucket {
  private rate: number; private capacity: number; private tokens: number; private last: number;
  constructor(ratePerSec: number, capacity?: number) {
    this.rate = ratePerSec; this.capacity = capacity ?? ratePerSec; this.tokens = this.capacity; this.last = Date.now()/1000;
  }
  take(cost = 1) {
    const now = Date.now()/1000;
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
    this.last = now;
    if (this.tokens < cost) throw new RateLimitExceededError('Rate limit exceeded');
    this.tokens -= cost;
  }
}
