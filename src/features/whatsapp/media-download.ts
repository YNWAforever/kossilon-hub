import { isIP } from "node:net";
import { z } from "zod";
import { boundedProviderBytes } from "./woztell";

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const FILE_QUERY =
  "query KossilonMedia($fileId: ID!) { apiViewer { file(fileId: $fileId) { fileId url size } } }";
const fileSchema = z.object({
  fileId: z.string().min(1),
  url: z.string().min(1),
  size: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform(Number)
    .refine(Number.isSafeInteger),
});

export type MediaDownloadResult =
  | {
      status: "downloaded";
      fileId: string;
      body: Uint8Array;
      checksum: string;
      contentType: "application/pdf" | "image/png" | "image/jpeg";
      sizeBytes: number;
    }
  | { status: "blocked" | "failed"; errorCode: string; retryable: boolean };
export type MediaDownloadOptions = {
  fileId: string;
  accessToken: string;
  /** Exact hosts approved by the storage/security owner; no wildcard or URL input. */
  allowedHosts: readonly string[];
  resolveHost(hostname: string): Promise<readonly string[]>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) !== 6) return false;
  const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  // Only global unicast; IPv4-mapped, loopback, link-local, multicast, ULA,
  // documentation and transition ranges are refused rather than guessed safe.
  return (
    /^[23]/.test(normalized) &&
    !/^2001:(db8|0|10|20)(:|$)/.test(normalized) &&
    !normalized.startsWith("2002:")
  );
}

function permittedUrl(value: string, hosts: ReadonlySet<string>): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      !hosts.has(url.hostname.toLowerCase())
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function matchingMime(body: Uint8Array, mime: string): body is Uint8Array {
  if (mime === "application/pdf") return new TextDecoder().decode(body.slice(0, 5)) === "%PDF-";
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => body[i] === byte);
  return (
    mime === "image/jpeg" &&
    body[0] === 255 &&
    body[1] === 216 &&
    body[2] === 255 &&
    body[body.length - 2] === 255 &&
    body[body.length - 1] === 217
  );
}

/**
 * Official WOZTELL apiViewer.file(fileId) -> bounded unauthenticated CDN read.
 * https://doc.woztell.com/open-api-reference/ (RetrieveFilePayload/file)
 * Never consumes a URL from an inbound message, or invents a waMediaId endpoint.
 * This returns untrusted bytes only; the existing upload/scan/version lifecycle
 * must quarantine them before any preview or business review.
 */
export async function downloadWoztellMedia(
  options: MediaDownloadOptions,
): Promise<MediaDownloadResult> {
  const blocked = (errorCode: string): MediaDownloadResult => ({
    status: "blocked",
    errorCode,
    retryable: false,
  });
  const timeoutMs = options.timeoutMs ?? 15_000;
  const hosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  if (!hosts.size) return blocked("media-host-policy-missing");
  if (!options.accessToken.trim()) return blocked("media-provider-unconfigured");
  if (
    !options.fileId.trim() ||
    options.fileId.length > 200 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    [...hosts].some((host) => !permittedUrl(`https://${host}/`, hosts))
  )
    return blocked("media-config-invalid");
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const perform = async (): Promise<MediaDownloadResult> => {
    const response = await fetchImpl("https://open.api.woztell.com/v3", {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: FILE_QUERY, variables: { fileId: options.fileId } }),
    });
    controller.signal.throwIfAborted();
    if (!response.ok)
      return {
        status: response.status === 401 || response.status === 403 ? "blocked" : "failed",
        errorCode: `media-provider-http-${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    const envelope = JSON.parse(
      new TextDecoder().decode(await boundedProviderBytes(response, controller.signal, 32 * 1024)),
    );
    const parsed = fileSchema.safeParse(envelope?.data?.apiViewer?.file);
    if (envelope?.errors?.length || !parsed.success || parsed.data.fileId !== options.fileId)
      return blocked("media-provider-contract");
    if (parsed.data.size < 1 || parsed.data.size > MAX_MEDIA_BYTES)
      return blocked("media-too-large");
    let candidate = parsed.data.url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const url = permittedUrl(candidate, hosts);
      if (!url) return blocked("media-url-refused");
      const addresses = await options.resolveHost(url.hostname);
      controller.signal.throwIfAborted();
      if (!addresses.length || addresses.some((address) => !publicAddress(address)))
        return blocked("media-private-host");
      const media = await fetchImpl(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "application/pdf,image/png,image/jpeg" },
      });
      controller.signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(media.status)) {
        const location = media.headers.get("location");
        void media.body?.cancel().catch(() => undefined);
        if (!location || redirects === 3) return blocked("media-redirect-refused");
        candidate = new URL(location, url).toString();
        continue;
      }
      if (!media.ok || media.status !== 200)
        return {
          status: "failed",
          errorCode: `media-http-${media.status}`,
          retryable: media.status === 429 || media.status >= 500,
        };
      const contentType =
        media.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!["application/pdf", "image/png", "image/jpeg"].includes(contentType)) {
        void media.body?.cancel().catch(() => undefined);
        return blocked("media-mime-refused");
      }
      const length = media.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_MEDIA_BYTES)) {
        void media.body?.cancel().catch(() => undefined);
        return blocked("media-too-large");
      }
      const body = await boundedProviderBytes(media, controller.signal, MAX_MEDIA_BYTES);
      if (body.byteLength !== parsed.data.size || !matchingMime(body, contentType))
        return blocked("media-content-mismatch");
      const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(body));
      controller.signal.throwIfAborted();
      const checksum = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return {
        status: "downloaded",
        fileId: options.fileId,
        body,
        checksum,
        contentType: contentType as "application/pdf" | "image/png" | "image/jpeg",
        sizeBytes: body.byteLength,
      };
    }
    return blocked("media-redirect-refused");
  };
  try {
    return await Promise.race([
      perform().catch(
        (): MediaDownloadResult => ({
          status: "failed",
          errorCode: controller.signal.aborted ? "media-timeout" : "media-download-failed",
          retryable: true,
        }),
      ),
      new Promise<MediaDownloadResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: "failed", errorCode: "media-timeout", retryable: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
