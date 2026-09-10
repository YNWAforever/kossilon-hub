/**
 * Which bytes a decision was about.
 *
 * `documents` held one row per file with no version and no supersession
 * pointer, so a reviewer approved "the document" and which bytes that meant was
 * whatever happened to be current at the time. A replacement upload silently
 * inherited the approval.
 *
 * Two things are kept apart here that the schema used to conflate:
 *
 * - the *claim*, `checksum_sha256` on the upload intent, supplied by the client
 *   before the bytes exist;
 * - the *identity*, the hash of what is actually in storage.
 *
 * Only the provider scanner ever computes the second, and it is
 * BLOCKED_INTEGRATION, so today every version has a claim and no identity. That
 * is reported as `unknown`, not smoothed over -- a package manifest that hashed
 * the client's declared value would certify whatever the uploader typed.
 */

export type DocumentVersionState = {
  id: string;
  documentId: string;
  versionNumber: number;
  /** From the upload intent. A claim about bytes that did not exist yet. */
  declaredChecksum: string | null;
  /** Computed over the stored object. Null until something has read it. */
  verifiedChecksum: string | null;
  supersededByVersionId: string | null;
};

export type ContentIdentity =
  /** The bytes in storage were hashed, and this is what they are. */
  | { kind: "verified"; checksum: string }
  /** Only the uploader's claim exists. Usable as a hint, never as an identity. */
  | { kind: "declared-only"; declared: string }
  /** Neither. A legacy or staff-created row that was never hashed by anyone. */
  | { kind: "unknown" };

export function contentIdentityOf(version: DocumentVersionState): ContentIdentity {
  if (version.verifiedChecksum) return { kind: "verified", checksum: version.verifiedChecksum };
  if (version.declaredChecksum)
    return { kind: "declared-only", declared: version.declaredChecksum };
  return { kind: "unknown" };
}

/**
 * Whether this version may be named in a package manifest.
 *
 * Verified identity only. A manifest is the record of exactly what was filed,
 * and a manifest entry whose hash came from the client is not evidence of
 * anything. This currently refuses every version, because the only code that
 * hashes stored bytes is the blocked provider scanner -- which is the same gate
 * Phase A already applies to approval, from the same missing provider, and not
 * a new one.
 */
export function canCiteInManifest(version: DocumentVersionState): boolean {
  return contentIdentityOf(version).kind === "verified";
}

export function isCurrent(version: DocumentVersionState): boolean {
  return version.supersededByVersionId === null;
}

export type CurrentVersionResult =
  | { kind: "one"; version: DocumentVersionState }
  /** No versions at all, or every version superseded. */
  | { kind: "none" }
  /**
   * More than one row claims to be current. The partial unique index makes this
   * unreachable in a consistent database, which is exactly why it must not be
   * resolved by picking the highest number: silently choosing would attach a
   * reviewer's decision to bytes nobody selected.
   */
  | { kind: "ambiguous"; versions: readonly DocumentVersionState[] };

export function currentVersion(versions: readonly DocumentVersionState[]): CurrentVersionResult {
  const live = versions.filter(isCurrent);
  if (live.length === 0) return { kind: "none" };
  if (live.length > 1) return { kind: "ambiguous", versions: live };
  return { kind: "one", version: live[0] };
}

/** Newest first, which is the order a reviewer reads a history in. */
export function versionHistory(versions: readonly DocumentVersionState[]): DocumentVersionState[] {
  return [...versions].sort((left, right) => right.versionNumber - left.versionNumber);
}

/**
 * The number a replacement upload takes.
 *
 * Max plus one rather than count plus one: a deleted or failed row must not let
 * a later upload reuse a number that a decision already refers to.
 */
export function nextVersionNumber(versions: readonly DocumentVersionState[]): number {
  return versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1;
}

export type SupersessionIssue =
  | { kind: "multiple-current"; versionIds: readonly string[] }
  | { kind: "dangling-successor"; versionId: string; missingId: string }
  | { kind: "successor-not-newer"; versionId: string; successorId: string }
  | { kind: "cycle"; versionIds: readonly string[] };

/**
 * Structural faults in a supersession chain, for the repository integration
 * tests and for a reviewer-facing warning.
 *
 * Reported rather than thrown: a case with a broken chain still needs to be
 * openable so somebody can fix it, and refusing to render it would hide the
 * problem behind an error page.
 */
export function supersessionIssues(versions: readonly DocumentVersionState[]): SupersessionIssue[] {
  const issues: SupersessionIssue[] = [];
  const byId = new Map(versions.map((version) => [version.id, version]));

  const live = versions.filter(isCurrent);
  if (live.length > 1) {
    issues.push({ kind: "multiple-current", versionIds: live.map((version) => version.id) });
  }

  for (const version of versions) {
    const successorId = version.supersededByVersionId;
    if (!successorId) continue;

    const successor = byId.get(successorId);
    if (!successor) {
      issues.push({ kind: "dangling-successor", versionId: version.id, missingId: successorId });
      continue;
    }
    // A replacement is always later. The reverse would make "the newest version"
    // and "the current version" disagree.
    if (successor.versionNumber <= version.versionNumber) {
      issues.push({
        kind: "successor-not-newer",
        versionId: version.id,
        successorId: successor.id,
      });
    }
  }

  const reportedCycleMembers = new Set<string>();
  for (const start of versions) {
    const seen: string[] = [];
    let cursor: DocumentVersionState | undefined = start;
    while (cursor && !seen.includes(cursor.id)) {
      seen.push(cursor.id);
      cursor = cursor.supersededByVersionId ? byId.get(cursor.supersededByVersionId) : undefined;
    }
    if (!cursor) continue;

    const loop = seen.slice(seen.indexOf(cursor.id));
    // One issue per cycle, not one per node that walks into it.
    if (loop.some((id) => reportedCycleMembers.has(id))) continue;
    for (const id of loop) reportedCycleMembers.add(id);
    issues.push({ kind: "cycle", versionIds: loop });
  }

  return issues;
}
