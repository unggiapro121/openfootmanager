/**
 * Room codes as a coach types and reads them (S-12 S12-29): six characters of an alphabet without
 * 0/O and 1/I, shown `XXX-XXX`. The server reads a code with or without its dash, in any case;
 * this only keeps the field tidy while it is typed.
 */

const CODE_CHARACTERS = /[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g;

/** What the coach typed, as the code field shows it: upper case, the dash after three. */
export function typedCode(input: string): string {
  const characters = input.toUpperCase().replace(CODE_CHARACTERS, "").slice(0, 6);
  return characters.length > 3 ? `${characters.slice(0, 3)}-${characters.slice(3)}` : characters;
}

/** Whether a typed code has its six characters. */
export function isWholeCode(typed: string): boolean {
  return typed.replace("-", "").length === 6;
}

/** Time waited since `since` (ISO), as `m:ss`. */
export function waitedText(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
