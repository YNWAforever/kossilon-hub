# 額外 B02：PDF.js 修補與剩餘 dependency gate

## 已確認與修補

2026-10-02 原npm audit指出已安裝 `pdfjs-dist6.1.200` 受 GHSA-hq66-cqwq-w95j／CVE-2026-16633 影響。[Mozilla官方advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j)列修補版6.2.108，問題條件是PDF.js scripting啟用且沒有阻止script-src的CSP。這不等於另一個舊漏洞的`isEvalSupported`設定；沒有聲稱本app已重現任意script execution。

目前app browser入口為 knowledge-base按需載入 `doc-parser.ts`→`getDocument`／`getTextContent`，沒有使用PDF viewer／`enableScripting` UI。Server另用既有unpdf，原`isEvalSupported=false` contract保留。沒有把有風險文件標為clean。

最小patch：direct `pdfjs-dist` 精確pin6.2.108，Bun及既有npm lock同步。Official npm metadata確認2026-07-28發布，符合repo24小時release-age guard；沒有添加exclusion。Bun frozen install PASS，實際node_modules版本6.2.108／Node22.23.3。其餘runtime／framework版本保留。

Actual Chrome real parser＋PDF worker synthetic text regression使用既有reviewable PDF builder；沒有stub parser／掃描結果／R2 upload。首次失敗確認既有dev optimizer cache仍取API6.1.200而worker6.2.108；只重啟已核對本工作樹的localhost5180 Vite並`--force`，沒有放寬解析或version check。保留原失敗與精確version-mismatch log；fresh-cache結果：actual Chrome390／1280兩項PASS18.8s；見PR11gate JSON。

## 審計工具差異

repo同時追蹤Bun與npm lock；CI使用Bun。舊npm lock未同步時仍報PDF vulnerability，不能把那個snapshot稱為patch失敗或改成假PASS。同步後npm audit：9packages（6high／2moderate／1low），沒有pdfjs-dist；authoritative Bun audit：13packages，亦沒有pdfjs-dist，但因transitive resolution不同有額外告警。兩份實際報告保留；**沒有聲稱零漏洞或用green CI豁免告警**。

## 尚未修補的實際path／owner

以下parent來自當時本地Bun lock；severity取各package最高。不是以名稱猜測是否可達。正式release仍需要逐advisory／entrypoint確認及最小兼容patch。

| Package                  | Severity | 實際parent／入口                                    | Owner／下一步                                                                                         |
| ------------------------ | -------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| @xmldom/xmldom           | high     | mammoth→browser DOCX raw-text parse                 | Security／Developer：重現malformed XML與resource limits，兼容patch及真DOCX corpus；未驗證不可宣稱安全 |
| brace-expansion          | high     | minimatch／typescript-estree                        | Build owner：核對untrusted pattern path與相容patch                                                    |
| js-yaml                  | high     | eslint/eslintrc／xmlbuilder2                        | Build／document owner：分開CLI config及document path重現                                              |
| nanoid                   | high     | postcss及Lovable tagger Tailwind/PostCSS            | Build owner：核對ID/security使用與最小patch                                                           |
| postcss                  | high     | Vite／Lovable tagger Tailwind                       | Build owner：核對untrusted stylesheet／parser advisory及相容patch                                     |
| undici                   | high     | jsdom                                               | Test-runtime owner：核對本地/CI網絡邊界及jsdom兼容patch；不宣稱app transport已受影響或已清除          |
| browserslist             | high     | Babel compilation targets／TanStack插件子樹         | Build owner：核對config/input路徑並升級兼容resolved subtree                                           |
| @vitest/mocker／vitest   | moderate | Vitest測試runner                                    | Test-runtime owner：依officialpatch更新相容pair；不把watch server對外開放                             |
| baseline-browser-mapping | moderate | browserslist                                        | Build owner：配合resolved subtree修補                                                                 |
| @babel/core              | low      | TanStack plugins／Vite React／dead-code elimination | Build owner：核對sourceMappingURL輸入與兼容patch                                                      |
| esbuild                  | low      | Lovable tagger／tsx                                 | Build owner：核對dev server/input邊界及patch                                                          |
| postcss-selector-parser  | low      | postcss-nested／Lovable tagger Tailwind             | Build owner：核對selector parsing與patch                                                              |

以上是新增的具體安全triage，原F01–F20與50UAT不變。B02只交付已確認的direct PDF patch；剩餘項目列為release gate，沒有用`npm audit fix --force`整批改framework或忽略結果。
