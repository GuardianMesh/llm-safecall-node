import fs from 'node:fs';
import YAML from 'yaml';
import { PolicyEngine, type PolicyConfig } from './policy';

export function loadPolicy(path: string) {
  const data: unknown = YAML.parse(fs.readFileSync(path, 'utf-8'));
  return new PolicyEngine((data ?? {}) as PolicyConfig);
}
