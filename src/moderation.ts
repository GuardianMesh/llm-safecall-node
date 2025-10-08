const BANNED = ['bomb', 'dox', 'credit card number'];
export function checkInput(text: string) {
  const lowered = text.toLowerCase();
  if (BANNED.some((w) => lowered.includes(w))) throw new Error('Input moderation failed');
}
export function checkOutput(text: string) {
  const lowered = text.toLowerCase();
  if (BANNED.some((w) => lowered.includes(w))) throw new Error('Output moderation failed');
}
