$ErrorActionPreference='Stop'
$previous='../cosec-20261024-missing-d74e4679/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$original=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($original.Count -ne 184){throw 'Row count drift'}
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC166'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC166 f7337fb9: shared validation rejects missing/dual/blank transferee and invalid quantities, with linked Chinese field messages/focus and retained inputs. Pure service rejects before write, actor derived at RPC; repository validates internal callers. Real SQL readback/rollback and browser evidence are separately scoped in DELIVERY/release-candidate; local injected actors/stub transport do not prove native Auth/HTTP/RLS.'
    $row.evidence_paths+=';PLAN.md;DELIVERY.md;release-candidate.json;source-candidate.json;targeted-red1.txt;targeted-final.txt;focus-review-red.txt'
    $row.remaining_scope+=' | Native same-version Auth/server-function HTTP/DB-RLS/persisted browser reload remain BLOCKED. Local browser sessionStorage ledger and injected-actor disposable SQL do not establish production availability. No provider/message/payment/filing action.'
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
[ordered]@{original_rows_preserved=184;counts=$counts;native=$native;appended_only='UC166';native_pass=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
