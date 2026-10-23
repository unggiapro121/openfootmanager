import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/**
 * One clock for every countdown of the online mode (C-2 §3.10): the shell ticks it once a
 * second, so a page of countdowns is one timer, not one per card.
 */
const OnlineClock = createContext<number | null>(null);

export function OnlineClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <OnlineClock.Provider value={now}>{children}</OnlineClock.Provider>;
}

/** Now, as the online shell's clock last ticked; the real clock outside the shell. */
export function useOnlineNow(): number {
  return useContext(OnlineClock) ?? Date.now();
}
