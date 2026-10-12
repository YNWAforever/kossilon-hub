export class BusinessHandoverRejection extends Error {
  constructor(readonly reason: "staff_version_conflict" | "recipient_unavailable") {
    super(reason);
    this.name = "BusinessHandoverRejection";
  }
  readonly beforeWrite = true;
}
