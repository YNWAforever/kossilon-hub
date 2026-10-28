$ErrorActionPreference='Stop'
$root='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$base='2edfc24d37bc5325c23fa8ea29a76876fd034176'
$prefix='docs/audit-remediation/cosec-20261025-ap00-07447c43/'
if((Get-Location).Path -ne $root -or (& git rev-parse HEAD) -ne $base){throw 'Identity drift; inspect latest without resetting'}
if((& git branch --show-current) -ne 'codex/cosec-20261023' -or (& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Repo identity drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve staged work'}
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if(!$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
$report=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verification-report.json') -Raw|ConvertFrom-Json
if($report.source_sha -ne '4d63818fe2562146f85e9a7b9917d8f0eb58f4c1' -or $report.original_rows -ne 184 -or $report.approved_packets -ne 0 -or $report.native_pass -ne 0 -or $report.native_fields_preserved_unknown -ne 31 -or $report.minimal_input_groups -ne 3){throw 'Verification result drift'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence-manifest.json') -Raw|ConvertFrom-Json
foreach($r in $manifest.files){if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $r.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r.sha256){throw ('Evidence changed '+$r.path)}}
& git -c core.autocrlf=false add -- $prefix
if($LASTEXITCODE -ne 0){throw 'Stage failed'}
foreach($p in @(& git diff --cached --name-only)){if(!$p.StartsWith($prefix)){throw 'Staged scope drift'}}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Document whitespace error'}
& git commit -m 'docs(audit): prefill AP00 local evidence and minimum owner inputs'
if($LASTEXITCODE -ne 0){throw 'Ordinary local document commit failed'}
node (Join-Path $PSScriptRoot 'verify.mjs') git
if($LASTEXITCODE -ne 0){throw 'Post-commit byte verification failed; retain state'}
