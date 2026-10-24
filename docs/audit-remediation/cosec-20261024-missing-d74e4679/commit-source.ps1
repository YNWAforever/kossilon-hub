$ErrorActionPreference='Stop'
$base='c9d783478572b1e11331018d46e09e20f427b832'
$prefix='docs/audit-remediation/cosec-20261024-missing-d74e4679/'
if((Get-Location).Path -ne 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Wrong root'}
if((& git rev-parse HEAD) -ne $base -or (& git branch --show-current) -ne 'codex/cosec-20261023'){throw 'Version drift'}
if((& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Remote drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Existing staged work'}
$paths=@('src/features/corporate-changes/components/production-corporate-change-detail.tsx','src/routes/-missing-record.interaction.test.tsx')
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){
  $path=$line.Substring(3)
  if($path -notin $paths -and !$path.StartsWith($prefix)){throw ('Unowned change '+$path)}
}
foreach($name in @('targeted-final','typecheck-verified','lint-verified','build-final','browser-green1')){
  $receipt=Get-Content -LiteralPath (Join-Path $PSScriptRoot ($name+'.json')) -Raw|ConvertFrom-Json
  if($receipt.exit_code -ne 0 -or $receipt.error){throw ('Check failed '+$name)}
}
$freeze=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-post-checks.json') -Raw|ConvertFrom-Json
foreach($row in $freeze.files){
  if((Get-FileHash -LiteralPath $row.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.sha256){throw ('Source drift '+$row.path)}
}
& git add -- @paths
if($LASTEXITCODE -ne 0){throw 'Source stage failed'}
$staged=@(& git diff --cached --name-only|Sort-Object)
if(($staged -join '|') -cne (($paths|Sort-Object) -join '|')){throw 'Staged scope drift'}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Source whitespace error'}
& git commit -m 'fix(corporate-changes): retain return context for invalid request IDs'
if($LASTEXITCODE -ne 0){throw 'Local source commit failed'}
$out=Join-Path $PSScriptRoot 'source-commit-receipt.json'
if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{source_sha=(& git rev-parse HEAD);parent_sha=$base;paths=$paths;operation='ordinary local commit only; no push/merge/deploy'}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $out -Encoding utf8
