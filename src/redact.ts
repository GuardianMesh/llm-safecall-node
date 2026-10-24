function asciiLetter(value: string): boolean {
  return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z');
}

function emailEnd(text: string, domainStart: number): number {
  let end = -1;
  let lettersAfterDot = -1;
  for (let index = domainStart; index < text.length; index++) {
    const char = text[index];
    const letter = asciiLetter(char);
    if (!letter && !(char >= '0' && char <= '9') && char !== '.' && char !== '-') break;
    if (char === '.') lettersAfterDot = index > domainStart ? 0 : -1;
    else if (letter && lettersAfterDot >= 0) {
      lettersAfterDot++;
      if (lettersAfterDot >= 2) end = index + 1;
    } else lettersAfterDot = -1;
  }
  return end;
}

function redactEmails(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  // Each local-part token and following domain is scanned once, including failed matches.
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+/g)) {
    const start = Math.max(match.index, cursor);
    const localEnd = match.index + match[0].length;
    if (start >= localEnd || text[localEnd] !== '@') continue;
    const end = emailEnd(text, localEnd + 1);
    if (end < 0) continue;
    parts.push(text.slice(cursor, start), '[REDACTED_EMAIL]');
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

export function redactEmailPhone(text: string, fields: string[]) {
  let out = text;
  if (fields.includes('email')) out = redactEmails(out);
  if (fields.includes('phone')) out = out.replace(/(?:\+?\d[\s-]?){7,}/g, '[REDACTED_PHONE]');
  return out;
}
