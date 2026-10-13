/**
 * Chinese names for the built-in checklist documents.
 *
 * Checklist item names are firm data: they are seeded from templates the firm
 * can edit in Settings, and requirement matching reads them (see
 * REQUIREMENT_MARKERS), so the stored English stays exactly as it is. The
 * screen shows the Chinese name first and keeps the English beside it — the
 * form codes (NAR1, NNC1, ND2A) are how the trade names these documents — and
 * shows any name the firm typed itself exactly as typed.
 *
 * Names follow the Companies Registry's own Chinese titles where one exists.
 */
const CHINESE_NAMES: Record<string, string> = {
  "signed nar1 form": "已簽署的 NAR1 周年申報表",
  "register of directors": "董事登記冊",
  "register of secretaries": "公司秘書登記冊",
  "register of members": "成員登記冊",
  "register of members (updated)": "成員登記冊（更新版）",
  "updated register of members": "更新的成員登記冊",
  "updated register of directors and secretaries": "更新的董事及公司秘書登記冊",
  "business registration certificate copy": "商業登記證副本",
  "updated business registration certificate": "更新的商業登記證",
  "id copies of all directors": "全體董事身分證明文件副本",
  "proof of registered office address": "註冊辦事處地址證明",
  "auditor's report": "核數師報告",
  "directors' report": "董事報告",
  "audited financial statements": "經審計財務報表",
  "nnc1 incorporation form": "NNC1 法團成立表格",
  "articles of association": "組織章程細則",
  "irbr1 business registration notice": "IRBR1 商業登記通知",
  "id / passport of each director & shareholder": "每名董事及股東的身分證／護照",
  "proof of address for each director": "每名董事的地址證明",
  "written consent from all directors": "全體董事的書面同意",
  "nd2a / nd2b form": "ND2A／ND2B 表格",
  "nd2a/nd2b form": "ND2A／ND2B 表格",
  "board resolution": "董事會決議",
  "consent to act as director": "出任董事同意書",
  "new director id copy": "新任董事身分證明文件副本",
  "dr1 deregistration form": "DR1 撤銷註冊申請書",
  "ird notice of no objection": "稅務局不反對撤銷註冊通知書",
  "special resolution approving new name": "批准新名稱的特別決議",
  "nnc2 form": "NNC2 更改名稱通知書",
  "certificate of change of name": "更改名稱證明書",
  "bought & sold note": "買賣單據",
  "instrument of transfer": "轉讓文書",
  "transferee id/address proof": "承讓人身分及地址證明",
  "stamp duty payment receipt": "印花稅繳付收據",
  "new officer's id/address proof": "新任高級人員身分及地址證明",
  "nr1 form": "NR1 註冊辦事處地址變更通知書",
  "proof of new address": "新地址證明",
};

/** The Chinese name of a built-in document, or null for a name the firm typed. */
export function checklistItemChineseName(label: string): string | null {
  return CHINESE_NAMES[label.trim().replace(/\s+/g, " ").toLowerCase()] ?? null;
}

/** For running text and accessible names: 「董事登記冊（Register of directors）」. */
export function checklistItemText(label: string): string {
  const chinese = checklistItemChineseName(label);
  return chinese ? `${chinese}（${label.trim()}）` : label;
}
