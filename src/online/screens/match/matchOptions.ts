/** The open options, and the side's current one even when closed, so it shows as the chosen. */
export function withCurrent<T extends string>(open: T[], current: string): T[] {
  return open.includes(current as T) ? open : [current as T, ...open];
}
