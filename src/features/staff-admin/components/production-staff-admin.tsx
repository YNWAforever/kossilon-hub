import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { changeStaffAccess, disableStaff, listStaffAdministration } from "../server-fns";
import type { StaffAdminList, StaffAdminRow, StaffProfile } from "../repository";

type Team = StaffAdminList["teams"][number];

function StaffAccessRow({
  staff,
  teams,
  onChanged,
}: {
  staff: StaffAdminRow;
  teams: Team[];
  onChanged: () => Promise<unknown>;
}) {
  const [role, setRole] = useState<StaffProfile["role"]>(staff.role);
  const [teamId, setTeamId] = useState(staff.teamId ?? "");
  const [handoverOperationId, setHandoverOperationId] = useState("");
  const access = useMutation({
    mutationFn: () =>
      changeStaffAccess({
        data: {
          staffId: staff.staffId,
          role,
          teamId: teamId || null,
          expectedRevision: staff.revision,
        },
      }),
    onSuccess: onChanged,
  });
  const disable = useMutation({
    mutationFn: () =>
      disableStaff({
        data: {
          staffId: staff.staffId,
          expectedRevision: staff.revision,
          handoverOperationId: handoverOperationId.trim() || undefined,
        },
      }),
    onSuccess: onChanged,
  });
  const balance = staff.outstandingCases + staff.outstandingWorkItems;
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{staff.name}</p>
          <p className="text-sm text-muted-foreground">{staff.email}</p>
        </div>
        <span className="rounded border px-2 py-1 text-xs">
          {staff.active ? "Active" : "Disabled"} · rev {staff.revision}
        </span>
      </div>
      <p className="mt-2 text-sm">
        Outstanding handover: {staff.outstandingCases} cases, {staff.outstandingWorkItems} work
        items.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">
          Server role
          <select
            className="rounded border bg-background p-2 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value as StaffProfile["role"])}
            disabled={!staff.active}
          >
            <option value="Staff">Staff</option>
            <option value="Manager">Manager</option>
            <option value="Admin">Admin</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          Team
          <select
            className="rounded border bg-background p-2 text-sm"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            disabled={!staff.active}
          >
            <option value="">No team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          disabled={
            !staff.active ||
            access.isPending ||
            (role === staff.role && (teamId || null) === staff.teamId)
          }
          onClick={() => access.mutate()}
        >
          Save access
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">
          Completed T09 handover operation ID (if used)
          <input
            className="w-72 max-w-full rounded border bg-background p-2 text-sm"
            value={handoverOperationId}
            onChange={(event) => setHandoverOperationId(event.target.value)}
            disabled={!staff.active}
          />
        </label>
        <button
          type="button"
          className="rounded border border-destructive px-3 py-2 text-sm text-destructive disabled:opacity-50"
          disabled={!staff.active || balance > 0 || disable.isPending}
          onClick={() => disable.mutate()}
        >
          Disable staff
        </button>
      </div>
      {balance > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Reassign open cases and work items through their existing authorized controls before
          disabling or moving teams.
        </p>
      ) : null}
      {access.isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {access.error instanceof Error ? access.error.message : "Access change failed."}
        </p>
      ) : null}
      {disable.isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {disable.error instanceof Error ? disable.error.message : "Disable failed."}
        </p>
      ) : null}
    </li>
  );
}

export function ProductionStaffAdmin() {
  const queryClient = useQueryClient();
  const roster = useQuery({
    queryKey: ["staff-administration"],
    queryFn: () => listStaffAdministration({ data: {} }),
    retry: false,
  });
  const onChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: ["staff-administration"] });
  };
  if (roster.isPending) return <p role="status">Loading staff administration…</p>;
  if (roster.isError || !roster.data)
    return <p role="alert">Unable to load the authorized staff roster.</p>;
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Staff access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every change is checked against the current server Admin profile and an access revision.
          The last active Admin cannot be disabled or downgraded.
        </p>
        <ul className="mt-4 grid gap-3">
          {roster.data.staff.map((staff) => (
            <StaffAccessRow
              key={staff.staffId + ":" + staff.revision}
              staff={staff}
              teams={roster.data.teams}
              onChanged={onChanged}
            />
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Invitations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Neon Auth staff invitation is unavailable until this tenant’s management API, identity
          correlation, and scoped credential are verified. No invitation can be sent here yet.
        </p>
        {roster.data.invitations.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {roster.data.invitations.map((item) => (
              <li key={item.id}>
                {item.name} · {item.email} · {item.status}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
