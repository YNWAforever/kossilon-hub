$ErrorActionPreference = 'Stop'
$folder = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $folder '../../..')).Path
if ($repo -ine 'C:\Users\laich\Documents\kossilon-hub\cosec-20261023') {throw 'Unexpected checkout'}
$candidate = Get-Content -Raw -LiteralPath (Join-Path $folder 'release-candidate.json') | ConvertFrom-Json
if ($candidate.release_gate -cne 'NO_GO' -or $candidate.auth_runtime_verified -or $candidate.deployed) {throw 'Release boundary drift'}
$source = Get-Content -Raw -LiteralPath (Join-Path $folder 'source-candidate.json') | ConvertFrom-Json
if ($source.source_sha -cne '2b25cacf4af6a1c2fc529e4b585000fe40bab40d' -or $candidate.source_sha -cne $source.source_sha) {throw 'Candidate identity drift'}
foreach ($file in $source.files) {
  if ((Get-FileHash -LiteralPath (Join-Path $repo $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256) {throw ('Source drift: '+$file.path)}
}
git -C $repo diff --exit-code $source.source_sha -- $source.paths
if ($LASTEXITCODE -ne 0) {throw 'Candidate source differs from tested bytes'}
$changed = @(git -C $repo diff --name-only $source.parent_sha HEAD -- . ':!docs/audit-remediation/**')
if ((($changed | Sort-Object) -join ';') -cne (($source.paths | Sort-Object) -join ';')) {throw 'Unexpected non-document source changes'}
$reflowFreeze = Get-Content -Raw -LiteralPath (Join-Path $folder 'source-freeze-complete.json') | ConvertFrom-Json
foreach ($file in $reflowFreeze.files | Where-Object {$_.path -ne 'e2e/r22-viewport-zoom.spec.ts'}) {
  if ((Get-FileHash -LiteralPath (Join-Path $repo $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256) {throw 'Old reflow dependency changed after execution'}
}
$old = @(Import-Csv -LiteralPath (Join-Path $folder '../cosec-20261023-xlsx-db68ab95/acceptance-results.csv'))
$rows = @(Import-Csv -LiteralPath (Join-Path $folder 'acceptance-results.csv'))
if ($rows.Count -ne 184 -or $old.Count -ne 184) {throw 'Original row count drift'}
foreach ($kind in @(@('F',35),@('R',15),@('UC',100),@('LA',34))) {
  if (@($rows | Where-Object record_type -ceq $kind[0]).Count -ne $kind[1]) {throw 'Original category drift'}
}
$immutable = @($old[0].PSObject.Properties.Name | Where-Object {$_ -notin @('local_result','local_scope','evidence_paths','remaining_scope')})
for ($i=0; $i -lt $rows.Count; $i++) {
  foreach ($field in $immutable) {if ($old[$i].$field -cne $rows[$i].$field) {throw ('Original/native field drift: '+$old[$i].id+'/'+$field)}}
}
if (@($rows | Where-Object native_result -ceq 'BLOCKED').Count -ne 70 -or @($rows | Where-Object native_result -ceq 'NOT_RUN').Count -ne 114) {throw 'Native result drift'}
$auditRoot = (Resolve-Path (Join-Path $folder '..')).Path + [IO.Path]::DirectorySeparatorChar
foreach ($path in ($rows.evidence_paths -split ';' | Where-Object {$_} | Sort-Object -Unique)) {
  $absolute = [IO.Path]::GetFullPath((Join-Path $folder $path))
  if (-not $absolute.StartsWith($auditRoot,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $absolute -PathType Leaf)) {throw ('Missing/outside evidence: '+$path)}
}
foreach ($batch in @(@('native-capture',3),@('reflow-complete',2))) {
  $receipt = Get-Content -Raw -LiteralPath (Join-Path $folder ('receipt-'+$batch[0]+'.json')) | ConvertFrom-Json
  $result = Get-Content -Raw -LiteralPath (Join-Path $folder ('browser/'+$batch[0]+'/results.json')) | ConvertFrom-Json
  if ($receipt.code -ne 0 -or $result.stats.expected -ne $batch[1] -or $result.stats.unexpected -ne 0 -or $result.stats.skipped -ne 0 -or $result.stats.flaky -ne 0) {throw ('Browser result not clean: '+$batch[0])}
}
$factsFiles = @(Get-ChildItem -LiteralPath (Join-Path $folder 'browser/native-capture') -Filter journey-facts.json -File -Recurse)
if ($factsFiles.Count -ne 3) {throw 'Missing browser project facts'}
$checkpoints = 0
$pngCount = 0
foreach ($file in $factsFiles) {
  $facts = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
  if ($facts.project -notin @('full390','desktop100','desktop200')) {throw 'Unexpected browser project'}
  $expected = switch ($facts.project) { 'full390' {@(390,844,1)} 'desktop100' {@(1280,900,1)} 'desktop200' {@(640,450,2)} }
  if ($facts.checkpoints.Count -ne 16 -or $facts.denied.Count -or $facts.pageErrors.Count -or $facts.nativeAuth -or $facts.businessWrites) {throw 'Scope/steps drift'}
  foreach ($point in $facts.checkpoints) {
    $metrics = $point.metrics
    if ($metrics.innerWidth -ne $expected[0] -or $metrics.innerHeight -ne $expected[1] -or $metrics.devicePixelRatio -ne $expected[2] -or
        $point.cssVisualViewport.zoom -ne $expected[2] -or $point.cssVisualViewport.scale -ne 1 -or $metrics.visualScale -ne 1 -or
        $metrics.rootZoom -cne '1' -or $metrics.bodyZoom -cne '1' -or $metrics.rootTransform -cne 'none' -or $metrics.bodyTransform -cne 'none') {throw 'False zoom/viewport evidence'}
    if ($facts.project -ne 'full390' -and ($metrics.outerWidth -ne 1304 -or $metrics.outerHeight -ne 992)) {throw 'Desktop physical window changed'}
    $png = [IO.File]::ReadAllBytes((Join-Path $file.DirectoryName ($point.name+'.png')))
    $pngWidth = [uint32]$png[16]*16777216 + [uint32]$png[17]*65536 + [uint32]$png[18]*256 + $png[19]
    $pngHeight = [uint32]$png[20]*16777216 + [uint32]$png[21]*65536 + [uint32]$png[22]*256 + $png[23]
    if ($pngWidth -ne $expected[0]*$expected[2] -or $pngHeight -ne $expected[1]*$expected[2]) {throw 'Native surface screenshot cropped'}
    $checkpoints++
  }
  $pngCount += @(Get-ChildItem -LiteralPath $file.DirectoryName -Filter '*.png' -File).Count
}
if ($checkpoints -ne 48 -or $pngCount -ne 60) {throw 'Screenshot/checkpoint inventory drift'}
$cleanup = Get-Content -Raw -LiteralPath (Join-Path $folder 'cleanup-final.json') | ConvertFrom-Json
if ($cleanup.listener_count -ne 0 -or $cleanup.matching_owned_browser_processes.Count -or $cleanup.database_clients_created -or $cleanup.database_fixture_created) {throw 'Runtime scope/cleanup drift'}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $folder 'evidence-manifest.json') | ConvertFrom-Json
foreach ($file in $manifest.files) {
  $absolute = [IO.Path]::GetFullPath((Join-Path $folder $file.path))
  if (-not $absolute.StartsWith($folder+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Manifest path escape'}
  if ((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLower() -cne $file.sha256) {throw ('Evidence drift: '+$file.path)}
}
foreach ($prior in (Get-Content -Raw -LiteralPath (Join-Path $folder 'prior-evidence-integrity.json') | ConvertFrom-Json)) {
  $priorFolder = Join-Path $folder ('../'+$prior.run)
  $oldManifest = Get-Content -Raw -LiteralPath (Join-Path $priorFolder 'evidence-manifest.json') | ConvertFrom-Json
  foreach ($file in $oldManifest.files) {
    if ((Get-FileHash -LiteralPath (Join-Path $priorFolder $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256.ToLower()) {throw 'Prior failure/evidence bytes changed'}
  }
}
Write-Output ('VERIFIED source='+$source.source_sha+'; evidence_files='+$manifest.files.Count)
Write-Output 'VERIFIED original_rows=184; native=70_BLOCKED/114_NOT_RUN/0_PASS; NO_GO'
Write-Output 'VERIFIED browser=3+2_PASS; checkpoints=48; native_surface_images=60; actual_page_zoom=1/2'
