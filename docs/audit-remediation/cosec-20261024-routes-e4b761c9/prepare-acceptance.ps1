$ErrorActionPreference='Stop'
$previous='../cosec-20261024-checklist-59870455/'
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($rows.Count -ne 184){throw 'Original row count drift'}
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';' | Where-Object {$_} | ForEach-Object {$previous+$_}) -join ';')
  if($row.id -in @('UC160','F19','R15','R22','R26')){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC160 e4b761c9: production incorporation/corporate-change route pairs tested with real TanStack router/history; existing 43e2b97 Outlet fix retained. List -> detail -> Back/Forward, URL/context, direct/copied/reloaded detail and fresh stub transport readback, missing/malformed/denied/error retry, pending departure and empty list. Actual results and retained harness failures in UC160.md and DELIVERY.md. No native Auth/HTTP/DB acceptance.'
    $row.evidence_paths+=';UC160.md;DELIVERY.md;release-candidate.json;source-candidate.json'
    $row.remaining_scope+=' | UC160 native same-version staging, real Staff A/B Auth, server-function transport, DB/RLS and persisted business record readback remain BLOCKED/NOT_RUN. Local 合成 routing evidence does not close the original native gate; LA33 relation retained without claiming settings usage acceptance.'
  }
}
$rows | Export-Csv (Join-Path $PSScriptRoot 'acceptance-results.csv') -NoTypeInformation -Encoding utf8
Write-Output ('Preserved '+$rows.Count+' original/native rows; UC160 local scope appended.')
