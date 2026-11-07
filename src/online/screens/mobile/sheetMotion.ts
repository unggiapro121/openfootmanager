/**
 * The way a phone sheet leaves (design .sheet, analysis-mobile-dropdowns bản 2): it rises in
 * 220 ms (`animate-sheet-up`) and goes down faster, 180 ms, speeding up as it goes, while the
 * dimmed page fades. Run with the Web Animations API so the sheet is only taken off the page
 * once the slide is over. Where the webview cannot animate, or the player asked for less motion,
 * it simply goes.
 */
const LEAVE_MS = 180;
const SETTLE_MS = 160;
const LEAVE_EASING = "cubic-bezier(0.4, 0, 1, 1)";
const SETTLE_EASING = "cubic-bezier(0, 0, 0.2, 1)";

function canAnimate(element: HTMLElement | null): element is HTMLElement {
  return element !== null && typeof element.animate === "function";
}

/** Slide `panel` down and fade `dim`, then `done`; at once when there is nothing to animate. */
export function slideSheetAway(
  panel: HTMLElement | null,
  dim: HTMLElement | null,
  reducedMotion: boolean,
  done: () => void,
): void {
  if (reducedMotion || !canAnimate(panel)) {
    done();
    return;
  }
  // From wherever a drag left it, not from the top.
  const from = panel.style.transform || "none";
  const slide = panel.animate([{ transform: from }, { transform: "translateY(100%)" }], {
    duration: LEAVE_MS,
    easing: LEAVE_EASING,
    fill: "forwards",
  });
  if (canAnimate(dim)) {
    dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LEAVE_MS, fill: "forwards" });
  }
  slide.finished.then(done, done);
}

/** Put a sheet dragged down by `by` pixels back in place. */
export function settleSheet(panel: HTMLElement | null, by: number, reducedMotion: boolean): void {
  if (!panel) return;
  panel.style.transform = "";
  if (by <= 0 || reducedMotion || !canAnimate(panel)) return;
  panel.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }], {
    duration: SETTLE_MS,
    easing: SETTLE_EASING,
  });
}
