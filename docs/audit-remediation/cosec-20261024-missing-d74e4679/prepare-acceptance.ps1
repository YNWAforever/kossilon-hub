$ErrorActionPreference='Stop'
$previous='../cosec-20261024-upload-98d2f4c9/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$original=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($original.Count -ne 184){throw 'Row count drift'}
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC164'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC164 d74e4679: actual Router/production detail distinguishes malformed (zero RPC), typed missing, transient failure and role-denied data. Real pure domain read/authorization with injected repository IO. Filtered safe return now survives malformed ID. Explicit retry, concurrent pending read, Back/departure/late response and fresh query readback covered. Local browser RPC/sessionStorage fixtures only. See DELIVERY and release-candidate for actual results.'
    $row.evidence_paths+=';PLAN.md;DELIVERY.md;release-candidate.json;source-candidate.json;targeted-red1.txt;targeted-green1.txt;browser-results-green1.json'
    $row.remaining_scope+=' | Native Auth/server-function HTTP status/DB-RLS and hosted persisted reload remain BLOCKED. Generic safe error text does not expose raw repository details. A never-settling native transport and real provider outage recovery are not proven by resolved local error injection.'
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
[ordered]@{original_rows_preserved=184;counts=$counts;native=$native;appended_only='UC164';native_pass=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
