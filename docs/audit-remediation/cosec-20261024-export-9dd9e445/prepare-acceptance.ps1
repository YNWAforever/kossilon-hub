$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$rows=@(Import-Csv (Join-Path $folder '../cosec-20261023-clients-d20c646a/acceptance-results.csv'))
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {'../cosec-20261023-clients-d20c646a/'+$_}) -join ';')
  if($row.id -in @('UC157','R17','R23')){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC157 run9dd9e445: actual export command RED for omitted redacted rows and mixed/incomplete saved pages; repaired count-preserving redaction and stable-job fingerprint/total checks. Actual isolated SQL snapshot/preview/execute/worker/getJob/export across103 current payments plus excluded fixture control; two-page CSV readback, HKD unpaid/partial/full totals, unchanged payment/receipt/audit rows, persisted role denial, between-page worker conflict, cancellation and deterministic replay. UI scope-guard repair and final verification status are separately recorded in DELIVERY/release-candidate, never inferred from SQL.'
    $row.evidence_paths+=';UC157.md;readback-summary.json;db/db-export-final.txt;DELIVERY.md'
    $row.remaining_scope+=' | Exact native Admin/Auth/session/HTTP/RLS/browser reload and genuine storage/scanner remain blocked/NOT_RUN. Local source/static/full-suite/resource statuses remain as explicitly recorded in candidate checks; PARTIAL_SCOPED is not a complete original scenario pass.'
  }
}
$rows | Export-Csv (Join-Path $folder 'acceptance-results.csv') -NoTypeInformation -Encoding utf8
Write-Output ('Preserved '+$rows.Count+' original rows; local UC157 scope appended; native unchanged.')
