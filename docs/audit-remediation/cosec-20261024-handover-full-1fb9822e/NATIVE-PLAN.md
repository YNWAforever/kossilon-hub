# 同版原生驗收候選：只準備，未執行

Native BLOCKED／NO_GO。source版本以本批release-candidate.json為準；當前候選仍缺完整UC186轉交command及停用並發保護，這兩項是先決本機關卡，不可直接跳到原生稱通過。之後補碼產生新SHA時，要重新綁定artifact、source manifest、DB schema／權限及測試，不能沿用舊SHA的PASS。

完整原生環境及主旅程沿用上一批 [NATIVE-PLAN.md](../cosec-20261024-handover-657a8815/NATIVE-PLAN.md)，此處補本輪UC186所需資料、操作及門檻；沒有新增執行授權。

環境須由擁有人提供已批准隔離站URL、artifact／source SHA、runtime ID、Neon project/branch/database、Auth tenant、storage bucket／queue／scanner sandbox非秘密ID。先唯讀比對artifact、實體catalog／migration ledger／app-role及實際連線路徑；不靠localhost／test label認定隔離。不要在聊天貼token／密碼。

角色為合成Admin、來源Staff、同隊合資格owner及reviewer接手者、另一隊Staff／Manager、Client及停用／profile不一致控制身份。登記immutable Auth ID→internal user/profile/team；email相同不算身份證明。接手者須滿足所轉案件／工作之實際角色、active team、技能及分工規則。

資料包括每隊一間合成公司、三業務open parent、annual及work reviewer、無work投影的incorporation、沒有required skill的normal corporate work、獨立terminal控制；保留一組缺文件／未付費readiness，安全及拒絕文件版本。執行前登記精確IDs、object keys、parents、source versions和operation ID，不使用正式資料或seed成功標記。

完整流程：

1. Staff真登入→Today辨認下一事／期限／blocker→開正確公司／案件→核安全文件、付款及readiness；Team B／Client以URL/API均拒絕且不暫顯快取。
2. Admin讀來源全部owner／reviewer責任→分別選合法接手者→預覽完整scope及版本→取消不寫入→重新預覽、明確確認。缺受讓人、錯角色／隊、inactive、profile不一致、分工衝突、stale preview均拒絕且parents／work／audit不變。
3. 合法確認一次原子轉交三業務parent與active work；來源剩餘0，terminal不動，每項old/new actor／receiver／operation可歸因。刻意遺失response，讀operation receipt，再用同一operation重試；無重複轉交／審計。改payload沿用operation必須衝突。
4. 交前停用拒絕；交後可按新revision明確停用。用另一真session同時建案／指派與停用，兩種先後次序均觀察API結果、鎖等待／conflict及獨立回讀：不能在停用成功後冒出新責任。先成案／指派者若成功，停用須讀到責任並拒絕。來源舊session立即拒絕，接手者能開案。
5. 真HTTP response、API再讀、獨立app-role資料回讀、Admin audit、來源／接手者Today／case、返回及reload一致；角色拒絕、空態、錯誤、重複／並發、取消／返回全涵蓋。toast、mock session、本機SQL superuser及人工改scan/tick均不足。

建議待批上限：單一同版隔離站、最多2個同時browser contexts、200次業務讀取、50次合成commands、4個≤5MiB檔案；實際付款轉帳、真訊息、正式交件、付費服務呼叫均0。此上限是計劃，尚未授權使用。

精確待批操作：接入指定隔離URL並建立自己的QA session；對事先manifest的合成IDs執行上述內部業務寫入、文件upload及sandbox scan／readback；保留前後projection、request/receipt及不可刪audit。若需建立站／部署／套schema，先交target、差異、成本及rollback候選再另批；本次no push/merge/deploy仍有效。

Cleanup只針對核實屬本輪的精確record/object IDs，或另獲批准、完全owned的disposable資源。再核identity／inventory、client closure與before/after讀回；不blanket delete、不刪immutable audit或正式帳戶。需整體dispose時列精確resource ID及保留證據，再批准。只讀授權不包含上述寫入／cleanup。
