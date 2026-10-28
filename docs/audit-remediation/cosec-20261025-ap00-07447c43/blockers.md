# AP-00 native綁定／授權待補：BLOCKED／NO_GO

本機已證實欄位及所有提案要求已預填。Actual native31欄仍未核實；本輪只有準備授權，approved_packet_ids仍空。

首輪最小三組見[MINIMUM-INPUT.md](MINIMUM-INPUT.md)：

1. 既有非正式URL／owner／專用或共享、可核實resource metadata IDs/links及安全存取位置。沒有則填無，不新建。
2. 若要超越metadata，提供1個既有QA Admin識別及安全登入方式；要查DB另需獲准唯讀角色/安全存取。沒有則相應身份／DB階段保留blocked。勿貼password/token/秘密連線字串。
3. 日後獨立明示精確readonly子範圍、批准者、HKT起迄及接受／調低配額。本輪仍只準備，不視作任何AP已批。

metadata／身份-only不用業務fixture或資料讀取。21個完整QA角色、公司／案／版本ID、storage/provider、calendar、fault/restore/scheduler、裝置及清理ID各在對應包前補；沒有因此豁免完整驗收。原13AP內容及Core200reads/50commands的草案不變，首輪更小的0寫入子範圍亦未批准。

不以local artifact hash代填deployed checksum、不以historical SQL target代填DB branch、不以alias代填角色ID。原184列及失敗證據不變，native0PASS。安全／實際artifact、真Auth/RLS、完整員工旅程、calendar／scheduler／恢復／可及性／效能及provider回執仍未接受。
