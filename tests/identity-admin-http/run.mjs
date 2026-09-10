import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createEnvironment, hash, lit, readFixture } from "./environment.mjs";

assert.equal(process.argv.length, 2, "Run without arguments");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runId = `${Date.now()}_${randomBytes(4).toString("hex")}`;
const directory = `C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/tarefa-A5e1-${runId}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed evidence root and generated numeric/hex suffix.
mkdirSync(directory, { recursive: false });
const evidence = {
  runId,
  startedAt: new Date().toISOString(),
  images: [],
  resources: [],
  events: [],
  cases: [],
  calls: [],
  sources: [],
  complete: false,
};
const environment = createEnvironment(runId, evidence);
const nativeFetch = globalThis.fetch;
let externalFetches = 0;
globalThis.fetch = () => {
  externalFetches++;
  throw new Error("UNINJECTED_FETCH_FORBIDDEN");
};
const origin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const adminId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const a2Path =
  "supabase/migrations/20261121000000_identidade_e_arquivos_da_loja.sql";
const a5Path =
  "supabase/migrations/20261122000000_gravacao_concorrente_da_identidade.sql";
function source(path) {
  const text = readFixture(root, path);
  if (!evidence.sources.some((entry) => entry.path === path))
    evidence.sources.push({ path, sha256: hash(text) });
  return text;
}
function jwt(sub, changes = {}, secret = environment.jwtSecret) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, ...changes })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}
const adminToken = jwt(adminId);
const customerToken = jwt(customerId);
const codes = new Set([
  "PGRST202",
  "PGRST301",
  "PGRST302",
  "PGRST303",
  "42501",
  "22023",
  "23514",
  "P0001",
  "P0002",
  "PGRST002",
]);
async function rpc(rest, name, body, token, signal) {
  assert(
    [
      "read_store_identity",
      "save_store_identity",
      "upsert_store_config",
    ].includes(name),
  );
  rest.guard();
  const target = `${rest.origin}/rpc/${name}`;
  const started = performance.now();
  const response = await rest.fetch(target, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  assert.equal(response.url, target);
  assert.equal(response.redirected, false);
  const data = await response.json();
  evidence.calls.push({
    id: evidence.calls.length + 1,
    rpc: name,
    origin: rest.origin,
    status: response.status,
    milliseconds: Math.round(performance.now() - started),
    authorization: "[REDACTED]",
    ...(typeof data.revision === "string"
      ? {
          revision: data.revision,
          identitySha256: hash(JSON.stringify(data.identity)),
        }
      : {}),
    ...(codes.has(data.code) ? { code: data.code } : {}),
  });
  return { status: response.status, data };
}
async function waitReady(rest, expected) {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const response = await rpc(
        rest,
        "read_store_identity",
        {},
        adminToken,
        AbortSignal.timeout(3000),
      );
      if (expected(response)) return;
    } catch {
      /* A running process is not readiness; require an actual contract response. */
    }
    assert(Date.now() < deadline, "REST_READINESS_TIMEOUT");
    await delay(250);
  }
}
function options(
  rest,
  {
    token = adminToken,
    userId = adminId,
    controller = new AbortController(),
    afterResponse,
    beforeRead,
    authorizeUser = userId,
  } = {},
) {
  const requests = [];
  const fetchImpl = async (input, init) => {
    assert.equal(typeof input, "string");
    const name = input.slice(`${origin}/rest/v1/rpc/`.length);
    assert(["read_store_identity", "save_store_identity"].includes(name));
    assert.equal(input, `${origin}/rest/v1/rpc/${name}`);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      `Bearer ${token}`,
    );
    requests.push(name);
    if (name === "read_store_identity") await beforeRead?.();
    rest.guard();
    const target = `${rest.origin}/rpc/${name}`;
    const started = performance.now();
    // Preserve the actual SDK body/headers; only translate the closed virtual origin.
    const response = await rest.fetch(target, init);
    assert.equal(response.url, target);
    assert.equal(response.redirected, false);
    const text = await response.text();
    const data = JSON.parse(text);
    evidence.calls.push({
      id: evidence.calls.length + 1,
      rpc: name,
      origin: rest.origin,
      status: response.status,
      milliseconds: Math.round(performance.now() - started),
      authorization: "[REDACTED]",
      ...(typeof data.revision === "string"
        ? {
            revision: data.revision,
            identitySha256: hash(JSON.stringify(data.identity)),
          }
        : {}),
      ...(codes.has(data.code) ? { code: data.code } : {}),
    });
    await afterResponse?.({ name, status: response.status, data });
    const virtual = new Response(text, {
      status: response.status,
      headers: response.headers,
    });
    Object.defineProperty(virtual, "url", { value: input });
    return virtual;
  };
  return {
    requests,
    value: {
      supabaseUrl: origin,
      publicKey: "sb_publishable_local_synthetic",
      userId,
      authorize: async () => ({ userId: authorizeUser, accessToken: token }),
      isCurrent: () => true,
      signal: controller.signal,
      fetchImpl,
      timeoutMs: 60000,
    },
  };
}
function baseline(db) {
  return environment.sql(
    db,
    `SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')),
    'constraints',(SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.store_config'::regclass),
    'table',(SELECT jsonb_build_array(relacl,relowner,relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='public.store_config'::regclass),
    'view',(SELECT jsonb_build_array(pg_get_viewdef(oid),relacl,relowner,reloptions) FROM pg_class WHERE oid='public.v_store_config'::regclass));`,
  );
}
function setupDatabase(variant, missing = false) {
  const db = environment.createDatabase(
    `${variant}${missing ? "_missing" : ""}`,
  );
  environment.sql(
    db,
    source("tests/identity-database/fixture.sql") +
      source(`tests/identity-database/storage-${variant}.sql`),
  );
  environment.sql(db, source(a2Path));
  environment.sql(
    db,
    `${source("tests/identity-database/contract.sql").split("COMMIT;")[0]}COMMIT;`,
  );
  environment.sql(
    db,
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${adminId}"}';
    SELECT public.upsert_store_config(jsonb_build_object('store_name','Synthetic ${variant}','store_city','Synthetic City','store_state','MG',
      'primary_color','#112233','secondary_color','#334455','accent_color','#556677','branding_assets',public.a2_package(),
      'logo_url','${origin}/storage/v1/object/public/branding/'||(public.a2_package()#>>'{header,path}'))); COMMIT;`,
  );
  return db;
}

async function main() {
  const bundled = await build({
    entryPoints: [resolve(root, "tests/identity-admin-http/client.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const code = bundled.outputFiles[0].text;
  for (const path of [
    "src/lib/adminStoreIdentity.ts",
    "src/lib/storeIdentitySnapshot.ts",
    "src/lib/storeIdentity.ts",
    "src/lib/publicSupabaseKey.ts",
    "package-lock.json",
  ]) {
    evidence.sources.push({
      path,
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Closed product/dependency source list; never env files.
      sha256: hash(readFileSync(resolve(root, path))),
    });
  }
  evidence.bundle = {
    sha256: hash(code),
    bytes: Buffer.byteLength(code),
    inputs: Object.keys(bundled.metafile.inputs),
  };
  const { readAdminStoreIdentity: read, saveAdminStoreIdentity: save } =
    await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
  await environment.start();
  for (const variant of ["principal", "savy"]) {
    const db = setupDatabase(variant);
    const rest = await environment.startRest(db, variant);
    await waitReady(
      rest,
      (response) =>
        response.status === 404 && response.data.code === "PGRST202",
    );
    const initialRaw = JSON.parse(
      environment.sql(
        db,
        `SELECT jsonb_build_object('store_name',store_name,'store_city',store_city,'store_state',store_state,'primary_color',primary_color,'secondary_color',secondary_color,'accent_color',accent_color,'logo_url',logo_url,'branding_assets',branding_assets) FROM store_config WHERE id=1;`,
      ),
    );
    await assert.rejects(read(options(rest).value), {
      code: "IDENTITY_ADMIN_UNAVAILABLE",
      message: "IDENTITY_ADMIN_UNAVAILABLE",
    });
    assert.deepEqual(
      await save(
        {
          expected: { revision: "0", identity: initialRaw },
          desired: initialRaw,
        },
        options(rest).value,
      ),
      { status: "rejected", code: "unavailable" },
    );
    evidence.events.push({
      phase: "RED",
      variant,
      reason:
        "RPC absent before literal A5; read unavailable and save rejected unavailable",
    });
    console.log(`RED ${variant}: real HTTP 404 PGRST202, new contract absent`);
    environment.sql(db, source(a5Path));
    environment.sql(db, "NOTIFY pgrst, 'reload schema';");
    await waitReady(
      rest,
      (response) =>
        response.status === 200 && typeof response.data.revision === "string",
    );
    const schemaBefore = baseline(db);
    const rowTwo = environment.sql(
      db,
      "SELECT to_jsonb(s) FROM public.store_config s WHERE id=2;",
    );
    const test = async (name, run) => {
      const firstCall = evidence.calls.length;
      await run();
      evidence.cases.push({
        variant,
        name,
        result: "PASS",
        rpcCalls: evidence.calls
          .slice(firstCall)
          .map(({ rpc, status }) => ({ rpc, status })),
      });
      console.log(`PASS ${variant}: ${name}`);
    };
    const fresh = () => read(options(rest).value);
    const intent = (snapshot, name) => ({
      expected: snapshot,
      desired: { ...snapshot.identity, store_name: name },
    });
    const rawSql = () =>
      JSON.parse(
        environment.sql(
          db,
          `SET ROLE authenticated; SET request.jwt.claims='{"sub":"${adminId}"}'; SELECT public.read_store_identity();`,
        ),
      );
    await test("admin raw8 and string revision", async () => {
      const snapshot = await fresh();
      assert.deepEqual(snapshot, { revision: "0", identity: initialRaw });
      assert.equal(Object.keys(snapshot.identity).length, 8);
      assert.deepEqual(snapshot, rawSql());
      const direct = await rest.direct(
        "read_store_identity",
        new Headers({
          "content-type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        }),
        "{}",
      );
      const forwarded = await rest.fetch(
        `${rest.origin}/rpc/read_store_identity`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: "{}",
        },
      );
      assert.equal(forwarded.status, direct.status);
      assert.equal(
        forwarded.headers.get("content-type"),
        direct.headers.get("content-type"),
      );
      assert.equal(
        hash(Buffer.from(await forwarded.arrayBuffer())),
        hash(direct.body),
      );
      const count = evidence.events.filter(
        (event) => event.phase === "curl-http",
      ).length;
      assert.equal(
        (
          await nativeFetch(`${rest.origin}/rpc/read_store_identity`, {
            method: "POST",
            body: "{}",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await rest.fetch(`${rest.origin}/rpc/read_store_identity`, {
            method: "DELETE",
          })
        ).status,
        405,
      );
      assert.throws(() =>
        rest.fetch(`${rest.origin}/rpc/other`, { method: "POST" }),
      );
      assert.throws(() =>
        rest.fetch("https://external.invalid/rpc/read_store_identity", {
          method: "POST",
        }),
      );
      assert.equal(
        evidence.events.filter((event) => event.phase === "curl-http").length,
        count,
      );
      evidence.events.push({
        phase: "bridge-control",
        variant,
        status: direct.status,
        bodySha256: hash(direct.body),
        unauthorized: 403,
        forbiddenMethod: 405,
        invalidDestinationsSent: 0,
      });
    });
    await test("changed identity persists exactly", async () => {
      const requested = intent(
        await fresh(),
        'Synthetic São \\ quoted "name"\tline\r\nnext',
      );
      const result = await save(requested, options(rest).value);
      assert.equal(result.status, "confirmed");
      assert.equal(result.source, "response");
      assert.notEqual(result.snapshot.revision, requested.expected.revision);
      assert.deepEqual(result.snapshot.identity, requested.desired);
      assert.deepEqual(await fresh(), result.snapshot);
      assert.deepEqual(rawSql(), result.snapshot);
    });
    await test("no-op preserves revision and updated_at", async () => {
      const before = await fresh();
      const updatedAt = environment.sql(
        db,
        "SELECT updated_at::text FROM store_config WHERE id=1;",
      );
      const result = await save(
        { expected: before, desired: before.identity },
        options(rest).value,
      );
      assert.deepEqual(result, {
        status: "confirmed",
        source: "response",
        snapshot: before,
      });
      assert.equal(
        environment.sql(
          db,
          "SELECT updated_at::text FROM store_config WHERE id=1;",
        ),
        updatedAt,
      );
    });
    await test("customer cannot read or save", async () => {
      const before = await fresh();
      const customer = options(rest, {
        userId: customerId,
        token: customerToken,
      });
      await assert.rejects(read(customer.value), {
        code: "IDENTITY_ADMIN_PERMISSION",
        message: "IDENTITY_ADMIN_PERMISSION",
      });
      assert.deepEqual(
        await save(intent(before, "Denied customer"), customer.value),
        { status: "rejected", code: "permission" },
      );
      assert.deepEqual(await fresh(), before);
    });
    const now = Math.floor(Date.now() / 1000);
    for (const [name, token] of [
      ["wrong signature", jwt(adminId, {}, randomBytes(48).toString("hex"))],
      ["expired", jwt(adminId, { exp: now - 120 })],
      ["future nbf", jwt(adminId, { nbf: now + 120 })],
      ["wrong audience", jwt(adminId, { aud: "incorrect-audience" })],
    ])
      await test(`JWT ${name} rejected`, async () => {
        const before = await fresh();
        const invalid = options(rest, { token });
        await assert.rejects(read(invalid.value), {
          code: "IDENTITY_ADMIN_SESSION",
          message: "IDENTITY_ADMIN_SESSION",
        });
        assert.deepEqual(
          await save(intent(before, "Denied JWT"), invalid.value),
          { status: "rejected", code: "session" },
        );
        assert.deepEqual(await fresh(), before);
      });
    await test("anonymous lacks EXECUTE on both RPCs", async () => {
      const before = await fresh();
      for (const [name, args] of [
        ["read_store_identity", {}],
        [
          "save_store_identity",
          {
            expected_revision: before.revision,
            expected_identity: before.identity,
            desired_identity: before.identity,
          },
        ],
      ]) {
        const response = await rpc(rest, name, args);
        assert.equal(response.status, 401);
        assert.equal(response.data.code, "42501");
      }
      assert.deepEqual(await fresh(), before);
    });
    await test("invalid desired SQL state has fixed public error", async () => {
      const before = await fresh();
      for (const invalid of [
        { ...before.identity, primary_color: "#000000" },
        { ...before.identity, secondary_color: "PRIVATE_INVALID_MARKER" },
      ]) {
        assert.deepEqual(
          await save(
            { expected: before, desired: invalid },
            options(rest).value,
          ),
          { status: "rejected", code: "invalid" },
        );
        const response = await rpc(
          rest,
          "save_store_identity",
          {
            expected_revision: before.revision,
            expected_identity: before.identity,
            desired_identity: invalid,
          },
          adminToken,
        );
        assert.equal(response.status, 400);
        assert(["22023", "23514"].includes(response.data.code));
        assert.equal(response.data.message, "IDENTITY_INVALID");
        assert(
          !JSON.stringify(response.data).includes("PRIVATE_INVALID_MARKER"),
        );
        assert.deepEqual(await fresh(), before);
      }
    });
    await test("two simultaneous intentions produce one winner", async () => {
      const before = await fresh();
      const first = options(rest);
      const second = options(rest);
      const results = await Promise.all([
        save(intent(before, "Concurrent A"), first.value),
        save(intent(before, "Concurrent B"), second.value),
      ]);
      const winners = results.filter((r) => r.status === "confirmed");
      assert.equal(winners.length, 1);
      assert.deepEqual(
        results.find((r) => r.status !== "confirmed"),
        { status: "conflict", source: "server" },
      );
      assert.deepEqual(first.requests, ["save_store_identity"]);
      assert.deepEqual(second.requests, ["save_store_identity"]);
      assert.deepEqual(await fresh(), winners[0].snapshot);
    });
    await test("legacy HTTP writer invalidates old intention", async () => {
      const before = await fresh();
      const old = await rpc(
        rest,
        "upsert_store_config",
        { config_json: { store_name: "Legacy writer" } },
        adminToken,
      );
      assert.equal(old.status, 200);
      const after = await fresh();
      assert.notEqual(after.revision, before.revision);
      assert.equal(after.identity.store_name, "Legacy writer");
      assert.deepEqual(
        await save(intent(before, "Stale"), options(rest).value),
        { status: "conflict", source: "server" },
      );
      assert.deepEqual(await fresh(), after);
    });
    await test("lost committed response reads back without second write", async () => {
      const requested = intent(await fresh(), "Lost response committed");
      let saved;
      const lost = options(rest, {
        afterResponse: ({ name, status, data }) => {
          if (name === "save_store_identity") {
            assert.equal(status, 200);
            saved = data;
            throw new Error("PRIVATE_TRANSPORT_MARKER");
          }
        },
      });
      const result = await save(requested, lost.value);
      assert.deepEqual(result, {
        status: "confirmed",
        source: "readback",
        snapshot: saved,
      });
      assert.deepEqual(lost.requests, [
        "save_store_identity",
        "read_store_identity",
      ]);
      assert.deepEqual(rawSql(), saved);
    });
    await test("lost response followed by another actor yields conflict", async () => {
      const requested = intent(await fresh(), "Lost before actor");
      const lost = options(rest, {
        afterResponse: async ({ name, status }) => {
          if (name === "save_store_identity") {
            assert.equal(status, 200);
            assert.equal(
              (
                await rpc(
                  rest,
                  "upsert_store_config",
                  { config_json: { store_name: "Other actor" } },
                  adminToken,
                )
              ).status,
              200,
            );
            throw new Error("PRIVATE_TRANSPORT_MARKER");
          }
        },
      });
      const result = await save(requested, lost.value);
      assert.equal(result.status, "conflict");
      assert.equal(result.source, "readback");
      assert.equal(result.current.identity.store_name, "Other actor");
      assert.deepEqual(lost.requests, [
        "save_store_identity",
        "read_store_identity",
      ]);
      assert.deepEqual(await fresh(), result.current);
      assert.equal(requested.desired.store_name, "Lost before actor");
    });
    await test("unavailable readback remains pending; manual check is read only", async () => {
      const requested = intent(await fresh(), "Pending committed");
      const lost = options(rest, {
        afterResponse: ({ name, status }) => {
          if (name === "save_store_identity") {
            assert.equal(status, 200);
            throw new Error("PRIVATE_TRANSPORT_MARKER");
          }
        },
        beforeRead: () => {
          throw new Error("PRIVATE_READBACK_MARKER");
        },
      });
      assert.deepEqual(await save(requested, lost.value), {
        status: "pending",
        reason: "unconfirmed",
      });
      assert.deepEqual(lost.requests, [
        "save_store_identity",
        "read_store_identity",
      ]);
      const manual = options(rest);
      assert.deepEqual((await read(manual.value)).identity, requested.desired);
      assert.deepEqual(manual.requests, ["read_store_identity"]);
    });
    await test("abort after HTTP 200 stays pending without automatic read", async () => {
      const controller = new AbortController();
      const requested = intent(await fresh(), "Abort after commit");
      const canceled = options(rest, {
        controller,
        afterResponse: ({ name, status }) => {
          if (name === "save_store_identity") {
            assert.equal(status, 200);
            controller.abort();
          }
        },
      });
      assert.deepEqual(await save(requested, canceled.value), {
        status: "pending",
        reason: "canceled",
      });
      assert.deepEqual(canceled.requests, ["save_store_identity"]);
      assert.deepEqual((await fresh()).identity, requested.desired);
    });
    await test("pre-abort and incoherent user send zero writes", async () => {
      const before = await fresh();
      const controller = new AbortController();
      controller.abort();
      for (const [probe, code] of [
        [options(rest, { controller }), "IDENTITY_ADMIN_CANCELED"],
        [
          options(rest, { authorizeUser: customerId }),
          "IDENTITY_ADMIN_SESSION",
        ],
      ]) {
        await assert.rejects(save(intent(before, "Never sent"), probe.value), {
          code,
          message: code,
        });
        assert.deepEqual(probe.requests, []);
      }
      assert.deepEqual(await fresh(), before);
    });
    await test("revision above 2^53 stays exact text", async () => {
      const before = await fresh();
      environment.sql(
        db,
        "SELECT setval('public.branding_a5_revision_seq',9007199254740992,true);",
      );
      const result = await save(
        intent(before, "Big revision"),
        options(rest).value,
      );
      assert.equal(result.status, "confirmed");
      // Legacy upsert runs BEFORE INSERT then BEFORE UPDATE: both consume the sequence.
      assert.equal(result.snapshot.revision, "9007199254740994");
      assert.deepEqual(await fresh(), result.snapshot);
      assert.deepEqual(rawSql(), result.snapshot);
    });
    await test("SQL definitions ACL policies checks and unrelated row unchanged", async () => {
      assert.equal(baseline(db), schemaBefore);
      assert.equal(
        environment.sql(
          db,
          "SELECT to_jsonb(s) FROM public.store_config s WHERE id=2;",
        ),
        rowTwo,
      );
      assert.equal(
        environment.sql(db, "SELECT count(*) FROM auth.users;"),
        "2",
      );
      evidence.events.push({
        phase: "SQL-invariants",
        variant,
        before: hash(schemaBefore),
        after: hash(baseline(db)),
        unrelatedRow: hash(rowTwo),
      });
    });
    const missingDb = setupDatabase(variant, true);
    environment.sql(missingDb, source(a5Path));
    environment.sql(
      missingDb,
      "BEGIN; DELETE FROM public.store_config WHERE id=1; COMMIT;",
    );
    const missingRest = await environment.startRest(
      missingDb,
      `${variant}-missing`,
    );
    await waitReady(
      missingRest,
      (response) => response.status === 500 && response.data.code === "P0002",
    );
    await test("missing row is HTTP500 P0002 mapped to missing", async () => {
      await assert.rejects(read(options(missingRest).value), {
        code: "IDENTITY_ADMIN_MISSING",
        message: "IDENTITY_ADMIN_MISSING",
      });
      const before = await fresh();
      assert.deepEqual(
        await save(intent(before, "Missing"), options(missingRest).value),
        { status: "rejected", code: "missing" },
      );
      assert.equal(
        environment.sql(
          missingDb,
          "SELECT count(*) FROM public.store_config WHERE id=1;",
        ),
        "0",
      );
    });
    assert.equal(
      evidence.cases.filter((entry) => entry.variant === variant).length,
      20,
      "INCOMPLETE_VARIANT_CASES",
    );
  }
  assert.equal(evidence.cases.length, 40, "INCOMPLETE_SUITE");
  assert.equal(externalFetches, 0);
  evidence.complete = true;
}

try {
  await main();
} catch (error) {
  // Do not render data-URL stack traces or assertions containing arbitrary payloads.
  evidence.failure = {
    name: error?.name === "AssertionError" ? "AssertionError" : "Error",
    phase: evidence.events.at(-1)?.phase ?? "setup",
    completedCases: evidence.cases.length,
    location:
      /tests\/identity-admin-http\/(?:environment|run)\.mjs:[0-9]+:[0-9]+/.exec(
        error?.stack ?? "",
      )?.[0],
    message: /^[A-Z_]+$/.test(error?.message ?? "")
      ? error.message
      : "LOCAL_TEST_ASSERTION_OR_SETUP_FAILED",
  };
  console.error("FAIL", JSON.stringify(evidence.failure));
  process.exitCode = 1;
} finally {
  try {
    await environment.stop();
  } catch {
    evidence.complete = false;
    evidence.cleanupFailed = true;
    process.exitCode = 1;
  }
  globalThis.fetch = nativeFetch;
  evidence.externalFetches = externalFetches;
  evidence.finishedAt = new Date().toISOString();
  for (const path of ["run.mjs", "environment.mjs", "client.ts", "README.md"]) {
    try {
      evidence.sources.push({
        path: `tests/identity-admin-http/${path}`,
        sha256: hash(
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed four own paths only.
          readFileSync(resolve(root, "tests/identity-admin-http", path)),
        ),
      });
    } catch {
      /* README may not exist in the first diagnostic run. */
    }
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed evidence root and generated run ID.
  writeFileSync(
    resolve(directory, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(`EVIDENCE ${directory}/evidence.json`);
  console.log(
    `${evidence.complete ? "PASS" : "INCOMPLETE"} ${evidence.cases.length}/40 cases; own resources preserved and stopped=${!evidence.cleanupFailed}`,
  );
}
