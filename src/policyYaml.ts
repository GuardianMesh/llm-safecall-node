import fs from 'node:fs'; import YAML from 'yaml'; import { PolicyEngine } from './policy'; export function loadPolicy(p:string){ return new PolicyEngine(YAML.parse(fs.readFileSync(p,'utf-8'))); }
