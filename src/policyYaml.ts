import fs from 'node:fs';
import YAML from 'yaml';
import { PolicyEngine } from './policy';
export function loadPolicy(path: string) {
  const data = YAML.parse(fs.readFileSync(path, 'utf-8'));
  return new PolicyEngine(data);
}
