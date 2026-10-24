import fs from 'node:fs';
import { BudgetExceededError } from './types';
export class Budget {
  constructor(
    private path = '.llm_safecall_budget.json',
    private dailyLimit = Infinity,
  ) {
    if (typeof dailyLimit !== 'number' || Number.isNaN(dailyLimit) || dailyLimit < 0) {
      throw new RangeError('dailyLimit must be nonnegative');
    }
    if (!fs.existsSync(this.path))
      fs.writeFileSync(this.path, '{}', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  }
  private today() {
    return new Date().toISOString().slice(0, 10);
  }
  private state() {
    const day = this.today();
    const data = JSON.parse(fs.readFileSync(this.path, 'utf-8') || '{}');
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('Budget file must contain an object');
    }
    const previous = data[day] ?? 0;
    if (typeof previous !== 'number' || !Number.isFinite(previous) || previous < 0) {
      throw new TypeError('Stored budget total must be nonnegative and finite');
    }
    return { day, data, previous };
  }
  assertAvailable() {
    if (this.state().previous >= this.dailyLimit)
      throw new BudgetExceededError('Daily budget exceeded');
  }
  add(_model: string | undefined, amount: number) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError('amount must be nonnegative and finite');
    }
    const { day, data, previous } = this.state();
    const total = previous + amount;
    if (!Number.isFinite(total)) throw new BudgetExceededError('Budget total overflow');
    data[day] = total;
    fs.writeFileSync(this.path, JSON.stringify(data));
    if (total > this.dailyLimit) throw new BudgetExceededError('Daily budget exceeded');
  }
}
