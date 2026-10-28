$ErrorActionPreference = 'Stop'
$folder = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $folder '../../..')).Path
if ($repo -ine 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023') { throw 'Unexpected candidate root' }
$candidate = Get-Content -Raw (Join-Path $folder 'release-candidate.json') | ConvertFrom-Json
if ($candidate.release_gate -cne 'NO_GO' -or $candidate.auth_runtime_verified -or $candidate.deployed) { throw 'Release boundary drift' }
$source = Get-Content -Raw (Join-Path $folder 'source-candidate.json') | ConvertFrom-Json
if ($candidate.source_sha -cne $source.source_sha) { throw 'Source version mismatch' }
foreach ($file in $source.files) {
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $repo $file.path)).Hash.ToLower() -cne $file.sha256) { throw ('Source drift: ' + $file.path) }
}
git -C $repo diff --exit-code $source.source_sha -- $source.paths
if ($LASTEXITCODE -ne 0) { throw 'Source commit/worktree mismatch' }
$old = @(Import-Csv (Join-Path $folder '../cosec-20261023-cont-d55d8d7e/acceptance-results.csv'))
$rows = @(Import-Csv (Join-Path $folder 'acceptance-results.csv'))
if ($rows.Count -ne 184 -or $old.Count -ne 184) { throw 'Acceptance count drift' }
foreach ($kind in @(@('F',35),@('R',15),@('UC',100),@('LA',34))) {
  if (@($rows | Where-Object record_type -eq $kind[0]).Count -ne $kind[1]) { throw 'Original category count drift' }
}
for ($i=0; $i -lt $rows.Count; $i++) {
  foreach ($field in @('record_type','id','historical_result','native_result','original_row_json')) {
    if ($old[$i].$field -cne $rows[$i].$field) { throw ('Original/native field drift: ' + $old[$i].id) }
  }
}
if (@($rows | Where-Object native_result -match '^PASS').Count) { throw 'Invented native pass' }
foreach ($path in ($rows.evidence_paths -split ';' | Where-Object {$_} | Sort-Object -Unique)) {
  if (-not (Test-Path -LiteralPath (Join-Path $folder $path))) { throw ('Missing evidence: ' + $path) }
}
$events = @(Get-Content (Join-Path $folder 'db/xlsx-events-first.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
$book = $events | Where-Object phase -eq 'workbook'
$binaryPath = Join-Path $folder 'db/mixed-first.xlsx'
if ((Get-FileHash -Algorithm SHA256 $binaryPath).Hash.ToLower() -cne $book.sha256 -or (Get-Item $binaryPath).Length -ne $book.bytes) { throw 'Actual workbook byte identity mismatch' }
$zip = [IO.Compression.ZipFile]::OpenRead($binaryPath)
try {
  $stream = [IO.StreamReader]::new($zip.GetEntry('xl/worksheets/sheet1.xml').Open())
  try { $xml = [System.Xml.Linq.XDocument]::Parse($stream.ReadToEnd()) } finally { $stream.Dispose() }
  $sheetRows = @($xml.Descendants() | Where-Object {$_.Name.LocalName -ceq 'row'})
  if ($sheetRows.Count -ne 502) { throw 'Saved OOXML physical row count mismatch' }
  if ((@($sheetRows | ForEach-Object {[int]$_.Attribute('r').Value}) -join ',') -cne ((1..502) -join ',')) { throw 'OOXML rows missing or repeated' }
} finally { $zip.Dispose() }
if ($book.rowCount -ne 500 -or $book.validRowNumbers.Count -ne 350 -or $book.duplicateRowNumbers.Count -ne 100 -or $book.invalidRowNumbers.Count -ne 50) { throw 'Parsed category count mismatch' }
$preview = $events | Where-Object phase -eq 'preview'
if ($preview.selected -ne 500 -or $preview.eligibleCount -ne 350 -or @($preview.rows | Where-Object {$_.conflicts -contains 'source_row_invalid'}).Count -ne 150) { throw 'Preview widened source scope' }
$retry = $events | Where-Object phase -eq 'retry'
if (($retry.processed -join ',') -cne '100,100,100,13') { throw 'Retry chunks mismatch' }
$readback = $events | Where-Object phase -eq 'readback'
if ($readback.facts.Count -ne 350 -or $readback.journals.Count -ne 350 -or $readback.rows.Count -ne 500) { throw 'SQL readback mismatch' }
foreach ($column in @('id','company_id','payment_id','work_id')) {
  if (@($readback.facts.$column | Sort-Object -Unique).Count -ne 350) { throw 'Duplicate domain identity' }
}
if (@($readback.journals.row_id | Sort-Object -Unique).Count -ne 350) { throw 'Duplicate journal row' }
if (@($readback.facts | Where-Object {$_.status -cne 'Payment pending' -or $_.paid_at -ne $null -or $_.amount -ne 1200}).Count) { throw 'Invented payment success' }
if (@($readback.rows | Where-Object {$_.appliedAt}).Count -ne 350 -or $readback.batchStatus -cne 'pending_review' -or $readback.outboxCount -ne 0) { throw 'False whole-batch or provider success' }
foreach ($eventFile in @('db/xlsx-events-first.jsonl','db/normalized-events-first.jsonl')) {
  $cleanup = Get-Content (Join-Path $folder $eventFile) | ForEach-Object {$_ | ConvertFrom-Json} | Where-Object phase -eq 'cleanup-readback'
  foreach ($key in @('companies','cases','batches','jobs','users','teams')) { if ($cleanup.$key -ne 0) { throw 'Fixture residue' } }
}
$db = Get-Content -Raw (Join-Path $folder 'db/db-500-first.json') | ConvertFrom-Json
if ($db.exit_code -ne 0) { throw 'DB test failure' }
$cleanup = Get-Content -Raw (Join-Path $folder 'cleanup-final.json') | ConvertFrom-Json
if (-not $cleanup.container_absent -or -not $cleanup.credentials_absent) { throw 'Missing target cleanup proof' }
if ((Get-Content -Raw (Join-Path $folder 'unit-final.txt')) -notmatch '2470 passed \(2470\)') { throw 'Missing current full unit pass' }
$manifest = Get-Content -Raw (Join-Path $folder 'evidence-manifest.json') | ConvertFrom-Json
foreach ($file in $manifest.files) {
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $folder $file.path)).Hash.ToLower() -cne $file.sha256) { throw ('Evidence drift: ' + $file.path) }
}
Write-Output ('VERIFIED source=' + $source.source_sha + '; evidence_files=' + $manifest.files.Count)
Write-Output 'VERIFIED original_rows=184; actual_XLSX_rows=500; eligible=350; blocked=150; native_passes=0'
Write-Output 'VERIFIED unit=2470; real_SQL_files=2; release_gate=NO_GO'
