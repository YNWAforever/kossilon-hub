$ErrorActionPreference='Stop'
$rows=@(Import-Csv (Join-Path $PSScriptRoot 'acceptance-results.csv'))
$source='../cosec-20261025-build-d29cd5ec/acceptance-results.csv'
if($rows.Count -ne 184){throw 'Original rows drift'}
if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'acceptance-results.csv') -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $source) -Algorithm SHA256).Hash){throw 'Original CSV not byte-identical'}
$localCounts=[ordered]@{}; foreach($g in ($rows|Group-Object local_result|Sort-Object Name)){$localCounts[$g.Name]=$g.Count}
$nativeCounts=[ordered]@{}; foreach($g in ($rows|Group-Object native_result|Sort-Object Name)){$nativeCounts[$g.Name]=$g.Count}
if($localCounts['PARTIAL_SCOPED'] -ne 176 -or $localCounts['SOURCE_ONLY'] -ne 7 -or $localCounts['NOT_RUN'] -ne 1 -or $nativeCounts['BLOCKED'] -ne 70 -or $nativeCounts['NOT_RUN'] -ne 114){throw 'Coverage count drift'}
$map=@(foreach($r in ($rows|Where-Object record_type -eq 'UC')){
 $n=[int]$r.id.Substring(2);$o=$r.original_row_json|ConvertFrom-Json
 $p=switch($n){
  {$_ -in 101,143,144,145,146,147,176,177,178,179,180,192,194}{'AP-09';break}
  {$_ -in 110,132,133,167,168,169,170,171,172,173,174,175,181,182,183}{'AP-08';break}
  {$_ -in 117,118,127,140,196,197,198}{'AP-10';break}
  {$_ -in 130,131,186}{'AP-05';break}
  {$_ -in 134,185,189,190,191}{'AP-07';break}
  {$_ -in 188,193}{'AP-11';break}
  {($_ -ge 99 -and $_ -le 107) -or ($_ -ge 111 -and $_ -le 116) -or $_ -in 128,163,184,187,195}{'AP-01';break}
  {$_ -in 108,109 -or ($_ -ge 141 -and $_ -le 157)}{'AP-04';break}
  default{'AP-03'}
 }
 [pscustomobject][ordered]@{id=$r.id;title=$r.title;original_route=$o.route;original_role=$o.role;original_preconditions=$o.preconditions_and_data;original_steps=$o.steps;original_expected=$o.expected_result;historical_result=$r.historical_result;local_result=$r.local_result;native_result=$r.native_result;related_finding_ids=$r.related_finding_ids;related_task_ids=$r.related_task_ids;related_la_ids=$r.related_la_ids;primary_approval_packet=$p;additional_packet_if_needed=$(if($r.id -eq 'UC186'){'AP-06'}else{''});required_binding_packet='AP-00';cleanup_packet='AP-12';plan_status='PLANNED_NOT_APPROVED_NOT_EXECUTED';original_record_source_csv=$source;execution_evidence='NONE_THIS_RUN'}
})
if($map.Count -ne 100 -or @($map.id|Sort-Object -Unique).Count -ne 100){throw 'UC identity drift'}
foreach($m in $map){if([string]::IsNullOrWhiteSpace($m.original_expected)){throw ('Missing original oracle '+$m.id)}}
$mapPath=Join-Path $PSScriptRoot 'native-scenario-map.csv';if(Test-Path -LiteralPath $mapPath){throw 'Prior map exists'}
$map|Export-Csv -LiteralPath $mapPath -NoTypeInformation -Encoding utf8
$assessment=[ordered]@{original_rows=184;counts=[ordered]@{F=35;R=15;UC=100;LA=34};local_counts=$localCounts;native_counts=$nativeCounts;native_pass=0;source_only_ids=@($rows|Where-Object local_result -eq 'SOURCE_ONLY'|ForEach-Object id);not_run_ids=@($rows|Where-Object local_result -eq 'NOT_RUN'|ForEach-Object id);mapped_uc_rows=100;independent_local_core_gap_identified=$false;scope_of_conclusion='Recorded remaining_scope plus latest delivery/coverage/blockers and referenced dispositions; not a fresh full code audit or100UC runtime rerun';execution_evidence_this_run='NONE';all_prior_original_fields_byte_identical=$true}
$assessment|ConvertTo-Json -Depth 7|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'coverage-assessment.json') -Encoding utf8
Write-Output '184 original records byte-identical;100 original UC oracles mapped to pending approval packets; native0PASS.'
