$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$prior=Join-Path $folder '../cosec-20261023-assignment-86b2aa9a/acceptance-results.csv'
$rows=@(Import-Csv -LiteralPath $prior)
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';' | Where-Object {$_} | ForEach-Object {'../cosec-20261023-assignment-86b2aa9a/'+$_}) -join ';')
  if($row.id -in @('UC155','R17','R23')){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC155 run21be5584: six opposite-decision SQL scenarios, approval-first and return-first across empty/full and prior-partial/full/open amounts; distinct observer/winner/loser sessions with pg_blocking_pids; real actor-handler 409/version_conflict Responses; persisted amount/date/proof/actor/reasons/audit/timeline, stale and fresh-token retries invariant. Persisted unassigned staff denied. Local scanner contract stub only; no native Auth/HTTP/RLS/browser reload.'
    $row.evidence_paths+=';UC155.md;readback-summary.json;db/db-payment-accepted.txt;DELIVERY.md'
    $row.remaining_scope+=' | UC155 local SQL conflict/amount/audit slice verified. Native same-version identities, HTTP/session/RLS, two browsers and browser reload, genuine storage/scanner remain unexecuted and blocked by missing approved native target. Original finding_ids/native columns preserved.'
  }
}
$rows | Export-Csv -LiteralPath (Join-Path $folder 'acceptance-results.csv') -NoTypeInformation -Encoding utf8
Write-Output ('Preserved '+$rows.Count+' original rows; appended local scope only for UC155, R17 and R23.')
