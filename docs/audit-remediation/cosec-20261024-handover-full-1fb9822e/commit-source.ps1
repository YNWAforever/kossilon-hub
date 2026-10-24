$ErrorActionPreference='Stop'
$base='7a70e3be143cf771b6693f4ec2bb491817f74ca9'
$prefix='docs/audit-remediation/cosec-20261024-handover-full-1fb9822e/'
if((Get-Location).Path -ne 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Wrong root'}
if((& git rev-parse HEAD) -ne $base){throw 'HEAD changed; inspect latest delivery'}
if((& git branch --show-current) -ne 'codex/cosec-20261023' -or (& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Repo identity drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve existing staged work'}
$paths=@('src/features/work-items/assignment.test.ts','src/features/work-items/assignment.ts','src/features/work-items/repository.ts','src/features/work-items/types.ts')
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if($line.Substring(3) -notin $paths -and !$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
node (Join-Path $PSScriptRoot 'package.mjs') preflight
if($LASTEXITCODE -ne 0){throw 'Partial candidate preflight failed'}
& git add -- @paths
if($LASTEXITCODE -ne 0){throw 'Source stage failed'}
if((@(& git diff --cached --name-only|Sort-Object) -join '|') -cne (($paths|Sort-Object) -join '|')){throw 'Staged scope drift'}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Source whitespace error'}
& git commit -m 'fix(work-items): allow eligible staff when no skill is required'
if($LASTEXITCODE -ne 0){throw 'Ordinary local source commit failed'}
Write-Output ('Source candidate '+(& git rev-parse HEAD))
