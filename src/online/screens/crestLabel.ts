/** Up to three letters for a club's crest: the initials of its words, or its first letters. */
export function crestLabel(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((word) => word[0]).join("") : name.slice(0, 3);
}
