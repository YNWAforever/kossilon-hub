// Guards a `mutate` call with a plain ref flag, checked and set *synchronously* — independent of
// any render or scheduler. TanStack Query's own `isPending` is not enough on its own: it defers
// the re-render that flips `isPending` to `true` via `setTimeout(fn, 0)` (see
// `notifyManager`/`MutationObserver` in `@tanstack/query-core`), not synchronously and not even
// via a microtask. In ordinary human use that gap closes long before a second click could land,
// but two `mutate()` calls issued back to back in the same tick (a double-click fast enough, or
// anything scripted) can both fire before that timer runs, both closing over the same stale
// snapshot of whatever data they patch. Wrapping every `mutate` call site with this guard makes a
// second call a deterministic no-op regardless of that timing, rather than relying on a rendered
// `disabled` attribute alone.
export function guardMutation<Args>(
  inFlightRef: { current: boolean },
  mutate: (args: Args) => void,
): (args: Args) => void {
  return (args) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    mutate(args);
  };
}
