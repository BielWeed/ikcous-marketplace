// Isolated contract proof. No network clients, env files or DATABASE_URL.
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const container = 'ikcous-identidade-sql-corrigido-20260909';
const bootstrapContainer = 'ikcous-identidade-sql-20260909';
const mode = process.argv[2];
assert(['red', 'green'].includes(mode), 'Usage: node tests/identity-database/run.cjs red|green');
const startedAt = new Date().toISOString();
const root = join(__dirname, '../..');
const read = name => readFileSync(join(__dirname, name), 'utf8');
function docker(args, input, target = container, streaming = false) {
  assert([container, bootstrapContainer].includes(target));
  if (target === bootstrapContainer) assert.deepEqual(args, ['exec', '--env', 'PGPASSWORD=postgres', bootstrapContainer,
    'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-privileges', '--schema=auth', '--schema=storage']);
  const inspect = spawnSync('docker', ['inspect', target], { encoding: 'utf8', timeout: 15000 });
  assert.equal(inspect.status, 0, 'Local container must exist');
  const state = JSON.parse(inspect.stdout)[0];
  assert.equal(state.Name, '/' + target);
  assert.equal(state.HostConfig.NetworkMode, 'none');
  assert.deepEqual(state.HostConfig.PortBindings, {});
  assert.equal(state.State.Running, true);
  if (streaming) {
    assert.equal(target, container);
    return spawn('docker', args, { timeout: 60000, windowsHide: true });
  }
  return spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 2 ** 22, windowsHide: true });
}
function sql(db, source, expectedError) {
  assert(db === 'postgres' || /^identity_a2_[a-z0-9_]+$/.test(db));
  if (db === 'postgres') assert(/^CREATE DATABASE identity_a2_[a-z0-9_]+ TEMPLATE template0;$/.test(source));
  const result = docker(['exec', '-i', '--env', 'PGPASSWORD=postgres', container,
    'psql', '-U', 'postgres', '-d', db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], source);
  if (expectedError) {
    assert.notEqual(result.status, 0, 'Expected SQL failure');
    assert.match(result.stderr, expectedError);
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout.trim();
}
const installedSupautils = docker(['exec', container, 'cat', '/nix/store/76dh4rsb843criisb67jp5z1xcm9bxza-supautils.drv']);
assert.equal(installedSupautils.status, 0, 'Expected official image derivation must exist');
assert.match(installedSupautils.stdout, /\("version","3\.2\.3"\)/);
console.log('ENV official 17.6.1.153; installed supautils 3.2.3; network none; ports {}');
const bootstrapResult = docker(['exec', '--env', 'PGPASSWORD=postgres', bootstrapContainer,
  'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-privileges', '--schema=auth', '--schema=storage'], undefined, bootstrapContainer);
assert.equal(bootstrapResult.status, 0, 'Local schema-only bootstrap failed');
const bootstrap = bootstrapResult.stdout;
assert(!/^(?:COPY\s+[^\n]+\s+FROM\s+stdin|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|ALTER\s+ROLE|CREATE\s+ROLE)/im.test(bootstrap), 'Bootstrap must contain schema only, no data or roles');
console.log('BOOTSTRAP schema-only local PG17 SHA256=' + createHash('sha256').update(bootstrap).digest('hex'));
const lit = value => "'" + String(value).replaceAll("'", "''") + "'";
const snapshot = `SELECT jsonb_build_object(
 'rpc_acl',(SELECT proacl FROM pg_proc WHERE oid='public.upsert_store_config(jsonb)'::regprocedure),
 'rpc_owner',(SELECT proowner FROM pg_proc WHERE oid='public.upsert_store_config(jsonb)'::regprocedure),
 'view_acl',(SELECT relacl FROM pg_class WHERE oid='public.v_store_config'::regclass),
 'view_owner',(SELECT relowner FROM pg_class WHERE oid='public.v_store_config'::regclass),
 'view_options',(SELECT reloptions FROM pg_class WHERE oid='public.v_store_config'::regclass),
 'columns',(SELECT jsonb_agg(jsonb_build_array(attname,atttypid,attacl) ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.v_store_config'::regclass AND attnum BETWEEN 1 AND 26),
 'storage_acl',(SELECT relacl FROM pg_class WHERE oid='storage.objects'::regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='storage' AND policyname NOT LIKE 'branding_a2_%'),
 'is_admin',(SELECT prosrc FROM pg_proc WHERE oid='public.is_admin()'::regprocedure));`;

async function main() {
for (const variant of ['principal', 'savy']) {
  const db = `identity_a2_${mode}_${variant}_${Date.now()}`;
  sql('postgres', `CREATE DATABASE ${db} TEMPLATE template0;`);
  sql(db, 'CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
  sql(db, bootstrap);
  sql(db, read('fixture.sql') + read(`storage-${variant}.sql`));
  console.log(`FIXTURE ${variant}: ${db}; network none; no ports`);
  assert.match(sql(db, 'SHOW session_preload_libraries;'), /supautils/);
  const postmaster = sql(db, 'SELECT pg_postmaster_start_time();');
  sql(db, 'SET ROLE anon; SELECT public.upsert_store_config(\'{}\');', /42501:[^\n]*permission denied for function upsert_store_config/);
  assert.equal(sql(db, 'SELECT pg_is_in_recovery();'), 'f');
  assert.equal(sql(db, 'SELECT pg_postmaster_start_time();'), postmaster);
  console.log('PASS normal supautils preload: actual denied EXECUTE returns 42501; server healthy');
  const before = sql(db, snapshot);
  const oldRows = sql(db, 'SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM store_config s;');
  if (mode === 'red') {
    const error = sql(db, read('red.sql'), /A2_RED_RPC_DISCARDS_IDENTITY/);
    console.log(error.split('\n').find(line => line.includes('A2_RED')));
    sql(db, 'SELECT secondary_color, accent_color, branding_assets FROM public.v_store_config;', /42703/);
    console.log('RED 42703: new public columns absent');
    continue;
  }
  const migration = readFileSync(join(root, 'supabase/migrations/20261121000000_identidade_e_arquivos_da_loja.sql'), 'utf8');
  const divergentDb = `identity_a2_divergent_${variant}_${Date.now()}`;
  sql('postgres', `CREATE DATABASE ${divergentDb} TEMPLATE template0;`);
  sql(divergentDb, 'CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
  sql(divergentDb, bootstrap);
  sql(divergentDb, read('fixture.sql') + read(`storage-${variant}.sql`));
  sql(divergentDb, "INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('branding','branding',false,123,ARRAY['image/jpeg']);");
  const divergentBefore = sql(divergentDb, snapshot);
  const bucketBefore = sql(divergentDb, "SELECT to_jsonb(b) FROM storage.buckets b WHERE id='branding';");
  const divergentRows = sql(divergentDb, 'SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM store_config s;');
  sql(divergentDb, migration, /A2_ALREADY_PRESENT_OR_DIVERGENT/);
  assert.equal(sql(divergentDb, snapshot), divergentBefore);
  assert.equal(sql(divergentDb, "SELECT to_jsonb(b) FROM storage.buckets b WHERE id='branding';"), bucketBefore);
  assert.equal(sql(divergentDb, 'SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM store_config s;'), divergentRows);
  assert.equal(sql(divergentDb, "SELECT count(*) FROM pg_proc WHERE proname LIKE 'branding_a2_%';"), '0');
  console.log('PASS divergent existing bucket refused atomically; bucket/schema/rows/policies unchanged');
  // Inject a failure at the final DDL boundary. Transaction must restore every earlier step.
  sql(db, migration.replace(/COMMIT;\s*$/, "SELECT 1/0;\nCOMMIT;"), /22012/);
  assert.equal(sql(db, snapshot), before);
  assert.equal(sql(db, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='store_config' AND column_name='branding_assets';"), '0');
  assert.equal(sql(db, "SELECT count(*) FROM storage.buckets WHERE id='branding';"), '0');
  assert.equal(sql(db, "SELECT count(*) FROM pg_proc WHERE proname LIKE 'branding_a2_%';"), '0');
  console.log('PASS final-statement failure rolls back all DDL and preserves live RPC');
  sql(db, migration);
  assert.equal(sql(db, snapshot), before);
  assert.equal(sql(db, "SELECT jsonb_agg(to_jsonb(s)-'secondary_color'-'accent_color'-'branding_assets' ORDER BY id) FROM store_config s;"), oldRows);
  console.log('PASS original rows, first 26 view columns, owners, ACLs and old policies unchanged');
  console.log(sql(db, read('contract.sql')));
  console.log(sql(db, read('boundaries.sql')));
  await require('./concurrency.cjs')({ db, sql, docker, container });
  const repeatedBefore = sql(db, 'SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM store_config s;');
  sql(db, migration, /A2_ALREADY_PRESENT_OR_DIVERGENT/);
  assert.equal(sql(db, snapshot), before);
  assert.equal(sql(db, 'SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM store_config s;'), repeatedBefore);
  console.log('PASS repeated migration refused explicitly; rows and metadata unchanged');
  const extended = sql(db, 'SELECT to_jsonb(s) FROM store_config s WHERE id=1;');
  const rollbackPath = 'C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/tarefa-A2-identidade-rpc-rollback.sql';
  const rollback = readFileSync(rollbackPath, 'utf8');
  console.log('ROLLBACK operational SHA256=' + createHash('sha256').update(rollback).digest('hex'));
  sql(db, rollback);
  sql(db, rollback); // Repeating the operational rollback must preserve state as well.
  assert.equal(sql(db, snapshot), before);
  assert.equal(sql(db, "SELECT count(*) FROM pg_attribute WHERE attrelid='public.v_store_config'::regclass AND attnum>0 AND NOT attisdropped;"), '29');
  assert.equal(sql(db, "SELECT count(*) FROM storage.buckets WHERE id='branding';"), '1');
  const bodyHex = sql(db, "SELECT encode(convert_to(prosrc,'UTF8'),'hex') FROM pg_proc WHERE oid='public.upsert_store_config(jsonb)'::regprocedure;");
  const body = Buffer.from(bodyHex, 'hex');
  assert.deepEqual(body, readFileSync(join(__dirname, 'legacy-rpc-body.sql')));
  assert.equal(createHash('sha256').update(body).digest('hex'), '2403a21fa4f3ee2c905df77b368868017bc512b0ec579452c6b8558513ecce31');
  assert.equal(sql(db, 'SELECT to_jsonb(s) FROM store_config s WHERE id=1;'), extended);
  sql(db, `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}'; SELECT public.upsert_store_config('{"store_name":"Legacy compatible"}'); COMMIT;`);
  const afterLegacy = JSON.parse(sql(db, 'SELECT to_jsonb(s) FROM store_config s WHERE id=1;'));
  const prior = JSON.parse(extended);
  assert.deepEqual(afterLegacy.branding_assets, prior.branding_assets);
  assert.equal(afterLegacy.secondary_color, prior.secondary_color);
  assert.equal(afterLegacy.accent_color, prior.accent_color);
  console.log('PASS rollback RPC prosrc byte-for-byte SHA256=2403a21fa4f3ee2c905df77b368868017bc512b0ec579452c6b8558513ecce31; old RPC preserves identity');
}
const logs = docker(['logs', '--since', startedAt, container]);
assert.equal(logs.status, 0);
assert.doesNotMatch(logs.stdout + logs.stderr, /terminated by signal|segmentation fault|PANIC:|database system was interrupted|reinitializing/i);
console.log('PASS container logs: no crash/recovery during complete run');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
