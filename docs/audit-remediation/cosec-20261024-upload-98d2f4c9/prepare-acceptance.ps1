$ErrorActionPreference='Stop'
$previous='../cosec-20261024-rejection-4e52ac19/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($rows.Count -ne 184){throw 'Original row count drift'}
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC150'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC150 98d2f4c9: lost CREATE/FINALIZE response after real SQL commit, stable actor-bound request identity and current-version readback; same request concurrent create/finalize dedupes document/version/scan/analysis/checklist receipt. Near-10MiB PDF bytes checked. Actor/case/company session journal survives reload/reselection without storing bytes; mismatch/persistence-error/expiry/cancel/refusal covered. Browser RPC/memory storage and injected SQL Auth are local-only. See UC150.md/DELIVERY for actual results and preserved failures.'
    $row.evidence_paths+=';UC150.md;DELIVERY.md;release-candidate.json;source-candidate.json;db/db-upload-green2.txt;db/db-cleanup.json'
    $row.remaining_scope+=' | Native same-version Auth/server-function HTTP/DB-RLS/R2/scanner/persisted browser reload remain BLOCKED. This is full-file retry/resolution, not byte-offset/multipart resume. Independent tabs with independent new request IDs remain additive; simultaneous initial identical PUTs may repeat, while committed sequential replay does not PUT or recreate receipts. No claim of clean/approved/production readiness.'
  }
}
$rows|Export-Csv -LiteralPath $out -NoTypeInformation -Encoding utf8
Write-Output 'Preserved 184 original/native rows; appended UC150 local scope only.'
