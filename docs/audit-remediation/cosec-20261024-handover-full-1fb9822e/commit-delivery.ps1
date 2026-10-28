$ErrorActionPreference='Stop'
$root='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$prefix='docs/audit-remediation/cosec-20261024-handover-full-1fb9822e/'
$source='209aef6c78fe1ded6ad3a68eba4eaa9bd7304243'
if((Get-Location).Path -ne $root -or (& git rev-parse HEAD) -ne $source){throw 'Identity drift; preserve new work'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve staged work'}
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if(!$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
$report=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verification-report.json') -Raw|ConvertFrom-Json
if($report.source_sha -ne $source -or $report.full_uc186 -ne 'INCOMPLETE' -or $report.native_pass -ne 0){throw 'Verification status drift'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence-manifest.json') -Raw|ConvertFrom-Json
foreach($r in $manifest.files){if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $r.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r.sha256){throw ('Evidence changed '+$r.path)}}
& git -c core.autocrlf=false add -- $prefix
if($LASTEXITCODE -ne 0){throw 'Evidence stage failed'}
foreach($p in @(& git diff --cached --name-only)){if(!$p.StartsWith($prefix)){throw 'Staged scope drift'}}
& git commit -m 'docs(audit): record UC186 prerequisites and resource blockers'
if($LASTEXITCODE -ne 0){throw 'Ordinary local delivery commit failed'}
node (Join-Path $PSScriptRoot 'package.mjs') git
if($LASTEXITCODE -ne 0){throw 'Post-commit byte verification failed; retain state'}
