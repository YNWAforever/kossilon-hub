$ErrorActionPreference = 'Stop'
$folder = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $folder '../../..')).Path
if ($repo -ine 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023') { throw 'Unexpected candidate root' }
$candidate = Get-Content -Raw (Join-Path $folder 'release-candidate.json') | ConvertFrom-Json
if ($candidate.release_gate -cne 'NO_GO' -or $candidate.auth_runtime_verified -or $candidate.deployed) { throw 'Release boundary drift' }
$source = Get-Content -Raw (Join-Path $folder 'source-candidate.json') | ConvertFrom-Json
if ($source.source_sha -cne $candidate.source_sha) { throw 'Source identity mismatch' }
foreach ($file in $source.files) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repo $file.path)).Hash.ToLower()
  if ($actual -cne $file.sha256) { throw ('Source fingerprint drift: ' + $file.path) }
}
git -C $repo diff --exit-code $candidate.source_sha -- e2e/continuation-reflow.spec.ts playwright.local.config.ts src/features/nar-import/scale.integration.test.ts src/test/db-integration-files.ts
if ($LASTEXITCODE -ne 0) { throw 'Source commit/worktree mismatch' }
$original = @(Import-Csv (Join-Path $folder '../cosec-20261023-79d324f0/acceptance-results.csv'))
$current = @(Import-Csv (Join-Path $folder 'acceptance-results.csv'))
if ($current.Count -ne 184 -or $original.Count -ne 184) { throw 'Acceptance record count drift' }
foreach ($kind in @(@('F',35),@('R',15),@('UC',100),@('LA',34))) {
  if (@($current | Where-Object record_type -eq $kind[0]).Count -ne $kind[1]) { throw 'Original ID category count drift' }
}
for ($i=0; $i -lt $original.Count; $i++) {
  foreach ($field in @('record_type','id','historical_result','native_result','original_row_json')) {
    if ($original[$i].$field -cne $current[$i].$field) { throw ('Original/native drift: ' + $original[$i].id) }
  }
}
if (@($current | Where-Object native_result -match '^PASS').Count -ne 0) { throw 'Invented native pass' }
foreach ($path in ($current.evidence_paths -split ';' | Where-Object {$_} | Sort-Object -Unique)) {
  if (-not (Test-Path -LiteralPath (Join-Path $folder $path))) { throw ('Missing evidence: ' + $path) }
}
$events = @(Get-Content (Join-Path $folder 'db-verify/events-final.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
$facts = ($events | Where-Object phase -eq 'readback').facts
$journal = ($events | Where-Object phase -eq 'readback').journal
if ($facts.Count -ne 500 -or $journal.Count -ne 500) { throw 'Actual SQL readback size mismatch' }
foreach ($column in @('id','company_id','payment_id','work_id')) {
  if (@($facts.$column | Sort-Object -Unique).Count -ne 500) { throw ('Duplicate SQL fact: ' + $column) }
}
if (@($journal.row_id | Sort-Object -Unique).Count -ne 500) { throw 'Duplicate journal row' }
if (@($facts | Where-Object { $_.status -cne 'Payment pending' -or $_.paid_at -ne $null -or $_.amount -ne 1200 }).Count) { throw 'Invented payment success or wrong amount' }
$cleanup = $events | Where-Object phase -eq 'cleanup-readback'
foreach ($key in @('companies','cases','batches','jobs','users','teams')) {
  if ($cleanup.$key -ne 0) { throw 'SQL fixture residue' }
}
$cleanupFinal = Get-Content -Raw (Join-Path $folder 'cleanup-final.json') | ConvertFrom-Json
if (-not $cleanupFinal.containers_absent -or -not $cleanupFinal.port_5180_bind_probe_free) { throw 'Missing cleanup proof' }
foreach ($path in $cleanupFinal.credential_paths_absent) {
  if (Test-Path -LiteralPath (Join-Path $repo $path)) { throw 'Own credentials remain' }
}
$browser = Get-Content -Raw (Join-Path $folder 'browser/final/results.json') | ConvertFrom-Json
if ($browser.stats.expected -ne 2 -or $browser.stats.unexpected -ne 0 -or $browser.stats.skipped -ne 0) { throw 'Browser result drift' }
if (@(Get-ChildItem (Join-Path $folder 'browser/final') -Recurse -Filter '*.png').Count -ne 14) { throw 'Missing browser screenshots' }
if ((Get-Content -Raw (Join-Path $folder 'unit-verified.txt')) -notmatch '2464 passed \(2464\)') { throw 'Missing full unit pass' }
$static = Get-Content -Raw (Join-Path $folder 'static-events-final.json') | ConvertFrom-Json
if ($static.typecheck -ne 0 -or $static.changed_db_test_lint -ne 0) { throw 'Final static check failed' }
$manifest = Get-Content -Raw (Join-Path $folder 'evidence-manifest.json') | ConvertFrom-Json
foreach ($file in $manifest.files) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $folder $file.path)).Hash.ToLower()
  if ($actual -cne $file.sha256) { throw ('Evidence byte drift: ' + $file.path) }
}
Write-Output ('VERIFIED source=' + $candidate.source_sha)
Write-Output ('VERIFIED evidence_files=' + $manifest.files.Count + '; original_rows=184; native_passes=0')
Write-Output 'VERIFIED unit=2464; SQL=1 (500 normalized rows); demo browser=2; release_gate=NO_GO'
