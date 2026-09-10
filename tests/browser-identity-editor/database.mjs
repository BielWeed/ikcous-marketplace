import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createEnvironment,
  hash,
  lit,
  readFixture,
} from "../identity-admin-http/environment.mjs";

export const virtualOrigin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
export const adminId = "11111111-1111-4111-8111-111111111111";
export const customerId = "22222222-2222-4222-8222-222222222222";
const sources = [
  "tests/identity-database/fixture.sql",
  "tests/identity-database/storage-principal.sql",
  "supabase/migrations/20261121000000_identidade_e_arquivos_da_loja.sql",
  "supabase/migrations/20261122000000_gravacao_concorrente_da_identidade.sql",
];

export function createDatabaseBench(root, runId, evidence) {
  const environment = createEnvironment(runId, evidence);
  let db;
  let rest;
  const jwt = (sub) => {
    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 14400 })}`;
    return `${unsigned}.${createHmac("sha256", environment.jwtSecret).update(unsigned).digest("base64url")}`;
  };
  const sessions = {
    admin: { user: { id: adminId }, access_token: jwt(adminId) },
    customer: { user: { id: customerId }, access_token: jwt(customerId) },
  };
  const rpc = async (
    name,
    body = {},
    actor = "independent",
    token = sessions.admin.access_token,
  ) => {
    assert(
      [
        "read_store_identity",
        "save_store_identity",
        "upsert_store_config",
      ].includes(name),
    );
    const response = await forward(
      name,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      },
      actor,
    );
    return { status: response.status, data: JSON.parse(response.body) };
  };
  const forward = async (name, init, actor = "form") => {
    rest.guard();
    const target = `${rest.origin}/rpc/${name}`;
    const response = await rest.fetch(target, init);
    assert.equal(response.url, target);
    assert.equal(response.redirected, false);
    const body = await response.text();
    const data = JSON.parse(body);
    evidence.http.push({
      actor,
      rpc: name,
      status: response.status,
      requestSha256: hash(init.body),
      responseSha256: hash(body),
      ...(typeof data.revision === "string" ? { revision: data.revision } : {}),
      ...(/^(?:P[0-9A-Z]{4,7}|[0-9]{5})$/.test(data.code ?? "")
        ? { code: data.code }
        : {}),
    });
    return {
      status: response.status,
      body,
      headers: { "Content-Type": "application/json" },
    };
  };
  const metadata = () =>
    JSON.parse(
      environment.sql(
        db,
        `SELECT jsonb_build_object('revision',identity_revision::text,'updatedAt',updated_at,'identity',jsonb_build_object('store_name',store_name,'store_city',store_city,'store_state',store_state,'primary_color',primary_color,'secondary_color',secondary_color,'accent_color',accent_color,'logo_url',logo_url,'branding_assets',branding_assets)) FROM store_config WHERE id=1;`,
      ),
    );
  const schema = () =>
    environment.sql(
      db,
      `SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')),'constraints',(SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.store_config'::regclass),'otherRow',(SELECT to_jsonb(s) FROM store_config s WHERE id=2));`,
    );
  return {
    sessions,
    rpc,
    forward,
    metadata,
    schema,
    async start(raw) {
      await environment.start();
      db = environment.createDatabase("principal");
      for (const path of sources) {
        const sql = readFixture(root, path);
        evidence.sources.push({ path, sha256: hash(sql) });
        environment.sql(db, sql);
      }
      // Explicit seed uses real synthetic bytes' descriptors, with no sequence reset.
      environment.sql(
        db,
        `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${adminId}"}'; SELECT public.upsert_store_config(${lit(JSON.stringify(raw))}::jsonb); COMMIT;`,
      );
      rest = await environment.startRest(db, "principal");
      const deadline = Date.now() + 60000;
      while (true) {
        try {
          const result = await rpc("read_store_identity");
          if (result.status === 200) break;
        } catch {
          /* Readiness requires a real response, and the deadline is finite. */
        }
        assert(Date.now() < deadline, "POSTGREST_READY_TIMEOUT");
        await delay(250);
      }
      evidence.database = db;
    },
    stop: () => environment.stop(),
  };
}
