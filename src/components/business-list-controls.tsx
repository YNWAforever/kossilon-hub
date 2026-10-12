import type { BusinessListSearch } from "@/lib/business-list";
import { businessStatusLabel } from "@/lib/staff-copy.zh-HK";
export function BusinessListControls({
  search,
  onChange,
  statuses,
  owners,
}: {
  search: BusinessListSearch;
  onChange: (next: BusinessListSearch) => void;
  statuses: readonly string[];
  owners: { id: string; name: string }[];
}) {
  const change = (patch: Partial<BusinessListSearch>) =>
    onChange({ ...search, ...patch, cursor: undefined, anchor: undefined });
  const field = "min-h-11 max-w-full rounded-md border bg-background px-3";
  return (
    <section className="flex flex-wrap gap-3" aria-label="案件列表篩選">
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        搜尋案件
        <input className={field} value={search.q} onChange={(e) => change({ q: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        工作範圍
        <select
          className={field}
          value={search.view}
          onChange={(e) => change({ view: e.target.value as BusinessListSearch["view"] })}
        >
          <option value="all">全部授權案件</option>
          <option value="mine">我的案件</option>
          <option value="overdue">逾期案件</option>
          <option value="unassigned" disabled>
            未分派（此業務必須指定負責人）
          </option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        業務狀態
        <select
          className={field}
          value={search.status}
          onChange={(e) => change({ status: e.target.value })}
        >
          <option value="open">未完成</option>
          <option value="all">全部狀態</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {businessStatusLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        負責人
        <select
          className={field}
          disabled={search.view === "mine"}
          value={search.owner}
          onChange={(e) => change({ owner: e.target.value })}
        >
          <option value="all">全部授權負責人</option>
          {search.owner !== "all" && !owners.some((o) => o.id === search.owner) ? (
            <option value={search.owner}>已選負責人</option>
          ) : null}
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        期限
        <select
          className={field}
          value={search.due}
          onChange={(e) => change({ due: e.target.value as BusinessListSearch["due"] })}
        >
          <option value="all">全部期限</option>
          <option value="overdue">已逾期</option>
          <option value="next30">三十日內到期</option>
          <option value="none">期限未設定</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        排列
        <select
          className={field}
          value={search.sort}
          onChange={(e) => change({ sort: e.target.value as BusinessListSearch["sort"] })}
        >
          <option value="deadline">限期先後</option>
          <option value="recent">最近建立</option>
          <option value="company">公司名稱</option>
        </select>
      </label>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={search.history}
          onChange={(e) => change({ history: e.target.checked })}
        />
        包括已完成／取消案件
      </label>
    </section>
  );
}
