import { useState, useRef } from "react";

import type { GameStateData } from "../store/gameStore";
import type { BlockerData } from "../services/advanceTimeService";
import { advanceOneDay } from "../services/advanceTimeService";
import { buildAdvanceRecap, detectAttentionEvents } from "../components/dashboard/advanceRecap";
import type { AttentionEventKind, DigestEntry } from "../components/dashboard/advanceRecap";

export type { DigestEntry } from "../components/dashboard/advanceRecap";

export type DigestStopReason =
  | { kind: "match_day" }
  | { kind: "blocked"; blockers: BlockerData[] }
  | { kind: "event"; events: AttentionEventKind[] }
  | { kind: "fired" }
  | { kind: "stopped" }
  | { kind: "error" };

const MAX_DIGEST_DAYS = 60;

export function useDigestAdvance(
  setGameState: (state: GameStateData) => void,
  onFired: () => void,
) {
  const [isRunning, setIsRunning] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [entries, setEntries] = useState<DigestEntry[]>([]);
  const [stopReason, setStopReason] = useState<DigestStopReason | null>(null);
  // Abort flag so an in-flight loop can be cancelled (e.g. on unmount).
  const abortRef = useRef(false);
  const inFlightRef = useRef(false);
  // Warnings the manager has chosen to continue past in this run. Resuming
  // after a blocked stop is that choice, so the warnings it stopped on join the
  // set; a fresh run starts over and checks everything again.
  const acknowledgedRef = useRef<Set<string>>(new Set());
  const lastBlockedIdsRef = useRef<string[]>([]);

  const startDigest = async (options?: { resume?: boolean; acknowledgedBlockerIds?: string[] }) => {
    if (inFlightRef.current) return;
    if (options?.resume) {
      for (const id of lastBlockedIdsRef.current) acknowledgedRef.current.add(id);
    } else {
      acknowledgedRef.current = new Set();
    }
    for (const id of options?.acknowledgedBlockerIds ?? []) acknowledgedRef.current.add(id);
    lastBlockedIdsRef.current = [];
    inFlightRef.current = true;
    abortRef.current = false;
    setIsRunning(true);
    setIsAborting(false);
    // Resuming (e.g. after an attention-event pause) keeps the feed so the
    // digest reads as one continuous run.
    if (!options?.resume) setEntries([]);
    setStopReason(null);

    let daysProcessed = 0;

    try {
      while (daysProcessed < MAX_DIGEST_DAYS) {
        if (abortRef.current) {
          setStopReason({ kind: "stopped" });
          return;
        }

        const result = await advanceOneDay([...acknowledgedRef.current]);

        if (abortRef.current) {
          setStopReason({ kind: "stopped" });
          return;
        }

        if (result.action === "fired") {
          if (result.game) setGameState(result.game as GameStateData);
          setStopReason({ kind: "fired" });
          onFired();
          return;
        }

        if (result.action === "match_day") {
          setStopReason({ kind: "match_day" });
          return;
        }

        if (result.action === "blocked") {
          const blockers = result.blockers ?? [];
          lastBlockedIdsRef.current = blockers.map((blocker) => blocker.id);
          setStopReason({ kind: "blocked", blockers });
          return;
        }

        // action === "advanced"
        if (result.game) {
          const game = result.game as GameStateData;
          setGameState(game);
          const recap = buildAdvanceRecap(game, result.date, result.results ?? []);
          setEntries((prev) => [...prev, { date: result.date, recap }]);
          daysProcessed++;
          const events = detectAttentionEvents(game, recap);
          if (events.length > 0) {
            setStopReason({ kind: "event", events });
            return;
          }
        }
      }
    } catch (err) {
      console.error("[useDigestAdvance] error during digest loop:", err);
      setStopReason({ kind: "error" });
    } finally {
      inFlightRef.current = false;
      setIsRunning(false);
      setIsAborting(false);
    }
  };

  // Present an already-completed batch advance (Skip to Match Day, plain
  // Continue) in the same digest feed the streaming loop fills, so every
  // advance flow shares one UI.
  const showStaticDigest = (staticEntries: DigestEntry[], reason: DigestStopReason | null) => {
    if (inFlightRef.current) return;
    setEntries(staticEntries);
    setStopReason(reason);
  };

  const abortDigest = () => {
    abortRef.current = true;
    setIsAborting(true);
  };

  const dismissDigest = () => {
    setEntries([]);
    setStopReason(null);
  };

  const isVisible = isRunning || entries.length > 0 || stopReason !== null;

  return {
    isRunning,
    isAborting,
    entries,
    stopReason,
    isVisible,
    startDigest,
    showStaticDigest,
    abortDigest,
    dismissDigest,
  };
}
