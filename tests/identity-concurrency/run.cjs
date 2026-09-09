// Local synthetic SQL only. No environment files, network clients or arbitrary commands.
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const mode = process.argv[2];
assert(process.argv.length === 3 && ['red', 'green'].includes(mode), 'Usage: node tests/identity-concurrency/run.cjs red|green');
const container = 'ikcous-identidade-sql-corrigido-20260909';
const bootstrapContainer = 'ikcous-identidade-sql-20260909';
const root = join(__dirname, '../..');
const evidence = 'C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/aceite-A5b-sql';
const startedAt = new Date().toISOString();
const runId = `${mode}_${Date.now()}`;
const transcript = [];
mkdirSync(evidence, { recursive: true });
const log = message => { console.log(message); transcript.push(message); };
const ownFiles = ['run.cjs','contract.sql','boundaries.sql','concurrency.cjs','rollback.sql','README.md'];
const allowedFiles = new Set([
  ...ownFiles.map(name => join(__dirname, name)),
  ...['fixture.sql','storage-principal.sql','storage-savy.sql','contract.sql'].map(name => join(root,'tests/identity-database',name)),
  join(root,'supabase/migrations/20261121000000_identidade_e_arquivos_da_loja.sql'),
  join(root,'supabase/migrations/20261122000000_gravacao_concorrente_da_identidade.sql'),
]);
function readAllowed(path) {
  assert(allowedFiles.has(path), 'Only enumerated fixture/test/migration files can be read');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Exact allowlist above; no user-supplied paths.
  return readFileSync(path, 'utf8');
}
function writeEvidence(suffix, content) {
  assert(['.log','-postgres.log'].includes(suffix));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed directory, generated run ID, two allowed suffixes.
  writeFileSync(join(evidence, runId + suffix), content);
}
const read = name => readAllowed(join(__dirname, name));
const a2 = name => readAllowed(join(root, 'tests/identity-database', name));
const hash = value => createHash('sha256').update(value).digest('hex');
const lit = value => "'" + String(value).replaceAll("'", "''") + "'";
function guard(target) {
  assert([container, bootstrapContainer].includes(target));
  const inspected = spawnSync('docker', ['inspect', target], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(inspected.status, 0, inspected.stderr);
  const state = JSON.parse(inspected.stdout)[0];
  assert.equal(state.Name, '/' + target);
  assert.equal(state.State.Running, true);
  assert.equal(state.HostConfig.NetworkMode, 'none');
  assert.deepEqual(state.HostConfig.PortBindings, {});
  if (target === container) assert.equal(state.Config.Image, 'public.ecr.aws/supabase/postgres:17.6.1.153');
}
function psql(db, source, expectedError, streaming = false) {
  assert(db === 'postgres' || /^identity_a5_[a-z0-9_]+$/.test(db));
  if (db === 'postgres') assert(/^CREATE DATABASE identity_a5_[a-z0-9_]+ TEMPLATE template0;$/.test(source));
  guard(container);
  const args = ['exec', '-i', '--env', 'PGPASSWORD=postgres', container, 'psql', '-U', 'postgres', '-d', db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  if (streaming) { assert.notEqual(db, 'postgres'); return spawn('docker', args, { timeout: 60000, windowsHide: true }); }
  const result = spawnSync('docker', args, { input: source, encoding: 'utf8', timeout: 60000, maxBuffer: 2 ** 24, windowsHide: true });
  if (expectedError) {
    assert.notEqual(result.status, 0, 'Expected SQL rejection');
    assert.match(result.stderr, expectedError);
    transcript.push(result.stderr.trim());
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout.trim();
}
const admin = `SET ROLE authenticated; SET request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';`;
const raw = `jsonb_build_object('store_name',s.store_name,'store_city',s.store_city,'store_state',s.store_state,'primary_color',s.primary_color,'secondary_color',s.secondary_color,'accent_color',s.accent_color,'logo_url',s.logo_url,'branding_assets',s.branding_assets)`;
const functions = ['public.upsert_store_config(jsonb)', 'public.is_admin()', 'public.branding_a2_file_valid(jsonb,text)', 'public.branding_a2_assets_valid(jsonb)', 'public.branding_a2_logo_valid(jsonb,text)'];
const baseline = `SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,pg_get_functiondef(oid),proowner,proacl) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE oid IN (${functions.map(f => lit(f) + '::regprocedure').join(',')})), 'view',(SELECT jsonb_build_array(pg_get_viewdef(oid,false),relowner,relacl,reloptions) FROM pg_class WHERE oid='public.v_store_config'::regclass), 'table',(SELECT jsonb_build_array(relowner,relacl,relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='public.store_config'::regclass), 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')), 'columns',(SELECT jsonb_agg(jsonb_build_array(attname,atttypid,attnotnull,attacl) ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.store_config'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'identity_revision'), 'constraints',(SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.store_config'::regclass AND conname<>'store_config_identity_revision_a5_check'));`;
const rows = `SELECT jsonb_agg(to_jsonb(s)-'identity_revision' ORDER BY id) FROM public.store_config s;`;
async function main() {
  guard(container); guard(bootstrapContainer);
  const derivation = spawnSync('docker', ['exec', container, 'cat', '/nix/store/76dh4rsb843criisb67jp5z1xcm9bxza-supautils.drv'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(derivation.status, 0); assert.match(derivation.stdout, /\("version","3\.2\.3"\)/);
  log('ENV image 17.6.1.153; supautils 3.2.3; network none; ports {}');
  const dump = spawnSync('docker', ['exec', '--env', 'PGPASSWORD=postgres', bootstrapContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-privileges', '--schema=auth', '--schema=storage'], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 ** 24, windowsHide: true });
  assert.equal(dump.status, 0, dump.stderr);
  assert(!/^(?:COPY\s+[^\n]+\s+FROM\s+stdin|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|ALTER\s+ROLE|CREATE\s+ROLE)/im.test(dump.stdout));
  log('BOOTSTRAP schema-only SHA256=' + hash(dump.stdout));
  const a2Migration = readAllowed(join(root, 'supabase/migrations/20261121000000_identidade_e_arquivos_da_loja.sql'));
  for (const variant of ['principal', 'savy']) {
    const db = `identity_a5_${runId}_${variant}`;
    psql('postgres', `CREATE DATABASE ${db} TEMPLATE template0;`);
    psql(db, 'CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
    psql(db, dump.stdout); psql(db, a2('fixture.sql') + a2(`storage-${variant}.sql`)); psql(db, a2Migration);
    // Consume only the committed helper definitions, never the Storage probes.
    psql(db, a2('contract.sql').split('COMMIT;')[0] + 'COMMIT;');
    assert.match(psql(db, 'SHOW session_preload_libraries;'), /supautils/);
    const postmaster = psql(db, 'SELECT pg_postmaster_start_time();');
    log('DATABASE ' + db);
    log('BASELINE ' + psql(db, `SELECT jsonb_object_agg(oid::regprocedure::text,encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')) FROM pg_proc WHERE oid IN (${functions.map(f => lit(f) + '::regprocedure').join(',')});`));
    log('VIEW_HASH ' + psql(db, `SELECT encode(sha256(convert_to(pg_get_viewdef('public.v_store_config'::regclass,false),'UTF8')),'hex');`));
    if (mode === 'red') {
      const identityA = JSON.parse(psql(db, `SELECT ${raw} FROM public.store_config s WHERE id=1;`));
      const identityB = { ...identityA, store_name: 'B stale intention' };
      for (const value of [identityB, { ...identityA, store_name: 'C newer' }, identityA, identityB]) psql(db, admin + `SELECT public.upsert_store_config(${lit(JSON.stringify(value))});`);
      const actual = JSON.parse(psql(db, `SELECT ${raw} FROM public.store_config s WHERE id=1;`));
      assert.deepEqual(actual, identityB);
      assert.notDeepEqual(actual, identityA);
      log('RED A5_LOST_INTENTION: A->B->C->A then old B is accepted by existing RPC; expected preserved A fails');
      assert.equal(psql(db, `SELECT to_regprocedure('public.read_store_identity()') IS NULL AND to_regprocedure('public.save_store_identity(text,jsonb,jsonb)') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.store_config'::regclass AND attname='identity_revision');`), 't');
      log('RED new administrative APIs and protected revision absent');
      continue;
    }
    const migration = readAllowed(join(root, 'supabase/migrations/20261122000000_gravacao_concorrente_da_identidade.sql'));
    const before = psql(db, baseline); const originalRows = psql(db, rows);
    psql(db, migration.replace(/COMMIT;\s*$/, 'SELECT 1/0;\nCOMMIT;'), /22012/);
    assert.equal(psql(db, baseline), before); assert.equal(psql(db, rows), originalRows);
    assert.equal(psql(db, `SELECT to_regclass('public.branding_a5_revision_seq') IS NULL AND to_regprocedure('public.read_store_identity()') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.store_config'::regclass AND attname='identity_revision');`), 't');
    log('PASS injected final error rolls back all A5 DDL and rows');
    // A conflicting name and an unreviewed writer both fail before mutation.
    psql(db, 'CREATE SEQUENCE public.branding_a5_revision_seq;');
    psql(db, migration, /A5_ALREADY_PRESENT_OR_DIVERGENT/);
    psql(db, 'DROP SEQUENCE public.branding_a5_revision_seq;');
    psql(db, `CREATE FUNCTION public.a5_foreign_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER unrelated BEFORE UPDATE ON public.store_config FOR EACH ROW EXECUTE FUNCTION public.a5_foreign_trigger();`);
    psql(db, migration, /A5_BASELINE_DIVERGENT/);
    psql(db, 'DROP TRIGGER unrelated ON public.store_config; DROP FUNCTION public.a5_foreign_trigger();');
    // ALTER metadata, rather than guessing another function body, must be detected.
    psql(db, 'ALTER FUNCTION public.is_admin() SET search_path=pg_catalog;');
    psql(db, migration, /A5_BASELINE_DIVERGENT/);
    psql(db, `ALTER FUNCTION public.is_admin() SET search_path TO 'public', 'auth';`);
    assert.equal(psql(db, baseline), before); assert.equal(psql(db, rows), originalRows);
    for (const constraint of ['store_config_accent_color_a2_check','store_config_secondary_color_a2_check','store_config_branding_assets_a2_check','store_config_branding_logo_a2_check']) {
      const definition = psql(db, `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.store_config'::regclass AND conname=${lit(constraint)};`);
      psql(db, `ALTER TABLE public.store_config DROP CONSTRAINT ${constraint};`);
      const withoutCheck = psql(db, baseline);
      log('PROBE baseline missing ' + constraint + ' must refuse A5');
      psql(db, migration, /A5_BASELINE_DIVERGENT/);
      assert.equal(psql(db, baseline), withoutCheck); assert.equal(psql(db, rows), originalRows);
      psql(db, `ALTER TABLE public.store_config ADD CONSTRAINT ${constraint} ${definition};`);
    }
    assert.equal(psql(db, baseline), before);
    psql(db, migration);
    assert.equal(psql(db, baseline), before); assert.equal(psql(db, rows), originalRows);
    assert.equal(psql(db, 'SELECT bool_and(identity_revision=0) FROM public.store_config;'), 't');
    log('PASS baseline, old rows/columns, view, owners, ACLs and policies preserved; existing revisions zero');
    log(psql(db, read('contract.sql')));
    log(psql(db, read('boundaries.sql')));
    // Only synthetic test function definitions are varied, within a rolled-back transaction.
    const definition = psql(db, `SELECT pg_get_functiondef('public.upsert_store_config(jsonb)'::regprocedure);`);
    for (const badReturn of ["NULL", "'{}'::jsonb", "result-'store_name'", "result||'{\"store_name\":\"incorrect return\"}'::jsonb"]) {
      const faulty = definition.replace('RETURN result;', `RETURN ${badReturn};`);
      assert.notEqual(faulty, definition);
      const confirmedRows = psql(db, rows);
      // pg_get_functiondef does not append a statement semicolon. Without it,
      // SET ROLE would become a function configuration option in this test.
      psql(db, `BEGIN; ${faulty}; ${admin} DO $$ DECLARE a jsonb; BEGIN a:=public.read_store_identity(); PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',a->'identity'||'{"store_name":"Must not persist unconfirmed"}'),'P0001','IDENTITY_WRITE_UNCONFIRMED'); END $$; ROLLBACK;`);
      assert.equal(psql(db, rows), confirmedRows); assert.equal(psql(db, baseline), before);
    }
    log('PASS null/empty/partial/divergent legacy returns rejected; writes and altered test definitions rolled back');
    psql(db, `BEGIN; CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','auth' AS $$ BEGIN RETURN NULL; END $$; ${admin} SELECT public.a5_reject('SELECT public.read_store_identity()','42501','IDENTITY_PERMISSION'); SELECT public.a5_reject('SELECT public.save_store_identity(NULL,NULL,NULL)','42501','IDENTITY_PERMISSION'); ROLLBACK;`);
    assert.equal(psql(db, baseline), before);
    log('PASS indeterminate is_admin NULL fails closed in both new APIs; original definition restored');
    await require('./concurrency.cjs')({ db, sql: psql, open: () => psql(db, '', undefined, true), admin, lit, log });
    const after = psql(db, rows);
    psql(db, migration, /A5_ALREADY_PRESENT_OR_DIVERGENT/);
    assert.equal(psql(db, rows), after); assert.equal(psql(db, baseline), before);
    const revision = psql(db, 'SELECT identity_revision::text FROM public.store_config WHERE id=1;');
    psql(db, read('rollback.sql')); psql(db, read('rollback.sql'));
    assert.equal(psql(db, rows), after); assert.equal(psql(db, baseline), before);
    for (const role of ['anon', 'authenticated', 'service_role']) psql(db, `SET ROLE ${role}; SELECT public.save_store_identity('0','{}','{}');`, /42501:.*permission denied for function save_store_identity/);
    psql(db, admin + `SELECT public.upsert_store_config('{"store_name":"Legacy after operational rollback"}'); SELECT public.read_store_identity();`);
    assert.notEqual(psql(db, 'SELECT identity_revision::text FROM public.store_config WHERE id=1;'), revision);
    log('PASS repeated operational rollback preserves protection/data/read and denies new writes; old writer advances revision');
    assert.equal(psql(db, 'SELECT pg_postmaster_start_time();'), postmaster);
    assert.equal(psql(db, 'SELECT count(*) FROM auth.users;'), '2');
    // Separate database: exhausting the sequence must not prevent other probes running.
    const maxDb = `identity_a5_max_${runId}_${variant}`;
    psql('postgres', `CREATE DATABASE ${maxDb} TEMPLATE template0;`);
    psql(maxDb, 'CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
    psql(maxDb, dump.stdout); psql(maxDb, a2('fixture.sql') + a2(`storage-${variant}.sql`)); psql(maxDb, a2Migration); psql(maxDb, migration);
    psql(maxDb, `SELECT setval('public.branding_a5_revision_seq',9223372036854775806,true); UPDATE public.store_config SET primary_color=NULL WHERE id=1;`);
    assert.equal(psql(maxDb, 'SELECT identity_revision::text FROM public.store_config WHERE id=1;'), '9223372036854775807');
    const atMax = psql(maxDb, rows);
    for (let attempt = 0; attempt < 2; attempt++) {
      psql(maxDb, admin + `SELECT public.save_store_identity('9223372036854775807',(public.read_store_identity())->'identity',(public.read_store_identity())->'identity'||'{"store_name":"Cannot reuse max"}');`, /2200H:.*reached maximum value/);
      assert.equal(psql(maxDb, rows), atMax);
      assert.equal(psql(maxDb, 'SELECT identity_revision::text FROM public.store_config WHERE id=1;'), '9223372036854775807');
    }
    log('PASS exhausted NO CYCLE sequence refuses twice without partial row changes or revision reuse; ' + maxDb);
  }
  guard(container);
  const logs = spawnSync('docker', ['logs', '--since', startedAt, container], { encoding: 'utf8', timeout: 15000, maxBuffer: 2 ** 24, windowsHide: true });
  assert.equal(logs.status, 0); assert.doesNotMatch(logs.stdout + logs.stderr, /terminated by signal|segmentation fault|PANIC:|database system was interrupted|reinitializing/i);
  writeEvidence('-postgres.log', logs.stdout + logs.stderr);
  log('PASS no crash/recovery; local SQL only; fixtures synthetic; databases retained');
  for (const name of ownFiles) log(`SHA256 tests/identity-concurrency/${name} ${hash(read(name))}`);
  log('SHA256 migration ' + hash(readAllowed(join(root,'supabase/migrations/20261122000000_gravacao_concorrente_da_identidade.sql'))));
}
main().catch(error => { transcript.push(String(error.stack)); console.error(error); process.exitCode = 1; }).finally(() => {
  transcript.push('ELAPSED_MS ' + (Date.now() - Date.parse(startedAt)));
  writeEvidence('.log', transcript.join('\n') + '\n');
});
