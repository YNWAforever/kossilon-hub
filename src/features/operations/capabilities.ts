/**
 * What this build cannot do, and what a person does instead.
 *
 * Some of these gate a capability the product otherwise appears to offer.
 *
 * There is deliberately no count in that sentence. It used to read "six ... and
 * four of them" while the array held seven entries of which four blocked a
 * release -- a prose number sitting beside a list that nothing checks is the
 * same rot this file exists to prevent. `releaseBlockingIntegrations()` answers
 * it from the data, which cannot drift.
 *
 * Scattered `BLOCKED_INTEGRATION:` comments are enough for whoever is reading
 * that file; they are not enough for a staff member deciding whether to trust a
 * screen, and they are not enough for a pilot that has to know which steps stay
 * on paper.
 *
 * So the same facts are declared once, in the product, and shown on the
 * operations screen. `capabilities.test.ts` cross-checks these ids against the
 * markers actually present in `src/` in BOTH directions -- a marker with no
 * entry means a disabled capability nobody is told about, and an entry with no
 * marker means this file is still claiming something is off after the code
 * stopped saying so.
 *
 * The second direction is the one that matters in a year's time.
 */

import type { MaintenanceHealthState } from "./health";

export type BlockedIntegrationId =
  | "malware-scanner-provider"
  | "document-text-extraction"
  | "ai-provider"
  | "whatsapp-media-download"
  | "external-handoff-destination"
  | "deployment-runtime";

/**
 * Where this blocker's clearing condition could be observed, if anywhere.
 *
 * Required, not optional, because "nothing in this system can check this" and
 * "nobody thought to check" used to look identical. `local-postgres` stayed
 * listed as release-blocking after both of its own stated clearing conditions
 * were met, and no test could have noticed: `capabilities.test.ts` compares
 * entries against source markers, and here the entry and its marker went stale
 * together, so both sides agreed.
 */
export type ClearingEvidence =
  /** Observable while the test suite runs. */
  | { observable: "build" }
  /** Observable only from a deployed runtime's own data. */
  | { observable: "runtime" }
  /**
   * Not observable from inside the product. `why` is required so that
   * "external" cannot quietly become the default answer for anything awkward:
   * an author has to write down what kind of fact this is, and that sentence is
   * itself reviewable.
   */
  | { observable: "external"; why: string };

export type BlockedIntegration = {
  id: BlockedIntegrationId;
  /** The capability a user would reasonably expect to work. */
  capability: string;
  /** What actually happens instead. Never softened into "limited" or "partial". */
  effect: string;
  /** What a pilot does in its place. */
  pilotFallback: string;
  /** The specific input that would clear it. Not "more work". */
  clearedBy: string;
  /**
   * Whether this one holds back a release gate, as opposed to degrading a
   * convenience.
   */
  blocksRelease: boolean;
  /** Where a person or a test could see that this is no longer true. */
  evidence: ClearingEvidence;
};

export const BLOCKED_INTEGRATIONS: readonly BlockedIntegration[] = [
  {
    id: "malware-scanner-provider",
    capability: "上載文件的病毒掃描",
    effect:
      "沒有任何文件可以通過安全檢查，全部停留在隔離狀態。因此沒有任何套件可以被批准交件。" +
      "舊檔案的重掃隊列會一直累積，不會自動清空。",
    pilotFallback: "由職員在受管制的工作站自行掃描後，以人手記錄結論；系統不會代為判斷。",
    clearedBy: "一個已批核的掃描供應商、它的 binding 名稱，以及它的資料處理條款。",
    blocksRelease: true,
    evidence: {
      observable: "external",
      why: "一份已簽署的供應商合約與其資料處理條款，不會在這個系統內留下任何痕跡。",
    },
  },
  {
    id: "document-text-extraction",
    capability: "讀取文件內文（頁數、日期、年度、內容比對）",
    effect:
      "伺服器端沒有任何文字擷取。所有需要文件本身文字的檢查都無法執行，包括兩條日期規則。" +
      "分析只能檢查檔案頭尾的格式標記與記錄之間的互相對照。",
    pilotFallback: "文件內容仍由職員親自閱讀核對，一如現時做法。",
    clearedBy:
      "一個可在 Worker 執行的 PDF 文字層（新工作），或啟用 nodejs_compat 加 Node PDF 程式庫（改動部署面）。",
    blocksRelease: false,
    evidence: {
      observable: "external",
      why: "是否具備 Worker 可用的文字抽取層，取決於尚未開始的工程與部署面決定，系統內無從觀察。",
    },
  },
  {
    id: "ai-provider",
    capability: "由模型協助審閱文件",
    effect:
      "第三層分析從不執行。倉庫內沒有任何 AI SDK、金鑰 binding 或供應商設定，" +
      "介面上也沒有任何位置顯示模型的結論。",
    pilotFallback: "全部審閱由人完成。這正是現時的實際做法，不是降級。",
    clearedBy: "一個已批核的供應商、它的 binding 名稱，以及它的資料處理條款。",
    blocksRelease: false,
    evidence: {
      observable: "external",
      why: "已批核的供應商與其資料處理條款不會在系統內留下痕跡；binding 本身雖然可由 getDocumentAiConfig 觀察，但它存在並不代表供應商已獲批核。",
    },
  },
  {
    id: "whatsapp-media-download",
    capability: "接收客戶在 WhatsApp 傳來的附件",
    effect:
      "附件的存在會被記錄（類型、供應商的媒體編號、在訊息中的位置），但檔案本身取不到，" +
      "所以不會成為一份文件，也不會出現在文件清單。",
    pilotFallback: "職員在 WOZTELL 介面下載檔案後，用一般上載流程放進案件。",
    clearedBy: "WOZTELL 媒體下載端點的正式文件與其認證方式。",
    blocksRelease: false,
    evidence: {
      observable: "external",
      why: "WOZTELL 是否已提供媒體下載端點的正式文件，是對方的決定，系統內看不到。",
    },
  },
  {
    id: "external-handoff-destination",
    capability: "把已批准的套件交去外部代理",
    effect:
      "沒有任何套件可以交出。每一個 handoff 都停在 prepared，transmitted_at 永遠是空的，" +
      "因此「回件與異常」不會有任何回件——那裡的空白不代表沒有異常。",
    pilotFallback: "沿用現時的人手交件與人手記錄；套件內容仍可在系統內準備和批核。",
    clearedBy: "行方內部伺服器的通訊協定、位址、認證方式與存取權限。",
    blocksRelease: true,
    evidence: {
      observable: "external",
      why: "行方內部伺服器的通訊協定與存取權限由另一個團隊掌握，本系統無法探測。",
    },
  },
  {
    id: "deployment-runtime",
    capability: "五分鐘排程確實在部署環境執行",
    effect:
      "從未有人觀察過一次排程執行。在 maintenance_runs 之前，唯一的記錄是 console.log，" +
      "而排程若從未註冊，每一個畫面看起來仍然完全正常。",
    pilotFallback:
      "上線後先看營運畫面的「最後一次執行」；在它出現第一筆記錄之前，排程一律當作沒有運行。",
    clearedBy: "部署環境上一次排程被觸發的實際證據——現在就是 maintenance_runs 的第一筆排程資料。",
    blocksRelease: true,
    evidence: { observable: "runtime" },
  },
];

export function blockedIntegrationIds(): readonly BlockedIntegrationId[] {
  return BLOCKED_INTEGRATIONS.map((integration) => integration.id);
}

/** The ones that hold back a release gate rather than degrade a convenience. */
export function releaseBlockingIntegrations(): readonly BlockedIntegration[] {
  return BLOCKED_INTEGRATIONS.filter((integration) => integration.blocksRelease);
}

/**
 * What would have to be true for a `runtime`-kind blocker to be over.
 *
 * A record rather than a switch, so `runtimeCheckedIds` can report what is
 * covered and a test can fail on an entry nobody wired up.
 */
const RUNTIME_EVIDENCE: Partial<
  Record<BlockedIntegrationId, (input: { maintenanceState: MaintenanceHealthState }) => boolean>
> = {
  // `never-observed` is the absence of any scheduled run at all, so every other
  // state IS the evidence this blocker names. No extra query: the operations
  // screen already computes this state.
  "deployment-runtime": ({ maintenanceState }) => maintenanceState !== "never-observed",
};

/** The ids that have a runtime check, so a test can spot one that does not. */
export function runtimeCheckedIds(): readonly BlockedIntegrationId[] {
  return Object.keys(RUNTIME_EVIDENCE) as BlockedIntegrationId[];
}

/**
 * Blockers still declared whose runtime evidence has arrived.
 *
 * Reports; never clears. The dangerous direction of this idea is a product that
 * re-asserts its own capabilities from a heuristic, so the result is worded as a
 * prompt for a person and the entry stays until somebody deletes it.
 */
export function staleBlockedIntegrations(input: {
  blocked: readonly BlockedIntegration[];
  maintenanceState: MaintenanceHealthState;
}): readonly BlockedIntegrationId[] {
  return input.blocked
    .filter((item) => item.evidence.observable === "runtime")
    .filter((item) => RUNTIME_EVIDENCE[item.id]?.(input) === true)
    .map((item) => item.id);
}
