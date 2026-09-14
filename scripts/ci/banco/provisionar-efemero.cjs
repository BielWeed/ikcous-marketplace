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
 *      existem no image oficial do postgres — avisam aqui e os arquivos que
 *      os pedem são PULADOS com aviso no apply (mesma ressalva da casa: não
 *      cobre o agendamento, cobre o schema).
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
        `[provisionar] AVISO: extensão ${extIndisponivel} não existe no image oficial do postgres — arquivos que a pedem serão PULADOS com aviso no apply (não cobre o agendamento, cobre o schema).`,
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
    await cliente.query(
      `CREATE TABLE auth.users (
         id uuid PRIMARY KEY,
         email text,
         phone text
       )`,
    );
    console.log(
      "[provisionar] auth.* de fábrica emulado (uid/role stubs + auth.users id/email/phone).",
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

    await cliente.end();
    sair(
      "OK",
      "Banco efêmero provisionado: papéis, extensões contrib e auth.* de fábrica.",
    );
  } catch (erro) {
    await cliente.end().catch(() => {});
    sair("FALHOU", `Provisionamento falhou: ${erro.message}`);
  }
}

main().catch((erro) =>
  sair("INDETERMINADO", erro?.stack ? erro.stack : String(erro)),
);
