$ErrorActionPreference='Stop'
$previous='../cosec-20261024-admin-ab8690c7/'
$old=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($rows.Count -ne 184){throw 'Original row count drift'}
foreach($r in $rows){
  $r.evidence_paths=(($r.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($r.id -eq 'UC186'){
    $r.local_result='PARTIAL_SCOPED'
    $r.local_scope+=' | 657a8815: actual incorporation createCase RED: roster/preview0, disable committed staff revision2. Shared all-business open responsibility SQL now covers annual owner/reviewer, incorporation owner, corporate owner in roster/preview/write guard. Correct case-type detail links and truthful overflow/queue guidance. Final real disposable SQL verifies sole-incorporation and corporate-only zero-work rejection/retries for disable/team/Client, unchanged affected rows/xmin/audit, terminal rollback control, role/version/last-Admin regression, 104total/100shown stable bounded preview and independent readback. Injected sessions/disposable superuser only; no native Auth/HTTP/RLS.'
    $r.remaining_scope+=' | Remaining LOCAL_GAP: complete authorized owner/reviewer transfer across all business types and creation/assignment-versus-disable concurrency. Native same-candidate Auth/session/HTTP/RLS/browser/cancel/back/reload and actual account/provider lifecycle remain BLOCKED. This is responsibility enumeration and sequential refusal only, not full original UC186 PASS.'
    $r.evidence_paths+=';COVERAGE.md;PLAN.md;DELIVERY.md;NATIVE-PLAN.md;release-candidate.json;source-candidate.json;db/test-red.txt;db/UC186-red.jsonl;db/test-green.txt;db/test-green-r4.txt;review.json;blockers.md'
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
[ordered]@{original_rows=184;original_json_rows_parsed=184;counts=$counts;native=$native;native_pass=0;local_appended_only='UC186';layers_preserved=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
Write-Output '184 original records parsed/preserved; UC186-only local update; native unchanged.'
