import { useRouter, useRouterState } from "@tanstack/react-router";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { caseListPath, readCaseListSearch, type CaseListQuery } from "../case-list-query";

// Shared by the two existing lists; company picker state remains in its dialog.
// eslint-disable-next-line react-refresh/only-export-components -- Shared navigation hook for the two case lists.
export function useCaseListView(path: "/incorporation" | "/corporate-changes") {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const router = useRouter();
  const query = readCaseListSearch(search);
  const go = (next: CaseListQuery) => {
    void router.navigate({ href: caseListPath(path, next) });
  };
  return { query, returnTo: caseListPath(path, query), go };
}
export function CaseListControls({
  query,
  statuses,
  owners,
  go,
  onRefresh,
  pending,
}: {
  query: CaseListQuery;
  statuses: Record<string, string>;
  owners: { id: string; name: string }[];
  go: (query: CaseListQuery) => void;
  onRefresh: () => void;
  pending: boolean;
}) {
  return (
    <form
      key={JSON.stringify(query)}
      aria-label="案件篩選"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const { cursor: _cursor, ...next } = query;
        for (const key of ["q", "status", "ownerId", "dueFrom", "dueTo", "sort"] as const) {
          const value = String(data.get(key) ?? "");
          if (value) Object.assign(next, { [key]: value });
          else delete next[key];
        }
        go(next);
      }}
    >
      <label className="text-sm">
        搜尋既有案件
        <Input
          name="q"
          defaultValue={query.q ?? ""}
          maxLength={200}
          placeholder="公司中文或英文名稱"
        />
      </label>
      <label className="text-sm">
        狀態
        <Select name="status" defaultValue={query.status ?? ""}>
          <option value="">全部狀態</option>
          {Object.entries(statuses).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-sm">
        負責同事
        <Select name="ownerId" defaultValue={query.ownerId ?? ""}>
          <option value="">全部同事</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
          {query.ownerId && !owners.some((owner) => owner.id === query.ownerId) ? (
            <option value={query.ownerId}>已選同事</option>
          ) : null}
        </Select>
      </label>
      <label className="text-sm">
        期限由
        <Input name="dueFrom" type="date" defaultValue={query.dueFrom ?? ""} />
      </label>
      <label className="text-sm">
        期限至
        <Input name="dueTo" type="date" defaultValue={query.dueTo ?? ""} />
      </label>
      <label className="text-sm">
        排序
        <Select name="sort" defaultValue={query.sort ?? "created"}>
          <option value="created">最新建立</option>
          <option value="company">公司名稱</option>
          <option value="due">最早期限</option>
        </Select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          搜尋案件
        </Button>
        <Button onClick={() => go({})}>清除篩選</Button>
        <Button
          disabled={pending}
          onClick={() => {
            if (query.cursor) {
              const { cursor: _cursor, ...rest } = query;
              go(rest);
            } else {
              onRefresh();
            }
          }}
        >
          重新整理列表
        </Button>
      </div>
    </form>
  );
}
export function CaseListPagination({
  query,
  nextCursor,
  go,
  pending,
}: {
  query: CaseListQuery;
  nextCursor: string | null;
  go: (query: CaseListQuery) => void;
  pending: boolean;
}) {
  return (
    <nav aria-label="案件分頁" className="flex items-center gap-3">
      <Button
        disabled={!query.cursor || pending}
        onClick={() => {
          const { cursor: _cursor, ...rest } = query;
          go(rest);
        }}
      >
        回到第一頁
      </Button>
      <Button
        disabled={!nextCursor || pending}
        onClick={() => {
          if (nextCursor) go({ ...query, cursor: nextCursor });
        }}
      >
        下一頁
      </Button>
    </nav>
  );
}
