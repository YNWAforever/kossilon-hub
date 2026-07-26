import type { R2BucketLike } from "./runtime-env";

// R2BucketLike backed by R2's S3-compatible API, for runtimes without a Workers
// binding (Vercel, Node). Signing is AWS SigV4 over Web Crypto so the same module
// runs unchanged on Workers, Vercel, and Node.

const ALGORITHM = "AWS4-HMAC-SHA256";
const REGION = "auto";
const SERVICE = "s3";
const METADATA_PREFIX = "x-amz-meta-";
const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// S3 lowercases user metadata keys on the wire, so original casing must be restored
// on read. Register any new customMetadata key written by document storage here.
const CUSTOM_METADATA_KEYS = ["checksumSha256", "sizeBytes"] as const;

export type R2S3BucketConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
};

type PutOptions = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function hmacSha256(key: Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

export async function hmacSha256Hex(key: Uint8Array, data: string): Promise<string> {
  return toHex(await hmacSha256(key, data));
}

// RFC 3986 encoding: encodeURIComponent leaves !'()* unescaped, but S3 signs them escaped.
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucketName: string, objectKey: string): string {
  return `/${[bucketName, ...objectKey.split("/")].map(encodeSegment).join("/")}`;
}

async function derivedSigningKey(secretAccessKey: string, dateStamp: string): Promise<Uint8Array> {
  let key = new TextEncoder().encode(`AWS4${secretAccessKey}`);
  for (const part of [dateStamp, REGION, SERVICE, "aws4_request"]) {
    key = new Uint8Array(await hmacSha256(key, part));
  }
  return key;
}

async function authorizationHeaders(input: {
  method: string;
  path: string;
  host: string;
  payloadHash: string;
  headers: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string;
}): Promise<Record<string, string>> {
  const dateStamp = input.amzDate.slice(0, 8);
  const signed: Record<string, string> = {
    ...input.headers,
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": input.amzDate,
  };

  const names = Object.keys(signed)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(signed[name] ?? "").trim()}\n`)
    .join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    input.method,
    input.path,
    "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    input.amzDate,
    scope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signature = await hmacSha256Hex(
    await derivedSigningKey(input.secretAccessKey, dateStamp),
    stringToSign,
  );

  return {
    ...signed,
    authorization:
      `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function metadataHeaders(customMetadata: Record<string, string> | undefined) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(customMetadata ?? {})) {
    headers[`${METADATA_PREFIX}${key.toLowerCase()}`] = value;
  }
  return headers;
}

function readCustomMetadata(headers: Headers): Record<string, string> {
  const original = new Map(CUSTOM_METADATA_KEYS.map((key) => [key.toLowerCase(), key as string]));
  const metadata: Record<string, string> = {};

  headers.forEach((value, name) => {
    if (!name.toLowerCase().startsWith(METADATA_PREFIX)) return;
    const raw = name.toLowerCase().slice(METADATA_PREFIX.length);
    metadata[original.get(raw) ?? raw] = value;
  });

  return metadata;
}

function readHttpMetadata(headers: Headers): { contentType?: string } | undefined {
  const contentType = headers.get("content-type");
  return contentType ? { contentType } : undefined;
}

function readSize(headers: Headers, fallback: number): number {
  const declared = Number(headers.get("content-length"));
  return Number.isSafeInteger(declared) && declared >= 0 ? declared : fallback;
}

function requireCredential(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`R2 S3 credentials are incomplete: ${name} is required.`);
  return trimmed;
}

function amzTimestamp(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function createR2S3Bucket(config: R2S3BucketConfig): R2BucketLike {
  const accountId = requireCredential(config.accountId, "accountId");
  const accessKeyId = requireCredential(config.accessKeyId, "accessKeyId");
  const secretAccessKey = requireCredential(config.secretAccessKey, "secretAccessKey");
  const bucketName = requireCredential(config.bucketName, "bucketName");
  const endpoint = (config.endpoint?.trim() || `https://${accountId}.r2.cloudflarestorage.com`)
    .toString()
    .replace(/\/$/, "");
  const fetcher = config.fetcher ?? fetch;
  const now = config.now ?? (() => new Date());

  async function send(
    method: string,
    objectKey: string,
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const path = canonicalPath(bucketName, objectKey);
    const url = new URL(`${endpoint}${path}`);
    const headers = await authorizationHeaders({
      method,
      path,
      host: url.host,
      payloadHash: body ? await sha256Hex(body) : EMPTY_PAYLOAD_SHA256,
      headers: extraHeaders,
      accessKeyId,
      secretAccessKey,
      amzDate: amzTimestamp(now()),
    });

    return fetcher(url, { method, headers, body });
  }

  // Error text carries the status only — never the signature, key, or response body.
  function assertOk(response: Response, operation: string): void {
    if (response.ok) return;
    throw new Error(`R2 ${operation} failed with status ${response.status}.`);
  }

  return {
    async put(objectKey: string, body: Uint8Array | ArrayBuffer, options?: PutOptions) {
      const payload = body instanceof Uint8Array ? body : new Uint8Array(body);
      const response = await send("PUT", objectKey, payload, {
        ...(options?.httpMetadata?.contentType
          ? { "content-type": options.httpMetadata.contentType }
          : {}),
        ...metadataHeaders(options?.customMetadata),
      });
      assertOk(response, "put");
      return { key: objectKey, size: payload.byteLength };
    },

    async get(objectKey: string) {
      const response = await send("GET", objectKey);
      if (response.status === 404) return null;
      assertOk(response, "get");

      const body = await response.arrayBuffer();
      return {
        size: readSize(response.headers, body.byteLength),
        httpMetadata: readHttpMetadata(response.headers),
        customMetadata: readCustomMetadata(response.headers),
        arrayBuffer: async () => body,
      };
    },

    async head(objectKey: string) {
      const response = await send("HEAD", objectKey);
      if (response.status === 404) return null;
      assertOk(response, "head");

      return {
        size: readSize(response.headers, 0),
        httpMetadata: readHttpMetadata(response.headers),
        customMetadata: readCustomMetadata(response.headers),
      };
    },

    async delete(objectKey: string) {
      const response = await send("DELETE", objectKey);
      if (response.status === 404) return;
      assertOk(response, "delete");
    },
  } as unknown as R2BucketLike;
}
