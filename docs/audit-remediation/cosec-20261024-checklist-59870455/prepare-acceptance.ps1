$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$rows=@(Import-Csv (Join-Path $folder '../cosec-20261024-export-9dd9e445/acceptance-results.csv'))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {'../cosec-20261024-export-9dd9e445/'+$_}) -join ';')
  if($row.id -in @('UC159','F19','R22','R26')){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC159 run59870455: five-item production component with unique names (including duplicate labels), focusable per-row pending guard, linked error/explicit retry, confirmed response and independent-row cache merge. Component first5failed/7passed preserved. Real headless Edge original snapshot3red and repaired3green; five keyboard saves, Tab and fresh-cache reopen via in-memory RPC stub. Separate exact isolated SQL command/readback covers25transitions/25logical retries/7refusals per attempt; no native Auth/RLS/HTTP claim. Actual final tests and source equivalence are in DELIVERY/release-candidate.'
    $row.evidence_paths+=';UC159.md;readback-summary.json;browser-results-red5.json;browser-results-green.json;DELIVERY.md'
    $row.remaining_scope+=' | Native same-version staging, authenticated roles, actual server transport/error serialization, app-role/RLS, true route return/reload, screen-reader and physical device/visual acceptance remain BLOCKED/NOT_RUN; PARTIAL_SCOPED closes no original native gate.'
  }
}
$rows|Export-Csv (Join-Path $folder 'acceptance-results.csv') -NoTypeInformation -Encoding utf8
Write-Output ('Preserved '+$rows.Count+' original/native rows; scoped UC159 evidence appended.')
