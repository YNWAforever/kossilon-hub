$ErrorActionPreference='Stop'
$base='104af5c4875d2f10b595ec330fcb2e1d07e87201'
$prefix='docs/audit-remediation/cosec-20261024-handover-exec-a30e04f1/'
if((Get-Location).Path -ne 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'){throw 'Wrong root'}
if((& git rev-parse HEAD) -ne $base){throw 'HEAD changed; inspect latest delivery'}
if((& git branch --show-current) -ne 'codex/cosec-20261023' -or (& git remote get-url origin) -ne 'https://github.com/YNWAforever/kossilon-hub.git'){throw 'Repo identity drift'}
if(@(& git diff --cached --name-only).Count -ne 0){throw 'Preserve existing staged work'}
node (Join-Path $PSScriptRoot 'package.mjs') preflight
if($LASTEXITCODE -ne 0){throw 'Candidate preflight failed'}
$paths=@(& git diff --name-only)+@(& git ls-files --others --exclude-standard src)
if($paths.Count -ne 20){throw 'Expected exact20 reviewed source paths'}
foreach($line in @(& git status --porcelain=v1 --untracked-files=all)){if($line.Substring(3) -notin $paths -and !$line.Substring(3).StartsWith($prefix)){throw ('Preserve unowned change '+$line)}}
& git add -- @paths
if($LASTEXITCODE -ne 0){throw 'Source stage failed'}
if((@(& git diff --cached --name-only|Sort-Object) -join '|') -cne (($paths|Sort-Object) -join '|')){throw 'Staged scope drift'}
& git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
if($LASTEXITCODE -ne 0){throw 'Source whitespace error'}
& git commit -m 'fix(admin): hand over case responsibilities before staff disable'
if($LASTEXITCODE -ne 0){throw 'Ordinary local source commit failed'}
Write-Output ('Source candidate '+(& git rev-parse HEAD))
