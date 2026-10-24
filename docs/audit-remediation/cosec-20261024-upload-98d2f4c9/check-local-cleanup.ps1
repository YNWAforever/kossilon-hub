param([Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]+$')][string]$Attempt)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath('C:\Users\laich\Documents\kossilon-hub\cosec-20261023')
$ownedTemp=Join-Path $root '.worktrees\upload-98d2f4c9-unit'
$resolved=(Resolve-Path -LiteralPath $ownedTemp).Path
if($resolved -ne $ownedTemp -or !$resolved.StartsWith($root+'\')){throw 'Owned path mismatch'}
$nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='msedge.exe'"|Where-Object {
  $_.CommandLine -and ($_.CommandLine.Contains($ownedTemp) -or $_.CommandLine.Contains('cosec-20261024-upload-98d2f4c9/browser-upload.mjs'))
}|Select-Object ProcessId,ParentProcessId,Name,CommandLine)
$out=Join-Path $PSScriptRoot ('local-process-inspection-'+$Attempt+'.json')
if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
[ordered]@{checked_utc=[DateTime]::UtcNow.ToString('o');root=$root;owned_temp=$ownedTemp;matching_processes=$nodes;operation='read-only inspection; no processes stopped or resources removed'}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $out -Encoding utf8
Write-Output ('Owned runtime processes remaining: '+$nodes.Count)
