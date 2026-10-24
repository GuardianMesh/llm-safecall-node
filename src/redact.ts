export function redactEmailPhone(text: string, fields: string[]) {
  let out = text;
  if (fields.includes('email'))
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
  if (fields.includes('phone')) out = out.replace(/(?:\+?\d[\s-]?){7,}/g, '[REDACTED_PHONE]');
  return out;
}
