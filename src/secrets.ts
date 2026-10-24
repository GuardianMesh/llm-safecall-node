const patterns: Record<string, RegExp> = {
  aws_access_key_id: /\bAKIA[0-9A-Z]{16}\b/g,
  aws_secret_access_key:
    /\b(?=[A-Za-z0-9/+=]{0,39}[A-Za-z])(?=[A-Za-z0-9/+=]{0,39}\d)[A-Za-z0-9/+=]{40}\b/g,
  gcp_api_key: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  slack_webhook: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/]+/g,
  github_pat: /\bghp_[A-Za-z0-9]{36}\b/g,
  private_key_block:
    /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY|PGP PRIVATE KEY(?: BLOCK)?)-----[\s\S]+?-----END \1-----/gm,
  generic_bearer: /\bBearer\s+[A-Za-z0-9\-_=./]+\b/g,
};
export type Finding = { name: string; start: number; end: number; match: string };
export function scanSecrets(text: string): Finding[] {
  const out: Finding[] = [];
  for (const [name, re] of Object.entries(patterns)) {
    for (const m of text.matchAll(re)) {
      if (m.index !== undefined)
        out.push({ name, start: m.index, end: m.index + m[0].length, match: m[0] });
    }
  }
  return out;
}
export function redactFindings(text: string, finds: Finding[]) {
  const ranges: Finding[] = [];
  for (const finding of [...finds].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = ranges.at(-1);
    if (previous && finding.start < previous.end) {
      previous.end = Math.max(previous.end, finding.end);
    } else {
      ranges.push({ ...finding });
    }
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const finding of ranges) {
    parts.push(text.slice(cursor, finding.start), `[REDACTED_${finding.name.toUpperCase()}]`);
    cursor = finding.end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}
