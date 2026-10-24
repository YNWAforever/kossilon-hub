$ErrorActionPreference='Stop'
$rows=@(Import-Csv (Join-Path $PSScriptRoot 'acceptance-results.csv'))
$previous=Join-Path $PSScriptRoot '../cosec-20261025-build-d29cd5ec/acceptance-results.csv'
if((Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'acceptance-results.csv') -Algorithm SHA256).Hash){throw 'Original bytes changed'}
if($rows.Count -ne 184 -or @($rows.id|Sort-Object -Unique).Count -ne 184){throw 'Row identity changed'}
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($counts -join '|') -ne 'F:35|LA:34|R:15|UC:100'){throw 'Type counts changed'}
foreach($r in $rows){$null=$r.original_row_json|ConvertFrom-Json}
$map=@(Import-Csv (Join-Path $PSScriptRoot 'native-scenario-map.csv'))
$plan=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'approval-request.json') -Raw|ConvertFrom-Json
if($map.Count -ne 100 -or @($map.id|Sort-Object -Unique).Count -ne 100){throw 'UC map changed'}
$columns=@('title','historical_result','local_result','native_result','related_finding_ids','related_task_ids','related_la_ids')
foreach($m in $map){
 $r=@($rows|Where-Object id -eq $m.id);if($r.Count -ne 1 -or $r[0].record_type -ne 'UC'){throw ('Unknown UC '+$m.id)}
 foreach($k in $columns){if($m.$k -cne $r[0].$k){throw ('UC original changed '+$m.id+' '+$k)}}
 $o=$r[0].original_row_json|ConvertFrom-Json
 $pairs=@{original_route='route';original_role='role';original_preconditions='preconditions_and_data';original_steps='steps';original_expected='expected_result'}
 foreach($k in $pairs.Keys){if($m.$k -cne $o.($pairs[$k])){throw ('Original oracle changed '+$m.id+' '+$k)}}
 foreach($k in @('primary_approval_packet','required_binding_packet','cleanup_packet','additional_packet_if_needed')){if($m.$k -and $m.$k -notin $plan.packets.id){throw ('Unknown packet '+$m.$k)}}
 foreach($k in @('related_finding_ids','related_task_ids','related_la_ids')){foreach($id in ($m.$k -split ';'|Where-Object {$_})){if($id -notin $rows.id){throw ('Original relation not found '+$id)}}}
 if($m.plan_status -cne 'PLANNED_NOT_APPROVED_NOT_EXECUTED' -or $m.execution_evidence -cne 'NONE_THIS_RUN'){throw 'Accidental execution result'}
 if(!(Test-Path -LiteralPath (Join-Path $PSScriptRoot $m.original_record_source_csv))){throw 'Source CSV reference missing'}
}
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($native -join '|') -cne 'BLOCKED:70|NOT_RUN:114'){throw 'Native status changed'}
$out=Join-Path $PSScriptRoot 'document-check.json';if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{check='local document/CSV integrity only';original_rows=184;original_json_parsed=184;original_bytes_unchanged=$true;counts=$counts;mapped_uc=100;original_oracles_and_relations_unchanged=$true;packet_references_valid=$true;native=$native;native_pass=0;product_tests_executed=0;native_actions_executed=0}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $out -Encoding utf8
Write-Output 'Document integrity PASS:184 originals/100 exact UC oracles and relations; no native result changed.'
