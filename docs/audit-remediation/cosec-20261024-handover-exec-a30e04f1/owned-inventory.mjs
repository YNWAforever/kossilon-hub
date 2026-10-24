import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),run='cosec-20261024-handover-exec-a30e04f1';assert.equal(realpathSync(process.cwd()),root);
const docker=(...a)=>execFileSync('docker',a,{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
assert.equal(docker('context','show'),'desktop-linux');assert.equal(JSON.parse(docker('--context','desktop-linux','context','inspect','desktop-linux','--format','{{json .Endpoints.docker.Host}}')),'npipe:////./pipe/dockerDesktopLinuxEngine');
const found=docker('--context','desktop-linux','ps','--all','--no-trunc','--filter','label=codex.run='+run,'--format','{{json .}}');assert.equal(found,'','Owned resource remains; preserve and inspect');
const credentials=[];for(const slot of ['red','green','green-r2','green-r3','green-r4'])for(const name of ['owned-target.json','container.env','mapped-port.json','disposal-seal.json','migration-provenance.json']){const path=join(root,'node_modules/.cache',run+'-db-'+slot,name);if(existsSync(path))credentials.push(path);}
assert.deepEqual(credentials,[]);
writeFileSync(join(import.meta.dirname,'owned-inventory.json'),JSON.stringify({checked_utc:new Date().toISOString(),root,run,matching_containers:[],remaining_owned_state_or_credential_files:[],operation:'read-only exact run inventory; no resources stopped or removed'},null,2)+'\n',{flag:'wx'});console.log('Owned run containers0; credentials/state files0.');
