/**
 * The demo build renders fixture data and has no write path (ADR-0001), so a
 * visitor cannot tell whether a control acted. This banner makes the mode
 * explicit instead of leaving inert controls looking broken.
 */
export function DemoBanner() {
  return (
    <aside
      data-demo-banner
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-status-yellow/40 bg-status-yellow-soft px-4 py-2 text-center text-xs text-status-yellow-text"
    >
      <span className="font-semibold">示範模式</span>
      <span>所有資料為模擬，操作不會儲存。</span>
      <a className="underline underline-offset-4" href="/">
        產品介紹
      </a>
    </aside>
  );
}
