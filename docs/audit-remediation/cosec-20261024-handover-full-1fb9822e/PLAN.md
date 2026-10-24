# UC186 合法跨業務交接與並發停用保護

Base `7a70e3be143cf771b6693f4ec2bb491817f74ca9`，其source父版 `4e5b4532091d125d79ca19244a0699f26832166a`；root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`，branch codex/cosec-20261023，origin https://github.com/YNWAforever/kossilon-hub.git。起始clean，沒有後續交付，其他worktree保留。Run `cosec-20261024-handover-full-1fb9822e`。

原UC186未完成範圍：Admin明確選owner／reviewer接手者，預覽完整權威案件與工作範圍，確認合法轉交後可停用來源員工，審計及獨立資料回讀一致。回應遺失可用同一operationId核對／重試，不能重做成功項。不得把work projection轉交當parent case已轉交。

先重現：UI缺明確確認入口；未指定技能的corporate工作沒有合法候選；正常incorporation createCase讀舊active值、在disable提交後仍建立新案。保留實際RED，不強行改正確的annual/work現有防線。

修補方向：沿用現有lifecycle key，handover/disable exclusive，責任建立／指派在outer transaction最先shared admission，之後current verified staff/team/role/separation檢查。覆蓋三種案件、work items、import/bulk入口，避免late admission反轉鎖順序。交接transaction核對source/receiver revision與完整preview fingerprint；同時更新authoritative parents、active work責任與歸因audit。既有版本／locked case／技能及分工規則不繞過；整批錯誤rollback，沒有部分轉交。

驗收：role/identity/inactive/foreign-team及同人owner/reviewer拒絕，stale preview/revision、空態、取消、回應遺失同operation重試、altered operation拒絕；跨三業務owner及annual/work reviewer、terminal記錄不動、完整audit與readback；new-case及assignment與disable雙向實際lock wait，無停用後新責任、無死鎖／半完成。UI使用bounded可搜尋接手人清單、明確預覽與確認、保留unknown重試。

授權：本機code/tests/docs及精確核實disposable container，固定已安裝image、512MiB/1CPU/1GiB tmpfs、無shared mount、loopback mapping＋metadata/SCRAM/實際system identity；RAM gate focused1.5GiB、type/lint2GiB、DB/build/fullunit3GiB。cleanup只精確owned資料／資源，先closure/inventory/projection。無push/merge/deploy、正式migration／帳戶／權限、訊息／付款／交件或付費服務。

184列原F/R/UC/LA及歷史失敗保留；native70BLOCKED/114NOT_RUN/0PASS、NO_GO。既有19批2655個manifested檔案不改。Graph metadata8s逾時；先前遭拒的私有indexing未重試。Postgres locking skill用於transaction／lock順序，mock/session/stub僅本機。

## 本輪實際checkpoint（不是原計劃完成）

上列creation-race是待重現假設，**SQL NOT_RUN**。四次actual-context provision RAM gate拒絕，未建立target。只對已實際重現的null-skill候選缺陷落4-file修補；missing-command UI RED原樣保存，完整交接與lifecycle並發仍未實作。各種角色／重試／audit／readback的完整SQL驗收仍欠，不以既有防線／unit PASS替代。

遠端main由GitHub connector重新核對仍1c57a67213af72bff8d776694e6ed8c986b921db；本機main=c1b41a81d76ed98f3ddd98a3e69fc3db3a6f0360是其祖先，落後256commits。已讀相關本機差異，沒有fetch／移動refs，沒有把本機舊ref或原production當同版runtime。Git CLI DNS讀取失敗，精確connector收據見remote-refresh.json。
