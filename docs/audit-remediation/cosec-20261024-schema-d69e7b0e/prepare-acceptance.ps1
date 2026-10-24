$ErrorActionPreference='Stop'
$previous='../cosec-20261024-transfer-f7337fb9/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$original=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($original.Count -ne 184){throw 'Row count drift'}
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC189'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC189 d69e7b0e: local scheduler precondition refuses missing/unknown/divergent/absent ledger and unavailable or missing marker catalog before durable claims, effects or heartbeat writes; retries re-read. Actual disposable SQL Operations/catalog, transactional faults, exact IDs, independent full-row/xmin rollback readback and recovery/replay verified. Injected no-effect job is local only; no native Auth/HTTP/RLS/platform ticks or production compatibility proof.'
    $row.evidence_paths+=';PLAN.md;DELIVERY.md;release-candidate.json;source-candidate.json;focus-red1.txt;targeted-final2.txt;db/test-final3.txt;blockers.md'
    $row.remaining_scope+=' | Native same-version Auth/HTTP/DB permissions and platform ticks remain BLOCKED. Guard covers scheduler entry only, migration-ID parity and two dispatch-marker physical facts; full catalog/checksums, all application mutations, historical-release exception, production compatibility and persisted browser reload remain unverified.'
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
[ordered]@{original_rows_preserved=184;counts=$counts;native=$native;appended_only='UC189';native_pass=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
