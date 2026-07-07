let lastCapturedError: unknown;

export function captureError(error: unknown): void {
  lastCapturedError = error;
}

export function consumeLastCapturedError(): unknown {
  const error = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

if (typeof globalThis !== "undefined") {
  globalThis.addEventListener?.("error", (event) => {
    captureError(event.error ?? event.message);
  });
  globalThis.addEventListener?.("unhandledrejection", (event) => {
    captureError(event.reason);
  });
}
