$ErrorActionPreference='Stop'
$previous='../cosec-20261024-handover-657a8815/'
$old=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
$rows=@(Import-Csv (Join-Path $PSScriptRoot ($previous+'acceptance-results.csv')))
if($rows.Count -ne 184){throw 'Original row count drift'}
foreach($r in $rows){
  $r.evidence_paths=(($r.evidence_paths -split ';'|Where-Object {$_}|ForEach-Object {$previous+$_}) -join ';')
  if($r.id -eq 'UC186'){
    $r.local_result='PARTIAL_SCOPED'
    $r.local_scope+=' | 1fb9822e: actual focus RED=2failed/13passed (missing lawful handover command UI; null-required-skill rejects eligible colleague). Four-file prerequisite fix makes no-skill work eligible via nullable type/ranker/SQL LEFT JOIN; exact required active skills, role/team/profile, empty-key guard and duty separation retained. Final related unit/component36passed/8files includes assignment8; typecheck/lint exit0. Pure unit/mock only; SQL path NOT_RUN. Full handover UI RED retained verbatim outside active suite as pending oracle; no expectation weakened or native result upgraded.'
    $r.remaining_scope+=' | 1fb9822e: FULL UC186 STILL INCOMPLETE. No lawful cross-business parent/work handover command, idempotent operation/retry receipt or positive audit/readback yet. New-case/assignment-versus-disable probe NOT_RUN: four actual pre-provision RAM refusals (<3GiB), zero target/client/fixture/migration. Build NOT_RUN_RESOURCE (2163892224bytes <3GiB); full unit NOT_RUN. SQL recommendation path, role denial/retry/audit/readback and both lock orders still need exact isolated target. Native Auth/HTTP/RLS/browser and employee daily-use gates remain BLOCKED/NO_GO.'
    $r.evidence_paths+=';PLAN.md;DELIVERY.md;COVERAGE.md;blockers.md;NATIVE-PLAN.md;release-candidate.json;source-candidate.json;focus-red.txt;assignment-green.txt;targeted-accepted.txt;typecheck-accepted.json;lint-accepted.json;resource-checks.jsonl;pending-test-status.json;handover-ui-red.test.tsx.snapshot;handover-execution.test.ts.snapshot;db/provision-red.jsonl;db/provision-red-ready.jsonl;db/provision-red-ready2.jsonl;db/provision-red-headroom-restored.jsonl;owned-inventory.json;review.json'
  }
}
$immutable=@('record_type','id','title','historical_result','related_finding_ids','related_task_ids','related_uc_ids','related_la_ids','native_result','source_file','original_row_json')
for($i=0;$i -lt 184;$i++){
  $null=$old[$i].original_row_json|ConvertFrom-Json
  foreach($k in $immutable){if($rows[$i].$k -cne $old[$i].$k){throw ('Original field changed '+$old[$i].id+' '+$k)}}
  if($rows[$i].id -ne 'UC186'){foreach($k in @('local_result','local_scope','remaining_scope')){if($rows[$i].$k -cne $old[$i].$k){throw ('Unrelated scope changed '+$old[$i].id)}}}
}
$counts=@($rows|Group-Object record_type|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
$native=@($rows|Group-Object native_result|ForEach-Object {$_.Name+':'+$_.Count}|Sort-Object)
if(($counts -join '|') -ne 'F:35|LA:34|R:15|UC:100' -or ($native -join '|') -ne 'BLOCKED:70|NOT_RUN:114'){throw 'Matrix drift'}
$out=Join-Path $PSScriptRoot 'acceptance-results.csv'
if(Test-Path -LiteralPath $out){throw 'Prior CSV exists'}
$rows|Export-Csv -LiteralPath $out -NoTypeInformation -Encoding utf8
[ordered]@{original_rows=184;original_json_rows_parsed=184;counts=$counts;native=$native;native_pass=0;local_appended_only='UC186';layers_preserved=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'acceptance-verification.json') -Encoding utf8
Write-Output '184 original records parsed/preserved; UC186 prerequisite-only partial result; native unchanged.'
