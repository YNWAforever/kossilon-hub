# Kossilon 同版原生驗收：精確待批清單

**只準備；全部未批准／未執行；原生 BLOCKED／NO_GO。** 這份文件及approval-request.json是審閱候選，不是執行指令或授權。AP-00至AP-12是審批項目ID，不新增或取代原F／R／UC／LA編號。缺少真實target值的項目不能以概括「可以測」啟動。

候選source固定為`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`；交付基線`531887acce5468f7321a3a2919a7afaa20dedac1`。本輪重核674來源檔及本機433個output檔，只有本機identity／hash證據。精確artifact manifest SHA256見source-candidate.json，**部署artifact checksum／URL／DB／Auth tenant尚未綁定**。候選若變，先讀diff和影響再換基線，不沿用舊SHA的runtime結論。

## 1. 審批邊界及必填綁定

| 欄位 | 本次已知／需要提供的精確資料 | 未齊時 |
| --- | --- | --- |
| Repo／source | 已核對origin、branch、上述source及交付；沒有新的產品改動 | 保留本機證據 |
| 隔離站 | **待填**：owner、現有URL、project/runtime/deployment ID、實際source SHA／artifact checksum、可用時段／審批到期HKT | 不開站、不登入 |
| CI／安全 | **待填**：required check/run IDs與head；該artifact SBOM／鎖檔／已接受的依賴風險 | 本機build0不能代替 |
| DB | **待填**：provider project/branch/database、app-role、唯讀observer、實際server identity、host/proxy/port綁定、migration ledger／physical catalog／checksum／權限 | 不import/instantiate真DB client；metadata先過初閘才作獲批唯讀identity確認 |
| Auth | **待填**：tenant ID、角色表、immutable Auth ID→internal user/profile/team/revision、既有QA session建立方法 | 不用email／QA名稱猜身份；不建立帳戶或發邀請 |
| Storage／scan | **待填**：account/bucket ID、精確object keys/prefix、quarantine邊界、scanner sandbox、當前version/hash及真receipt | 無真scan便只驗拒絕，不能seed clean／approved |
| 測試資料 | **待填**：driver diff／副作用、fixture manifest、父子IDs、versions、預期physical rows與audit、合法目的地／no-dispatch政策 | setup及所有業務寫入均不開放 |
| Calendar／故障／營運 | **待填**：核准calendar版本/hash與預期due/breach；fault clone及精確差異；scheduler owner/6個job IDs；QA backup／restore target | UC134／188／189／193相應部分維持blocked |
| 用量／清理 | **待填**：批准AP項目、共享及增量上限、時限、cost ceiling、exact cleanup IDs／保留政策、批准者及到期時間 | 不將本機授權延伸到原生target |

秘密只經既有安全表單／secret store／操作者QA session交付，不寫進聊天或證據。Network allowlist只含已批准的app/Auth/storage/provider sandbox hosts；未知host、正式資料、角色/target漂移或未預期外發即停依賴操作並保留事件。

日後本機重型DB／runtime harness仍須在實際執行上下文通過原3GiB RAM門檻，不停止別人工作或降低門檻。先前本機512MiB／1CPU／1GiB tmpfs容器上限不授權任何遠端資源；native算力、儲存、費用及增量建立需另列精確target／quota再批。

Fault clone及restore來源只准schema-only或本輪明確合成QA資料；共享站／正式資料不能因名稱帶test而被複製。Clone及restore runtime亦各自填URL／artifact／DB綁定；缺同版runtime時先保留blocked，不能自行deploy或改Core連線。

## 2. 角色清單：全部須是真身份，不能用注入actor代替

| Alias | 必填能力／隔離關係 | 要核對的結果 |
| --- | --- | --- |
| ADMIN_PRIMARY／ADMIN_RECOVERY | 兩個已存在的QA Admin；綁定identity/profile/team/revision，確認恢復者可用 | 合法管理；沒有Admin角色授予或邀請send |
| STAFF_SOURCE | Team A，有未完成三業務案件及owner/reviewer責任 | 預覽、完整轉交後方可按新revision停用；舊session被拒 |
| STAFF_OWNER／STAFF_REVIEWER | Team A，active/current identity吻合，符合原skills／分工；不預設override | 合法接手各業務，原parent/work關聯與狀態保留 |
| MANAGER_A | Team A Manager | 可讀本隊；Admin-only／跨隊仍拒絕 |
| STAFF_B／MANAGER_B | Team B；有自己的公司／案件positive control | 對A的list/detail/search/count/URL/API不洩漏 |
| CLIENT_A／CLIENT_B | 已綁定各自公司membership，無staff權限 | Portal只見本公司；staff/admin入口拒絕 |
| STAFF_NO_TEAM／AUTH_NO_PROFILE／STAFF_INACTIVE／STAFF_NO_SKILL | 分別是Staff缺team、Auth有帳戶無profile、停用、不符skill的獨立已存在QA身份 | 各自具體拒絕／恢復，不把合法Admin的明確global scope錯當缺team拒絕 |
| RACE_SOURCE_01至06 | 6個獨立已存在Team A QA Staff，對應create／owner／reviewer各兩次序 | 每輪獨立IDs與revision；不重啟已被停用來源來冒充第二輪 |
| PAGING_SOURCE | 額外已存在、active且獨立的Team A QA Staff，只供AP-06的104責任資料 | 不重用AP-05已停用來源；AP-06另批最多停用這1個QA profile |

最多2個同時browser contexts；角色依序重用乾淨context，不能共用cookie。初始所有actual Auth/internal/profile/team IDs均待填，沒有假造ID。AP-05最多可停用STAFF_SOURCE＋6個RACE_SOURCE的**7個已綁定QA profile**，並驗應用舊session拒絕；不包括刪Auth帳戶、provider停用、建立/提升角色或修改真員工。

## 3. 資料清單及setup精度

| 批次 | 必要合成資料與預期 | 待批ID／副作用範圍 |
| --- | --- | --- |
| Core | A/B公司與另一公司控制；三業務open parent/work；缺文件／欠款／critical finding blockers；Filed/Completed/terminal/unrelated controls；金額固定HKD1,000、部分收HKD300、待核proof HKD700 | AP-02：最多100個logical entities／2,500 physical rows（含自動children/audit）／100次setup request。優先由owner提供既有專用資料；fixture driver、精確IDs與預計row diff未review便不建立 |
| 文件 | 4個本機檔案上限：有效安全樣本、真掃描拒絕樣本或受控sandbox樣本、版本替換、補傳；每檔≤5MiB | 每檔SHA256/type/size/current-version/object-key/scan job及receipt；安全狀態來自真sandbox流程，缺provider不能人手造結果；4次PUT含retry，未知提交先讀receipt避免超量 |
| Handover完整分頁 | 101宗來源案＝97AR＋2註冊＋2變更，3個來源active work，共**104項責任**；另3個terminal case＋2個unrelated work作控制 | AP-06另批125 logical setup／5,000 physical rows／125 setup requests；含完整關聯。須以authoritative preview讀回100＋4，不能按fixture數量推論；driver若自動產生額外責任需先重審，不能改期望迎合 |
| 大量/匯入/歷史 | 1k公司／10k工作／1k文件、300混合案件、101對話及單對話201訊息；500列有效／重複／無效XLSX | AP-08另批15,000 logical／75,000 physical rows／1,000 setup requests；真檔hash、各類列數及預期新增ID清單先review，不能把500列當500成功。規模文件預設待掃描；少數安全bytes須有真receipt |
| Calendar | 週末、核准假期、香港午夜前後的固定日期與expected due/breach | UC134原NOT_RUN保留；需owner核准calendar及答案，不能自行猜法定業務日期 |

以上是**建議上限，尚未授權**。Logical數與physical row數分開；audit、outbox、工作projection及派生資料不能當0。所有setup先在已綁定disposable target過identity gate，再依核准driver產生本輪唯一run ID及精確manifest；server-generated IDs須從已commit receipt及獨立讀回關聯，未確認前不做下一個依賴寫入。setup不使用正式資料、不給歷史資料加可外發origin。

## 4. 精確待批操作包

| AP | 擬批准的具體動作／範圍 | 依賴及效果／回復 |
| --- | --- | --- |
| AP-00 | owner填齊第1節binding、角色、fixture、清理manifest及期限，只做審閱 | 沒有任何預設已批項目；可逐包批准或拒絕 |
| AP-01 | 先deployment/CI/provider metadata後，核准唯讀app-role/observer身份、ledger/catalog/privileges；建立既有QA session並驗角色讀取 | endpoint需先有副作用清單，已知會sync/write的GET不當唯讀探針；禁止migration。Magic-link/invite可能外發，除AP-09另批便不提出請求 |
| AP-02 | 在精確QA target按review後driver建立Core合成資料，保存前後row/projection/audit及IDs | 屬額外setup寫入，不包含在舊50個業務command內；若setup途中失敗只rollback自身transaction，未知commit先讀回 |
| AP-03 | Staff從Today→正確公司/案件→有界篩選/詳情/返回/reload；正常開三業務案、指派、建立客戶與註冊完成/同ID重試 | 只改manifest IDs，補齊／回讀授權業務結果；不正式交件；與AP-04/05共享總200 reads／50 command attempts |
| AP-04 | 真metadata/current-version/安全bytes核對；退回/補傳、回應遺失後同IDreceipt/重試；HKD1,000/300/700內部proof/ledger核對及相反決策並發 | 真storage/scan未批便相應blocked；不是實際轉帳；成功proof只credit一次，409敗方金額/audit不變 |
| AP-05 | Admin完整責任預覽，選合法owner/reviewer＋原因，取消預覽、確認、receipt、同ID重試、未知取消fence；完成後停用7個綁定QA來源；六個雙人競爭次序 | 預覽scope/hash/revisions→明確確認→atomic parent/work/audit→remaining0→新revision停用；保留blocked/terminal/unrelated。已commit不能用取消或code rollback冒充業務undo |
| AP-06 | 在另外核准104責任資料上重做完整分頁、preview取消、轉交、獨立readback及來源停用 | 額外100 reads／20 command attempts及第3節setup，另綁PAGING_SOURCE並最多停用這1個profile；不能把Core小資料通過當100＋4通過 |
| AP-07 | 自己browser context的503／timeout／response-drop；核准calendar比較；dedicated clone上schema不相容及QA最後Admin拒絕 | 額外100 reads／20 command attempts／1 fault clone及另綁fault environment。任何schema差異與rollback diff先review，不改共享DB/全域clock/Auth provider；只在clone內兩QA Admin並發最多2次降權/停用嘗試、保留1名可用，不改Core Admin或重新授予Admin |
| AP-08 | 有界清單/中文搜尋/snapshot/全選排除；500XLSX parser→preview→apply→中斷→重試→資料回讀；對話/訊息歷史；只產草稿、no-dispatch | 額外200 reads／50 command attempts＋第3節大setup；XLSX≤5MiB、最多2次upload attempts。所有增加相對舊Core cap清楚另批，不能自動沿用到此 |
| AP-09 | 指定scanner/OCR/AI、Auth受控mail sink、WhatsApp與交件**sandbox**的真正回執及故障/去重 | 所有destination/model/corpus/資料處理/用量/貨幣/費用未填、批准calls與spend均0。具體request ceilings見JSON；不得因批准Core而自動發訊息或付費。真正式付款/訊息/交件仍0 |
| AP-10 | 既有真角色在固定裝置/網絡完成keyboard/screen-reader/mobile/physical Safari；6個固定頁cold/warm各30次量測 | 需AP-08規模資料；另批360 navigations、2,000 business API reads、1GiB、120分鐘，最多2contexts。定6 routes後才測；建議p95列表≤2s、搜尋≤1s，LCP≤2.5s/INP≤200ms/CLS≤0.1分開記錄；未同意不自訂接受門檻 |
| AP-11 | 觀察3個原生5分鐘tick（20分鐘窗）、最多6個已列job IDs；1份純QA backup還原至1個新disposable DB，核代表case/object並量RTO/RPO | scheduler owner、exact IDs、backup/object snapshot/hash、restore target／另綁restore environment與費用先批；最多100 reads／60分鐘restore。沒有AP-09則worker不得派送或跑付費provider；不人手插tick、改scan或以stub算native |
| AP-12 | 關閉自己clients／QA sessions、讀回inventory並封存；按核准模式保留資料或dispose精確owned資源／object keys | 預設retain等待owner review；最多4 keys及2個完全owned disposable DB資源（fault clone＋restore），須逐個核實實際IDs及可丟棄性。既有Core/shared target保留；另需dispose便另列增量。不刪immutable audit、不blanket delete/truncate；失敗保留IDs及stop |

若需新站、deploy、正式migration、Auth帳戶建立、角色提升、production讀寫或付費服務：這些**不在Core操作包**，必須先補獨立target／diff／成本／備份／回復候選再另批。本輪沒有產生或執行可建立這些資源的腳本。

## 5. Core用量分配：重試／拒絕亦計數

AP-03/04/05合計只有200個業務讀取、50個業務command attempts、120個Auth/session requests、20個control-plane metadata讀取、1,000 asset requests、100MiB下載、4個≤5MiB檔案且**PUT attempts總共4次（含重試）**、120分鐘、2個同時contexts及1個Core站。Command指業務寫入嘗試（包括被拒／cancel／same-ID重試）；純預覽及獨立業務DB讀回計入reads，不能靠HTTP method混淆。AP-07/11的fault／restore environment是另批增量，不能用單站Core批准自行provision或deploy。

| 50個command預留 | 次數 |
| --- | ---: |
| 三業務建立3、owner/reviewer指派2、BR normalized客戶建立1、註冊完成及同ID重試2 | 8 |
| 欄位/duplicate BR/越權或stale拒絕 | 6 |
| 文件退回/補傳/unknown-result讀回後重試/取消的寫入嘗試 | 8 |
| 部分付款與相反決策/重試 | 6 |
| Handover確認/receipt後重試/cancel/停用 | 10 |
| Create/owner/reviewer與disable，各兩個次序，每次兩個command | 12 |
| **合計** | **50** |

這是Core預留與上限，不是聲稱50次足夠跑完100UC。完整300案、10k工作、500匯入、104責任、真provider、排程及效能各有額外包。實際UI會多出請求或重試時先扣配額；耗盡便停未執行部分並記NOT_RUN，不暗加fixture/次數、縮情境來報全通過。Provider request上限包含retry；cost上限未填便不呼叫。

Core需要unknown-upload retry時，最多預留3個初始PUT＋1個重試，其他檔案採已綁定既有物件或保持未執行；不能4次新PUT後再加重試。AP-11若worker無法約束到6個核准job IDs或有非本輪queue，不啟動／不冒稱安全隔離；先另交專用runtime與start/stop/rollback差異候選。不能靠改job狀態、tick或provider stub湊齊原生證據。

## 6. 員工完整流程與觀察oracle

1. **身份與下一事（UC99–107、111–128、195）**：Visitor拒絕；真Staff登入→Today的公司/類型/期限/首要blocker/下一步→正確案件。Manager/team B/Client與缺team/停用身份逐個list/get/search/count/URL/API拒絕；空態與錯誤分開。對應原欄位仍以native-scenario-map.csv為準，不將整個範圍一律宣告已執行。
2. **資料正確與返回（UC124、135–141、158–166）**：中文搜尋及BR normalization／duplicate；註冊/變更清單與子路由；取消不寫入、非法/不存在/越權ID有安全恢復；完成註冊再同ID提交不重建公司。返回保留原公司/搜尋/cursor，reload讀持久結果。
3. **文件／付款／readiness（UC126、142–157）**：核company/case/current-version/object/hash/scan/review，未掃描／不安全／物件缺失不讀bytes。缺文件、欠款、critical finding三種各自blocked，真實補齊後才解除。Proof固定sourceVersion，兩人批准/退回：只一個commit、另一409，credit/餘額/immutable audit與receipt獨立讀回；沒有實際付款。

   金額oracle按勝方判斷：既有合成內部ledger300、proof700、fee1000；批准勝出則ledger1000／餘額0，退回勝出則ledger300／餘額700，同ID重試不再credit。合成ledger不是銀行入帳證明，critical finding fixture也不是AI準確性驗收。
4. **轉交／停用（UC130、131、185、186）**：完整preview及正確parent/work公司；角色/隊/skills/duty/版本拒絕整批無變；明確確認→逐項moves與audit→source remaining0→new revision停用。Response丟失先receipt，同ID重試不多做；cancel-before-late-submit fence，already committed回原receipt。Create／owner／reviewer對disable兩個次序，觀察真HTTP與DB lock/readback，拒絕後無半完成寫入。最後由接手人Today開正確工作及reload，來源舊session拒絕。
5. **恢復與營運（UC167–194）**：按額外包完成bulk/import retry/cancel/readback、no-dispatch、HKT/503恢復、schema拒絕、3原生tick、backup/object restore、受控provider/filing receipts。AP-08/09/11未批的部分保持blocked，不拿Core toast或本機fixture補完。
6. **可及性／效能（UC117、118、140、159、196–198）**：真角色鍵盤/焦點/錯誤關聯/輔助閱讀、390×844/768/200%及physical Safari另列；6頁固定網絡/裝置cold/warm各30次，分開HTTP/SQL/payload及瀏覽器指標。

每個實際執行項目均保存：exact source/artifact/runtime/actor/role/team、run與operation/request IDs、before versions／金額／projection、sanitized HTTP facts、expected/actual、獨立app-role/observer與object readback、audit／provider receipt、取消／返回／reload結果、用量及cleanup disposition。觀察者不能因superuser查得到資料而聲稱app-role/RLS通過。Fault injection種類明列；自己丟response不是供應商真故障證據。

## 7. 清理、停止與可批准的形式

執行者先重核target及manifest，再按packet／IDs／quota逐項做；任一unsafe scope、未知commit、越權讀、provider destination不符、未預期正式資料／費用即停止依賴部分，先讀receipt及保留failure，繼續不依賴它的已批工作。部署／migration／kill switch的設定變更沒有獨立批准便不做。

清理先停止自己的polling與clients，再保存job/operation/audit/object/projection inventory、resource metadata及seal；immutable audit不得刪或改。共享QA資料只能走另批exact IDs／合法API清理，FK/audit阻擋便retain，不能force delete。完整dispose僅適用owner證明完全可丟棄、該run專用且逐ID獲批的資源；復核前後殘留數。失敗清理不重試不明對象；簽出自己的session，不自行恢復/重授角色。QA來源profile按已批終態保留disabled；任何補償需新的可審閱command與audit。

可供之後填寫的授權紀錄必須包含：plan ID＋source SHA、精確binding/role/fixture/cleanup manifests及hash、批准的AP IDs、各共享/增量配額、明確HKD或其他貨幣上限、有效HKT窗口、批准者及失敗時處置。approval-request.json目前approved_packet_ids空、execution_enabled=false；缺欄位項目為NOT_READY，不可先總括批准後再猜環境。本輪只提交這份候選，不要求或視作已取得執行批准。
