import JSZip from "jszip";
import type { DocumentStorage } from "@/features/documents/types";
import { canonicalManifestPayload, type PackageManifest } from "./package-manifest";

export type PackageSource = {
  versionId: string;
  objectKey: string;
  fileName: string;
  checksum: string;
  sizeBytes: number;
  contentType: string;
};

export type PackageArtifact = {
  body: Uint8Array;
  checksum: string;
  sizeBytes: number;
};

export async function packageSha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function safePackageFilename(name: string): string {
  const normalized = name
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return normalized || "document";
}

export async function buildPackageArtifact(
  manifest: PackageManifest,
  sources: readonly PackageSource[],
  storage: DocumentStorage,
): Promise<PackageArtifact> {
  const cited = new Map(
    manifest.entries
      .filter((entry) => entry.documentVersionId && entry.contentSha256)
      .map((entry) => [entry.documentVersionId!, entry.contentSha256!]),
  );
  const supplied = new Map(sources.map((source) => [source.versionId, source]));
  if (cited.size !== supplied.size)
    throw new Error("Package source set does not match the manifest.");
  const zip = new JSZip();
  const fixedDate = new Date("1980-01-01T00:00:00.000Z");
  zip.file("manifest.json", canonicalManifestPayload(manifest), { date: fixedDate });
  let index = 0;
  for (const [versionId, expectedHash] of [...cited.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const source = supplied.get(versionId);
    if (!source || source.checksum !== expectedHash) {
      throw new Error("Package source identity does not match the manifest.");
    }
    const object = await storage.get(source.objectKey);
    if (
      !object ||
      object.checksum !== expectedHash ||
      object.sizeBytes !== source.sizeBytes ||
      object.contentType !== source.contentType
    ) {
      throw new Error("Package source object metadata is missing or changed.");
    }
    const bytes = new Uint8Array(object.body);
    if (bytes.byteLength !== source.sizeBytes || (await packageSha256(bytes)) !== expectedHash) {
      throw new Error("Package source bytes do not match the verified version.");
    }
    index += 1;
    zip.file(
      `documents/${String(index).padStart(3, "0")}-${safePackageFilename(source.fileName)}`,
      bytes,
      { date: fixedDate },
    );
  }
  const body = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { body, checksum: await packageSha256(body), sizeBytes: body.byteLength };
}

export async function readVerifiedPackageArtifact(
  storage: DocumentStorage,
  artifact: { objectKey: string; checksum: string; sizeBytes: number },
): Promise<ArrayBuffer> {
  const stored = await storage.get(artifact.objectKey);
  if (
    !stored ||
    stored.checksum !== artifact.checksum ||
    stored.sizeBytes !== artifact.sizeBytes ||
    stored.contentType !== "application/zip"
  ) {
    throw new Error("Approved package object metadata is missing or changed.");
  }
  if (
    stored.body.byteLength !== artifact.sizeBytes ||
    (await packageSha256(new Uint8Array(stored.body))) !== artifact.checksum
  ) {
    throw new Error("Approved package bytes do not match the recorded hash.");
  }
  return stored.body;
}
