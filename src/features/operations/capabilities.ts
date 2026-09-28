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
  | "whatsapp-provider"
  | "external-handoff-destination"
  | "return-source"
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
      "伺服器端的 PDF 文字層擷取已寫好，但尚未在部署環境中執行過；它只處理已通過真正惡意軟件掃描的文件，" +
      "因此在掃描供應商到位前實際上不會擷取任何內容。掃描檔與相片沒有文字層，仍然讀不到。" +
      "目前沒有任何規則讀取文件文字，包括兩條日期規則。",
    pilotFallback: "文件內容仍由職員親自閱讀核對，一如現時做法。",
    clearedBy:
      "部署環境寫入的第一筆 extraction_method 為 text-layer 的 document_version_texts 記錄。" +
      "程式通過測試不算數：測試在 Node 執行，只有 Worker 上的真實執行才證明它可用。",
    blocksRelease: false,
    evidence: { observable: "runtime" },
  },
  {
    id: "ai-provider",
    capability: "由模型協助審閱文件",
    effect:
      "第三層分析的通用 adapter 已實作，但此部署尚未證實有獲批核的供應商、完整設定及成功執行證據。" +
      "模型建議仍不得作為文件覆核或批准依據。",
    pilotFallback: "全部審閱由人完成。這正是現時的實際做法，不是降級。",
    clearedBy: "一個已批核的供應商、它的 binding 名稱，以及它的資料處理條款。",
    blocksRelease: false,
    evidence: {
      observable: "external",
      why: "已批核的供應商與其資料處理條款不會在系統內留下痕跡；binding 本身雖然可由 getDocumentAiConfig 觀察，但它存在並不代表供應商已獲批核。",
    },
  },
  {
    id: "whatsapp-provider",
    capability: "WOZTELL WhatsApp 收發連線",
    effect:
      "設定存在不能證明此部署成功收發；未有當前部署的成功證據時，收件匣不得聲稱連線正常或沒有新訊息。",
    pilotFallback:
      "由職員在 WOZTELL 介面核對已批准的測試號碼、實際 webhook 和回執；系統不會自行傳送測試訊息。",
    clearedBy:
      "四個必要 binding、相同部署的無發送連線檢查，以及經批准測試號碼的 inbound、outbound 和 receipt 證據。",
    blocksRelease: true,
    evidence: {
      observable: "external",
      why: "測試號碼及 WOZTELL 租戶權限需要行方批准，程式不能自行提供這些授權或真實訊息證據。",
    },
  },
  {
    id: "whatsapp-media-download",
    capability: "接收客戶在 WhatsApp 傳來的附件",
    effect:
      "附件的存在會被記錄（類型、供應商的媒體編號、在訊息中的位置），但檔案本身取不到，" +
      "所以不會成為一份文件，也不會出現在文件清單。",
    pilotFallback: "職員在 WOZTELL 介面下載檔案後，用一般上載流程放進案件。",
    clearedBy:
      "獲授權的 WOZTELL Open API file:get 權限、真實 webhook fileId，以及受限下載與掃描的租戶測試證據。",
    blocksRelease: false,
    evidence: {
      observable: "external",
      why: "租戶的 file:get 權限及測試媒體由 WOZTELL 和行方管理；此程式不能自行取得授權。",
    },
  },
  {
    id: "external-handoff-destination",
    capability: "把已批准的套件交去外部代理",
    effect:
      "系統不能自動把套件傳送到行方內部伺服器；人手交件及提交證明可獨立記錄。" +
      "自動傳送成功與否不可由下載套件或人手紀錄推斷。",
    pilotFallback:
      "使用已批准套件的人手交件流程，上載真實提交證明並由職員記錄；不得宣稱自動傳送成功。",
    clearedBy: "行方內部伺服器的通訊協定、位址、認證方式與存取權限。",
    blocksRelease: true,
    evidence: {
      observable: "external",
      why: "行方內部伺服器的通訊協定與存取權限由另一個團隊掌握，本系統無法探測。",
    },
  },
  {
    id: "return-source",
    capability: "由行方內部伺服器唯讀同步回件",
    effect:
      "內部來源的實際協定、存取權限及測試資料夾未知，因此同步 adapter 不會連接或推進來源 cursor。",
    pilotFallback: "由獲授權職員在案件內上載真實回件，完成掃描及文件覆核後，人手核對交件紀錄。",
    clearedBy: "內部伺服器協定、唯讀權限、穩定檔案識別方式及測試資料夾，並完成斷線重試驗證。",
    blocksRelease: false,
    evidence: {
      observable: "external",
      why: "內部伺服器的協定和授權由行方持有；此程式庫不能自行驗證連接器已獲准使用。",
    },
  },
  {
    id: "deployment-runtime",
    capability: "五分鐘排程確實在部署環境執行",
    effect:
      "此部署的排程 ownership、執行及最近成功結果尚未經生產證據核實。" +
      "排程若未註冊，其他畫面仍可能看起來正常。",
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
/** What the runtime checks may look at: already on the screen, or one query away. */
export type RuntimeEvidence = {
  maintenanceState: MaintenanceHealthState;
  /** Whether any version has a `text-layer` extraction recorded. */
  textLayerObserved: boolean;
};

const RUNTIME_EVIDENCE: Partial<Record<BlockedIntegrationId, (input: RuntimeEvidence) => boolean>> =
  {
    // `never-observed` is the absence of any scheduled run at all, so every other
    // state IS the evidence this blocker names. No extra query: the operations
    // screen already computes this state.
    "deployment-runtime": ({ maintenanceState }) => maintenanceState !== "never-observed",
    // A text-layer row can only be written by the analysis pass running `unpdf`
    // for real. Tests run in Node and prove nothing about workerd.
    "document-text-extraction": ({ textLayerObserved }) => textLayerObserved,
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
export function staleBlockedIntegrations(
  input: { blocked: readonly BlockedIntegration[] } & RuntimeEvidence,
): readonly BlockedIntegrationId[] {
  return input.blocked
    .filter((item) => item.evidence.observable === "runtime")
    .filter((item) => RUNTIME_EVIDENCE[item.id]?.(input) === true)
    .map((item) => item.id);
}
