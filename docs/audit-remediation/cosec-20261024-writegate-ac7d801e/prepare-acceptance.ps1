$ErrorActionPreference='Stop'
$previous='../cosec-20261024-schema-d69e7b0e/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$original=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($original.Count -ne 184){throw 'Row count drift'}
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC189'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC189 ac7d801e: authenticated mutating request admission, verified-HMAC ingress and manual maintenance now fail closed on schema ID/catalog incompatibility. Actual disposable SQL covers Staff/Client/HMAC refusal and retry without business writers, independent full-row/xmin readback, committed recovery/deduplication and late-write rollback. Session adapter and HMAC requests are synthetic; no native Auth/HTTP/RLS or provider acceptance.'
    $row.evidence_paths+=';PLAN.md;DELIVERY.md;release-candidate.json;source-candidate.json;focus-red1.txt;targeted-final.txt;db/test-first.txt;entrypoint-inventory.json;blockers.md'
    $row.remaining_scope+=' | Native same-version Auth/compiled HTTP/RLS/persisted browser reload, full catalog/checksums/privileges, concurrent DDL and real provider delivery remain BLOCKED. Inventory of 74 POST functions is source-only, not 74 executed native journeys. Infrastructure Auth proxy/login recovery remains outside this business DB gate.'
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
