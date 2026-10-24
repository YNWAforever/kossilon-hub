$ErrorActionPreference='Stop'
$prefix='docs/audit-remediation/cosec-20261024-admin-ab8690c7/'
$source=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-candidate.json') -Raw|ConvertFrom-Json).source_sha
if((& git rev-parse HEAD) -ne $source){throw 'Source version drift'}
foreach($p in @(& git diff --cached --name-only)){if(!$p.StartsWith($prefix)){throw 'Unowned staged work'}}
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if(!$line.Substring(3).StartsWith($prefix)){throw ('Unowned change: '+$line)}}
if(!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'verification-report.txt'))){throw 'Verification report missing'}
& git add -- $prefix
if($LASTEXITCODE -ne 0){throw 'Evidence stage failed'}
foreach($p in @(& git diff --cached --name-only)){if(!$p.StartsWith($prefix)){throw 'Staged scope drift'}}
# Raw logs/CSV/JSON/snapshots retain original CRLF/whitespace bytes; check authored prose/scripts only.
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check -- ":(glob)$($prefix)*.md" ":(glob)$($prefix)*.mjs" ":(glob)$($prefix)*.ps1"
if($LASTEXITCODE -ne 0){throw 'Authored evidence whitespace error'}
& git commit -m 'docs(audit): record UC185 last-Admin local acceptance'
if($LASTEXITCODE -ne 0){throw 'Local evidence commit failed'}
