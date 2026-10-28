$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$audit=[IO.Path]::GetFullPath((Join-Path $folder '..'))
$before=@(Import-Csv (Join-Path $folder '../cosec-20261024-checklist-59870455/acceptance-results.csv'))
$after=@(Import-Csv (Join-Path $folder 'acceptance-results.csv'))
if($after.Count -ne 184 -or $before.Count -ne 184){throw 'Row count drift'}
$immutable=@('record_type','id','title','historical_result','related_finding_ids','related_task_ids','related_uc_ids','related_la_ids','native_result','source_file','original_row_json')
$changed=@()
$resolvedEvidence=0
for($i=0;$i -lt 184;$i++){
  foreach($key in $immutable){if($before[$i].$key -cne $after[$i].$key){throw ('Immutable drift: '+$after[$i].id+' '+$key)}}
  foreach($key in @('local_result','local_scope','remaining_scope')){
    if($before[$i].$key -cne $after[$i].$key){
      if($after[$i].id -notin @('UC160','F19','R15','R22','R26')){throw 'Unexpected scoped row'}
      $changed+=$after[$i].id
    }
  }
  foreach($path in ($after[$i].evidence_paths -split ';' | Where-Object {$_})){
    $absolute=[IO.Path]::GetFullPath((Join-Path $folder $path))
    if(!$absolute.StartsWith($audit+'\') -or !(Test-Path -LiteralPath $absolute -PathType Leaf)){throw ('Evidence path unresolved/outside audit: '+$path)}
    $resolvedEvidence++
  }
}
$native=@{};foreach($group in ($after|Group-Object native_result)){$native[$group.Name]=$group.Count}
if($native.BLOCKED -ne 70 -or $native.NOT_RUN -ne 114 -or $native.ContainsKey('PASS')){throw 'Native disposition drift'}
$types=@{};foreach($group in ($after|Group-Object record_type)){$types[$group.Name]=$group.Count}
if($types.F -ne 35 -or $types.R -ne 15 -or $types.UC -ne 100 -or $types.LA -ne 34){throw 'Original identifier counts drift'}
$out=Join-Path $folder 'acceptance-validation.json'
if(Test-Path -LiteralPath $out){throw 'Prior validation exists'}
[ordered]@{rows=184;original_types=$types;immutable_fields=$immutable;all_immutable_fields_equal=$true;scoped_rows=@($changed|Sort-Object -Unique);native=$native;native_pass=0;evidence_links_resolved=$resolvedEvidence;release_gate='NO_GO'}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $out -Encoding utf8
Write-Output ('Verified original/native rows: 184; resolved evidence links: '+$resolvedEvidence)
