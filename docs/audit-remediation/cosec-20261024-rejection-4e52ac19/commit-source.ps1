$ErrorActionPreference='Stop'
$root='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$base='6f29c4068fcbbaa2197efdf0b8969777b78f47c5'
if((Get-Location).Path -ne $root){throw 'Wrong root'}
if((& git rev-parse HEAD) -ne $base -or (& git branch --show-current) -ne 'codex/cosec-20261023'){throw 'Version drift'}
if((& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Remote drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Existing staged work'}
$paths=@('src/features/documents/repository.ts','src/routes/portal.tsx','src/test/db-integration-files.ts','src/features/documents/rejection-projection.test.ts','src/features/documents/rejection-readback.integration.test.ts','src/routes/-document-rejection.interaction.test.tsx')
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){
  $path=$line.Substring(3)
  if($path -notin $paths -and !$path.StartsWith('docs/audit-remediation/cosec-20261024-rejection-4e52ac19/')){throw ('Unowned change: '+$path)}
}
foreach($name in @('targeted-verified','unit-verified','typecheck-final','lint-final','build-final','browser-accepted','db/db-rejection-green')){
  $receipt=Get-Content -LiteralPath (Join-Path $PSScriptRoot ($name+'.json')) -Raw|ConvertFrom-Json
  if($receipt.exit_code -ne 0 -or $receipt.error){throw ('Failed check: '+$name)}
}
& git add -- @paths
if($LASTEXITCODE -ne 0){throw 'Source stage failed'}
$staged=@(& git diff --cached --name-only|Sort-Object)
if(($staged -join '|') -cne (($paths|Sort-Object) -join '|')){throw 'Staged scope drift'}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Authored source whitespace error'}
& git commit -m 'fix(documents): expose scoped rejection guidance and refresh reuploads'
if($LASTEXITCODE -ne 0){throw 'Local source commit failed'}
$sha=& git rev-parse HEAD
$out=Join-Path $PSScriptRoot 'source-commit-receipt.json'
if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{source_sha=$sha;parent_sha=$base;paths=$paths;operation='ordinary local commit only; no push/merge/deploy'}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $out -Encoding utf8
