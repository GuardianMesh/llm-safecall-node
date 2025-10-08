const patterns: Record<string, RegExp> = {
  aws_access_key_id: /\bAKIA[0-9A-Z]{16}\b/g,
  aws_secret_access_key: /\b(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9/+=]{40}\b/g,
  gcp_api_key: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  slack_webhook: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/]+/g,
  github_pat: /\bghp_[A-Za-z0-9]{36}\b/g,
  private_key_block: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----[\s\S]+?-----END \1 PRIVATE KEY-----/gm,
  generic_bearer: /\bBearer\s+[A-Za-z0-9\-_=\.\/]+\b/g
};
export type Finding = { name: string; start: number; end: number; match: string };
export function scanSecrets(text: string): Finding[] {
  const out: Finding[] = [];
  for (const [name, re] of Object.entries(patterns)) {
    for (const m of text.matchAll(re)) {
      if (m.index !== undefined) out.push({ name, start: m.index, end: m.index + m[0].length, match: m[0] });
    }
  }
  return out;
}
export function redactFindings(text: string, finds: Finding[]) {
  let out = text;
  for (const f of [...finds].sort((a,b) => b.start - a.start)) {
    out = out.slice(0, f.start) + `[REDACTED_${f.name.toUpperCase()}]` + out.slice(f.end);
  }
  return out;
}
