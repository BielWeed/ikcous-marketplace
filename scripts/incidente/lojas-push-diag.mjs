// Temporário (28/09/2026): diagnóstico do "Quero receber!" nas lojas novas.
// Nada fica gravado: lê o esquema/políticas de push_subscriptions e simula a
// MESMA gravação do app (upsert por endpoint, como o usuário logado) dentro
// de uma transação que termina em ROLLBACK.
import fs from "node:fs";

const PROIBIDOS = new Set(["dekxabvqdsuukijblazl", "gnjsrucsmjkajijrakzr", "cafkrminfnokvgjqtkle"]);
const { lojas } = JSON.parse(fs.readFileSync("scripts/incidente/lojas-novas.json", "utf8"));

for (const loja of lojas) {
  console.log(`\n==================== ${loja.nome} ====================`);
  const token = (process.env[loja.conta] ?? "").trim();
  if (!token) continue;
  const api = async (metodo, caminho, corpo) => {
    const r = await fetch(`https://api.supabase.com/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const t = await r.text();
    return { ok: r.ok, status: r.status, json: (() => { try { return JSON.parse(t); } catch { return t; } })() };
  };
  const projeto = (await api("GET", "/projects")).json.find((p) => p.name === loja.projeto);
  if (!projeto || PROIBIDOS.has(projeto.id)) throw new Error("projeto inválido");
  const sql = async (query) => {
    const r = await api("POST", `/projects/${projeto.id}/database/query`, { query });
    return r.ok ? r.json : { ERRO: r.status, detalhe: typeof r.json === "string" ? r.json.slice(0, 400) : r.json };
  };
  const mostra = (rotulo, v) => console.log(`${rotulo}: ${JSON.stringify(v)}`);

  mostra("colunas", await sql(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='push_subscriptions' ORDER BY ordinal_position`));
  mostra("restrições", await sql(`SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass`));
  mostra("rls", await sql(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.push_subscriptions'::regclass`));
  mostra("políticas", await sql(`SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
    WHERE schemaname='public' AND tablename='push_subscriptions'`));
  mostra("grants authenticated", await sql(`SELECT privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='push_subscriptions' AND grantee='authenticated'`));
  mostra("gatilhos", await sql(`SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
    WHERE tgrelid='public.push_subscriptions'::regclass AND NOT tgisinternal`));
  mostra("inscrições gravadas", await sql("SELECT count(*) AS n FROM public.push_subscriptions"));

  const [admin] = (await sql(`SELECT id FROM auth.users WHERE lower(email) = lower('${loja.admin_email.replaceAll("'", "''")}')`)) ?? [];
  if (!admin?.id) {
    console.log("admin não encontrado; simulação pulada");
    continue;
  }
  // Mesma gravação do app (usePushNotifications.subscribe), como o admin
  // logado, e desfeita no fim.
  const claims = JSON.stringify({ sub: admin.id, role: "authenticated" }).replaceAll("'", "''");
  mostra(
    "simulação do upsert do app (ROLLBACK)",
    await sql(`BEGIN;
      SELECT set_config('request.jwt.claims', '${claims}', true);
      SELECT set_config('request.jwt.claim.sub', '${admin.id}', true);
      SET LOCAL ROLE authenticated;
      INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id)
        VALUES ('https://fcm.googleapis.com/fcm/send/diagnostico-ikcous', 'BDiag', 'diag', '${admin.id}')
        ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id
        RETURNING endpoint;
      ROLLBACK;`),
  );
  mostra("conferência pós-rollback", await sql("SELECT count(*) AS n FROM public.push_subscriptions WHERE endpoint LIKE '%diagnostico-ikcous%'"));
}
