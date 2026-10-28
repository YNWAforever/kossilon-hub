$ErrorActionPreference = 'Stop'
$folder = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $folder '../../..')).Path
$copied = @()
foreach ($attempt in @('first','second','final','verified','reflow','complete','reflow-complete','native-capture')) {
  $receiptPath = Join-Path $folder ('receipt-' + $attempt + '.json')
  if (-not (Test-Path -LiteralPath $receiptPath)) { throw ('Missing completed attempt: ' + $attempt) }
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  $source = (Resolve-Path -LiteralPath $receipt.runRoot).Path
  $allowed = (Resolve-Path (Join-Path $repo '.worktrees/local-browser-runs')).Path + [IO.Path]::DirectorySeparatorChar
  if (-not $source.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or
      (Get-Item -LiteralPath $source).LinkType) { throw 'Unexpected artifact root' }
  $target = Join-Path $folder ('browser/' + $attempt)
  if (Test-Path -LiteralPath $target) { throw 'Evidence target already exists' }
  New-Item -ItemType Directory -Path $target | Out-Null
  foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object {$_.FullName -notmatch '[\\/]owned-profile[\\/]'}) {
    $relative = [IO.Path]::GetRelativePath($source, $file.FullName)
    $destination = Join-Path $target $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLower() -cne $hash) { throw 'Artifact copy drift' }
    $copied += [ordered]@{attempt=$attempt;source=$file.FullName;path=[IO.Path]::GetRelativePath($folder,$destination).Replace('\','/');sha256=$hash}
  }
}
$copied | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $folder 'browser-copy-integrity.json')
$facts = @(Get-ChildItem -LiteralPath (Join-Path $folder 'browser/native-capture') -Filter journey-facts.json -Recurse | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
if ($facts.Count -ne 3) {throw 'Missing final browser facts'}
[ordered]@{projects=@($facts | ForEach-Object {
  [ordered]@{project=$_.project;checkpoints=$_.checkpoints.Count;zoom_values=@($_.checkpoints.cssVisualViewport.zoom | Sort-Object -Unique);
    first_metrics=$_.checkpoints[0].metrics;browser=$_.browser;denied=$_.denied.Count;page_errors=$_.pageErrors.Count}
});native_auth=$false;business_writes=$false;checkpoint_count=($facts.checkpoints | Measure-Object).Count} |
  ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $folder 'runtime-summary.json')
$prior = Join-Path $folder '../cosec-20261023-xlsx-db68ab95/acceptance-results.csv'
$rows = @(Import-Csv -LiteralPath $prior)
$added = @('R22','F19','UC117','UC118','UC196','UC197')
foreach ($row in $rows) {
  $row.evidence_paths = (($row.evidence_paths -split ';' | Where-Object {$_} | ForEach-Object {'../cosec-20261023-xlsx-db68ab95/' + $_}) -join ';')
  if ($row.id -in $added) {
    $row.local_result = 'PARTIAL_SCOPED'
    $row.local_scope += ' | R22 fe4a5635: same-source read-only Edge155 demo full390x844, desktop100 control and actual browser200% three project passes; 48 geometry/CDP checkpoints, two personas, real Tab/Shift+Tab traversal/wrap/focus-return, empty search, unavailable client boundary, correct fixture case/reload/return and Staff route denial. Native Auth/HTTP/DB writes, client-record journey, assistive tech and physical/Safari remain unverified.'
    $row.evidence_paths += ';R22-method-and-review.md;runtime-summary.json;browser-native-capture.txt;browser-reflow-complete.txt'
    $row.remaining_scope += ' | Current R22 local demo full390 and actual200% gaps addressed; native full journey, real client roundtrip, screen reader/physical/Safari still pending. Previous run limitations remain historical scope, not current local gaps.'
  }
}
$rows | Export-Csv -LiteralPath (Join-Path $folder 'acceptance-results.csv') -NoTypeInformation -Encoding utf8
$priorIntegrity = @()
foreach ($name in @('cosec-20261023-79d324f0','cosec-20261023-cont-d55d8d7e','cosec-20261023-xlsx-db68ab95')) {
  $oldFolder = Join-Path $folder ('../' + $name)
  $manifest = Get-Content -LiteralPath (Join-Path $oldFolder 'evidence-manifest.json') -Raw | ConvertFrom-Json
  foreach ($file in $manifest.files) {
    if ((Get-FileHash -LiteralPath (Join-Path $oldFolder $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256.ToLower()) { throw ('Prior evidence drift: ' + $name + '/' + $file.path) }
  }
  $priorIntegrity += [ordered]@{run=$name;manifest_entries=$manifest.files.Count;unchanged=$true}
}
$priorIntegrity | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $folder 'prior-evidence-integrity.json')
Write-Output ('COPIED browser files=' + $copied.Count + '; original acceptance rows=' + $rows.Count)
