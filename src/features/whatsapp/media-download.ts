import type { DocumentStorage } from "@/features/documents/types";

const OPEN_API_ENDPOINT = "https://open.api.woztell.com/v3";
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const FILE_QUERY = `query InboundFile($fileId: ID) {
  apiViewer {
    file(fileId: $fileId) { fileId fileType size url }
  }
}`;

export type ProviderMediaRef = {
  providerMediaId: string;
  mediaType: string;
  /** Persisted opaque private key, reused after a crashed download attempt. */
  objectKey: string;
};
export type QuarantinedMedia = {
  objectKey: string;
  checksum: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
};
export type MediaDownloadDependencies = {
  accessToken: string;
  /** Exact hosts verified for this provider tenant. No wildcard or IP addresses. */
  allowedMediaHosts: readonly string[];
  storage: DocumentStorage;
  fetchImpl?: typeof fetch;
};

function mediaError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function approvedMediaUrl(value: string, allowedMediaHosts: readonly string[]): URL {
  const url = new URL(value);
  const hosts = new Set(
    allowedMediaHosts.map((host) => {
      const normalized = host.trim().toLowerCase();
      if (
        !/^[a-z0-9.-]+$/.test(normalized) ||
        !normalized.includes(".") ||
        normalized === "localhost" ||
        /^[0-9.]+$/.test(normalized)
      ) {
        throw mediaError("media_host_config_invalid", "Media host allowlist is invalid.");
      }
      return normalized;
    }),
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname.toLowerCase())
  ) {
    throw mediaError(
      "media_url_unapproved",
      "Provider media URL is outside the approved HTTPS host.",
    );
  }
  return url;
}

function detectedContentType(
  bytes: Uint8Array,
): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-")
    return "application/pdf";
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  return null;
}

async function boundedBody(response: Response): Promise<Uint8Array> {
  const headerSize = Number(response.headers.get("content-length"));
  if (headerSize > MAX_MEDIA_BYTES) {
    throw mediaError("media_oversize", "Provider media exceeds the 10 MiB document limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw mediaError("media_empty", "Provider media has no readable body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_MEDIA_BYTES) {
        await reader.cancel();
        throw mediaError("media_oversize", "Provider media exceeds the 10 MiB document limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw mediaError("media_empty", "Provider media is empty.");
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Resolve a provider file ID through WOZTELL's fixed Open API endpoint, then
 * fetch only a tenant-approved media host. This never accepts a webhook URL.
 * Returned bytes remain private and quarantined; a genuine scan and human
 * review are separate steps.
 */
export async function fetchInboundMedia(
  mediaRef: ProviderMediaRef,
  dependencies: MediaDownloadDependencies,
): Promise<QuarantinedMedia> {
  if (
    !mediaRef.providerMediaId.trim() ||
    mediaRef.providerMediaId.length > 256 ||
    !mediaRef.objectKey.startsWith("whatsapp-media/") ||
    !["DOCUMENT", "IMAGE"].includes(mediaRef.mediaType.toUpperCase())
  ) {
    throw mediaError("media_ref_invalid", "Provider media reference is incomplete.");
  }
  if (!dependencies.accessToken.trim() || dependencies.allowedMediaHosts.length === 0) {
    throw mediaError("media_provider_unconfigured", "Provider media access is not configured.");
  }
  const request = dependencies.fetchImpl ?? fetch;
  const lookup = await request(OPEN_API_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${dependencies.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: FILE_QUERY, variables: { fileId: mediaRef.providerMediaId } }),
    redirect: "error",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!lookup.ok) {
    throw mediaError("media_lookup_failed", "Provider media lookup did not succeed.");
  }
  const body = (await lookup.json()) as {
    errors?: unknown[];
    data?: {
      apiViewer?: { file?: { fileId?: string; url?: string; size?: number | string } | null };
    };
  };
  const file = body.data?.apiViewer?.file;
  const providerSize = Number(file?.size);
  if (
    body.errors?.length ||
    !file ||
    file.fileId !== mediaRef.providerMediaId ||
    !file.url ||
    !Number.isSafeInteger(providerSize) ||
    providerSize <= 0
  ) {
    throw mediaError("media_lookup_invalid", "Provider media lookup returned no matching file.");
  }
  if (providerSize > MAX_MEDIA_BYTES) {
    throw mediaError("media_oversize", "Provider media exceeds the 10 MiB document limit.");
  }
  const url = approvedMediaUrl(file.url, dependencies.allowedMediaHosts);
  const response = await request(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (response.status === 403 || response.status === 404 || response.status === 410) {
    throw mediaError(
      "media_manual_reupload",
      "Provider media link expired or disappeared; request a manual client reupload.",
    );
  }
  if (!response.ok) throw mediaError("media_download_failed", "Provider media download failed.");
  const bytes = await boundedBody(response);
  if (bytes.byteLength !== providerSize) {
    throw mediaError("media_size_mismatch", "Provider media size differs from its file metadata.");
  }
  const actualType = detectedContentType(bytes);
  const responseType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (
    !actualType ||
    responseType !== actualType ||
    (mediaRef.mediaType.toUpperCase() === "IMAGE" && actualType === "application/pdf")
  ) {
    throw mediaError("media_mime_mismatch", "Provider media MIME does not match its bytes.");
  }
  const extension =
    actualType === "application/pdf" ? "pdf" : actualType === "image/png" ? "png" : "jpg";
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  const checksum = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const fileName = `whatsapp-media-${checksum.slice(0, 12)}.${extension}`;
  await dependencies.storage.put({
    objectKey: mediaRef.objectKey,
    body: bytes,
    checksum,
    contentType: actualType,
    sizeBytes: bytes.byteLength,
  });
  const stored = await dependencies.storage.get(mediaRef.objectKey);
  if (
    !stored ||
    stored.checksum !== checksum ||
    stored.contentType !== actualType ||
    stored.sizeBytes !== bytes.byteLength ||
    stored.body.byteLength !== bytes.byteLength
  ) {
    throw mediaError(
      "media_storage_mismatch",
      "Private media readback differs from downloaded bytes.",
    );
  }
  const storedDigest = await crypto.subtle.digest("SHA-256", stored.body);
  const storedChecksum = Array.from(new Uint8Array(storedDigest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (storedChecksum !== checksum) {
    throw mediaError("media_storage_mismatch", "Private media readback checksum differs.");
  }
  return {
    objectKey: mediaRef.objectKey,
    checksum,
    contentType: actualType,
    sizeBytes: bytes.byteLength,
    fileName,
  };
}
