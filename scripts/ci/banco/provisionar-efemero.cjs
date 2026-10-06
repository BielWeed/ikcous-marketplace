#!/usr/bin/env node

/**
 * Provisiona o banco EFÊMERO do CI com o que o Supabase dá de fábrica e que
 * as migrations assumem existir — o mesmo provisionamento que o
 * db-prove-banco-zerado.cjs emula no banco de prova dele, aqui aplicado ao
 * service do job:
 *
 *   1. Papéis de fábrica (anon, authenticated, service_role, NOLOGIN) — os
 *      GRANT das migrations falham sem eles; no servidor do projeto os papéis
 *      nascem com o cluster, no service do CI não.
 *   2. Esquema `extensions` + extensões contrib que as migrations pedem:
 *      unaccent e pg_trgm (WITH SCHEMA extensions). pg_cron e pg_net NÃO
 *      existem no image oficial do postgres — avisam aqui; pg_cron ganha um
 *      STUB (passo 6: schema cron, cron.job, cron.schedule/unschedule) e os
 *      arquivos que pedem as extensões são REAPLICADOS no apply com as
 *      linhas `CREATE EXTENSION` comentadas (util.cjs,
 *      aplicarComProvisionamento) — o corpo deles entra no banco, o
 *      agendamento não dispara (mesma ressalva da casa: não cobre o
 *      agendamento, cobre o schema).
 *   3. Emulação do auth.* de fábrica: auth.uid()/auth.role() como stubs e
 *      auth.users com id/email/phone — é o que as policies e views validam
 *      na criação (medido no ADR 0003; o corpo opaco de função nunca roda
 *      durante o apply).
 *
 * USO: node scripts/ci/banco/provisionar-efemero.cjs
 * (DATABASE_URL do service + CI_BANCO_EFEMERO=1 — ver util.cjs)
 */

"use strict";

const { sair, lerDatabaseUrlEfemero } = require("./util.cjs");

const PAPEIS_DE_FABRICA = ["anon", "authenticated", "service_role"];

// Contrib do image oficial postgres:17 — o conjunto que a fila de migrations
// REFERENCIA sem nunca criar (o Supabase provisiona de fábrica; medido na
// 1ª rodada de depuração: extensions.uuid_generate_v4 (uuid-ossp) e
// extensions.crypt/gen_salt (pgcrypto) derrubavam o baseline). pg_cron e
// pg_net não existem no image oficial — avisados e não instalados.
const EXTENSOES_CONTRIB = [
  { nome: "unaccent", esquema: "extensions" },
  { nome: "pg_trgm", esquema: "extensions" },
  { nome: "uuid-ossp", esquema: "extensions" },
  { nome: "pgcrypto", esquema: "extensions" },
];

async function main() {
  const url = lerDatabaseUrlEfemero();
  const { Client } = require("pg");
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    sair(
      "INDETERMINADO",
      `Não conectei no banco efêmero: ${erro.message}\n(DATABASE_URL correta? Este script nunca conecta a banco real — ver util.cjs.)`,
    );
  }

  try {
    await cliente.query("RESET ALL");

    // O schema public nasce com o banco no CI; na bancada local de depuração
    // (que derruba tudo a cada rodada) ele precisa voltar — mesma cura que o
    // ADR 0003 deu ao baseline.
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "public"');

    // 1. Papéis de fábrica. CREATE ROLE não tem IF NOT EXISTS: DO block.
    const criados = [];
    for (const papel of PAPEIS_DE_FABRICA) {
      const existe = await cliente.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [papel],
      );
      if (existe.rowCount === 0) {
        // Nomes vêm de lista fixa deste arquivo — nunca entrada externa.
        await cliente.query(`CREATE ROLE "${papel}" NOLOGIN`);
        criados.push(papel);
      }
    }
    console.log(
      `[provisionar] papéis de fábrica: ${criados.length ? `${criados.join(", ")} criados` : "já existiam"}`,
    );

    // 1.5. DEFAULT PRIVILEGES de fábrica — o Supabase provisiona o projeto
    // com ALTER DEFAULT PRIVILEGES granting ALL em tabelas/sequências e
    // EXECUTE em funções novas de public a anon/authenticated/service_role;
    // a proteção vem da RLS (policies negam por padrão), não do grant.
    // Sem isto o banco do zero diverge do estado que as migrations de
    // blindagem (20261090*/091*) pressupõem — achado da 1ª rodada de
    // depuração: a guarda da 114 reprova "anon perdeu EXECUTE em v23/v24"
    // porque sem os defaults de fábrica NENHUMA função nasce alcançável.
    for (const papel of PAPEIS_DE_FABRICA) {
      // Nomes vêm de lista fixa deste arquivo — nunca entrada externa.
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
    console.log(
      "[provisionar] default privileges de fábrica (public: ALL em tabelas/sequências, EXECUTE em funções → anon/authenticated/service_role).",
    );

    // 2. Esquema de extensões + as contrib que as migrations citam.
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "extensions"');
    const ausentes = [];
    for (const ext of EXTENSOES_CONTRIB) {
      try {
        await cliente.query(
          `CREATE EXTENSION IF NOT EXISTS "${ext.nome}" WITH SCHEMA "${ext.esquema}"`,
        );
        console.log(
          `[provisionar] extensão ${ext.nome} → schema ${ext.esquema}`,
        );
      } catch (erro) {
        ausentes.push(`${ext.nome}: ${erro.message}`);
      }
    }
    for (const extIndisponivel of ["pg_cron", "pg_net"]) {
      console.log(
        `[provisionar] AVISO: extensão ${extIndisponivel} não existe no image oficial do postgres — arquivos que a pedem serão REAPLICADOS no apply com a linha CREATE EXTENSION comentada (não cobre o agendamento, cobre o schema).`,
      );
    }
    if (ausentes.length) {
      sair(
        "FALHOU",
        `Extensão contrib indisponível no image (não é provisioning de Supabase, é falta real): ${ausentes.join("; ")}`,
      );
    }

    // 3. auth.* de fábrica — receita do db-prove-banco-zerado.cjs (ADR 0003):
    // policies chamam auth.uid()/auth.role() e as views leem auth.users.
    await cliente.query("CREATE SCHEMA IF NOT EXISTS auth");
    await cliente.query(
      `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
       AS $stub$ SELECT NULL::uuid $stub$`,
    );
    await cliente.query(
      `CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
       AS $stub$ SELECT NULL::text $stub$`,
    );
    // raw_app_meta_data existe aqui porque public.is_admin() (baseline) cai
    // nele no fallback, e as funções da migration 83 (crm__pedidos_nao_pagos/
    // crm__nunca_comprou) leem `auth.users.raw_app_meta_data ->> 'role'` no
    // próprio corpo — sem a coluna, CREATE OR REPLACE FUNCTION dessas duas
    // (LANGUAGE sql, corpo validado contra o catálogo na criação) explode
    // com 42703 (undefined_column) já na 2ª passada de aplicação (achado da
    // re-revisão de risco, 27/09/2026; mesma coluna que tests/banco/
    // provisionar.cjs já tinha para a frente rpc-ci).
    await cliente.query(
      `CREATE TABLE auth.users (
         id uuid PRIMARY KEY,
         email text,
         phone text,
         raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
       )`,
    );
    console.log(
      "[provisionar] auth.* de fábrica emulado (uid/role stubs + auth.users id/email/phone/raw_app_meta_data).",
    );

    // 4. Publication de fábrica do realtime (achado da 1ª rodada de depuração:
    // a 20261061000000 faz ALTER PUBLICATION supabase_realtime pressupondo a
    // publication que a plataforma Supabase cria — nenhuma migration a cria;
    // sem ela, toda loja recém-nascida falharia no mesmo ponto).
    const pub = await cliente.query(
      "SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'",
    );
    if (pub.rowCount === 0) {
      await cliente.query("CREATE PUBLICATION supabase_realtime");
      console.log(
        "[provisionar] publication supabase_realtime criada (fábrica da plataforma, emulada).",
      );
    }

    // 5. Schema de storage — o serviço de storage do Supabase provisiona o
    // schema `storage` FORA das migrations (achado da 1ª rodada de depuração:
    // a 20261071000000 faz INSERT em storage.buckets e cria policies em
    // storage.objects sem criar nenhuma das duas). Emulação FIEL AO MÍNIMO
    // que a fila referencia: as colunas de buckets citadas nos INSERT/SELECT
    // (id, name, public, file_size_limit, allowed_mime_types) e a coluna de
    // objects citada nas policies (bucket_id). O job prova SCHEMA, não o
    // serviço de storage — fidelidade além do referido não muda o veredito.
    await cliente.query("CREATE SCHEMA IF NOT EXISTS storage");
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id text PRIMARY KEY,
        name text,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[],
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
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
      )`);
    console.log(
      "[provisionar] storage.buckets + storage.objects mínimos criados (fábrica do serviço de storage, emulada).",
    );

    // 6. pg_cron emulado por stub — a MESMA emulação de tests/banco/
    // provisionar.cjs (passo 5, frente rpc-ci): schema cron, tabela cron.job e
    // cron.schedule(text,text,text) -> bigint / cron.unschedule(text) ->
    // boolean nas assinaturas que a fila usa. O agendador nunca dispara nada.
    // POR QUE ESTÁ AQUI (PR 766, 04/10/2026): sem o schema `cron`, a
    // 20260901 (que agenda a expiração) falhava e era PULADA INTEIRA — o banco
    // do ci-banco ficava sem `devolver_uso_cupom` e com `confirmar_pagamento`
    // no corpo da 20260810, um estado que nenhuma loja tem; a 20261195, que
    // confere o corpo vivo por hash, recusava com B1_BASELINE_DIVERGENT.
    await cliente.query('CREATE SCHEMA IF NOT EXISTS "cron"');
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS cron.job (
        jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        jobname text UNIQUE,
        schedule text NOT NULL,
        command text NOT NULL
      )`);
    await cliente.query(`
      CREATE OR REPLACE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text)
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
      $stub$`);
    await cliente.query(`
      CREATE OR REPLACE FUNCTION cron.unschedule(p_jobname text) RETURNS boolean LANGUAGE plpgsql
      AS $stub$
      DECLARE
        v_apagou boolean;
      BEGIN
        DELETE FROM cron.job WHERE jobname = p_jobname;
        v_apagou := FOUND;
        RETURN v_apagou;
      END;
      $stub$`);
    console.log(
      "[provisionar] pg_cron emulado por stub (cron.job/schedule/unschedule; nada dispara).",
    );

    await cliente.end();
    sair(
      "OK",
      "Banco efêmero provisionado: papéis, extensões contrib, auth.* de fábrica e pg_cron emulado.",
    );
  } catch (erro) {
    await cliente.end().catch(() => {});
    sair("FALHOU", `Provisionamento falhou: ${erro.message}`);
  }
}

main().catch((erro) =>
  sair("INDETERMINADO", erro?.stack ? erro.stack : String(erro)),
);
