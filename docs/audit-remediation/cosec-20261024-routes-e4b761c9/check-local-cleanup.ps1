param([Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]+$')][string]$Attempt)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath('C:\Users\laich\Documents\kossilon-hub\cosec-20261023')
$ownedTemp=Join-Path $root '.worktrees\routes-e4b761c9-unit'
if(!(Test-Path -LiteralPath $ownedTemp)){throw 'Owned temp path missing'}
$resolved=(Resolve-Path -LiteralPath $ownedTemp).Path
if($resolved -ne $ownedTemp -or !$resolved.StartsWith($root+'\')){throw 'Owned path identity mismatch'}
$nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='msedge.exe'" | Where-Object {
  $_.CommandLine -and ($_.CommandLine.Contains($ownedTemp) -or $_.CommandLine.Contains('cosec-20261024-routes-e4b761c9/browser-routes.mjs'))
} | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
$receipt=[ordered]@{checked_utc=[DateTime]::UtcNow.ToString('o');root=$root;owned_temp=$ownedTemp;matching_processes=$nodes;operation='read-only identity inspection; no process stopped or file removed'}
$out=Join-Path $PSScriptRoot ('local-process-inspection-'+$Attempt+'.json')
if(Test-Path -LiteralPath $out){throw 'Prior receipt exists'}
$receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $out -Encoding utf8
Write-Output ('Owned browser/server processes remaining: '+$nodes.Count)
