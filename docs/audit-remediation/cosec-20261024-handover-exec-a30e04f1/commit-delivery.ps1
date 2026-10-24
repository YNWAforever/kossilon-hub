$ErrorActionPreference='Stop'
$root='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$prefix='docs/audit-remediation/cosec-20261024-handover-exec-a30e04f1/'
$candidate=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-candidate.json') -Raw|ConvertFrom-Json
$source=$candidate.source_sha
if((Get-Location).Path -ne $root -or (& git rev-parse HEAD) -ne $source){throw 'Identity drift; preserve new work'}
if($candidate.parent_sha -ne '104af5c4875d2f10b595ec330fcb2e1d07e87201'){throw 'Candidate lineage drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve staged work'}
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if(!$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
$report=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verification-report.json') -Raw|ConvertFrom-Json
if($report.source_sha -ne $source -or $report.original_uc186 -ne 'PARTIAL_SCOPED' -or $report.native_pass -ne 0 -or $report.unit -ne 2780 -or $report.sql -ne 1){throw 'Verification status drift'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence-manifest.json') -Raw|ConvertFrom-Json
foreach($r in $manifest.files){if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $r.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r.sha256){throw ('Evidence changed '+$r.path)}}
& git -c core.autocrlf=false add -- $prefix
if($LASTEXITCODE -ne 0){throw 'Evidence stage failed'}
foreach($p in @(& git diff --cached --name-only)){if(!$p.StartsWith($prefix)){throw 'Staged scope drift'}}
& git commit -m 'docs(audit): preserve UC186 handover and concurrency acceptance'
if($LASTEXITCODE -ne 0){throw 'Ordinary local delivery commit failed'}
node (Join-Path $PSScriptRoot 'package.mjs') git
if($LASTEXITCODE -ne 0){throw 'Post-commit byte verification failed; retain state'}
