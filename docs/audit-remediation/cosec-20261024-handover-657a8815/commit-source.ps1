$ErrorActionPreference='Stop'
$base='d2f96c899e30661943b2a59740c2e266a976d9d2'
$prefix='docs/audit-remediation/cosec-20261024-handover-657a8815/'
if((Get-Location).Path -ne 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Wrong root'}
if((& git rev-parse HEAD) -ne $base){throw 'HEAD changed; inspect latest delivery before proceeding'}
if((& git branch --show-current) -ne 'codex/cosec-20261023' -or (& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Repo identity drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve existing staged work'}
$paths=@('src/features/admin/handover-scope.integration.test.ts','src/features/admin/production-staff-admin.interaction.test.tsx','src/features/admin/production-staff-admin.tsx','src/features/admin/repository.ts','src/features/admin/types.ts','src/test/db-integration-files.ts')
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if($line.Substring(3) -notin $paths -and !$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
node (Join-Path $PSScriptRoot 'package.mjs') preflight
if($LASTEXITCODE -ne 0){throw 'Acceptance preflight failed'}
$freeze=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-post-checks.json') -Raw|ConvertFrom-Json
foreach($r in $freeze.files){if((Get-FileHash -LiteralPath $r.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r.sha256){throw ('Source drift '+$r.path)}}
& git add -- @paths
if($LASTEXITCODE -ne 0){throw 'Source stage failed'}
if((@(& git diff --cached --name-only|Sort-Object) -join '|') -cne (($paths|Sort-Object) -join '|')){throw 'Staged scope drift'}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Source whitespace error'}
& git commit -m 'fix(admin): include all open case responsibilities before staff removal'
if($LASTEXITCODE -ne 0){throw 'Ordinary local source commit failed'}
Write-Output ('Source candidate '+(& git rev-parse HEAD))
