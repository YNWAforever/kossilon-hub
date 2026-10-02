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

import type { MaintenanceHealthState, MaintenanceHealth } from "./health";

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
    pilotFallback:
      "職員可人工核對；文件保持隔離，不能用人手記錄代替綁定目前版本的真正掃描 verdict。",
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
      "PDF 文字層擷取及內容規則已實作，只處理通過真正掃描的目前版本。部署執行證據另列；掃描檔與相片仍需已批准的 OCR 或人手核對。",
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
      "HTTP AI advisory adapter 及引用建議已實作。是否配置、是否通過 runtime 驗證及供應商批准分開顯示；模型不能批准文件或套件。",
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
      "歷史排程記錄、目前 freshness 及執行範圍另列。僅有 adapter 或一次人手執行不能證明真正排程持續運行。",
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

export type CapabilityId =
  | BlockedIntegrationId
  | "database"
  | "auth-provider"
  | "document-storage"
  | "whatsapp-transport"
  | "document-ocr";
export type CapabilityHealth = "healthy" | "degraded" | "failed" | "unknown";
export type CapabilityStatus = {
  id: CapabilityId;
  capability: string;
  implemented: boolean;
  configured: boolean | null;
  health: CapabilityHealth;
  lastVerifiedAt: string | null;
  approvalRequired: boolean;
  owner: string;
  nextAction: string;
  summary: string;
};
export type CapabilityProbe = { health: CapabilityHealth; lastVerifiedAt: string };

/** Local config and recorded evidence only. Rendering never calls a provider. */
export function capabilityStatuses(input: {
  configuration?: Partial<Record<CapabilityId, boolean>>;
  probes?: Partial<Record<CapabilityId, CapabilityProbe>>;
  maintenance: MaintenanceHealth | null;
  textLayerObserved: boolean | null;
  schemaReady?: boolean | null;
}): CapabilityStatus[] {
  const metadata: {
    id: CapabilityId;
    capability: string;
    implemented: boolean;
    owner: string;
    nextAction: string;
    approval: boolean;
  }[] = [
    {
      id: "database",
      capability: "資料庫結構",
      implemented: true,
      owner: "DB／Release owner",
      nextAction: "核對 ledger、檔案 hash 和實體 DDL；只按批准的部署包處理差異。",
      approval: true,
    },
    {
      id: "auth-provider",
      capability: "Neon Auth 新登入及角色",
      implemented: true,
      owner: "Auth owner",
      nextAction: "以受控帳戶完成 fresh magic-link／Google 及角色隔離測試。",
      approval: true,
    },
    {
      id: "document-storage",
      capability: "R2 私人文件儲存",
      implemented: true,
      owner: "Storage owner",
      nextAction: "驗證授權 sample 的私人 object roundtrip 與版本授權。",
      approval: true,
    },
    {
      id: "malware-scanner-provider",
      capability: "文件惡意軟件掃描",
      implemented: true,
      owner: "Security／Scanner owner",
      nextAction: "確認已批准供應商、binding、條款及綁定目前版本的實際 sample verdict。",
      approval: true,
    },
    {
      id: "document-text-extraction",
      capability: "PDF 文字層及內容規則",
      implemented: true,
      owner: "Document pipeline owner",
      nextAction: "核對通過掃描的版本擷取記錄及引用；程式測試不代替部署執行。",
      approval: false,
    },
    {
      id: "document-ocr",
      capability: "掃描檔／相片 OCR",
      implemented: false,
      owner: "OCR provider owner",
      nextAction: "提供已批准 OCR 協議及 golden samples；未確認時人手核對。",
      approval: true,
    },
    {
      id: "ai-provider",
      capability: "AI 可引用審閱建議",
      implemented: true,
      owner: "AI provider owner",
      nextAction: "確認供應商批准、endpoint／key presence、實際 grounded sample；AI 不作批准。",
      approval: true,
    },
    {
      id: "whatsapp-transport",
      capability: "WOZTELL 訊息及 webhook",
      implemented: true,
      owner: "Messaging owner",
      nextAction: "核對四項 binding、受控收件人及 acceptance／delivery 證據；unknown 不盲目重試。",
      approval: true,
    },
    {
      id: "whatsapp-media-download",
      capability: "WhatsApp 附件入件",
      implemented: false,
      owner: "Messaging／Storage owner",
      nextAction: "提供正式 media download 協議及 scoped token；檔案須 quarantine／scan。",
      approval: true,
    },
    {
      id: "external-handoff-destination",
      capability: "內部 server 交件／回件",
      implemented: false,
      owner: "Internal-server owner",
      nextAction: "提供真實 transport／receipt 協議；保留人手上載及提交證明，匯出不算交件。",
      approval: true,
    },
    {
      id: "deployment-runtime",
      capability: "五分鐘排程",
      implemented: true,
      owner: "Operations／Release owner",
      nextAction: "核對單一 owner 及執行範圍；用 platform logs／DB correlation 驗證3次真正排程。",
      approval: true,
    },
  ];
  return metadata.map((item) => {
    const probe = input.probes?.[item.id];
    let health: CapabilityHealth = probe?.health ?? "unknown",
      lastVerifiedAt = probe?.lastVerifiedAt ?? null;
    let summary = probe
      ? "狀態來自已記錄驗證；批准 gate 保留。"
      : "尚無可用 runtime 驗證，配置存在亦不代表健康。";
    if (item.id === "deployment-runtime" && input.maintenance) {
      health =
        input.maintenance.state === "healthy"
          ? "healthy"
          : input.maintenance.state === "failing"
            ? "failed"
            : input.maintenance.state === "never-observed"
              ? "unknown"
              : "degraded";
      lastVerifiedAt = input.maintenance.lastSuccessAt;
      summary = input.maintenance.summary + " 維護排程成功不代表掃描、分析或訊息外發已獲批准。";
    }
    if (item.id === "database" && input.schemaReady !== undefined) {
      health = input.schemaReady === null ? "unknown" : input.schemaReady ? "healthy" : "degraded";
      summary =
        "已核對 ledger 及 outbox dispatch marker 的 column／index；其他實體 DDL、hash 及歷史 ID 仍需部署 review。";
    }
    if (item.id === "document-text-extraction" && input.textLayerObserved)
      summary = "已見文字層記錄；實際 runtime、版本及 sample 驗證仍需核對。";
    return {
      id: item.id,
      capability: item.capability,
      implemented: item.implemented,
      configured: input.configuration?.[item.id] ?? null,
      health,
      lastVerifiedAt,
      approvalRequired: item.approval,
      owner: item.owner,
      nextAction: item.nextAction,
      summary,
    };
  });
}
