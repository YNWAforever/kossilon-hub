import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import {
  listStaff,
  updateStaff,
  listAdminTeams,
  previewReassignment,
  listStaffAudit,
} from "./server-fns";
import { STAFF_ROLES, type StaffMember, type StaffFilters, type UpdateStaffInput } from "./types";
import { staffInvitationCapability } from "./auth-provider";
export function ProductionStaffAdmin({ actorScope }: { actorScope: string }) {
  const [q, setQ] = useState(""),
    [role, setRole] = useState("all"),
    [team, setTeam] = useState("all"),
    [active, setActive] = useState("all");
  const filters: StaffFilters = {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(role !== "all" ? { role: role as UpdateStaffInput["role"] } : {}),
    ...(team !== "all" ? { teamId: team } : {}),
    ...(active !== "all" ? { active: active === "true" } : {}),
  };
  const staff = useInfiniteQuery({
    queryKey: ["staff-admin", actorScope, "staff", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listStaff({ data: { ...filters, limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const teams = useQuery({
    queryKey: ["staff-admin", actorScope, "teams"],
    queryFn: () => listAdminTeams({ data: {} }),
    retry: false,
  });
  const rows = [
    ...new Map(
      (staff.data?.pages.flatMap((p) => p.staff) ?? []).map((s) => [s.userId, s]),
    ).values(),
  ];
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Administration" title="Admin" subtitle="員工與團隊管理" />
      <p>{staffInvitationCapability.message}</p>
      <p>只維護已核實綁定的既有身份。最後登入：沒有可靠紀錄時顯示未知。</p>
      <section aria-label="Staff filters" className="flex flex-wrap gap-3">
        <label>
          搜尋
          <input
            aria-label="Search staff"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="ml-2 rounded border"
          />
        </label>
        <label>
          角色
          <select
            aria-label="Staff role filter"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="all">全部</option>
            {STAFF_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          團隊
          <select
            aria-label="Staff team filter"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="all">全部</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.active ? "（停用）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          狀態
          <select
            aria-label="Staff active filter"
            value={active}
            onChange={(e) => setActive(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="true">有效</option>
            <option value="false">停用</option>
          </select>
        </label>
      </section>
      {staff.isError || teams.isError ? (
        <p role="alert">未能取得員工資料，請重新載入。已讀取紀錄仍可查閱。</p>
      ) : null}
      {staff.isPending ? <p>Loading staff administration...</p> : null}
      <section className="divide-y border-y">
        {rows.map((member) => (
          <StaffRow
            key={`${actorScope}:${member.userId}:${member.expectedVersion}`}
            member={member}
            teams={teams.data ?? []}
            actorScope={actorScope}
          />
        ))}
      </section>
      {!staff.isPending && !staff.isError && rows.length === 0 ? (
        <p>沒有符合條件的員工紀錄。</p>
      ) : null}
      {staff.hasNextPage ? (
        <button
          className="rounded border px-3 py-2"
          disabled={staff.isFetchingNextPage}
          onClick={() => void staff.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多員工
        </button>
      ) : null}
      {staff.isFetchNextPageError ? (
        <p role="alert">下一頁未能載入；保留已讀取資料，可重試。</p>
      ) : null}
    </main>
  );
}
function StaffRow({
  member,
  teams,
  actorScope,
}: {
  member: StaffMember;
  teams: { id: string; name: string; active: boolean }[];
  actorScope: string;
}) {
  const [open, setOpen] = useState(false),
    [role, setRole] = useState(member.role),
    [teamId, setTeamId] = useState(member.teamId ?? ""),
    [active, setActive] = useState(member.active);
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ["staff-admin", actorScope, "handover", member.userId, member.expectedVersion],
    queryFn: () =>
      previewReassignment({
        data: { userId: member.userId, expectedVersion: member.expectedVersion },
      }),
    enabled: open,
    retry: false,
  });
  const audit = useQuery({
    queryKey: ["staff-admin", actorScope, "audit", member.userId, member.expectedVersion],
    queryFn: () => listStaffAudit({ data: { userId: member.userId } }),
    enabled: open,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: () =>
      updateStaff({
        data: {
          userId: member.userId,
          expectedVersion: member.expectedVersion,
          role,
          teamId: teamId || null,
          active,
        },
      }),
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["staff-admin"] });
      void client.invalidateQueries({ queryKey: ["work-queue"] });
      void client.invalidateQueries({ queryKey: ["annual-return"] });
      void client.invalidateQueries({ queryKey: ["clients"] });
    },
  });
  const handoverNeeded = !active || teamId !== (member.teamId ?? "") || role === "Client";
  const blocked =
    handoverNeeded && (preview.data?.openCases ?? 0) + (preview.data?.openWorkItems ?? 0) > 0;
  return (
    <article className="space-y-2 p-4">
      <h2 className="font-semibold">
        {member.displayName} · {member.teamName ?? "未有團隊"}
      </h2>
      <p>
        {member.role} · {member.active ? "有效" : "停用"} · 未交案件 {member.openCases} · 未交工作{" "}
        {member.openWorkItems} · 最後登入：未知
      </p>
      {member.stateMismatch ? (
        <p role="alert">身份及員工狀態不一致，請先核對；暫不可修改。</p>
      ) : null}
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>維護帳戶／轉交預覽</summary>
        <div className="space-y-3 py-3">
          <label>
            帳戶角色
            <select
              aria-label={`Role for ${member.displayName}`}
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            所屬團隊
            <select
              aria-label={`Team for ${member.displayName}`}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">未有團隊</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id} disabled={!t.active}>
                  {t.name}
                  {!t.active ? "（停用）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <input
              type="checkbox"
              aria-label={`Active for ${member.displayName}`}
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            帳戶有效
          </label>
          {preview.isPending ? (
            <p>核對未交工作…</p>
          ) : preview.isError ? (
            <p role="alert">未能取得當前轉交預覽，暫不可套用。</p>
          ) : preview.data ? (
            <div>
              <p>
                當前未交案件：{preview.data.openCases}；工作：{preview.data.openWorkItems}。
              </p>
              {preview.data.cases.map((c) => (
                <p key={c.id}>
                  <Link to="/annual-returns/$id" params={{ id: c.id }}>
                    {c.companyName} · {c.status}
                  </Link>
                </p>
              ))}
              {preview.data.workItems.map((w) => (
                <p key={w.id}>{w.title}</p>
              ))}
              {preview.data.truncated ? <p>只顯示首100筆，請在工作隊列核對完整範圍。</p> : null}
              <Link
                to="/work-queue"
                search={{
                  view: "team",
                  owner: member.userId,
                  workType: "all",
                  sla: "all",
                  priority: "all",
                  status: "all",
                }}
              >
                開啟工作隊列轉交
              </Link>
            </div>
          ) : null}
          {blocked ? <p>必須先完成轉交，才可停用、移隊或改為 Client。</p> : null}
          <button
            className="rounded border px-3 py-2 disabled:opacity-50"
            disabled={
              mutation.isPending ||
              member.stateMismatch ||
              !preview.data ||
              preview.isError ||
              blocked
            }
            onClick={() => mutation.mutate()}
          >
            套用帳戶變更
          </button>
          {mutation.isError ? (
            <p role="alert">
              未能保存。身份、版本或未交工作可能已改變，請重新載入並核對；沒有自動重試。
            </p>
          ) : null}
          <h3>最近50筆帳戶紀錄</h3>
          {audit.isError ? (
            <p role="alert">帳戶紀錄未能載入。</p>
          ) : (
            audit.data?.map((event) => (
              <p key={event.id}>
                {event.event_type} · {event.actor_name} ·{" "}
                {new Date(event.created_at).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}
              </p>
            ))
          )}
        </div>
      </details>
    </article>
  );
}
