import { useEffect, useRef, useState } from "react";
import { pickRandomVerb, type StatusVerbSetId } from "./status-verbs";

/**
 * Returns a verb from the given set, changing every `intervalMs`.
 * The verb text is for VISUAL entertainment only — do NOT put it inside an
 * accessibilityLiveRegion (see the recording screen: keep the a11y label
 * stable and hide the cycling text from AT).
 *
 * Pass `enabled=false` (default) to keep the timer stopped — the hook only
 * cycles while work is actually in progress, so an idle screen never pays
 * for a periodic re-render.
 */
export function useCyclingStatus(
  setId: StatusVerbSetId,
  language: string,
  intervalMs = 2200,
  enabled = false,
): string {
  const [verb, setVerb] = useState(() => pickRandomVerb(setId, language));
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return; // idle — no timer, no re-renders
    prevRef.current = null;
    setVerb(pickRandomVerb(setId, language));
    const timer = setInterval(() => {
      setVerb((current) => {
        const next = pickRandomVerb(setId, language, current);
        prevRef.current = next;
        return next;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [setId, language, intervalMs, enabled]);

  return verb;
}
