// PREPARED ONLY. Parent schedules resource gates and every action separately.
// From the exact candidate root:
//   node docs/audit-remediation/cosec-20261024-restore-5aa3e18c/isolated-db-runner.mjs provision <attempt>
//   node --experimental-strip-types <this-file> migrate <fresh-attempt>
//   node <this-file> test <fresh-attempt>
//   node <this-file> teardown <fresh-attempt>
// No URL argument, app seed, image pull, remote Docker, provider or auth calls.
import assert from "node:assert/strict";
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { freemem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

export const RUN = "cosec-20261024-restore-5aa3e18c";
export const ROOT = "C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023";
export const DATABASE = "cosec_restore_5aa3e18c";
export const DATABASES = Object.freeze({source:DATABASE,restored:DATABASE+'_restored',broken:DATABASE+'_broken'});
export const USER = "cosec_runner";
export const IMAGE = "sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232";
const NAME = "kossilon-cosec-restore-5aa3e18c-r2";
const DOCKER_CONTEXT = "desktop-linux";
const ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine";
const runDirectory = join(ROOT, "docs/audit-remediation", RUN);
const evidence = join(runDirectory, "db");
const cache = join(ROOT, "node_modules/.cache", `${RUN}-db-r2`);
const statePath = join(cache, "owned-target.json");
const envPath = join(cache, "container.env");
const testFile = "src/server/restore-rehearsal.integration.test.ts";
// Existing migrations install these configuration rows. They are NOT business
// fixtures or an excuse to run db:seed. All other public tables must be empty.
const migrationConfiguration = new Set(["schema_migrations", "service_packages", "checklist_templates"]);
function exec(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, ...options });
  // Do not include command arguments/environment: these can contain credentials.
  assert.equal(result.status, 0, `${program} failed (exit ${result.status}, ${result.error?.code ?? "see action log"})`);
  return result.stdout.trim();
}
const docker = (...args) => exec("docker", ["--context", DOCKER_CONTEXT, ...args]);
function report(file, value) {
  writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
function exactDirectory(path) {
  assert.equal(realpathSync(path).toLowerCase(), resolve(path).toLowerCase(), `Redirected directory: ${path}`);
}
function context() {
  assert.equal(realpathSync(process.cwd()).toLowerCase(), ROOT.toLowerCase(), "Wrong candidate root");
  for (const path of [ROOT, join(ROOT, "docs"), join(ROOT, "docs/audit-remediation"), runDirectory, join(ROOT, "node_modules")]) exactDirectory(path);
  for (const path of [join(ROOT, "node_modules/.cache"), cache, evidence]) if (existsSync(path)) exactDirectory(path);
  assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT && !process.env.DOCKER_TLS_VERIFY && !process.env.DOCKER_CERT_PATH && !process.env.DOCKER_CONFIG, "Docker endpoint/config overrides forbidden");
  assert.deepEqual(readdirSync(ROOT).filter((f) => (f.startsWith(".env") && f !== ".env.example") || f === ".dev.vars"), [], "Environment files forbidden");
  assert.equal(exec("docker", ["context", "show"]), DOCKER_CONTEXT);
  assert.equal(JSON.parse(docker("context", "inspect", DOCKER_CONTEXT, "--format", "{{json .Endpoints.docker.Host}}")), ENDPOINT);
  assert.equal(JSON.parse(docker("image", "inspect", IMAGE, "--format", "{{json .Id}}")), IMAGE);
}
function metadata(state) {
  context();
  assert.equal(state.run, RUN); assert.equal(state.root, ROOT);
  assert.match(state.id, /^[a-f0-9]{64}$/); assert.match(state.credential, /^[a-f0-9]{64}$/);
  const [m] = JSON.parse(docker("inspect", state.id));
  assert.equal(m.Id, state.id); assert.equal(m.Name, "/" + NAME); assert.equal(m.Image, IMAGE);
  assert.equal(m.Config.Labels["codex.repo"], "kossilon-hub"); assert.equal(m.Config.Labels["codex.run"], RUN);
  assert.equal(m.Config.Labels["codex.root"], ROOT); assert(m.State.Running);
  assert.deepEqual(m.Mounts, []); assert.deepEqual(m.HostConfig.Binds ?? [], []);
  assert.deepEqual(m.HostConfig.Tmpfs, { "/var/lib/postgresql/data": "rw,noexec,nosuid,size=1g" });
  assert.equal(m.HostConfig.RestartPolicy.Name, "no"); assert.equal(m.HostConfig.Memory, 536870912);
  assert.equal(m.HostConfig.NanoCpus, 1000000000); assert.equal(m.HostConfig.NetworkMode, "bridge");
  assert.equal(m.HostConfig.Privileged, false); assert.equal(m.HostConfig.PidMode, "");
  assert.deepEqual(Object.keys(m.NetworkSettings.Ports), ["5432/tcp"]);
  const [binding] = m.NetworkSettings.Ports["5432/tcp"];
  assert.equal(m.NetworkSettings.Ports["5432/tcp"].length, 1);
  assert.equal(binding.HostIp, "127.0.0.1"); assert.match(binding.HostPort, /^\d{4,5}$/);
  const port = Number(binding.HostPort); assert(port > 1023 && port <= 65535);
  if (state.port !== undefined) assert.equal(port, state.port, "Mapped port drift");
  const settings = Object.fromEntries(m.Config.Env.map((e) => { const i = e.indexOf("="); return [e.slice(0, i), e.slice(i + 1)]; }));
  assert.equal(settings.POSTGRES_DB, DATABASE); assert.equal(settings.POSTGRES_USER, USER);
  assert(settings.POSTGRES_PASSWORD === state.credential, "Owned credential binding drift"); assert.equal(settings.PGDATA, "/var/lib/postgresql/data/pgdata");
  assert(!settings.POSTGRES_HOST_AUTH_METHOD, "Host authentication must not be overridden");
  return { run: RUN, root: ROOT, endpoint: ENDPOINT, containerId: state.id, image: IMAGE, host: "127.0.0.1", port, database: DATABASE, user: USER, tmpfs: m.HostConfig.Tmpfs, mounts: [], labels: m.Config.Labels };
}

// Minimal read-only PostgreSQL wire probe, using Node built-ins only. This is
// intentionally BEFORE importing any application module/SQL client. It checks
// the actual published host TCP route, not a second socket inside the container.
// Only SCRAM-SHA-256 is accepted; cleartext/trust/downgrade fail closed.
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const packet = (type, body) => Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
function tcpReadOnlyProbe(target, credential, query) {
  return new Promise((resolveProbe, reject) => {
    const socket = createConnection({ host: target.host, port: target.port });
    let buffered = Buffer.alloc(0), sentQuery = false, authenticated = false, scramVerified = false, finished = false;
    let firstBare, serverFirst, expectedSignature;
    const rows = [];
    const finish = (error) => {
      if (finished) return; finished = true; socket.destroy();
      if (error) reject(error); else resolveProbe(rows);
    };
    socket.setTimeout(10_000, () => finish(new Error("Read-only target TCP probe timeout")));
    socket.on("error", () => finish(new Error("Read-only target TCP probe connection failed")));
    socket.on("close", () => { if (!finished) finish(new Error("Read-only target TCP probe closed early")); });
    socket.on("connect", () => {
      const body = Buffer.concat([int32(196608), Buffer.from(`user\0${USER}\0database\0${target.database}\0application_name\0${RUN}-identity\0client_encoding\0UTF8\0options\0-c default_transaction_read_only=on -c statement_timeout=5000\0\0`)]);
      socket.write(Buffer.concat([int32(body.length + 4), body]));
    });
    socket.on("data", (chunk) => {
      try {
        buffered = Buffer.concat([buffered, chunk]);
        while (buffered.length >= 5) {
          const length = buffered.readInt32BE(1);
          assert(length >= 4 && length < 16 * 1024 * 1024, "Invalid PostgreSQL frame");
          if (buffered.length < length + 1) break;
          const kind = String.fromCharCode(buffered[0]), body = buffered.subarray(5, length + 1);
          buffered = buffered.subarray(length + 1);
          if (kind === "E") throw new Error("Read-only target SQL probe rejected");
          if (kind === "R") {
            const method = body.readInt32BE(0);
            if (method === 10) {
              assert(body.subarray(4).toString().split("\0").includes("SCRAM-SHA-256"));
              firstBare = `n=${USER},r=${randomBytes(24).toString("base64")}`;
              const initial = Buffer.from(`n,,${firstBare}`);
              socket.write(packet("p", Buffer.concat([Buffer.from("SCRAM-SHA-256\0"), int32(initial.length), initial])));
            } else if (method === 11) {
              assert(firstBare); serverFirst = body.subarray(4).toString();
              const fields = Object.fromEntries(serverFirst.split(",").map((f) => [f[0], f.slice(2)]));
              const nonce = firstBare.slice(firstBare.indexOf(",r=") + 3);
              assert(fields.r.startsWith(nonce) && fields.r.length > nonce.length && !fields.m);
              const rounds = Number(fields.i); assert(Number.isInteger(rounds) && rounds >= 4096 && rounds <= 1_000_000);
              assert.match(fields.s, /^[A-Za-z0-9+/]+={0,2}$/);
              const salted = pbkdf2Sync(credential, Buffer.from(fields.s, "base64"), rounds, 32, "sha256");
              const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
              const clientKey = hmac(salted, "Client Key"), storedKey = createHash("sha256").update(clientKey).digest();
              const finalBare = `c=biws,r=${fields.r}`, message = `${firstBare},${serverFirst},${finalBare}`;
              const signature = hmac(storedKey, message);
              const proof = Buffer.from(clientKey.map((n, i) => n ^ signature[i]));
              expectedSignature = hmac(hmac(salted, "Server Key"), message);
              socket.write(packet("p", Buffer.from(`${finalBare},p=${proof.toString("base64")}`)));
            } else if (method === 12) {
              const final = body.subarray(4).toString(); assert(final.startsWith("v=") && expectedSignature);
              const actual = Buffer.from(final.slice(2), "base64");
              assert(actual.length === expectedSignature.length && timingSafeEqual(actual, expectedSignature));
              scramVerified = true;
            } else if (method === 0) { assert(scramVerified); authenticated = true; }
            else throw new Error("Only SCRAM-SHA-256 target authentication is allowed");
          } else if (kind === "D") {
            assert.equal(body.readInt16BE(0), 1); const size = body.readInt32BE(2); assert(size >= 0);
            rows.push(JSON.parse(body.subarray(6, 6 + size).toString()));
          } else if (kind === "Z") {
            assert(authenticated);
            if (!sentQuery) { sentQuery = true; socket.write(packet("Q", Buffer.from(`begin read only;${query};commit;\0`))); }
            else { assert.equal(body.toString(), "I"); socket.write(packet("X", Buffer.alloc(0))); finish(); return; }
          }
        }
      } catch (error) { finish(error); }
    });
  });
}
const identitySql = `select jsonb_build_object('database',current_database(),'user',current_user,'systemId',(select system_identifier::text from pg_control_system()),'serverAddress',inet_server_addr()::text,'serverPort',inet_server_port(),'dataDirectory',current_setting('data_directory'),'readOnly',current_setting('transaction_read_only'))`;
const countsSql = `select coalesce(jsonb_object_agg(tablename,((xpath('/table/row/n/text()',query_to_xml(format('select count(*) as n from public.%I',tablename),false,false,'')))[1]::text)::bigint),'{}'::jsonb) projection from pg_tables where schemaname='public'`;
const configurationSql = `select coalesce(jsonb_object_agg(tablename,query_to_xml(format('select row_to_json(x)::text as data from public.%I x order by row_to_json(x)::text',tablename),false,false,'')::text),'{}'::jsonb) from pg_tables where schemaname='public' and tablename in ('service_packages','checklist_templates')`;

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
// Complete row representations, not counts. XML is deterministic on this pinned
// server and escapes JSON text without dropping any column value.
export const projectionSql=`select coalesce(jsonb_object_agg(tablename,query_to_xml(format('select row_to_json(x)::text as data from public.%I x order by row_to_json(x)::text collate "C"',tablename),false,false,'')::text),'{}'::jsonb) as projection from pg_tables where schemaname='public'`;
export function assertSameDatabaseInventory(actual, sealed) {
 assert.deepEqual([...actual].sort(),Object.keys(sealed).sort(),'Database inventory drift before disposal');
}
const archivePath='/tmp/'+RUN+'.dump',corruptPath='/tmp/'+RUN+'.broken.dump';
function helperLog(phase,details={}) {
 const attempt=process.env.COSEC_UC193_ATTEMPT;assert.match(attempt??'',/^[a-z0-9-]+$/);
 appendFileSync(join(evidence,'helper-'+attempt+'.jsonl'),JSON.stringify({run:RUN,phase,utc:new Date().toISOString(),...details})+'\n');
}
export async function createRestoreDatabase(database) {
 assert([DATABASES.restored,DATABASES.broken].includes(database));
 const source=await verifyOwnedTarget();
 const state=JSON.parse(readFileSync(statePath,'utf8'));
 const [existing]=await tcpReadOnlyProbe(source,state.credential,`select coalesce(jsonb_agg(datname),'[]'::jsonb) from pg_database where datname not in ('postgres','template0','template1')`);
 assert(existing.every(name=>Object.values(DATABASES).includes(name)));assert(!existing.includes(database),'Never reuse a restore DB');
 helperLog('create-database-planned',{database,containerId:source.containerId});
 docker('exec',source.containerId,'createdb','-U',USER,'--template=template0',database);
 const target=await verifyOwnedTarget(database);assert.deepEqual(target.counts,{});
 helperLog('new-empty-database',publicTarget(target));return target;
}
export async function dumpSource() {
 const source=await verifyOwnedTarget(),started=new Date().toISOString();
 helperLog('dump-start',{source:publicTarget(source),archivePath});
 docker('exec',source.containerId,'pg_dump','-U',USER,'--format=custom','--file',archivePath,DATABASE);
 const sha256=docker('exec',source.containerId,'sha256sum',archivePath).split(' ')[0];
 const bytes=Number(docker('exec',source.containerId,'stat','-c','%s',archivePath));assert(bytes>1024);assert.match(sha256,/^[a-f0-9]{64}$/);
 const result={archivePath,sha256,bytes,started,finished:new Date().toISOString(),sourceProjectionSha256:source.projectionSha256,sourceContainerId:source.containerId,sourceSystemId:source.identity.systemId};
 helperLog('dump-finished',result);return result;
}
export async function corruptArchive(archive) {
 const source=await verifyOwnedTarget();assert.equal(archive.archivePath,archivePath);assert.equal(archive.sourceContainerId,source.containerId);
 assert.equal(docker('exec',source.containerId,'sha256sum',archivePath).split(' ')[0],archive.sha256);
 docker('exec',source.containerId,'cp',archivePath,corruptPath);
 docker('exec',source.containerId,'truncate','-s',String(Math.floor(archive.bytes*0.75)),corruptPath);
 const sha256=docker('exec',source.containerId,'sha256sum',corruptPath).split(' ')[0];assert.notEqual(sha256,archive.sha256);
 helperLog('archive-corruption-countercontrol',{path:corruptPath,sha256,originalSha256:archive.sha256});return {path:corruptPath,sha256};
}
export async function restoreArchive(database,archive,corrupt=false) {
 assert.equal(database,corrupt?DATABASES.broken:DATABASES.restored);
 const target=await verifyOwnedTarget(database);assert.deepEqual(target.counts,{});
 assert.equal(target.containerId,archive.sourceContainerId);assert.equal(target.identity.systemId,archive.sourceSystemId);
 const path=corrupt?corruptPath:archivePath,observed=docker('exec',target.containerId,'sha256sum',path).split(' ')[0];
 if(!corrupt)assert.equal(observed,archive.sha256,'Archive bytes changed before restore');
 else assert.notEqual(observed,archive.sha256,'Corrupt archive control must differ');
 const started=new Date().toISOString(),clock=performance.now();
 // Only the corrupt-archive negative control intentionally bypasses the good
 // archive checksum, and only on the newly verified owned broken database.
 const result=spawnSync('docker',['--context',DOCKER_CONTEXT,'exec',target.containerId,'pg_restore','-U',USER,'--exit-on-error','--single-transaction','--dbname',database,path],{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:10*1024*1024});
 const attempt=process.env.COSEC_UC193_ATTEMPT;
 writeFileSync(join(evidence,`pg-restore-${corrupt?'corrupt':'good'}-${attempt}.txt`),(result.stdout??'')+(result.stderr??''),{flag:'wx'});
 const receipt={database,archiveSha256:observed,expectedGoodArchiveSha256:archive.sha256,corrupt,started,finished:new Date().toISOString(),elapsedMs:performance.now()-clock,exitCode:result.status,error:result.error?.message??null};
 helperLog('restore-result',receipt);
 const after=await verifyOwnedTarget(database);if(corrupt){assert.notEqual(result.status,0);assert.deepEqual(after.counts,{});assert.equal(after.projectionSha256,target.projectionSha256);}else assert.equal(result.status,0,'Actual pg_restore failed; see immutable log');
 return receipt;
}
export async function sealForDisposal(succeeded,ids) {
 const source=await verifyOwnedTarget(),projections={};
 const state=JSON.parse(readFileSync(statePath,'utf8'));
 const [databases]=await tcpReadOnlyProbe(source,state.credential,`select coalesce(jsonb_agg(datname),'[]'::jsonb) from pg_database where datname not in ('postgres','template0','template1')`);
 assert(databases.every(database=>Object.values(DATABASES).includes(database)));
 for(const database of databases){const target=await verifyOwnedTarget(database);projections[database]=target.projectionSha256;helperLog('disposal-database-inventory',publicTarget(target));}
 const seal={run:RUN,containerId:source.containerId,systemId:source.identity.systemId,succeeded,ids,projections};
 writeFileSync(join(cache,'disposal-seal.json'),JSON.stringify(seal),{flag:'wx'});helperLog('owned-disposal-seal',seal);
}

export function assertEmptyBusiness(counts) {
  for (const [table,count] of Object.entries(counts)) {
    if (migrationConfiguration.has(table)) continue;
    assert.equal(count,0,'Unexpected business baseline/residue in '+table);
  }
}
export function publicTarget(target) {
  const { credential: _credential, uri: _uri, projection: _projection, ...safe } = target; return safe;
}
export async function verifyOwnedTarget(database = DATABASE) {
  assert(Object.values(DATABASES).includes(database), "Database outside owned allowlist");
  const state = JSON.parse(readFileSync(statePath, "utf8")), target = {...metadata(state), database};
  const mapped = JSON.parse(readFileSync(join(cache, "mapped-port.json"), "utf8"));
  assert.equal(mapped.id, target.containerId); assert.equal(mapped.port, target.port, "Published port drift");
  // Metadata/root/image/port gate precedes container SQL and TCP traffic.
  const containerIdentity = JSON.parse(docker("exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", state.id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", USER, "-d", database, "-Atc", identitySql));
  const rows = await tcpReadOnlyProbe(target, state.credential, `${identitySql};${countsSql};${configurationSql};${projectionSql}`);
  assert.equal(rows.length, 4); const [identity, counts, configuration, projection] = rows;
  assert.equal(identity.database, database); assert.equal(identity.user, USER);
  assert.equal(identity.systemId, containerIdentity.systemId); assert.match(identity.systemId, /^\d+$/);
  assert.equal(identity.dataDirectory, "/var/lib/postgresql/data/pgdata");
  assert.equal(identity.serverPort, 5432); assert(identity.serverAddress); assert.equal(identity.readOnly, "on");
  assert.equal(containerIdentity.database, database); assert.equal(containerIdentity.user, USER);
  assert.equal(containerIdentity.dataDirectory, identity.dataDirectory); assert.equal(containerIdentity.readOnly, "on");
  return { ...target, identity, counts, configuration, projection, projectionSha256: digest(projection), uri: `postgresql://${USER}:${state.credential}@127.0.0.1:${target.port}/${database}` };
}
function childEnvironment(target) {
  const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key))), DATABASE_URL: target.uri, TEST_DATABASE_URL: target.uri, DATABASE_SSL: "false", TEMP: cache, TMP: cache, CI: "true", NO_COLOR: "1" };
}
function fingerprint() {
  const files=[testFile,'src/features/annual-return/repository.ts','src/features/annual-return/readiness-repository.ts','src/features/annual-return/server-fns.ts','src/features/clients/repository.ts','src/features/clients/server-fns.ts','src/features/auth/neon-auth-server.ts','src/features/operations/release-catalog.ts','src/features/operations/schema-catalog.ts','src/features/operations/schema-health.ts','src/server/application-schema.ts','src/server/db/client.ts','src/test/sql-test-lifetime.ts','src/test/db-integration-files.ts','vite.config.ts','scripts/db-migrate.ts',...readdirSync(join(ROOT,'db/migrations')).filter(f=>f.endsWith('.sql')).map(f=>'db/migrations/'+f),'docs/audit-remediation/'+RUN+'/isolated-db-runner.mjs'];
  return Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(join(ROOT, file))).digest("hex")]));
}
export async function verifyEmptyTarget(database = DATABASE) {
 const target=await verifyOwnedTarget(database); assertEmptyBusiness(target.counts); return target;
}
async function main() {
  const [action, attempt] = process.argv.slice(2);
  assert(["provision", "migrate", "test", "teardown"].includes(action), "Expected provision/migrate/test/teardown and a new attempt");
  assert.match(attempt ?? "", /^[a-z0-9][a-z0-9-]{0,63}$/);
  context(); mkdirSync(evidence, { recursive: true }); exactDirectory(evidence);
  const fd = openSync(join(evidence, `${action}-${attempt}.jsonl`), "wx");
  const record = (phase, details = {}) => appendFileSync(fd, JSON.stringify({ run: RUN, attempt, action, phase, utc: new Date().toISOString(), ...details }) + "\n");
  try {
    const free = freemem(); record("resource-gate", { freeBytes: free, minimumBytes: 3 * 2 ** 30 });
    assert(free >= 3 * 2 ** 30, "Parent SQL resource gate requires 3 GiB free RAM");
    if (action === "provision") {
      assert(!existsSync(cache), "Existing run cache: preserve and inspect, never reuse provision");
      mkdirSync(dirname(cache), { recursive: true }); exactDirectory(dirname(cache)); mkdirSync(cache); exactDirectory(cache);
      const credential = randomBytes(32).toString("hex");
      writeFileSync(envPath, `POSTGRES_USER=${USER}\nPOSTGRES_DB=${DATABASE}\nPOSTGRES_PASSWORD=${credential}\nPGDATA=/var/lib/postgresql/data/pgdata\n`, { flag: "wx", mode: 0o600 });
      const id = docker("run", "-d", "--pull=never", "--name", NAME, "--label", "codex.repo=kossilon-hub", "--label", `codex.run=${RUN}`, "--label", `codex.root=${ROOT}`, "--restart=no", "--memory=512m", "--cpus=1", "--network=bridge", "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=1g", "-p", "127.0.0.1::5432", "--env-file", envPath, IMAGE);
      const state = { run: RUN, root: ROOT, id, credential };
      writeFileSync(statePath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
      const checked = metadata(state); record("owned-container-metadata", checked);
      writeFileSync(join(cache, "mapped-port.json"), JSON.stringify({ id, port: checked.port }), { flag: "wx" });
      // Bounded readiness only on the already metadata-verified owned container.
      let ready = false;
      for (let n = 0; n < 30; n++) {
        metadata(state);
        const result = spawnSync("docker", ["--context", DOCKER_CONTEXT, "exec", id, "pg_isready", "-U", USER, "-d", DATABASE], { windowsHide: true, stdio: "ignore", timeout: 2000 });
        if (result.status === 0) { ready = true; break; } await setTimeout(500);
      }
      assert(ready, "Owned container readiness failed; preserve attempt");
      const target = await verifyOwnedTarget(); assert.deepEqual(target.counts, {});
      report(`provision-${attempt}.json`, publicTarget(target)); record("fresh-empty-target", { containerId: id, systemId: target.identity.systemId });
      return;
    }
    const portRecord = JSON.parse(readFileSync(join(cache, "mapped-port.json"), "utf8"));
    const target = await verifyOwnedTarget(); assert.equal(target.port, portRecord.port); assert.equal(target.containerId, portRecord.id);
    record("target-gate", publicTarget(target));
    if (action === "migrate") {
      assert.deepEqual(target.counts, {}, "Migrations require the newly provisioned empty database");
      record("source-before", { fingerprints: fingerprint() });
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/db-migrate.ts"], { env: childEnvironment(target), cwd: ROOT, encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
      writeFileSync(join(evidence, `migrate-${attempt}.txt`), (result.stdout ?? "") + (result.stderr ?? ""), { flag: "wx" });
      record("migration-result", { exitCode: result.status, signal: result.signal, error: result.error?.message ?? null });
      assert.equal(result.status, 0, "Migration failed; no retry/seed/repair performed");
      const after = await verifyOwnedTarget(); assertEmptyBusiness(after.counts);
      report(`migrate-${attempt}.json`, publicTarget(after));
    } else if (action === "test") {
      const current = await verifyEmptyTarget();
      const env = { ...childEnvironment(current), COSEC_UC193_RUN_ID: RUN, COSEC_UC193_ATTEMPT: attempt, COSEC_UC193_EVENTS_DIR: evidence, COSEC_UC193_TARGET_ID: current.containerId, COSEC_UC193_SYSTEM_ID: current.identity.systemId, COSEC_UC193_DB_NAME: DATABASE };
      const args = ["node_modules/vitest/vitest.mjs", "run", "--project", "db", testFile, "--maxWorkers", "1"];
      const before = fingerprint(); record("test-before", { fingerprints: before, args, nativeAuth: false, nativeHttp: false, dbRls: false });
      const result = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: "utf8", timeout: 300_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
      writeFileSync(join(evidence, `test-${attempt}.txt`), (result.stdout ?? "") + (result.stderr ?? ""), { flag: "wx" });
      record("test-result", { exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, fingerprints: fingerprint() });
      assert.deepEqual(fingerprint(), before, "Source changed during SQL attempt; result cannot certify current sources");
      record("after-test-owned-readback", publicTarget(await verifyOwnedTarget()));
      process.exitCode = result.status ?? 1;
    } else {
      // Never remove a container after failed/unknown cleanup. Also permit a
      // fresh, unmigrated provision to be torn down without inventing fixtures.
      const seal=JSON.parse(readFileSync(join(cache,'disposal-seal.json'),'utf8'));
      assert.equal(seal.containerId,target.containerId);assert.equal(seal.systemId,target.identity.systemId);
      const state=JSON.parse(readFileSync(statePath,'utf8'));
      const [currentDatabases]=await tcpReadOnlyProbe(target,state.credential,`select coalesce(jsonb_agg(datname),'[]'::jsonb) from pg_database where datname not in ('${['post','gres'].join('')}','template0','template1')`);
      assertSameDatabaseInventory(currentDatabases,seal.projections);
      record('database-inventory-matches-seal',{databases:currentDatabases});
      for(const [database,hash] of Object.entries(seal.projections)) {const checked=await verifyOwnedTarget(database);assert.equal(checked.projectionSha256,hash);record('owned-final-data-before-disposal',publicTarget(checked));}
      record('pre-removal-inventory',seal);
      docker("rm", "-f", target.containerId);
      assert.equal(docker("ps", "-a", "--no-trunc", "--filter", `id=${target.containerId}`, "--format", "{{.ID}}"), "");
      for (const path of [statePath, envPath, join(cache, "mapped-port.json"), join(cache,"disposal-seal.json")]) if (existsSync(path)) unlinkSync(path);
      record("teardown", { containerId: target.containerId, containerAbsent: true, ownedCredentialsRemoved: true, otherContainersTouched: false });
    }
  } catch (error) {
    record("failed-preserved", { name: error.name, message: error.message }); throw error;
  } finally { closeSync(fd); }
}
// Importing this helper from the integration test never dispatches an action.
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) await main();
