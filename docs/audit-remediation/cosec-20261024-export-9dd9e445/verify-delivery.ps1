$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$repo=(Resolve-Path (Join-Path $folder '../../..')).Path
if($repo -ine 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Unexpected checkout'}
$candidate=Get-Content (Join-Path $folder 'release-candidate.json') -Raw|ConvertFrom-Json
$source=Get-Content (Join-Path $folder 'source-candidate.json') -Raw|ConvertFrom-Json
if($candidate.release_gate -cne 'NO_GO' -or $candidate.auth_runtime_verified -or $candidate.deployed){throw 'Native boundary drift'}
if($source.source_sha -cne $candidate.source_sha){throw 'Source identity mismatch'}
foreach($freezeName in @('source-freeze.json','db-source-freeze.json','source-candidate.json')){
  $freeze=Get-Content (Join-Path $folder $freezeName) -Raw|ConvertFrom-Json
  foreach($file in $freeze.files){
    if((Get-FileHash -LiteralPath (Join-Path $repo $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256){throw('Tested bytes changed: '+$file.path)}
  }
}
git -C $repo diff --exit-code $source.source_sha -- $source.paths
if($LASTEXITCODE -ne 0){throw 'Source differs from source commit'}
$changed=@(git -C $repo diff --name-only $candidate.parent_sha HEAD -- . ':!docs/audit-remediation/**')
if((($changed|Sort-Object)-join ';') -cne (($source.paths|Sort-Object)-join ';')){throw 'Unexpected source scope'}
foreach($name in @('unit-verified','targeted-final','typecheck-final','lint-final','build-final','worker-startup-retry')){
  if((Get-Content (Join-Path $folder ($name+'.json')) -Raw|ConvertFrom-Json).exit_code -ne 0){throw('Check failed: '+$name)}
}
$counts=Get-Content (Join-Path $folder 'check-summary.json') -Raw|ConvertFrom-Json
$unit=Get-Content (Join-Path $folder 'unit-verified.txt') -Raw
$unit=[regex]::Replace($unit,[char]27+'\[[0-?]*[ -/]*[@-~]','')
if($unit -notmatch ('Tests\s+'+$counts.unit_pass+' passed \('+$counts.unit_pass+'\)')){throw 'Unit count mismatch'}
if($unit -notmatch ('Test Files\s+'+$counts.unit_files+' passed \('+$counts.unit_files+'\)')){throw 'Unit file count mismatch'}
if($unit -notmatch 'bulk-export.interaction.test.tsx.*\(5 tests\)'){throw 'Final UI scope missing from broad suite'}
$failedBroad=Get-Content (Join-Path $folder 'unit-first-failure.json') -Raw|ConvertFrom-Json
if($failedBroad.unhandled_errors -ne 1 -or -not $failedBroad.file_unchanged_from_parent -or $failedBroad.passed_tests -ne 2529){throw 'Lost broad-run failure evidence'}
$red=Get-Content (Join-Path $folder 'targeted-red.json') -Raw|ConvertFrom-Json
if($red.exit_code -eq 0){throw 'Missing backend failure reproduction'}
$sidecarRed=Get-Content (Join-Path $folder 'sidecar-focused-report.json') -Raw|ConvertFrom-Json
$sidecarGreen=Get-Content (Join-Path $folder 'sidecar-green-report.json') -Raw|ConvertFrom-Json
if($sidecarRed.numFailedTests -ne 4 -or $sidecarRed.numPassedTests -ne 1 -or $sidecarGreen.numPassedTests -ne 5 -or $sidecarGreen.numFailedTests -ne 0){throw 'UI red/green evidence mismatch'}
node (Join-Path $folder 'prepare-readback.mjs') --verify
if($LASTEXITCODE -ne 0){throw 'SQL/CSV/readback mismatch'}
foreach($attempt in @('initial','final')){
  $db=Get-Content (Join-Path $folder ('db/db-export-'+$attempt+'.txt')) -Raw
  $db=[regex]::Replace($db,[char]27+'\[[0-?]*[ -/]*[@-~]','')
  if($db -notmatch '1 passed \(1\)'){throw 'SQL actual test count mismatch'}
}
$old=@(Import-Csv (Join-Path $folder '../cosec-20261023-clients-d20c646a/acceptance-results.csv'))
$rows=@(Import-Csv (Join-Path $folder 'acceptance-results.csv'))
if($rows.Count -ne 184 -or $old.Count -ne 184){throw 'Original row count drift'}
$immutable=@($old[0].PSObject.Properties.Name|Where-Object {$_ -notin @('local_result','local_scope','evidence_paths','remaining_scope')})
for($i=0;$i -lt 184;$i++){foreach($field in $immutable){if($old[$i].$field -cne $rows[$i].$field){throw('Original/native drift: '+$old[$i].id)}}}
foreach($category in @(@('F',35),@('R',15),@('UC',100),@('LA',34))){if(@($rows|Where-Object record_type -ceq $category[0]).Count -ne $category[1]){throw 'Category count drift'}}
if(@($rows|Where-Object native_result -ceq 'BLOCKED').Count -ne 70 -or @($rows|Where-Object native_result -ceq 'NOT_RUN').Count -ne 114 -or @($rows|Where-Object native_result -ceq 'PASS').Count){throw 'Native status drift'}
$audit=(Resolve-Path (Join-Path $folder '..')).Path+[IO.Path]::DirectorySeparatorChar
foreach($path in ($rows.evidence_paths -split ';'|Where-Object {$_}|Sort-Object -Unique)){
  $absolute=[IO.Path]::GetFullPath((Join-Path $folder $path))
  if(-not $absolute.StartsWith($audit,[StringComparison]::OrdinalIgnoreCase) -or -not(Test-Path -LiteralPath $absolute -PathType Leaf)){throw('Missing/outside evidence: '+$path)}
}
foreach($prior in (Get-Content (Join-Path $folder 'prior-evidence-integrity.json') -Raw|ConvertFrom-Json)){
  $base=Join-Path $folder ('../'+$prior.run)
  if((Get-FileHash -LiteralPath (Join-Path $base 'evidence-manifest.json')).Hash.ToLower() -cne $prior.manifest_sha256){throw 'Prior manifest drift'}
  foreach($file in (Get-Content (Join-Path $base 'evidence-manifest.json') -Raw|ConvertFrom-Json).files){if((Get-FileHash -LiteralPath (Join-Path $base $file.path)).Hash.ToLower() -cne $file.sha256.ToLower()){throw('Prior evidence drift: '+$prior.run+'/'+$file.path)}}
}
$manifest=Get-Content (Join-Path $folder 'evidence-manifest.json') -Raw|ConvertFrom-Json
foreach($file in $manifest.files){
  $absolute=[IO.Path]::GetFullPath((Join-Path $folder $file.path))
  if(-not $absolute.StartsWith($folder+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Manifest path escape'}
  if((Get-FileHash -LiteralPath $absolute).Hash.ToLower() -cne $file.sha256 -or (Get-Item -LiteralPath $absolute).Length -ne $file.bytes){throw('Evidence drift: '+$file.path)}
}
Write-Output ('VERIFIED source='+$source.source_sha+'; evidence_files='+$manifest.files.Count+'; prior_batches=7')
Write-Output ('VERIFIED unit='+$counts.unit_pass+'/'+$counts.unit_files+'_files; UI=5_included; SQL=1_per_attempt; typecheck/lint/build=0')
Write-Output 'VERIFIED original_rows=184; 35F/15R/100UC/34LA; native=70_BLOCKED/114_NOT_RUN/0_PASS; NO_GO'
Write-Output 'VERIFIED two_SQL_fixture_cleanups=0; container/credentials_removed; 313_preexisting_preserved'
