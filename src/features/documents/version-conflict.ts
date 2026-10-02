/** A decision must refer to the version the caller actually inspected. */
export class DocumentVersionConflictError extends Error {
  readonly statusCode = 409;
  constructor(message = "Document version changed; reload the current evidence before review.") {
    super(message);
    this.name = "DocumentVersionConflictError";
  }
}

/** The RPC layer returns the same reload contract as other versioned commands. */
export async function withDocumentVersionConflict<T>(command: () => Promise<T>): Promise<T> {
  try {
    return await command();
  } catch (error) {
    if (error instanceof DocumentVersionConflictError) {
      throw new Response(JSON.stringify({ code: "version_conflict", message: error.message }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    throw error;
  }
}
