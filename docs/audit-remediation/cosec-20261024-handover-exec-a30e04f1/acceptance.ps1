$ErrorActionPreference='Stop'
$previous='../cosec-20261024-handover-full-1fb9822e/'
$old=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($rows.Count -ne 184 -or @($rows|Where-Object id -eq 'UC186').Count -ne 1){throw 'Original row/UC identity drift'}
$validation=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'check-summary.json') -Raw|ConvertFrom-Json
foreach($r in $rows){
  $r.evidence_paths=(($r.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($r.id -eq 'UC186'){
    $r.local_result='PARTIAL_SCOPED'
    $r.local_scope+=' | a30e04f1: real disposable SQL RED: disable committed while normal incorporation create later committed an owned case for inactive source. Shared lifecycle admission now precedes outer domain/actor/job locks; current matched staff checks preserve normal role/team/skill protections. Actual UI delayed-response RED and real SQL same-team cross-company context/blocked-status RED retained and minimally repaired. Final true SQL1 multi-stage journey PASS: 101case+3work obligations across annual/incorporation/corporate owner and annual/work reviewer, complete100+4paging, role/current-identity/active/team/skill/duty/version/context refusals with full row/xmin/audit snapshots, injected catalog503 and post-parent-write rollback, committed response-loss same-op replay/read receipt, cancellation fencing/after-commit receipt, terminal/unrelated/blocked preservation, source disable and stale identity refusal, six observed create/owner/reviewer versus disable orders with independent readback; normal corporate null-skill assignment exercised. Unit2780/288files, targeted44 included. Injected session and disposable SQL superuser/JSDOM mock RPC only; not native Auth/HTTP/RLS/browser PASS.'
    $r.local_scope+=' | Final required checks: '+($validation.checks|ConvertTo-Json -Compress -Depth 5)
    $r.remaining_scope+=' | a30e04f1 resolves the previously recorded case/work handover and admission concurrency LOCAL_GAP within this exact local scope. Original isolated-staging UC186 UAT and LA26:fail remain unchanged. Native same-candidate Auth/session/HTTP/app-role/RLS, actual browser reload/account switch, whole employee Today->case->safe documents/payment/blockers->authorized command->API/data/reload and actual account/provider lifecycle still BLOCKED/NO_GO. Any NOT_RUN_RESOURCE in this batch remains a required local gate, not a pass.'
    $r.evidence_paths+=';PLAN.md;DELIVERY.md;COVERAGE.md;blockers.md;NATIVE-PLAN.md;release-candidate.json;source-candidate.json;check-summary.json;review.json;resource-checks.jsonl;unit-final.txt;targeted-delayed-red-ready.txt;targeted-delayed-green.txt;db/test-red.txt;db/UC186-red.jsonl;db/test-green-r2.txt;db/test-green-r3.txt;db/test-green-r4.txt;db/UC186-green-r4.jsonl;source-post-checks.json'
  }
}
$immutable=@('record_type','id','title','historical_result','related_finding_ids','related_task_ids','related_uc_ids','related_la_ids','native_result','source_file','original_row_json')
for($i=0;$i -lt 184;$i++){
  $null=$old[$i].original_row_json|ConvertFrom-Json
  foreach($k in $immutable){if($rows[$i].$k -cne $old[$i].$k){throw ('Original field changed '+$old[$i].id+' '+$k)}}
  if($rows[$i].id -ne 'UC186'){foreach($k in @('local_result','local_scope','remaining_scope')){if($rows[$i].$k -cne $old[$i].$k){throw ('Unrelated scope changed '+$old[$i].id)}}}
}
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($counts -join '|') -ne 'F:35|LA:34|R:15|UC:100' -or ($native -join '|') -ne 'BLOCKED:70|NOT_RUN:114'){throw 'Matrix drift'}
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$rows|Export-Csv -LiteralPath $out -NoTypeInformation -Encoding utf8
[ordered]@{original_rows=184;original_json_rows_parsed=184;counts=$counts;native=$native;native_pass=0;local_appended_only='UC186';layers_preserved=$true;matched_uc186=1}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
Write-Output '184 original records preserved; UC186 local functional evidence appended; original/native/UAT failures unchanged.'
