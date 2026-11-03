/**
 * What the phone's Back does inside a page (phase 5): a sheet open, a form a step in. The screen
 * that holds Back pushes its action while it is shown and releases it when it goes; Back runs the
 * newest. With none held, Back goes back a page.
 */
const actions: Array<() => void> = [];

/** Hold Back with `action` until the returned function is called. */
export function pushBackAction(action: () => void): () => void {
  actions.push(action);
  return () => {
    const at = actions.lastIndexOf(action);
    if (at >= 0) actions.splice(at, 1);
  };
}

/** Run the newest held action; false when no screen holds Back. */
export function runBackAction(): boolean {
  const action = actions[actions.length - 1];
  if (!action) return false;
  action();
  return true;
}
