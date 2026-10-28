param(
  [Parameter(Mandatory = $true)][string]$Phase,
  [ValidateSet('test', 'format', 'lint')][string]$Task = 'test',
  [string]$TestName
)
$ErrorActionPreference = 'Stop'
$candidate = 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023'
$receipt = Join-Path $candidate 'docs/audit-remediation/cosec-20261023-assignment-86b2aa9a'
$scratch = Join-Path $candidate '.worktrees/sidecar-assignment-86b2aa9a'
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = 'C:\Program Files\nodejs\node.exe'
$start.WorkingDirectory = $candidate
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.CreateNoWindow = $true
$start.Environment.Clear()
$start.Environment['SystemRoot'] = 'C:\Windows'
$start.Environment['WINDIR'] = 'C:\Windows'
$start.Environment['ComSpec'] = 'C:\Windows\System32\cmd.exe'
$start.Environment['PATH'] = 'C:\Program Files\nodejs;C:\Windows\System32;C:\Windows'
$start.Environment['TEMP'] = $scratch
$start.Environment['TMP'] = $scratch
$start.Environment['NODE_ENV'] = 'test'
$start.Environment['NO_COLOR'] = '1'
if ($Task -eq 'test') {
  $start.ArgumentList.Add('node_modules/vitest/vitest.mjs')
  $start.ArgumentList.Add('run')
  $start.ArgumentList.Add('--configLoader')
  $start.ArgumentList.Add('runner')
  $start.ArgumentList.Add('--config')
  $start.ArgumentList.Add('docs/audit-remediation/cosec-20261023-assignment-86b2aa9a/sidecar-vitest.config.mts')
  if ($TestName) { $start.ArgumentList.Add('-t'); $start.ArgumentList.Add($TestName) }
} else {
  if ($Task -eq 'format') {
    $start.ArgumentList.Add('node_modules/prettier/bin/prettier.cjs')
    $start.ArgumentList.Add('--write')
  } else { $start.ArgumentList.Add('node_modules/eslint/bin/eslint.js') }
  $start.ArgumentList.Add('src/routes/work-queue.tsx')
  $start.ArgumentList.Add('src/routes/-work-queue.interaction.test.tsx')
}
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $start
$started = [DateTime]::UtcNow
if (-not $process.Start()) { throw 'Could not start focused component test.' }
$stdout = $process.StandardOutput.ReadToEndAsync()
$stderr = $process.StandardError.ReadToEndAsync()
$process.WaitForExit()
$log = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
[IO.File]::WriteAllText((Join-Path $receipt "sidecar-$Phase.log"), $log)
$result = [ordered]@{
  phase = $Phase
  startedUtc = $started.ToString('o')
  finishedUtc = [DateTime]::UtcNow.ToString('o')
  exitCode = $process.ExitCode
  command = $start.FileName + ' ' + ($start.ArgumentList -join ' ')
  environment = 'Cleared; only fixed Windows/runtime/PATH/TEMP/TMP/NODE_ENV/NO_COLOR whitelist. No inherited DB/provider variables. envDir points to per-run scratch.'
  temp = $scratch
  hashes = @('src/routes/work-queue.tsx', 'src/routes/-work-queue.interaction.test.tsx') | ForEach-Object {
    [ordered]@{ path = $_; sha256 = (Get-FileHash -LiteralPath (Join-Path $candidate $_) -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $receipt "sidecar-$Phase.json")
$log
exit $process.ExitCode
