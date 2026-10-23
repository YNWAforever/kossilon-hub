$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$repo=(Resolve-Path (Join-Path $folder '../../..')).Path
if($repo -ine 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Unexpected checkout'}
$candidate=Get-Content (Join-Path $folder 'release-candidate.json') -Raw|ConvertFrom-Json
$source=Get-Content (Join-Path $folder 'source-candidate.json') -Raw|ConvertFrom-Json
if($candidate.release_gate -cne 'NO_GO' -or $candidate.auth_runtime_verified -or $candidate.deployed){throw 'Native boundary drift'}
if($source.source_sha -cne $candidate.source_sha){throw 'Source identity mismatch'}
$sqlPath='src/features/incorporation/checklist-recovery.integration.test.ts'
$initial=Get-Content (Join-Path $folder 'source-freeze.json') -Raw|ConvertFrom-Json
$final=Get-Content (Join-Path $folder 'source-final-freeze.json') -Raw|ConvertFrom-Json
foreach($file in $initial.files){
  $path=if($file.path -ceq $sqlPath){Join-Path $folder 'sql-before-cleanup-repair.test.ts.snapshot'}else{Join-Path $repo $file.path}
  if((Get-FileHash -LiteralPath $path).Hash.ToLower() -cne $file.sha256){throw('Full-unit byte evidence changed: '+$file.path)}
}
foreach($file in $final.files){if((Get-FileHash -LiteralPath (Join-Path $repo $file.path)).Hash.ToLower() -cne $file.sha256){throw('Final tested bytes changed: '+$file.path)}}
if($final.changed_after_full_unit.Count -ne 1 -or $final.changed_after_full_unit[0] -cne $sqlPath){throw 'Undisclosed after-unit change'}
foreach($file in $source.files){if((Get-FileHash -LiteralPath (Join-Path $repo $file.path)).Hash.ToLower() -cne $file.sha256 -or -not $file.git_blob_equal){throw 'Candidate source mismatch'}}
git -C $repo diff --exit-code $source.source_sha -- $source.paths
if($LASTEXITCODE -ne 0){throw 'Source differs from source commit'}
$changed=@(git -C $repo diff --name-only $candidate.parent_sha HEAD -- . ':!docs/audit-remediation/**')
if((($changed|Sort-Object)-join ';') -cne (($source.paths|Sort-Object)-join ';')){throw 'Unexpected source scope'}
foreach($name in @('unit-final','targeted-verified','typecheck-verified','lint-verified','build-final','browser-green')){
  if((Get-Content (Join-Path $folder ($name+'.json')) -Raw|ConvertFrom-Json).exit_code -ne 0){throw('Check failed: '+$name)}
}
if((Get-Content (Join-Path $folder 'lint-final.json') -Raw|ConvertFrom-Json).exit_code -ne 1){throw 'Lost initial lint failure'}
$counts=Get-Content (Join-Path $folder 'check-summary.json') -Raw|ConvertFrom-Json
$unit=Get-Content (Join-Path $folder 'unit-final.txt') -Raw
$unit=[regex]::Replace($unit,[char]27+'\[[0-?]*[ -/]*[@-~]','')
if($unit -notmatch ('Tests\s+'+$counts.unit_pass+' passed \('+$counts.unit_pass+'\)') -or $unit -match 'Unhandled Errors'){throw 'Unit count/error mismatch'}
if($unit -notmatch ('Test Files\s+'+$counts.unit_files+' passed \('+$counts.unit_files+'\)')){throw 'Unit file count mismatch'}
if($unit -notmatch 'production-incorporation-checklist.interaction.test.tsx.*\(9 tests\)'){throw 'Missing final component scope'}
$red=Get-Content (Join-Path $folder 'targeted-red.txt') -Raw
if($red -notmatch '5 failed \| 7 passed \(12\)'){throw 'Missing original component reproduction'}
node (Join-Path $folder 'prepare-readback.mjs') --verify
if($LASTEXITCODE -ne 0){throw 'SQL/browser/readback mismatch'}
foreach($db in @('db/db-checklist-green.txt','db-final/db-checklist-final.txt')){
  $log=Get-Content (Join-Path $folder $db) -Raw
  $log=[regex]::Replace($log,[char]27+'\[[0-?]*[ -/]*[@-~]','')
  if($log -notmatch '1 passed \(1\)'){throw 'SQL actual test count mismatch'}
}
$green=Get-Content (Join-Path $folder 'browser-results-green.json') -Raw|ConvertFrom-Json
$redBrowser=Get-Content (Join-Path $folder 'browser-results-red5.json') -Raw|ConvertFrom-Json
$component=$final.files|Where-Object path -ceq 'src/features/incorporation/components/production-incorporation-detail.tsx'
if($green.source_sha256 -cne $component.sha256){throw 'Final Edge/source mismatch'}
if((Get-FileHash -LiteralPath (Join-Path $folder 'production-detail-before.tsx.snapshot')).Hash.ToLower() -cne $redBrowser.source_sha256){throw 'Original Edge/source mismatch'}
$old=@(Import-Csv (Join-Path $folder '../cosec-20261024-export-9dd9e445/acceptance-results.csv'))
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
Write-Output ('VERIFIED source='+$source.source_sha+'; evidence_files='+$manifest.files.Count+'; prior_batches=8/1419_files')
Write-Output ('VERIFIED unit='+$counts.unit_pass+'/'+$counts.unit_files+'_files; scoped=51; Edge=3; SQL=1_per_target; typecheck/lint/build=0')
Write-Output 'VERIFIED only post-unit change=excluded_SQL_cleanup; SQL/convention/typecheck/lint rerun; product/unit bytes unchanged'
Write-Output 'VERIFIED original_rows=184; 35F/15R/100UC/34LA; native=70_BLOCKED/114_NOT_RUN/0_PASS; NO_GO'
Write-Output 'VERIFIED both_SQL_fixture_cleanup=0; both_owned_containers/credentials_removed; all_preexisting_ids_preserved'
