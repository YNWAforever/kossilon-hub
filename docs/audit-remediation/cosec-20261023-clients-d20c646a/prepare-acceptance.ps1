$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$rows=@(Import-Csv (Join-Path $folder '../cosec-20261023-payment-21be5584/acceptance-results.csv'))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {'../cosec-20261023-payment-21be5584/'+$_}) -join ';')
  if($row.id -in @('UC135','UC136','UC137','F19','R22','R23')){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC135-137 rund20c646a: actual whitespace-required-field SQL RED before schema repair; same in-process creation command, ten disposable SQL cases for refusal/correction/unique replay/normalized CR and BR concurrency/late contact rollback/complete certificate normalization and independent readback. Component focus/associated messages/input preservation/pending guard/cancel/reopen/error recovery measured separately in sidecar evidence; Auth/RPC mocked there. Native Auth/HTTP/RLS/browser reload not run.'
    $row.evidence_paths+=';coverage-baseline.md;UC135-137.md;readback-summary.json;db/db-clients-green.txt;DELIVERY.md'
    $row.remaining_scope+=' | Local creation/duplicate/BR slice only. Same-version native Admin/Staff/Manager identities, session/HTTP error serialization, app-role/RLS, browser return/reload and complete original scenario matrices remain unexecuted and blocked by missing approved native target. Original relations and historical/native columns preserved.'
  }
}
$rows | Export-Csv (Join-Path $folder 'acceptance-results.csv') -NoTypeInformation -Encoding utf8
Write-Output ('Preserved '+$rows.Count+' original rows; local evidence appended without changing original relations or native status.')
