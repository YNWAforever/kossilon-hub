$ErrorActionPreference='Stop'
$previous='../cosec-20261024-restore-5aa3e18c/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$original=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($original.Count -ne 184){throw 'Original count drift'}
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC185'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC185 ab8690c7: same-version fresh owned PostgreSQL, sole Admin self-disable/demotion each refused twice with full user/profile/xmin/revision/audit unchanged; role/verified-identity denial; two independent opposite-removal races observed exact advisory blocking; one commit/one last-Admin refusal per race, exactly one Admin survives. Disabled/demoted stale actors refused; stale version409, fresh no-op replay deduplicated; independent actor/roster/full three-event audit readback. Existing product guard passed unchanged. Injected sessions and disposable superuser SQL only; no native Auth/HTTP/RLS.'
    $row.evidence_paths+=';PLAN.md;DELIVERY.md;release-candidate.json;source-candidate.json;db/test-third.txt;db/UC185-journey-third.jsonl;db/teardown-third.jsonl;blockers.md'
    $row.remaining_scope+=' | This closes the scoped local sole-Admin/opposite-removal SQL gap only. Native exact-version Auth/HTTP/RLS/browser error/reload, real provider account lifecycle and original full scenario remain BLOCKED; no live account mutation authorized.'
  }
}
for($i=0;$i -lt 184;$i++){
  foreach($key in @('record_type','id','title','historical_result','related_finding_ids','related_task_ids','related_uc_ids','related_la_ids','native_result','source_file','original_row_json')){
    if($rows[$i].$key -cne $original[$i].$key){throw ('Original field changed '+$rows[$i].id+' '+$key)}
  }
}
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($native -join '|') -ne 'BLOCKED:70|NOT_RUN:114' -or ($counts -join '|') -ne 'F:35|LA:34|R:15|UC:100'){throw 'Original matrix drift'}
$rows|Export-Csv -LiteralPath $out -NoTypeInformation -Encoding utf8
[ordered]@{original_rows_preserved=184;counts=$counts;native=$native;appended_only='UC185';native_pass=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
