# UC166 未完成範圍

- **BLOCKED_NATIVE_TARGET**：缺可核實且獲准的同版原生 target／角色；本機注入 actor、virtual RPC、superuser disposable SQL不是原生 Auth／server-function HTTP／DB-RLS 證據。
- **BLOCKED_NATIVE_PERSISTED_RELOAD**：Edge reload只回讀本輪 sessionStorage ledger；SQL另由真 observer驗證，不冒充同一原生 browser→HTTP→DB旅程。
- **NOT_RUN_FULL_UNIT**：本批相關116項／11files通過，全量 unit未跑，歷史結果不沿用。
- **NOT_RUN_DEVICE_ASSISTIVE**：實體裝置、Safari/WebKit及screen reader未驗。
- **SCOPED_RETRY**：只驗拒絕後修正及pending UI去重，未提供已提交回應遺失／跨頁新請求的去重承諾；名冊完成／存量及已核准真實calendar另列範圍。

Native70BLOCKED/114NOT_RUN/0PASS；release_gate=NO_GO。所有本批失敗及原F/R/UC/LA原始結果保留，不把blocked算pass。
