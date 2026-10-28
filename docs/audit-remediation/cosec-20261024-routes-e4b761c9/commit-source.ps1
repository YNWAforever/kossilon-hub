$ErrorActionPreference='Stop'
$root='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$base='36dad48dc30a86329f0afcc2ffb46749be71e94e'
if((Get-Location).Path -ne $root){throw 'Wrong root'}
if((& git rev-parse HEAD) -ne $base -or (& git branch --show-current) -ne 'codex/cosec-20261023'){throw 'Version drift'}
if((& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Remote drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Existing staged work'}
$paths=@('src/features/auth/auth-router-recovery.test.tsx','src/routes/-case-subroutes.interaction.test.tsx','src/test/case-route-fixtures.ts')
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){
  $path=$line.Substring(3)
  if($path -notin $paths -and !$path.StartsWith('docs/audit-remediation/cosec-20261024-routes-e4b761c9/')){throw ('Unowned change: '+$path)}
}
foreach($name in @('targeted-verified','unit-verified','typecheck-final','lint-final','build-final','browser-green2')){
  $receipt=Get-Content -LiteralPath (Join-Path $PSScriptRoot ($name+'.json')) -Raw|ConvertFrom-Json
  if($receipt.exit_code -ne 0 -or $receipt.error){throw ('Check failed: '+$name)}
}
& git add -- @paths
if($LASTEXITCODE -ne 0){throw 'Source stage failed'}
$staged=@(& git diff --cached --name-only|Sort-Object)
if(($staged -join '|') -cne (($paths|Sort-Object) -join '|')){throw 'Staged scope drift'}
& git diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Whitespace error'}
& git commit -m 'test(routes): verify UC160 navigation and read recovery'
if($LASTEXITCODE -ne 0){throw 'Local source commit failed'}
$sha=& git rev-parse HEAD
$out=Join-Path $PSScriptRoot 'source-commit-receipt.json'
if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{source_sha=$sha;parent_sha=$base;paths=$paths;operation='ordinary local commit only; no push/merge/deploy'}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $out -Encoding utf8
