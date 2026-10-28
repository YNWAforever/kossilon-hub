$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$repo=(Resolve-Path (Join-Path $folder '../../..')).Path
if($repo -ine 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Unexpected checkout'}
$candidate=Get-Content -LiteralPath (Join-Path $folder 'release-candidate.json') -Raw | ConvertFrom-Json
if($candidate.release_gate -cne 'NO_GO' -or $candidate.auth_runtime_verified -or $candidate.deployed){throw 'Native/release boundary drift'}
$source=Get-Content -LiteralPath (Join-Path $folder 'source-candidate.json') -Raw | ConvertFrom-Json
if($candidate.source_sha -cne $source.source_sha){throw 'Candidate mismatch'}
foreach($file in $source.files){if((Get-FileHash -LiteralPath (Join-Path $repo $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256){throw('Source drift: '+$file.path)}}
git -C $repo diff --exit-code $source.source_sha -- $source.paths
if($LASTEXITCODE -ne 0){throw 'Tested source/worktree differs'}
$changed=@(git -C $repo diff --name-only $candidate.parent_sha HEAD -- . ':!docs/audit-remediation/**')
if((($changed | Sort-Object) -join ';') -cne (($source.paths | Sort-Object) -join ';')){throw 'Unexpected source changes'}
$dbFreeze=Get-Content -LiteralPath (Join-Path $folder 'db-source-freeze.json') -Raw | ConvertFrom-Json
foreach($file in $dbFreeze.files){if((Get-FileHash -LiteralPath (Join-Path $repo $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256){throw 'DB-tested bytes changed'}}
foreach($kind in @('unit','typecheck','lint','build')){
  $result=Get-Content -LiteralPath (Join-Path $folder ($kind+'-final.json')) -Raw | ConvertFrom-Json
  if($result.exit_code -ne 0){throw($kind+' did not pass')}
}
$unit=Get-Content -LiteralPath (Join-Path $folder 'unit-final.txt') -Raw
if($unit -notmatch '267 passed \(267\)' -or $unit -notmatch '2497 passed \(2497\)'){throw 'Final unit count mismatch'}
$db=Get-Content -LiteralPath (Join-Path $folder 'db/db-assignment-expanded.json') -Raw | ConvertFrom-Json
if($db.exit_code -ne 0){throw 'DB test failed'}
$scenarios=@('UC130-owner','UC130-reviewer','UC131-users','UC131-profile','UC131-both','UC131-skill')
$workIds=@()
foreach($scenario in $scenarios){
  $events=@(Get-Content -LiteralPath (Join-Path $folder ('db/'+$scenario+'-expanded.jsonl')) | ForEach-Object {$_ | ConvertFrom-Json})
  $plan=$events | Where-Object phase -ceq 'planned-ids'
  $workIds+=$plan.ids.work
  $sessions=$events | Where-Object phase -ceq 'physical-sessions'
  if(@(@($sessions.observerPid,$sessions.firstPid,$sessions.secondPid) | Sort-Object -Unique).Count -ne 3){throw 'Not independent SQL sessions'}
  $clean=$events | Where-Object phase -ceq 'cleanup-readback'
  foreach($key in @('companies','cases','work_items','assignment_events','timeline','users','teams')){if($clean.$key -ne 0){throw 'Fixture cleanup incomplete'}}
  if($scenario.StartsWith('UC130')){
    $lock=$events | Where-Object phase -ceq 'concurrent-lock'
    if($lock.blocking.event_type -cne 'Lock' -or $lock.firstPid -notin $lock.blocking.blockers){throw 'No observed concurrent lock contention'}
    $conflict=$events | Where-Object phase -ceq 'concurrent-result'
    if($conflict.error.statusCode -ne 409 -or $conflict.error.code -cne 'WORK_ITEM_ASSIGNMENT_STALE'){throw 'Missing typed conflict'}
    $winner=$events | Where-Object phase -ceq 'winner-readback'
    $replay=$events | Where-Object phase -ceq 'stale-replay-readback'
    if($winner.current.version -ne 2 -or $winner.events.Count -ne 1 -or $replay.events.Count -ne 1 -or $replay.current.version -ne 2){throw 'Stale assignment overwrote or duplicated audit'}
    $final=$events | Where-Object phase -ceq 'recovery-readback'
    if($final.current.version -ne 3 -or $final.events.Count -ne 2 -or $final.timeline.Count -ne 2){throw 'Fresh confirmation mismatch'}
    $actor=$events | Where-Object phase -ceq 'persisted-inactive-actor-denied'
    if($actor.error.statusCode -ne 403){throw 'Persisted actor state ignored'}
  } else {
    $denial=$events | Where-Object phase -ceq 'inactive-rejected'
    if($denial.error.statusCode -ne 409 -or $denial.error.code -cne 'WORK_ITEM_ASSIGNEE_UNAVAILABLE'){throw 'Inactive assignee not refused'}
    $unchanged=$events | Where-Object phase -ceq 'inactive-readback'
    if($unchanged.current.version -ne 1 -or $unchanged.current.ownerId -ne $null -or $unchanged.events.Count -ne 0 -or $unchanged.timeline.Count -ne 0){throw 'Denied assignee mutated data'}
    $final=$events | Where-Object phase -ceq 'reselection-readback'
    if($final.current.version -ne 2 -or $final.events.Count -ne 1 -or $final.timeline.Count -ne 1){throw 'Reselection mismatch'}
  }
  if($final.outbox -ne 0){throw 'Unexpected dispatch candidate'}
}
if(@($workIds | Sort-Object -Unique).Count -ne 6){throw 'Reused scenario IDs'}
$cleanup=Get-Content -LiteralPath (Join-Path $folder 'cleanup-final.json') -Raw | ConvertFrom-Json
if(-not $cleanup.container_absent -or -not $cleanup.credentials_absent -or $cleanup.preexisting_missing.Count){throw 'Resource cleanup drift'}
$old=@(Import-Csv -LiteralPath (Join-Path $folder '../cosec-20261023-r22-fe4a5635/acceptance-results.csv'))
$rows=@(Import-Csv -LiteralPath (Join-Path $folder 'acceptance-results.csv'))
if($rows.Count -ne 184 -or $old.Count -ne 184){throw 'Original row count drift'}
$immutable=@($old[0].PSObject.Properties.Name | Where-Object {$_ -notin @('local_result','local_scope','evidence_paths','remaining_scope')})
for($i=0;$i -lt $rows.Count;$i++){foreach($field in $immutable){if($old[$i].$field -cne $rows[$i].$field){throw('Original/native row drift: '+$old[$i].id)}}}
foreach($kind in @(@('F',35),@('R',15),@('UC',100),@('LA',34))){if(@($rows | Where-Object record_type -ceq $kind[0]).Count -ne $kind[1]){throw 'Category count drift'}}
if(@($rows | Where-Object native_result -ceq 'BLOCKED').Count -ne 70 -or @($rows | Where-Object native_result -ceq 'NOT_RUN').Count -ne 114){throw 'Invented native pass'}
$audit=(Resolve-Path (Join-Path $folder '..')).Path+[IO.Path]::DirectorySeparatorChar
foreach($path in ($rows.evidence_paths -split ';' | Where-Object {$_} | Sort-Object -Unique)){
  $absolute=[IO.Path]::GetFullPath((Join-Path $folder $path))
  if(-not $absolute.StartsWith($audit,[StringComparison]::OrdinalIgnoreCase) -or -not(Test-Path -LiteralPath $absolute -PathType Leaf)){throw('Missing/outside evidence: '+$path)}
}
$manifest=Get-Content -LiteralPath (Join-Path $folder 'evidence-manifest.json') -Raw | ConvertFrom-Json
foreach($file in $manifest.files){
  $absolute=[IO.Path]::GetFullPath((Join-Path $folder $file.path))
  if(-not $absolute.StartsWith($folder+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Manifest escape'}
  if((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLower() -cne $file.sha256){throw('Evidence drift: '+$file.path)}
}
foreach($prior in (Get-Content -LiteralPath (Join-Path $folder 'prior-evidence-integrity.json') -Raw | ConvertFrom-Json)){
  $base=Join-Path $folder ('../'+$prior.run)
  $previous=Get-Content -LiteralPath (Join-Path $base 'evidence-manifest.json') -Raw | ConvertFrom-Json
  foreach($file in $previous.files){if((Get-FileHash -LiteralPath (Join-Path $base $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256.ToLower()){throw 'Prior failed evidence changed'}}
}
Write-Output ('VERIFIED source='+$source.source_sha+'; evidence_files='+$manifest.files.Count)
Write-Output 'VERIFIED original_rows=184; native=70_BLOCKED/114_NOT_RUN/0_PASS; NO_GO'
Write-Output 'VERIFIED unit=2497/267_files; SQL=6; typed_conflict_and_reselection; owned_cleanup=0'
