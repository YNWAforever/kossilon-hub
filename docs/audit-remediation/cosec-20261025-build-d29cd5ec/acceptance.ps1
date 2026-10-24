$ErrorActionPreference='Stop'
$previous='../cosec-20261024-handover-exec-a30e04f1/'
$old=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($rows.Count -ne 184 -or @($rows|Where-Object id -eq 'UC186').Count -ne 1){throw 'Original row identity drift'}
foreach($r in $rows){
 $r.evidence_paths=(($r.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
 if($r.id -eq 'UC186'){
  $r.local_scope+=' | d29cd5ec: same source4d63818 / evidence HEAD561f1ee2 build actually executed and PASS exit0 in34.670s after actual6,626,041,856bytes free RAM >= original3GiB gate.674 source/config files equal before/after and source/evidence Git blobs; local output433files/14,269,548bytes hashed. No product changes. Prior unit2780/288files, true local injected-session SQL1, typecheck/lint are inherited same-source evidence and NOT_RERUN_THIS_RUN. Previous resource NOT_RUN receipts and all RED retained unchanged; native Auth/HTTP/RLS/browser/provider NOT_RUN.'
  $r.remaining_scope+=' | d29cd5ec closes only the same-candidate local build gate previously NOT_RUN_RESOURCE; no new independent local case/work core gap identified in current reviewed scope. UC186 original isolated-staging UAT and LA26:fail remain PARTIAL_SCOPED/BLOCKED, native0PASS and NO_GO. CI/artifact/schema/security acceptance, real identity/roles/revocation, full Today->case->documents/payment/blocker->authorized command->API/data/reload, calendar/scheduler/recovery/accessibility/performance and necessary provider/filing receipts remain required.'
  $r.evidence_paths+=';DELIVERY.md;COVERAGE.md;blockers.md;release-candidate.json;source-candidate.json;check-summary.json;source-post-build.json;artifact-manifest.json;resource-gate.json;build.json;build.txt;process-inspection.json'
 }
}
$immutable=@('record_type','id','title','historical_result','related_finding_ids','related_task_ids','related_uc_ids','related_la_ids','native_result','source_file','original_row_json')
for($i=0;$i -lt 184;$i++){
 $null=$old[$i].original_row_json|ConvertFrom-Json
 foreach($k in $immutable){if($rows[$i].$k -cne $old[$i].$k){throw ('Original changed '+$old[$i].id+' '+$k)}}
 if($rows[$i].id -ne 'UC186'){foreach($k in @('local_result','local_scope','remaining_scope')){if($rows[$i].$k -cne $old[$i].$k){throw ('Unrelated scope changed '+$old[$i].id)}}}
}
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($counts -join '|') -ne 'F:35|LA:34|R:15|UC:100' -or ($native -join '|') -ne 'BLOCKED:70|NOT_RUN:114'){throw 'Matrix drift'}
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$rows|Export-Csv -LiteralPath $out -NoTypeInformation -Encoding utf8
[ordered]@{original_rows=184;original_json_rows_parsed=184;counts=$counts;native=$native;native_pass=0;local_appended_only='UC186';layers_preserved=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
Write-Output '184 originals and native statuses preserved; only UC186 same-candidate build evidence appended.'
