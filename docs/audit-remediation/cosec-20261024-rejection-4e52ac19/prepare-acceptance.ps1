$ErrorActionPreference='Stop'
$previous='../cosec-20261024-routes-e4b761c9/'
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($rows.Count -ne 184){throw 'Original row count drift'}
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';' | Where-Object {$_} | ForEach-Object {$previous+$_}) -join ';')
  if($row.id -eq 'UC149'){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | UC149 4e52ac19: current-version rejection instruction projection and Client UI; explicit known-precommit upload retry refetches document and requirement state; in-flight duplicate submission guard. Local component/repository and isolated PostgreSQL independent-observer readback preserve original review and pending replacement, reject membership/scope/version violations. Actual local browser transport and failure evidence in UC149.md/DELIVERY.md; no native Auth/storage/scanner equivalence.'
    $row.evidence_paths+=';UC149.md;DELIVERY.md;release-candidate.json;source-candidate.json;db/db-rejection-green.txt;db/db-cleanup.json'
    $row.remaining_scope+=' | Same-version native Reviewer+Client Auth, server-function HTTP, provider bytes/storage/scanner, DB/RLS and persisted browser reload remain BLOCKED/NOT_RUN. SQL scan result is a controlled local stub; checklist rejection setup is fixture state, not full evidence-service/SLA acceptance. Lost-response/ambiguous commit retry and resumable upload belong to UC150 and remain open.'
  }
}
$rows|Export-Csv -LiteralPath $out -NoTypeInformation -Encoding utf8
Write-Output 'Preserved 184 original/native rows; appended UC149 local scope only.'
