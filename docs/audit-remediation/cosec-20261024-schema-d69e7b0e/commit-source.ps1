$ErrorActionPreference='Stop'
$base='1a9f3fef8e419a3cc75d0d62e90795c3d8134d68'
$prefix='docs/audit-remediation/cosec-20261024-schema-d69e7b0e/'
if((Get-Location).Path -ne 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Wrong root'}
if((& git rev-parse HEAD) -ne $base -or (& git branch --show-current) -ne 'codex/cosec-20261023'){throw 'Version drift'}
if((& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Remote drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Existing staged work'}
$paths=@("src/features/operations/repository.ts","src/server/maintenance-schema.ts","src/server/maintenance-schema.integration.test.ts","src/server/maintenance-trigger-runtime.ts","src/server/maintenance-trigger-runtime.test.ts","src/test/db-integration-files.ts")
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){
  $path=$line.Substring(3)
  if($path -notin $paths -and !$path.StartsWith($prefix)){throw ('Unowned change '+$path)}
}
foreach($name in @('targeted-final2','typecheck-final2','lint-final2','build-final3')){
  $receipt=Get-Content -LiteralPath (Join-Path $PSScriptRoot ($name+'.json')) -Raw|ConvertFrom-Json
  if($receipt.exit_code -ne 0 -or $receipt.error){throw ('Check failed '+$name)}
}
$sql=@(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'db/test-final3.jsonl') | ForEach-Object {$_|ConvertFrom-Json} | Where-Object {$_.phase -eq 'test-result'})
if($sql.Count -ne 1 -or $sql[0].exitCode -ne 0 -or $sql[0].error){throw 'SQL acceptance failed'}
foreach($name in @('teardown1','teardown2')){
  $end=@(Get-Content -LiteralPath (Join-Path $PSScriptRoot ('db/teardown-'+$name+'.jsonl')) | ForEach-Object {$_|ConvertFrom-Json} | Where-Object {$_.phase -eq 'teardown'})
  if($end.Count -ne 1 -or !$end[0].containerAbsent -or !$end[0].ownedCredentialsRemoved){throw 'SQL cleanup unverified'}
}
$freeze=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-post-build.json') -Raw|ConvertFrom-Json
foreach($row in $freeze.files){
  if((Get-FileHash -LiteralPath $row.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.sha256){throw ('Source drift '+$row.path)}
}
& git add -- @paths
if($LASTEXITCODE -ne 0){throw 'Source stage failed'}
$staged=@(& git diff --cached --name-only|Sort-Object)
if(($staged -join '|') -cne (($paths|Sort-Object) -join '|')){throw 'Staged scope drift'}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Source whitespace error'}
& git commit -m 'fix(operations): refuse maintenance writes on incompatible schema'
if($LASTEXITCODE -ne 0){throw 'Local source commit failed'}
$out=Join-Path $PSScriptRoot 'source-commit-receipt.json'
if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{source_sha=(& git rev-parse HEAD);parent_sha=$base;paths=$paths;operation='ordinary local commit only; no push/merge/deploy'}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $out -Encoding utf8
