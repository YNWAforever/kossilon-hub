# AP-01 metadata-only：最小唯讀候選

**只準備，未批准／未執行；原生 BLOCKED／NO_GO。** Parent為原AP-01，本文件只定義control-plane metadata子範圍，不是QA登入、DB只讀或整包AP-01授權。交付基線`c8df4219f4c0b064aba35ec1d9f8388deb2654f1`；候選`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`。本機已證據見[AP-00預填](../cosec-20261025-ap00-07447c43/LOCAL-PREFILL.md)，不重填成原生觀察值。

## 三層前置條件

| 層 | Metadata-only現在需要 | 後續階段才需要 |
| --- | --- | --- |
| **Target／平台** | owner指定既有非正式URL（只用來比對，不開啟）、專用/共享、精確project/deployment或可信metadata定位連結；DB branch/Auth tenant若未有可在已批准精確project內查；既有平台control-plane唯讀存取及其帳戶/權限範圍；另行明示本子範圍、HKT期限、配額 | 沒有隔離站／metadata權限便blocked；不建站、不新增OAuth連接／帳戶或改設定。平台存取身份與Kossilon QA Admin是兩回事 |
| **QA Admin** | **不需要；本階段使用次數0** | 日後獨立批准QA identity階段，才用既有QA Admin安全登入方式，核Auth tenant及immutable Auth ID→internal user/profile/team/revision。新session、magic-link、invite、getSession或actor RPC均不在本子範圍 |
| **DB 存取** | **不需要連線、憑證或client；SQL次數0**。只讀provider既有project/branch/database/endpoint的資源描述，不接觸DB endpoint | 日後獨立批准DB階段，先有target metadata綁定及安全取得的app-role/observer唯讀存取，再核實實際server/role/catalog/privileges；不因本次branch描述便宣稱actual server或schema相容 |

Metadata-only不需要公司／案件／文件／付款IDs、seed、QA角色矩陣或scanner。這些保留原AP包的前置條件。平台工具若只有SQL API、會resume compute、建立資源、health-check連DB、讀秘密env值或需新登入／consent，該工具不適用，先記blocked，不能改稱metadata查詢。

## 最小步驟與用量分配

下表是**日後待批程序，本輪沒有執行**。不用猜endpoint或CLI flag；先把實際工具/operation/精確IDs/允許欄位/分頁及副作用列入request manifest。只選已有存取、明確無副作用的metadata read；禁止整個帳戶或未指定project的列舉。

| 步驟 | 唯讀內容／必要欄位 | Request預留 | 證據／不足處置 |
| --- | --- | ---: | --- |
| M0 本機scope gate | owner target聲明、可信定位資訊、現有平台存取引用、AP-01 metadata-only獨立批准、HKT窗口及quota；核source4d63818與本機manifest種類 | 0 | E0批准/target/request manifest；缺欄保持NOT_READY，不先probe app |
| M1 部署／target關聯 | 精確project/deployment ID、該deployment URL關聯、environment、source SHA、runtime標識與取得時間；只讀允許的非秘密欄位 | 6 | E1 deployment summary；owner聲明＋獨立平台metadata相互比對。URL／production/owner/版本不符，停依賴步驟 |
| M2 DB資源描述 | 在已綁定project內讀精確branch/database/endpoint ID及parent關係；僅control-plane metadata、無SQL、無連線、無喚醒 | 4 | E2 db-resource summary；記為declared endpoint，不記成actual server identity/role/catalog PASS |
| M3 Auth資源描述 | tenant/issuer ID、允許的app/runtime關聯、metadata來源；不取session/cookie/token或QA用戶資料 | 2 | E3 auth-binding summary；不支持metadata read則保留未知，不能改用getSession試登入 |
| M4 CI／artifact provenance | 精確source的required CI run/check IDs與結果；provider提供的artifact checksum及其類型/範圍；既有SBOM/lock/advisory disposition的metadata或owner已提供文件摘要 | 4 | E4 provenance summary；無artifact hash、checksum種類不同或安全處置缺失便記未證明，不下載bundle或跑新scan/CI |
| M5 安全讀取重試預留 | 只限同一精確scope且確認無副作用的讀取，至多1次明示重試/步驟；所有page/retry/redirect均計數 | 4 | E5 usage ledger；401/403不重試或換路徑；不可分辨副作用／用量便不執行該call |
| M6 比對／封存 | 本機比對聲明與metadata、分開expected/observed、寫缺口與request ledger及hash；結束本次讀取 | 0 | E6 disposition/manifest；不足保留blocked，不做修復或清理遠端資源 |
| **總預留** | **6＋4＋2＋4＋4** | **20** | 不是必須用滿；一項blocked不授權擴scope |

建議總上限：**1個既有target、20個metadata read attempts、10MiB metadata responses、30分鐘**。單次有界response≤1MiB；如需列表，只准精確已指定project內至多20條的有界頁，額外page也扣20總額。這是AP-00較大唯讀草案內再縮小的proposal，**尚未批准**。

業務/身份/observer讀取、app RPC、Auth/session requests、DB queries/clients、browser contexts、artifact/object bytes下載、uploads、provider processing/send、帳戶/profile/role變更、資源建立/喚醒、付費服務新增費用、刪除/dispose、push/merge/deploy均**0**。Metadata responses本身才計入10MiB。DB/Auth平台metadata reads只按上表計；不等於DB連線或Auth運行驗收。使用既有connector/metadata工具或owner已提供檔案，不開browser或重新登入／擴大OAuth scope；缺平台存取便blocked。

每個工具call、可見底層HTTP page/attempt/redirect/retry入帳。工具若隱藏多次請求或auto-resume/auto-pagination且無法界定副作用/用量，先標NOT_READY，不能聲稱符合20次上限。無背景polling、無自動重試、無health check或app GET；開/預覽Kossilon `/`、`/operations`、business route都不包含，以免SSR或GET party-sync初始化/寫入。

## 證據清單（E0至E6）

| 證據 | 必記 | 可得出的層級 |
| --- | --- | --- |
| E0 target/scope/request manifest | owner、URL作字串比對、project/預期IDs、平台access reference、批准者/範圍/HKT起迄、quota、每個工具/operation/fields/副作用檢查；不記秘密 | 只證明本次metadata scope及取得路徑；目前全待填 |
| E1 deployment | exact project/deployment/runtime ID、metadata URL關聯、observed source SHA、source/取得時間、request ID/hash、expected4d63818比對 | 控制平台報告的部署描述，非app runtime或功能PASS |
| E2 DB resource | provider project/branch/database/endpoint ID與父子關係、資源metadata來源/時間/hash；actual server/role/catalog欄仍未知 | **control-plane描述**；不是DB登入／RLS／schema驗收 |
| E3 Auth binding | tenant/issuer/app binding ID、metadata來源/時間/hash；session/actor/QA Admin核實均false | **tenant配置描述**；不是登入／撤權／角色證據 |
| E4 CI/artifact/security | run/check IDs/source/result與取得時間；checksum值＋kind＋file/archive範圍；SBOM／advisory disposition來源/缺口 | 已有metadata；本機file-set manifest SHA不與provider bundle SHA直接當成相同。沒有同種類／同範圍證據便artifact_binding_unproven |
| E5 usage/failure | 每attempt開始/完結HKT、工具/operation/exact target、response bytes/status、hash、是否retry/page、用量餘額、每個blocked/失敗的真原因 | 真執行時的讀取帳；**本輪模板entries空、usage0不是執行結果** |
| E6 disposition/manifest | expected與observed分開、每項MATCH/MISMATCH/UNKNOWN/NOT_RUN、不可推論項目、檔案SHA256、next gate | 只可標metadata吻合/未證明；native Auth/DB/業務/排程仍BLOCKED、NO_GO |

Raw response只保存允許的非秘密fields，避免env values、cookies、tokens、credential URLs或用戶個資；不足時保存sanitized摘要與來源/hash/缺口。輸出檔名/格式只是`evidence-template.json`的未執行模板，沒有虛構observed時間／request ID或成功tick。

**完成界線：** metadata取得路徑／scope／quota與每項target描述可審閱即完成此子範圍；缺資料可有blocked disposition，不因此建立資源、執行SQL、登入QA或deploy。日後QA身份及DB身份各自重新過閘、另批；metadata成功不關閉原UC/LA，尤其LA27相容性、LA28排程及UC186完整旅程。清理只封存本次本機證據／結束讀取，不登出既有共享平台session、不刪object或dispose任何資源。
