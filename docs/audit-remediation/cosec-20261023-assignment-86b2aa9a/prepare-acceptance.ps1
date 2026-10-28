$ErrorActionPreference='Stop'
$folder=$PSScriptRoot
$prior=Join-Path $folder '../cosec-20261023-r22-fe4a5635/acceptance-results.csv'
$rows=@(Import-Csv -LiteralPath $prior)
foreach($row in $rows){
  $row.evidence_paths=(($row.evidence_paths -split ';' | Where-Object {$_} | ForEach-Object {'../cosec-20261023-r22-fe4a5635/'+$_}) -join ';')
  if($row.id -in @('UC130','UC131','R23')){
    $row.local_result='PARTIAL_SCOPED'
    $row.local_scope+=' | Assignment run86b2aa9a: real in-process work assignment handlers and new disposable SQL, six scenarios (owner/reviewer conflicts; users/profile/both/skill stale eligibility), independent connection and pg_blocking_pids evidence, old-version replay denied, exact versions/actors/audit/readback and explicit fresh confirmation. Thirty mocked-boundary component cases cover reread/reselection/input preservation/unknown result/duplicate/cancel/actor changes. Native Auth/HTTP/RLS/browser not executed.'
    $row.evidence_paths+=';UC130-UC131.md;readback-summary.json;db/db-assignment-expanded.txt;sidecar-report.md;DELIVERY.md'
    $row.remaining_scope+=' | Local UC130/UC131 assignment slice now verified; original full same-version staging role/session/HTTP/browser reload remains unexecuted. Native status unchanged; no production acceptance.'
  }
}
$rows | Export-Csv -LiteralPath (Join-Path $folder 'acceptance-results.csv') -NoTypeInformation -Encoding utf8
$integrity=@()
foreach($run in @('cosec-20261023-79d324f0','cosec-20261023-cont-d55d8d7e','cosec-20261023-xlsx-db68ab95','cosec-20261023-r22-fe4a5635')){
  $base=Join-Path $folder ('../'+$run)
  $manifest=Get-Content -LiteralPath (Join-Path $base 'evidence-manifest.json') -Raw | ConvertFrom-Json
  foreach($file in $manifest.files){
    if((Get-FileHash -LiteralPath (Join-Path $base $file.path) -Algorithm SHA256).Hash.ToLower() -cne $file.sha256.ToLower()){throw ('Prior evidence changed: '+$run+'/'+$file.path)}
  }
  $integrity += [ordered]@{run=$run;entries=$manifest.files.Count;unchanged=$true}
}
$integrity | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $folder 'prior-evidence-integrity.json')
Write-Output ('Preserved '+$rows.Count+' original rows; original/native columns unchanged; four prior evidence sets unchanged.')
