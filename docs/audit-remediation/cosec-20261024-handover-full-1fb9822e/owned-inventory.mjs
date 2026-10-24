// Read-only Docker metadata and owned cache inventory; never connects to a DB.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),run='cosec-20261024-handover-full-1fb9822e';
assert.equal(realpathSync(process.cwd()),'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
assert.equal(process.cwd(),root);
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30_000}).trim();
assert.equal(docker('context','show'),'desktop-linux');
assert.equal(JSON.parse(docker('--context','desktop-linux','context','inspect','desktop-linux','--format','{{json .Endpoints.docker.Host}}')),'npipe:////./pipe/dockerDesktopLinuxEngine');
const result=docker('--context','desktop-linux','ps','--all','--no-trunc','--filter','label=codex.run='+run,'--format','{{json .}}');
const matches=result?result.split(/\r?\n/).map(JSON.parse):[];
assert.deepEqual(matches,[],'Unexpected owned resource: preserve and inspect, never delete');
const cache=join(root,'node_modules/.cache',run+'-db-red');
assert(!existsSync(cache),'Unexpected owned DB state; do not read credentials or remove');
writeFileSync(join(import.meta.dirname,'owned-inventory.json'),JSON.stringify({checked_utc:new Date().toISOString(),run,root,docker_context:'desktop-linux',endpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',matching_containers:matches,cache_exists:false,db_clients_created:0,fixtures_created:0,cleanup_required:false,operation:'read-only exact run-label inventory; no resources stopped or removed'},null,2)+'\n',{flag:'wx'});
console.log('No owned SQL resource/cache: all attempts stopped before provision. No cleanup performed.');
