import { parseEntityId } from "@/lib/entity-id";
import { defaultStringifySearch } from "@tanstack/react-router";

export type QueueViewSearch = {
  view: "mine" | "team" | "breached";
  owner: string;
  workType: string;
  sla: "all" | "none" | "warning" | "breach" | "acknowledged";
  priority: "all" | "high" | "normal";
  status: "all" | "open" | "in_progress" | "blocked";
  q: string;
  sort: "deadline" | "priority";
  cursor?: string;
  contextError?: true;
};
export function queueViewSearch(input: Record<string, unknown>): QueueViewSearch {
  const choices: Record<string, readonly string[]> = {
    view: ["mine", "team", "breached"],
    sla: ["all", "none", "warning", "breach", "acknowledged"],
    priority: ["all", "high", "normal"],
    status: ["all", "open", "in_progress", "blocked"],
    sort: ["deadline", "priority"],
  };
  const qScalar =
    input.q === undefined ||
    input.q === null ||
    ["string", "number", "boolean"].includes(typeof input.q);
  const contextError =
    !qScalar ||
    Object.entries(choices).some(
      ([key, allowed]) =>
        input[key] !== undefined &&
        (typeof input[key] !== "string" || !allowed.includes(input[key] as string)),
    ) ||
    (input.owner !== undefined &&
      input.owner !== "all" &&
      input.owner !== "unassigned" &&
      !parseEntityId(input.owner)) ||
    (input.workType !== undefined &&
      (typeof input.workType !== "string" ||
        !input.workType.trim() ||
        input.workType.length > 100)) ||
    (input.cursor !== undefined &&
      (typeof input.cursor !== "string" || input.cursor.length > 8192));
  return {
    view:
      input.view === "team" || input.view === "breached"
        ? input.view
        : ("mine" as "mine" | "team" | "breached"),
    owner: input.owner === "unassigned" ? "unassigned" : (parseEntityId(input.owner) ?? "all"),
    workType: typeof input.workType === "string" ? input.workType.slice(0, 100) : "all",
    sla: ["none", "warning", "breach", "acknowledged"].includes(String(input.sla))
      ? (input.sla as "none" | "warning" | "breach" | "acknowledged")
      : ("all" as const),
    priority:
      input.priority === "high" || input.priority === "normal" ? input.priority : ("all" as const),
    status:
      input.status === "open" || input.status === "in_progress" || input.status === "blocked"
        ? input.status
        : ("all" as const),
    q: qScalar && input.q !== undefined ? String(input.q).slice(0, 120) : "",
    sort: input.sort === "priority" ? ("priority" as const) : ("deadline" as const),
    ...(typeof input.cursor === "string" && input.cursor.length <= 8192
      ? { cursor: input.cursor }
      : {}),
    ...(contextError ? { contextError: true as const } : {}),
  };
}
export function queueReturnPath(search: ReturnType<typeof queueViewSearch>) {
  const query = { ...search };
  delete query.contextError;
  return `/work-queue${defaultStringifySearch(query)}`;
}
