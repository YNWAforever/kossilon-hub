import type { ChildProcess } from "node:child_process";

// Own a directly spawned test child without OS descendants. Vitest probe uses threads.
export function ownTestChild(child: ChildProcess, signal: AbortSignal) {
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const stop = () => {
    if (child.pid && !child.killed && child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  };
  const detach = () => signal.removeEventListener("abort", stop);
  signal.addEventListener("abort", stop, { once: true });
  void closed.then(detach, detach);
  if (signal.aborted) stop();
  return {
    closed,
    cleanup: async () => {
      stop();
      try {
        await closed;
      } finally {
        detach();
      }
    },
  };
}
