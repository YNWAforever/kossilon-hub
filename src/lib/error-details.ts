// Formats a caught error into something a user can copy out of the page.
//
// This exists because the deployment has no error reporting at all:
// reportLovableError calls window.__lovableEvents, a global Lovable injects
// that does not exist on this host, so it is a silent no-op, and the server
// logs belong to an account that does not own this repo. That left
// console.error as the only sink, which is no help when someone reports
// "Something went wrong" from a screen you cannot reach.
export function errorDetails(error: unknown, pathname: string): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : "(no stack)";

  return [`route: ${pathname}`, `${name}: ${message}`, "", stack].join("\n");
}
