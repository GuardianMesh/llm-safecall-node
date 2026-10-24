const BASH_BLOCK = /```(?:bash|sh|zsh|powershell|cmd)[\s\S]*?```/gi;
const DANGEROUS_CMD = /\b(rm\s+-rf|curl\s+|wget\s+|Invoke-WebRequest|powershell\s+-)\b/gi;
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const AMBIGUOUS_PATH = /%(?:2e|2f|5c|25)/i;
export function stripCodeBlocks(text: string, allowShell: boolean) {
  return allowShell ? text : text.replace(BASH_BLOCK, '[REDACTED_SHELL_BLOCK]');
}
export function stripDangerousCommands(text: string, allowShell: boolean) {
  return allowShell ? text : text.replace(DANGEROUS_CMD, '[REDACTED_SHELL_CMD]');
}
function safePath(url: string): boolean {
  // URL normalizes dot segments before exposing pathname, so inspect the source path.
  const path = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(url)?.[1];
  return (
    path !== undefined &&
    !AMBIGUOUS_PATH.test(path) &&
    !path.split('/').some((segment) => segment === '.' || segment === '..')
  );
}
export function allowlistUrls(text: string, allowlist: string[]) {
  if (!allowlist.length) return text;
  return text.replace(URL_RE, (url) => {
    const allowed = allowlist.some((prefix) => {
      try {
        const target = new URL(url);
        const base = new URL(prefix);
        return (
          !target.username &&
          !target.password &&
          !base.username &&
          !base.password &&
          !url.includes('\\') &&
          !prefix.includes('\\') &&
          safePath(url) &&
          safePath(prefix) &&
          target.origin === base.origin &&
          (target.pathname === base.pathname ||
            target.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')) &&
          (!base.search || target.search === base.search)
        );
      } catch {
        return false;
      }
    });
    return allowed ? url : '[BLOCKED_URL]';
  });
}
