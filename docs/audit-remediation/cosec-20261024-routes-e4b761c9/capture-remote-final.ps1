$ErrorActionPreference='Stop'
$expectedRoot='C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
if((Get-Location).Path -ne $expectedRoot){throw 'Wrong root'}
$out=Join-Path $PSScriptRoot 'remote-final.json'
if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
$text=@(& git ls-remote origin refs/heads/main)
if($LASTEXITCODE -ne 0){throw 'Remote read failed'}
$sha=($text[0] -split '\s+')[0]
if($sha -notmatch '^[0-9a-f]{40}$'){throw 'Invalid remote response'}
[ordered]@{checked_utc=[DateTime]::UtcNow.ToString('o');command='git ls-remote origin refs/heads/main';main_sha=$sha;stdout=$text;operation='read-only; no fetch/push/merge/deploy'}|ConvertTo-Json -Depth 3|Set-Content -LiteralPath $out -Encoding utf8
if($sha -ne '1c57a67213af72bff8d776694e6ed8c986b921db'){throw 'Main drift; read diff before continuing'}
Write-Output ('Verified main='+$sha)
