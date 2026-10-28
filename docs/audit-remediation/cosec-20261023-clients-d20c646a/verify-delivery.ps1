$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$repo=(Resolve-Path (Join-Path $folder '../../..')).Path
if($repo -ine 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Unexpected checkout'}
$candidate=Get-Content (Join-Path $folder 'release-candidate.json') -Raw|ConvertFrom-Json
$source=Get-Content (Join-Path $folder 'source-candidate.json') -Raw|ConvertFrom-Json
if($candidate.release_gate -cne 'NO_GO' -or $candidate.auth_runtime_verified -or $candidate.deployed){throw 'Native boundary drift'}
if($source.source_sha -cne $candidate.source_sha){throw 'Source mismatch'}
foreach($freezeFile in @('source-candidate.json','db-source-freeze.json')){
  $freeze=Get-Content (Join-Path $folder $freezeFile) -Raw|ConvertFrom-Json
  foreach($f in $freeze.files){
    $expected=$f.sha256
    if($freezeFile -ceq 'db-source-freeze.json'){
      $equiv=Get-Content (Join-Path $folder 'db-runtime-equivalence.json') -Raw|ConvertFrom-Json
      if($f.path -ceq $equiv.path){$expected=$equiv.after_sha256}
    }
    if((Get-FileHash -LiteralPath (Join-Path $repo $f.path) -Algorithm SHA256).Hash.ToLower() -cne $expected){throw('Tested bytes changed: '+$f.path)}
  }
}
node (Join-Path $folder 'verify-db-equivalence.mjs')
if($LASTEXITCODE -ne 0){throw 'SQL test emitted runtime changed'}
git -C $repo diff --exit-code $source.source_sha -- $source.paths
if($LASTEXITCODE -ne 0){throw 'Tested source differs'}
$changed=@(git -C $repo diff --name-only $candidate.parent_sha HEAD -- . ':!docs/audit-remediation/**')
if((($changed|Sort-Object)-join ';') -cne (($source.paths|Sort-Object)-join ';')){throw 'Unexpected source changes'}
foreach($kind in @('unit','typecheck','lint','build')){
  $stem=$kind+$(if($kind -in @('typecheck','lint')){'-verified'}else{'-final'})
  if((Get-Content (Join-Path $folder ($stem+'.json')) -Raw|ConvertFrom-Json).exit_code -ne 0){throw('Check failed: '+$kind)}
}
$counts=Get-Content (Join-Path $folder 'check-summary.json') -Raw|ConvertFrom-Json
$unit=Get-Content (Join-Path $folder 'unit-final.txt') -Raw
if($unit -notmatch ($counts.unit_pass.ToString()+' passed \('+$counts.unit_pass+'\)')){throw 'Unit count mismatch'}
$db=Get-Content (Join-Path $folder 'db/db-clients-green.txt') -Raw
$db=[regex]::Replace($db,[char]27+'\[[0-?]*[ -/]*[@-~]','')
if($db -notmatch '10 passed \(10\)'){throw 'SQL count mismatch'}
$summary=Get-Content (Join-Path $folder 'readback-summary.json') -Raw|ConvertFrom-Json
if($summary.cases.Count -ne 10 -or $summary.product_red.raw_invalid_commits.Count -ne 3 -or -not $summary.all_twenty_fixture_cleanup_zero){throw 'SQL coverage gap'}
foreach($case in $summary.cases){
  $events=@(Get-Content (Join-Path $folder $case.events)|ForEach-Object {$_|ConvertFrom-Json})
  $final=$events|Where-Object phase -ceq 'final-readback'
  $expected=if($case.scenario.StartsWith('UC136-')){2}else{1}
  if($final.companies.Count -ne $expected -or $final.contacts.Count -ne $expected -or $final.officers.Count -ne $expected -or $final.timeline.Count -ne $expected){throw 'Duplicate/partial rows'}
  if($case.scenario.StartsWith('UC136-race-')){
    $lock=$events|Where-Object phase -ceq 'lock-observed'
    if($lock.wait_type -cne 'Lock' -or $lock.winnerPid -notin $lock.blockers){throw 'No real unique-index contention'}
    $refusal=$events|Where-Object phase -ceq 'concurrent-refused'
    if($refusal.error.name -cne 'ClientWriteError' -or $refusal.error.field -cne $refusal.field){throw 'Wrong business refusal'}
  }
  if($case.scenario -ceq 'UC137-certificate'){
    if($case.normalized[0].cr_number -cne 'F0012345' -or $case.normalized[0].br_number -cne '12345678-000'){throw 'Canonical identifier mismatch'}
  }
}
foreach($attempt in @('red','green')){
  $eventsFiles=@(Get-ChildItem (Join-Path $folder 'db') -Filter ('UC13*-'+$attempt+'.jsonl') -File)
  if($eventsFiles.Count -ne 10){throw 'Attempt evidence gap'}
  foreach($file in $eventsFiles){
    $events=@(Get-Content -LiteralPath $file.FullName|ForEach-Object {$_|ConvertFrom-Json})
    $cleanup=@($events|Where-Object phase -ceq 'cleanup')
    if($cleanup.Count -ne 1 -or @($cleanup[0].remaining.PSObject.Properties|Where-Object Value -ne 0).Count){throw 'Missing/nonzero exact cleanup'}
  }
}
$cleanup=Get-Content (Join-Path $folder 'cleanup-final.json') -Raw|ConvertFrom-Json
if(-not $cleanup.container_absent -or -not $cleanup.credentials_absent -or $cleanup.preexisting_missing.Count){throw 'Resource cleanup gap'}
$identity=Get-Content (Join-Path $folder 'db/db-server-before-teardown.json') -Raw|ConvertFrom-Json
if(-not $identity.tcp_and_container_system_id_equal -or $identity.identity.system_id -cne '7699848157209518119'){throw 'Target identity drift'}
$old=@(Import-Csv (Join-Path $folder '../cosec-20261023-payment-21be5584/acceptance-results.csv'))
$rows=@(Import-Csv (Join-Path $folder 'acceptance-results.csv'))
if($rows.Count -ne 184 -or $old.Count -ne 184){throw 'Original rows drift'}
$immutable=@($old[0].PSObject.Properties.Name|Where-Object {$_ -notin @('local_result','local_scope','evidence_paths','remaining_scope')})
for($i=0;$i -lt 184;$i++){foreach($f in $immutable){if($old[$i].$f -cne $rows[$i].$f){throw('Original/native drift: '+$old[$i].id)}}}
foreach($kind in @(@('F',35),@('R',15),@('UC',100),@('LA',34))){if(@($rows|Where-Object record_type -ceq $kind[0]).Count -ne $kind[1]){throw 'Category count drift'}}
if(@($rows|Where-Object native_result -ceq 'BLOCKED').Count -ne 70 -or @($rows|Where-Object native_result -ceq 'NOT_RUN').Count -ne 114){throw 'Invented native pass'}
$audit=(Resolve-Path (Join-Path $folder '..')).Path+[IO.Path]::DirectorySeparatorChar
foreach($path in ($rows.evidence_paths -split ';'|Where-Object {$_}|Sort-Object -Unique)){
  $absolute=[IO.Path]::GetFullPath((Join-Path $folder $path))
  if(-not $absolute.StartsWith($audit,[StringComparison]::OrdinalIgnoreCase) -or -not(Test-Path -LiteralPath $absolute -PathType Leaf)){throw('Missing/outside evidence: '+$path)}
}
foreach($prior in (Get-Content (Join-Path $folder 'prior-evidence-integrity.json') -Raw|ConvertFrom-Json)){
  $base=Join-Path $folder ('../'+$prior.run)
  foreach($f in (Get-Content (Join-Path $base 'evidence-manifest.json') -Raw|ConvertFrom-Json).files){if((Get-FileHash -LiteralPath (Join-Path $base $f.path) -Algorithm SHA256).Hash.ToLower() -cne $f.sha256.ToLower()){throw('Prior evidence drift: '+$prior.run+'/'+$f.path)}}
}
$manifest=Get-Content (Join-Path $folder 'evidence-manifest.json') -Raw|ConvertFrom-Json
foreach($f in $manifest.files){
  $absolute=[IO.Path]::GetFullPath((Join-Path $folder $f.path))
  if(-not $absolute.StartsWith($folder+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Manifest path escape'}
  if((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLower() -cne $f.sha256){throw('Evidence drift: '+$f.path)}
}
Write-Output ('VERIFIED source='+$source.source_sha+'; evidence_files='+$manifest.files.Count)
Write-Output ('VERIFIED unit='+$counts.unit_pass+'/'+$counts.unit_files+'_files; SQL=10; typecheck/lint/build=0')
Write-Output 'VERIFIED original_rows=184; native=70_BLOCKED/114_NOT_RUN/0_PASS; NO_GO'
Write-Output ('VERIFIED all_20_SQL_cleanup=0; container/credentials_removed; '+$cleanup.preexisting_count+'_preexisting_preserved')
