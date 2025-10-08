const BASH_BLOCK = /```(?:bash|sh|zsh|powershell|cmd)[\s\S]*?```/gi;
const DANGEROUS_CMD = /\b(rm\s+-rf|curl\s+|wget\s+|Invoke-WebRequest|powershell\s+-)\b/gi;
const URL_RE = /https?:\/\/[\w\-.]+(?:\/[\w\-.\/%?#=&]*)?/gi;
export function stripCodeBlocks(text: string, allowShell: boolean) {
  return allowShell ? text : text.replace(BASH_BLOCK, '[REDACTED_SHELL_BLOCK]');
}
export function stripDangerousCommands(text: string, allowShell: boolean) {
  return allowShell ? text : text.replace(DANGEROUS_CMD, '[REDACTED_SHELL_CMD]');
}
export function allowlistUrls(text: string, allowlist: string[]) {
  if (!allowlist.length) return text;
  const urls = new Set(text.match(URL_RE) ?? []);
  let out = text;
  for (const url of urls) {
    if (!allowlist.some((p) => url.startsWith(p))) out = out.replaceAll(url, '[BLOCKED_URL]');
  }
  return out;
}
