import type { AuthenticatedActor } from "@/features/auth/types";
import { z } from "zod";
import {
  incorporationReadScope,
  type IncorporationReadScope,
} from "@/features/incorporation/authorization";
import { corporateChangeListTeamScope } from "@/features/corporate-changes/read";
import { otherWorkRow, type OtherWorkSource, type OtherWorkRow } from "./work-views-other";

export const otherWorkPageInput = z
  .object({
    view: z.enum([
      "chaseToday",
      "newlyReceived",
      "awaitingMyReview",
      "readyToFile",
      "returnsAndExceptions",
    ]),
    q: z.string().trim().max(200).optional(),
    sort: z.enum(["deadline", "company"]).optional(),
    cursor: z.string().max(4096).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type OtherWorkReadQuery = {
  incorporationScope: IncorporationReadScope;
  corporateTeamId: string | undefined;
  viewerUserId: string;
  view: z.infer<typeof otherWorkPageInput>["view"];
  q: string;
  sort: "deadline" | "company";
  after: { sortKey: string; business: OtherWorkSource["business"]; id: string } | null;
  today: string;
  limit: number;
};
export type OtherWorkPageRepository = {
  list(input: OtherWorkReadQuery): Promise<(OtherWorkSource & { sortKey: string })[]>;
};
export type OtherWorkPage = { rows: OtherWorkRow[]; nextCursor: string | null };

/** Both domain scopes are checked before the caller may open a repository. */
export function otherWorkScope(actor: AuthenticatedActor) {
  const incorporationScope = incorporationReadScope(actor);
  if (!actor.userId) throw new Error("Forbidden: a staff database identity is required.");
  return {
    incorporationScope,
    corporateTeamId: corporateChangeListTeamScope(actor),
    viewerUserId: actor.userId,
  };
}

export async function otherWorkPageForActor(
  actor: AuthenticatedActor,
  input: unknown,
  repository: OtherWorkPageRepository,
  today: string,
): Promise<OtherWorkPage> {
  const scope = otherWorkScope(actor),
    data = otherWorkPageInput.parse(input);
  const q = data.q ?? "",
    sort = data.sort ?? "deadline",
    limit = data.limit ?? 25;
  const context = JSON.stringify([
    actor.authUserId,
    actor.userId,
    actor.role,
    actor.teamId,
    data.view,
    q,
    sort,
    today,
  ]);
  let after: OtherWorkReadQuery["after"] = null;
  if (data.cursor) {
    try {
      const cursor = z
        .object({
          context: z.literal(context),
          sortKey: z.string().max(1000),
          business: z.enum(["incorporation", "corporate_change"]),
          id: z.string().guid(),
        })
        .strict()
        .parse(JSON.parse(Buffer.from(data.cursor, "base64url").toString()));
      after = { sortKey: cursor.sortKey, business: cursor.business, id: cursor.id };
    } catch {
      throw new Error("Invalid Today cursor; reset pagination explicitly.");
    }
  }
  const sources = await repository.list({
    ...scope,
    view: data.view,
    q,
    sort,
    after,
    today,
    limit: limit + 1,
  });
  const selected = sources.slice(0, limit),
    last = selected.at(-1);
  return {
    rows: selected.flatMap((source) => {
      const row = otherWorkRow(source, today);
      return row ? [row] : [];
    }),
    nextCursor:
      sources.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              context,
              sortKey: last.sortKey,
              business: last.business,
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}
