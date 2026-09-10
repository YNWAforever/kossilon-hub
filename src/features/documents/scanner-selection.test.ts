import { describe, expect, it, vi } from "vitest";
import { createDocumentScannerForProviderMode } from "./server-fns";
import type { DocumentStorage } from "./types";

const storage = { get: vi.fn(), put: vi.fn(), head: vi.fn(), delete: vi.fn() } as DocumentStorage;
const config = { endpoint: "https://scanner.example/scan", apiKey: "test-key" };

describe("createDocumentScannerForProviderMode", () => {
  it("gives local mode the deterministic scanner, marked as such", () => {
    const scanner = createDocumentScannerForProviderMode("local");
    expect(scanner.verdictSource).toBe("deterministic");
  });

  // simulated is a DEPLOYED mode against a real database, gated to the
  // kossilon-demo firm. Its verdicts are still fixed responses, and 0022
  // established that a simulated result must be recorded as simulated rather
  // than inferred later.
  it("gives simulated mode the deterministic scanner, also marked as such", () => {
    expect(createDocumentScannerForProviderMode("simulated").verdictSource).toBe("deterministic");
  });

  // The defect this function exists for: loadDefaultDocumentContext used to pass
  // createDeterministicDocumentScanner() unconditionally, so live mode marked
  // real malware available.
  it("refuses to hand live mode a deterministic scanner when none is configured", () => {
    expect(() => createDocumentScannerForProviderMode("live")).toThrow(
      /Live document scanning requires DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_API_KEY/,
    );
  });

  it("refuses live mode when the scanner config is explicitly absent", () => {
    expect(() => createDocumentScannerForProviderMode("live", { config: null, storage })).toThrow(
      /DOCUMENT_SCANNER_URL/,
    );
  });

  it("refuses live mode without storage, since a real scan must read the stored bytes", () => {
    expect(() => createDocumentScannerForProviderMode("live", { config })).toThrow(
      /requires document storage/,
    );
  });

  it("gives a fully configured live mode a provider-backed scanner", () => {
    const scanner = createDocumentScannerForProviderMode("live", { config, storage });
    expect(scanner.verdictSource).toBe("provider");
  });

  it("never returns a deterministic scanner for live under any option combination", () => {
    const attempts = [
      () => createDocumentScannerForProviderMode("live"),
      () => createDocumentScannerForProviderMode("live", {}),
      () => createDocumentScannerForProviderMode("live", { storage }),
      () => createDocumentScannerForProviderMode("live", { config: null }),
    ];
    for (const attempt of attempts) {
      let verdictSource: string | undefined;
      try {
        verdictSource = attempt().verdictSource;
      } catch {
        verdictSource = undefined;
      }
      expect(verdictSource).not.toBe("deterministic");
    }
  });
});
