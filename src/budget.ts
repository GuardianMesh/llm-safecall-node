import fs from 'node:fs';
import { BudgetExceededError } from './types';
export class Budget {
  constructor(private path = '.llm_safecall_budget.json', private dailyLimit = Infinity) {
    if (!fs.existsSync(this.path)) fs.writeFileSync(this.path, '{}', 'utf-8');
  }
  private today() { return new Date().toISOString().slice(0,10); }
  add(_model: string | undefined, amount: number) {
    const day = this.today(); const data = JSON.parse(fs.readFileSync(this.path, 'utf-8') || '{}');
    const total = (data[day] ?? 0) + amount;
    if (total > this.dailyLimit) throw new BudgetExceededError('Daily budget exceeded');
    data[day] = total; fs.writeFileSync(this.path, JSON.stringify(data));
  }
}
