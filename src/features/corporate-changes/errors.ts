/**
 * Thrown by the repository when a request id names no row, so a reader can
 * tell "this request does not exist" apart from a failure.
 */
export class CorporateChangeRequestNotFoundError extends Error {
  constructor() {
    super("Corporate change request not found.");
    this.name = "CorporateChangeRequestNotFoundError";
  }
}
