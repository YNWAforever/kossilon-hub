$ErrorActionPreference='Stop'
$old=@(Import-Csv -LiteralPath (Join-Path $PSScriptRoot '../cosec-20261024-schema-d69e7b0e/acceptance-results.csv'))
$rows=@(Import-Csv -LiteralPath (Join-Path $PSScriptRoot 'acceptance-results.csv'))
if($rows.Count -ne 184 -or $old.Count -ne 184){throw 'Row count drift'}
$immutable=@('record_type','id','title','historical_result','related_finding_ids','related_task_ids','related_uc_ids','related_la_ids','native_result','source_file','original_row_json')
for($i=0;$i -lt $rows.Count;$i++){
  foreach($key in $immutable){if($rows[$i].$key -cne $old[$i].$key){throw ('Original field drift '+$rows[$i].id+' '+$key)}}
  if($rows[$i].id -ne 'UC189'){
    foreach($key in @('local_result','local_scope','remaining_scope')){if($rows[$i].$key -cne $old[$i].$key){throw ('Unrelated local scope drift '+$rows[$i].id)}}
  }elseif($rows[$i].local_result -ne 'PARTIAL_SCOPED'){throw 'UC189 scope drift'}
  foreach($p in @($rows[$i].evidence_paths -split ';'|Where-Object {$_})){
    if(!(Test-Path -LiteralPath (Join-Path $PSScriptRoot $p) -PathType Leaf)){throw ('Missing evidence '+$rows[$i].id+' '+$p)}
  }
}
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($native -join '|') -ne 'BLOCKED:70|NOT_RUN:114'){throw 'Native drift'}
Write-Output 'Verified 184 original/native rows, UC189-only local additions and every referenced evidence path.'
