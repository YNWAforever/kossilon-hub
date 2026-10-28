$ErrorActionPreference='Stop'
$root='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$base='561f1ee2e761ab2d1b8ee1bff44533ea610d7614'
$prefix='docs/audit-remediation/cosec-20261025-build-d29cd5ec/'
if((Get-Location).Path -ne $root -or (& git rev-parse HEAD) -ne $base){throw 'Identity drift; inspect latest delivery without resetting'}
if((& git branch --show-current) -ne 'codex/cosec-20261023' -or (& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Repo identity drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve existing staged work'}
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if(!$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
$report=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verification-report.json') -Raw|ConvertFrom-Json
if($report.source_sha -ne '4d63818fe2562146f85e9a7b9917d8f0eb58f4c1' -or $report.build -ne 'PASS' -or $report.product_changes -ne 0 -or $report.native_pass -ne 0){throw 'Result drift'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence-manifest.json') -Raw|ConvertFrom-Json
foreach($r in $manifest.files){if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $r.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r.sha256){throw ('Evidence changed '+$r.path)}}
& git -c core.autocrlf=false add -- $prefix
if($LASTEXITCODE -ne 0){throw 'Stage failed'}
foreach($p in @(& git diff --cached --name-only)){if(!$p.StartsWith($prefix)){throw 'Staged scope drift'}}
& git commit -m 'docs(audit): complete UC186 same-source local build gate'
if($LASTEXITCODE -ne 0){throw 'Ordinary local delivery commit failed'}
node (Join-Path $PSScriptRoot 'finalize.mjs') git
if($LASTEXITCODE -ne 0){throw 'Post-commit byte verification failed; preserve state'}
