$ErrorActionPreference='Stop'
$previous='../cosec-20261024-writegate-ac7d801e/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$original=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($original.Count -ne 184){throw 'Row count drift'}
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC189'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC189 5aa3e18c prerequisite: GET-triggered case-party synchronization now checks the existing schema precondition at its actual INSERT point. Offline red regression reproduced bypass; actual restored-DB missing-index control refuses before creating the new officer candidate, preserving party rows/xmin. Non-writing GET diagnostics remain available; native compiled HTTP/Auth/RLS not exercised.'
    $row.evidence_paths+=';PLAN.md;DELIVERY.md;release-candidate.json;source-candidate.json;focus-red4.txt;targeted-final.txt;db/test-second.txt;blockers.md'
    $row.remaining_scope+=' | Native same-version Auth/HTTP/RLS/browser reload and full schema/checksum/privilege/DDL-concurrency remain BLOCKED; this closes the identified GET party-sync write point locally only.'
  }
  if($row.id -eq 'UC193'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC193 5aa3e18c: real custom pg_dump/SHA256/single-transaction pg_restore on new verified source/restored/broken DBs. Full public row projections, ledger/catalog and allowed/denied representative-case reads matched. Corrupt archive rollback, same-count data drift and missing-index GET-write refusal verified. Local timing/recovery-point observations only; synthetic input and injected sessions, no native Auth/HTTP/RLS/provider backup.'
    $row.evidence_paths+=';PLAN.md;DELIVERY.md;release-candidate.json;source-candidate.json;db/test-first.txt;db/test-second.txt;harness-ordering-failure.json;local-recovery-metrics.json;blockers.md'
    $row.remaining_scope+=' | Approved same-version Neon staging/provider backup, native roles/HTTP/RLS/browser recovery, object storage, production restore and operational RTO/RPO SLA remain BLOCKED; no formal deployment or restore acceptance.'
  }
}
for($i=0;$i -lt 184;$i++){
  foreach($column in @('record_type','id','title','historical_result','related_finding_ids','related_task_ids','related_uc_ids','related_la_ids','native_result','source_file','original_row_json')){
    if($rows[$i].$column -cne $original[$i].$column){throw ('Original field changed '+$rows[$i].id+' '+$column)}
  }
}
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($native -join '|') -ne 'BLOCKED:70|NOT_RUN:114'){throw 'Native matrix drift'}
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($counts -join '|') -ne 'F:35|LA:34|R:15|UC:100'){throw 'ID matrix drift'}
$rows|Export-Csv -LiteralPath $out -NoTypeInformation -Encoding utf8
[ordered]@{original_rows_preserved=184;counts=$counts;native=$native;appended_only='UC189;UC193';native_pass=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
