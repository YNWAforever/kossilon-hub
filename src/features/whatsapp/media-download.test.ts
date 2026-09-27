import { describe, expect, it, vi } from "vitest";
import type { DocumentStorage } from "@/features/documents/types";
import { fetchInboundMedia } from "./media-download";

const pdf = new TextEncoder().encode("%PDF-1.7\nT19 local fixture");
const endpoint = "https://open.api.woztell.com/v3";
const mediaUrl = "https://media.woztell.com/f/test-file";
const ref = {
  providerMediaId: "provider-file-1",
  mediaType: "DOCUMENT",
  objectKey: "whatsapp-media/test-1",
};

function storage(): DocumentStorage {
  const objects = new Map<
    string,
    { body: Uint8Array; checksum: string; contentType: string; sizeBytes: number }
  >();
  return {
    put: vi.fn(async (input) => {
      const body = new Uint8Array(input.body);
      objects.set(input.objectKey, {
        body,
        checksum: input.checksum,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });
      return {
        objectKey: input.objectKey,
        checksum: input.checksum,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      };
    }),
    get: vi.fn(async (key) => {
      const item = objects.get(key);
      return item
        ? {
            objectKey: key,
            checksum: item.checksum,
            contentType: item.contentType,
            sizeBytes: item.sizeBytes,
            body: item.body.buffer as ArrayBuffer,
          }
        : null;
    }),
    head: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
}

function providerFetch(url = mediaUrl, body = pdf, contentType = "application/pdf"): typeof fetch {
  return vi.fn(async (input) => {
    if (String(input) === endpoint) {
      return new Response(
        JSON.stringify({
          data: {
            apiViewer: {
              file: {
                fileId: ref.providerMediaId,
                url,
                size: body.byteLength,
                fileType: "OTHER",
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(input) === url) {
      return new Response(body, {
        status: 200,
        headers: { "content-type": contentType, "content-length": String(body.byteLength) },
      });
    }
    throw new Error("Unexpected external URL");
  }) as typeof fetch;
}

describe("T19 inbound media", () => {
  it("t19_scenario_1 rejects unsafe provider URLs, wrong MIME and oversized bytes before storage", async () => {
    const safeStorage = storage();
    const goodFetch = providerFetch();
    const result = await fetchInboundMedia(ref, {
      accessToken: "test-token",
      allowedMediaHosts: ["media.woztell.com"],
      storage: safeStorage,
      fetchImpl: goodFetch,
    });
    expect(result).toMatchObject({
      objectKey: ref.objectKey,
      contentType: "application/pdf",
      sizeBytes: pdf.byteLength,
    });
    expect(safeStorage.put).toHaveBeenCalledTimes(1);
    expect(goodFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(goodFetch).mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(vi.mocked(goodFetch).mock.calls[1][1]).toMatchObject({ redirect: "error" });

    const oversizedFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === endpoint)
        return new Response(
          JSON.stringify({
            data: {
              apiViewer: {
                file: {
                  fileId: ref.providerMediaId,
                  url: mediaUrl,
                  size: 10 * 1024 * 1024 + 1,
                },
              },
            },
          }),
          { status: 200 },
        );
      throw new Error("Oversize media must not be fetched");
    }) as typeof fetch;
    const oversizedStorage = storage();
    await expect(
      fetchInboundMedia(ref, {
        accessToken: "test-token",
        allowedMediaHosts: ["media.woztell.com"],
        storage: oversizedStorage,
        fetchImpl: oversizedFetch,
      }),
    ).rejects.toMatchObject({ code: "media_oversize" });
    expect(oversizedFetch).toHaveBeenCalledTimes(1);
    expect(oversizedStorage.put).not.toHaveBeenCalled();

    const expiredFetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === endpoint
        ? new Response(
            JSON.stringify({
              data: {
                apiViewer: {
                  file: {
                    fileId: ref.providerMediaId,
                    url: mediaUrl,
                    size: pdf.byteLength,
                  },
                },
              },
            }),
            { status: 200 },
          )
        : new Response(null, { status: 410 }),
    ) as typeof fetch;
    await expect(
      fetchInboundMedia(ref, {
        accessToken: "test-token",
        allowedMediaHosts: ["media.woztell.com"],
        storage: storage(),
        fetchImpl: expiredFetch,
      }),
    ).rejects.toMatchObject({ code: "media_manual_reupload" });

    for (const hostile of [
      "http://127.0.0.1/private",
      "https://169.254.169.254/latest",
      "https://evil.example/file",
    ]) {
      const deniedFetch = providerFetch(hostile);
      const deniedStorage = storage();
      await expect(
        fetchInboundMedia(ref, {
          accessToken: "test-token",
          allowedMediaHosts: ["media.woztell.com"],
          storage: deniedStorage,
          fetchImpl: deniedFetch,
        }),
      ).rejects.toThrow(/url|host|https|media/i);
      expect(deniedFetch).toHaveBeenCalledTimes(1);
      expect(deniedStorage.put).not.toHaveBeenCalled();
    }
    await expect(
      fetchInboundMedia(ref, {
        accessToken: "test-token",
        allowedMediaHosts: ["media.woztell.com"],
        storage: storage(),
        fetchImpl: providerFetch(mediaUrl, pdf, "text/html"),
      }),
    ).rejects.toThrow(/mime|content|type/i);
  });

  it("t19_scenario_2 keeps downloaded bytes quarantined until the existing scanner and human review", async () => {
    const safeStorage = storage();
    const result = await fetchInboundMedia(ref, {
      accessToken: "test-token",
      allowedMediaHosts: ["media.woztell.com"],
      storage: safeStorage,
      fetchImpl: providerFetch(),
    });
    expect(result).toHaveProperty("checksum");
    expect(result).not.toHaveProperty("scanVerdict", "clean");
    expect(result).not.toHaveProperty("reviewStatus", "verified");
  });
});
