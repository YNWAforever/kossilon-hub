$ErrorActionPreference='Stop'
$root='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$base='caefa0f2f88d4694d83800fbfaa0d8b2468abfa1'
$prefix='docs/audit-remediation/cosec-20261025-ap01-form-61f03672/'
if((Get-Location).Path -ne $root -or (& git rev-parse HEAD) -ne $base){throw 'Identity changed; preserve later work'}
if((& git branch --show-current) -ne 'codex/cosec-20261023' -or (& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Repo identity drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve staged work'}
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if(!$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
$report=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verification-report.json') -Raw|ConvertFrom-Json
if($report.source_sha -ne '4d63818fe2562146f85e9a7b9917d8f0eb58f4c1' -or $report.single_editable_form -ne $true -or $report.execution_approved -ne $false -or $report.original_rows -ne 184 -or $report.native_pass -ne 0){throw 'Verification result drift'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence-manifest.json') -Raw|ConvertFrom-Json
foreach($r in $manifest.files){if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $r.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r.sha256){throw ('Evidence changed '+$r.path)}}
& git -c core.autocrlf=false add -- $prefix
if($LASTEXITCODE -ne 0){throw 'Stage failed'}
foreach($p in @(& git diff --cached --name-only)){if(!$p.StartsWith($prefix)){throw 'Staged scope drift'}}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Document whitespace error'}
& git commit -m 'docs(audit): provide single fillable AP01 metadata authorization form'
if($LASTEXITCODE -ne 0){throw 'Ordinary local document commit failed'}
node (Join-Path $PSScriptRoot 'package.mjs') git
if($LASTEXITCODE -ne 0){throw 'Post-commit byte verification failed; preserve state'}
