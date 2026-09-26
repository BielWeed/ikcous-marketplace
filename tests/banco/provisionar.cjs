"use strict";

/**
 * Provisiona o Postgres EFÊMERO do job com a "fábrica" que o Supabase dá e
 * que as migrations assumem existir — a mesma receita da frente ci-banco
 * (scripts/ci/banco/provisionar-efemero.cjs, PR #585), com UMA diferença
 * própria desta frente e DUAS emulações a mais:
 *
 *   1. Papéis de fábrica (anon, authenticated, service_role) + default
 *      privileges — os GRANT/REVOKE das migrations falham sem eles.
 *   2. Esquema `extensions` + contrib instaláveis do image oficial:
 *      unaccent, pg_trgm, uuid-ossp, pgcrypto (resolver_loja usa
 *      extensions.crypt/gen_salt).
 *   3. auth.* emulado — e aqui a diferença própria: o auth.uid() desta
 *      frente lê o GUC `app.rpc.user_id` (set_config por sessão) em vez de
 *      devolver NULL sempre, porque as PROVAS DE COMPORTAMENTO precisam
 *      "logar" usuário e admin; auth.users nasce com raw_app_meta_data,
 *      que public.is_admin() lê no fallback.
 *   4. publication supabase_realtime + storage mínimo (fábrica da
 *      plataforma, emulada — mesmo achado da ci-banco).
 *   5. pg_cron EMULADO por stub (schema cron com tabela cron.job e as duas
 *      funções cron.schedule/cron.unschedule nas assinaturas que a fila de
 *      migrations usa): as migrations agendam a varredura de cupons e a
 *      expiração sem erro, e o agendador nunca dispara — as provas chamam
 *      as funções à mão, no momento que querem. pg_net só vive DENTRO do
 *      comando agendado (nunca avaliado no apply), então nada mais precisa.
 *
 * USO: node tests/banco/provisionar.cjs
 * (DATABASE_URL do service + CI_BANCO_EFEMERO=1 — ver efemero.cjs)
 */

const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const PAPEIS_DE_FABRICA = ["anon", "authenticated", "service_role"];

const EXTENSOES_CONTRIB = [
  { nome: "unaccent", esquema: "extensions" },
  { nome: "pg_trgm", esquema: "extensions" },
  { nome: "uuid-ossp", esquema: "extensions" },
  { nome: "pgcrypto", esquema: "extensions" },
];

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar(
      "INDETERMINADO",
      `Não conectei no banco efêmero: ${erro.message}\n(DATABASE_URL correta? Esta suíte nunca conecta a banco real.)`,
    );
  }

  try {
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "public"');
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "extensions"');
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "auth"');
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "storage"');
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "cron"');

    // 1. Papéis de fábrica (CREATE ROLE não tem IF NOT EXISTS).
    for (const papel of PAPEIS_DE_FABRICA) {
      const existe = await cliente.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [papel],
      );
      if (existe.rowCount === 0) {
        await cliente.query(`CREATE ROLE "${papel}" NOLOGIN`);
      }
    }
    for (const papel of PAPEIS_DE_FABRICA) {
      await cliente.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${papel}"`,
      );
      await cliente.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${papel}"`,
      );
      await cliente.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "${papel}"`,
      );
    }
    console.log("[provisionar] papéis de fábrica + default privileges OK");

    // 2. Contrib do image oficial no schema extensions (Supabase as põe lá).
    for (const ext of EXTENSOES_CONTRIB) {
      await cliente.query(
        `CREATE EXTENSION IF NOT EXISTS "${ext.nome}" WITH SCHEMA "${ext.esquema}"`,
      );
      console.log(`[provisionar] extensão ${ext.nome} → schema ${ext.esquema}`);
    }

    // 3. auth.* emulado. auth.uid() lê o GUC que as provas setam por sessão
    // (set_config('app.rpc.user_id', ..., false)); fora de prova, NULL.
    await cliente.query(`
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $stub$ SELECT NULLIF(current_setting('app.rpc.user_id', true), '')::uuid $stub$
    `);
    await cliente.query(`
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $stub$ SELECT NULL::text $stub$
    `);
    // raw_app_meta_data existe aqui porque public.is_admin() (baseline) cai
    // nele quando não há JWT na sessão — as provas logam admin por aqui.
    await cliente.query(`
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text,
        phone text,
        raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    console.log(
      "[provisionar] auth.* emulado (uid lê app.rpc.user_id, users com raw_app_meta_data)",
    );

    // 4. Publication de realtime (a 20261061000000 pressupõe a da plataforma).
    const pub = await cliente.query(
      "SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'",
    );
    if (pub.rowCount === 0) {
      await cliente.query("CREATE PUBLICATION supabase_realtime");
      console.log("[provisionar] publication supabase_realtime criada");
    }

    // 4-bis. Storage mínimo (a 20261071000000 INSERTA em storage.buckets).
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id text PRIMARY KEY,
        name text,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[],
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS storage.objects (
        id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
        bucket_id text REFERENCES storage.buckets(id),
        name text,
        key text,
        owner uuid,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Achado 9 da revisão de risco de 26/09/2026 (rodada 2): sem isto, o
    // mutante `storage_insert` (a policy de INSERT do bucket `devolucoes`
    // perder o `split_part(name,'/',1) = auth.uid()`) sobrevivia à prova viva
    // inteira — não por a RLS estar certa, mas porque `authenticated` nem
    // TINHA grant de tabela em `storage.*` aqui, e QUALQUER insert (mutado ou
    // não) morria antes de a policy ser avaliada, com "permission denied for
    // schema storage". No Supabase de verdade `storage.objects`/`buckets` já
    // nascem com GRANT ALL para anon/authenticated/service_role — é a RLS
    // (as policies das migrations) quem faz a guarda, nunca o grant de
    // tabela. Replica esse detalhe da plataforma aqui.
    await cliente.query(
      "GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role",
    );
    await cliente.query(
      "GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role",
    );
    // No Supabase de verdade `storage.objects` já nasce com RLS LIGADO pela
    // plataforma — as migrations do app só ACRESCENTAM policy em cima. Sem
    // isto aqui, `CREATE POLICY` das migrations (20261175000000) fica sem
    // efeito nenhum: toda policy exige RLS ligado na tabela para valer, e
    // nenhuma migration deste repo liga RLS em storage.objects (não devia —
    // não é dela, é da plataforma). `storage.buckets` fica de fora de
    // propósito: nenhuma migration cria policy nela, e ligar RLS sem
    // nenhuma policy negaria leitura a anon/authenticated que hoje não
    // precisa de guarda nenhuma aqui.
    await cliente.query(
      "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY",
    );
    console.log("[provisionar] storage mínimo criado");

    // 5. pg_cron emulado por stub. Assinaturas nas assinaturas que a fila de
    // migrations usa (schedule(text,text,text) -> bigint; unschedule(text) ->
    // boolean; cron.job com jobname). O agendador nunca dispara nada.
    await cliente.query(`
      CREATE TABLE cron.job (
        jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        jobname text UNIQUE,
        schedule text NOT NULL,
        command text NOT NULL
      )
    `);
    await cliente.query(`
      CREATE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text)
      RETURNS bigint LANGUAGE plpgsql
      AS $stub$
      DECLARE
        v_id bigint;
      BEGIN
        INSERT INTO cron.job (jobname, schedule, command)
        VALUES (p_jobname, p_schedule, p_command)
        ON CONFLICT (jobname) DO UPDATE
          SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
        RETURNING jobid INTO v_id;
        RETURN v_id;
      END;
      $stub$
    `);
    await cliente.query(`
      CREATE FUNCTION cron.unschedule(p_jobname text) RETURNS boolean LANGUAGE plpgsql
      AS $stub$
      DECLARE
        v_apagou boolean;
      BEGIN
        DELETE FROM cron.job WHERE jobname = p_jobname;
        v_apagou := FOUND;
        RETURN v_apagou;
      END;
      $stub$
    `);
    console.log(
      "[provisionar] pg_cron emulado por stub (cron.job/schedule/unschedule; nada dispara)",
    );

    await cliente.end();
    console.log("[provisionar] efêmero provisionado.");
  } catch (erro) {
    falhar("FALHOU", `Provisionamento do efêmero: ${erro.message}`);
  }
}

main();
