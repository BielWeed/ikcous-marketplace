"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os da migration 20261480, do rollback dela e
 * das consultas 184a/184b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261480000000_a_caderneta_fecha_para_o_service_role.sql contra o Postgres EFÊMERO com as migrations aplicadas
 * do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: public.frota_lojas (o endereço e a chave publicável do banco de cada loja) e public.frota_segredo (o hash da chave da frota)
 * davam TODOS os privilégios de tabela ao service_role (o ALTER DEFAULT PRIVILEGES do schema public, que o provisionar.cjs reproduz).
 * Agora o service_role não alcança nenhuma das duas; nada mais muda.
 *
 * O QUE SE PROVA (o service_role ganha BYPASSRLS só dentro de cada transação, como no Supabase de verdade, para o ANTES mostrar o
 * vazamento real e o DEPOIS provar que o BYPASSRLS não basta):
 *   (a) ANTES (o estado que o rollback reproduz): como service_role, SELECT lê a frota e o hash, UPDATE troca o endereço de uma loja;
 *   (b) DEPOIS: como service_role, SELECT, INSERT, UPDATE e DELETE nas duas recebem 42501; anon e authenticated também; ACL sem entrada
 *       do service_role; o anon ainda resolve a loja pelas duas portas (chave certa: a loja; chave errada: nada); o dono ainda lê tudo;
 *   (c) linha que já existia antes da migration: nada muda nela;
 *   (d) reaplicar 2x (LF e CRLF) não muda nada;
 *   (e) rollback devolve a ACL BYTE A BYTE (igual à de uma tabela nova do dono com o REVOKE da 20261141), 2x igual; reaplicar fecha de novo;
 *   (f) pré-voo recusa estado divergente (B1_BASELINE_DIVERGENT) sem escrever; o rollback também;
 *   (g) transação: sem COMMIT escondido; leitor segurando a caderneta não bloqueia; DDL na mesma tabela faz a migration desistir em 5 s;
 *   (h) consultas 184a/184b EXECUTADAS no catálogo real (como authenticated), com defeitos plantados;
 *   (i) MUTANTES da migration e do rollback: o comportamento cai pelo motivo certo, e o pós-voo de cada um recusa sozinho.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-caderneta-fecha-para-o-service-role-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
// A 20261490 sucede os corpos das portas da caderneta e o pre-voo desta migration (o md5 da 20261460) a recusaria: o clone e exclusivo,
// entao main() a desfaz (comum + destrutivo, COMITADO) antes de qualquer prova. Definicao unica no modulo abaixo.
const {
  desfazerChaveSemBcryptNoClone,
} = require("./a-caderneta-confere-a-chave-sem-bcrypt-posterior.cjs");

const NOME = "20261480000000_a_caderneta_fecha_para_o_service_role.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A184 = "184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado";
const B184 = "184b-antes-a-caderneta-fecha-para-o-service-role-ausente";

const REVOKE =
  "REVOKE ALL ON TABLE public.frota_lojas, public.frota_segredo FROM service_role;";
const GRANT =
  "GRANT ALL ON TABLE public.frota_lojas, public.frota_segredo TO service_role;";
const V1 = "public.resolver_loja(text, text)";
const V2 = "public.resolver_loja_com_estado(text, text)";
const TABELAS = ["frota_lojas", "frota_segredo"];
const PRIVILEGIOS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];
const CHAVE = "chave-da-prova-1480";
const LOJA = {
  id: "l1480-cofre",
  nome: "Loja da prova 1480",
  dominio_publico: "cofre.l1480.teste",
  project_ref: "aaaaaaaaaaaaaaaaaaad",
  supabase_url: "https://aaaaaaaaaaaaaaaaaaad.supabase.co",
  publishable_key: "pk_l1480_cofre",
};

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1480_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `fn` numa transação SEMPRE desfeita, com o service_role com BYPASSRLS (como no Supabase) só dentro dela. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    await c.query("ALTER ROLE service_role BYPASSRLS");
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
async function semente(c) {
  // A 20261470 deixa a loja nascer ativa sem a porta (o gatilho só recusa nascer fora de ativa).
  await c.query(
    "INSERT INTO public.frota_segredo (id, hash) VALUES (1, extensions.crypt($1, extensions.gen_salt('bf', 4))) ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash",
    [CHAVE],
  );
  await c.query(
    "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa) VALUES ($1, $2, $3, $4, $5, $6, true)",
    [
      LOJA.id,
      LOJA.nome,
      LOJA.dominio_publico,
      LOJA.project_ref,
      LOJA.supabase_url,
      LOJA.publishable_key,
    ],
  );
}
/** Tenta `sql` como `papel`; devolve o código do erro ("ok" se passou) e as linhas. */
async function como(c, papel, sql, params = []) {
  let linhas = null;
  const e = await tentar(c, async () => {
    await c.query(`SET LOCAL ROLE ${papel}`);
    linhas = (await c.query(sql, params)).rows;
  });
  return { codigo: e ? e.code : "ok", linhas, erro: e };
}
const ACL_VIVA = async (c) =>
  (
    await c.query(
      "SELECT c.relname, c.relacl::text AS acl FROM pg_class c WHERE c.oid IN ('public.frota_lojas'::regclass, 'public.frota_segredo'::regclass) ORDER BY 1",
    )
  ).rows;
async function foto(c) {
  const tb = await c.query(
    `SELECT c.relname, c.oid::int AS oid, c.relowner::int AS dono, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity,
            (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(a.attacl::text, '-'), ',' ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT string_agg(pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid) AS restricoes,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
            (SELECT string_agg(t.tgname || ':' || t.tgenabled::text, ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS gatilhos
       FROM pg_class c WHERE c.oid IN ('public.frota_lojas'::regclass, 'public.frota_segredo'::regclass) ORDER BY 1`,
  );
  const fn = await c.query(
    `SELECT p.proname, p.oid::int AS oid, md5(replace(p.prosrc, E'\\r', '')) AS h, p.proacl::text AS acl, p.proowner::int AS dono, p.prosecdef
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado') ORDER BY 1`,
  );
  return { tb: tb.rows, fn: fn.rows };
}
/** As linhas da caderneta, lidas como o dono. */
async function retrato(c) {
  const l = await c.query(
    "SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY f.id)) AS h, count(*)::int AS n FROM public.frota_lojas f",
  );
  const s = await c.query(
    "SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY f.id)) AS h, count(*)::int AS n FROM public.frota_segredo f",
  );
  return { lojas: l.rows[0], segredo: s.rows[0] };
}
/** Volta ao estado de antes desta migration (service_role com tudo) DENTRO da transação do chamador. */
async function voltarAoAntes(c) {
  await c.query(ROLLBACK);
  for (const t of TABELAS)
    assert.equal(
      (
        await c.query(
          "SELECT has_table_privilege('service_role', $1::regclass, 'SELECT') AS x",
          [`public.${t}`],
        )
      ).rows[0].x,
      true,
      `base de antes: service_role com SELECT em ${t}`,
    );
}
const SQL_V = (fn) => `SELECT * FROM ${fn.replace("(text, text)", "")}($1, $2)`;

// ---------------------------------------------------------------------------
// (a) ANTES: o vazamento que a migration fecha (o rollback reproduz esse estado)
// ---------------------------------------------------------------------------
async function antes(c) {
  await desfeita(c, async () => {
    await semente(c);
    await voltarAoAntes(c);
    const lojas = await como(
      c,
      "service_role",
      "SELECT id, supabase_url, publishable_key FROM public.frota_lojas WHERE id = $1",
      [LOJA.id],
    );
    assert.equal(lojas.codigo, "ok", "antes: service_role lia frota_lojas");
    assert.deepEqual(lojas.linhas, [
      {
        id: LOJA.id,
        supabase_url: LOJA.supabase_url,
        publishable_key: LOJA.publishable_key,
      },
    ]);
    const segredo = await como(
      c,
      "service_role",
      "SELECT count(*)::int AS n FROM public.frota_segredo",
    );
    assert.deepEqual(
      [segredo.codigo, segredo.linhas],
      ["ok", [{ n: 1 }]],
      "antes: service_role lia o hash da chave da frota",
    );
    const troca = await como(
      c,
      "service_role",
      "UPDATE public.frota_lojas SET supabase_url = 'https://outro.supabase.co' WHERE id = $1 RETURNING id",
      [LOJA.id],
    );
    assert.deepEqual(
      [troca.codigo, troca.linhas?.length],
      ["ok", 1],
      "antes: service_role trocava o endereço de uma loja",
    );
  });
}

// ---------------------------------------------------------------------------
// (b) DEPOIS: o comportamento (o MESMO que os mutantes têm de derrubar)
// ---------------------------------------------------------------------------
async function comportamento(c) {
  await semente(c);
  // ACL no catálogo.
  for (const t of TABELAS) {
    for (const p of PRIVILEGIOS)
      for (const papel of ["service_role", "anon", "authenticated"])
        assert.equal(
          (
            await c.query(
              "SELECT has_table_privilege($1, $2::regclass, $3) AS x",
              [papel, `public.${t}`, p],
            )
          ).rows[0].x,
          false,
          `catálogo: ${papel} sem ${p} em ${t}`,
        );
    assert.equal(
      (
        await c.query(
          "SELECT has_any_column_privilege('service_role', $1::regclass, 'SELECT, INSERT, UPDATE, REFERENCES') AS x",
          [`public.${t}`],
        )
      ).rows[0].x,
      false,
      `catálogo: service_role sem privilégio de coluna em ${t}`,
    );
  }
  // A tentativa: 42501 em tudo, mesmo com BYPASSRLS.
  for (const [papel, sql, params, rotulo] of [
    [
      "service_role",
      "SELECT * FROM public.frota_lojas",
      [],
      "SELECT em frota_lojas",
    ],
    [
      "service_role",
      "SELECT * FROM public.frota_segredo",
      [],
      "SELECT em frota_segredo",
    ],
    [
      "service_role",
      "SELECT id FROM public.frota_lojas WHERE id = $1",
      [LOJA.id],
      "SELECT de uma coluna em frota_lojas",
    ],
    [
      "service_role",
      "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key) VALUES ('l1480-intrusa', 'x', 'intrusa.l1480.teste', 'aaaaaaaaaaaaaaaaaaae', 'https://x.supabase.co', 'pk')",
      [],
      "INSERT em frota_lojas",
    ],
    [
      "service_role",
      "INSERT INTO public.frota_segredo (id, hash) VALUES (2, 'x')",
      [],
      "INSERT em frota_segredo",
    ],
    [
      "service_role",
      "UPDATE public.frota_lojas SET supabase_url = 'https://outro.supabase.co' WHERE id = $1",
      [LOJA.id],
      "UPDATE em frota_lojas",
    ],
    [
      "service_role",
      "UPDATE public.frota_segredo SET hash = 'x'",
      [],
      "UPDATE em frota_segredo",
    ],
    [
      "service_role",
      "DELETE FROM public.frota_lojas WHERE id = $1",
      [LOJA.id],
      "DELETE em frota_lojas",
    ],
    [
      "service_role",
      "DELETE FROM public.frota_segredo",
      [],
      "DELETE em frota_segredo",
    ],
    [
      "anon",
      "SELECT * FROM public.frota_lojas",
      [],
      "SELECT em frota_lojas (anon)",
    ],
    [
      "authenticated",
      "SELECT * FROM public.frota_segredo",
      [],
      "SELECT em frota_segredo (authenticated)",
    ],
  ]) {
    const r = await como(c, papel, sql, params);
    assert.equal(r.codigo, "42501", `${papel}: ${rotulo} recusado (42501)`);
  }
  // O porteiro não sente: o anon resolve a loja pelas duas portas; chave errada não resolve; service_role não executa as portas.
  for (const fn of [V1, V2]) {
    const certo = await como(c, "anon", SQL_V(fn), [
      LOJA.dominio_publico,
      CHAVE,
    ]);
    assert.equal(certo.codigo, "ok", `porteiro: anon executa ${fn}`);
    assert.deepEqual(
      certo.linhas.map((l) => [l.id, l.supabase_url, l.publishable_key]),
      [[LOJA.id, LOJA.supabase_url, LOJA.publishable_key]],
      `porteiro: anon resolve a loja por ${fn}`,
    );
    const errado = await como(c, "anon", SQL_V(fn), [
      LOJA.dominio_publico,
      "errada",
    ]);
    assert.deepEqual(
      [errado.codigo, errado.linhas],
      ["ok", []],
      `porteiro: chave errada em ${fn} não resolve`,
    );
    assert.equal(
      (await como(c, "service_role", SQL_V(fn), [LOJA.dominio_publico, CHAVE]))
        .codigo,
      "42501",
      `porteiro: service_role não executa ${fn}`,
    );
  }
  // O dono continua lendo e escrevendo.
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM public.frota_lojas WHERE id = $1",
        [LOJA.id],
      )
    ).rows[0].n,
    1,
    "dono: lê a caderneta",
  );
  for (const { relname, acl } of await ACL_VIVA(c))
    assert(
      !/service_role=/.test(acl ?? ""),
      `ACL: nenhuma entrada do service_role em ${relname} (${acl})`,
    );
}

// ---------------------------------------------------------------------------
// (c) linha que já existia antes da migration
// ---------------------------------------------------------------------------
async function dadoExistente(c) {
  await desfeita(c, async () => {
    await semente(c);
    await voltarAoAntes(c);
    const dados = await retrato(c);
    assert(dados.lojas.n >= 1 && dados.segredo.n === 1, "há linhas antes");
    await c.query(MIGRATION);
    assert.deepEqual(
      await retrato(c),
      dados,
      "a migration não toca linha nenhuma",
    );
    await c.query(ROLLBACK);
    assert.deepEqual(
      await retrato(c),
      dados,
      "o rollback não toca linha nenhuma",
    );
  });
}

// ---------------------------------------------------------------------------
// (d) reaplicar 2x (LF e CRLF)
// ---------------------------------------------------------------------------
async function reaplicar(c) {
  await desfeita(c, async () => {
    await semente(c);
    const antesDe = await foto(c);
    const dados = await retrato(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antesDe,
      "reaplicar (LF, CRLF, LF) não muda OID, ACL, coluna nem porta",
    );
    assert.deepEqual(await retrato(c), dados, "reaplicar não toca linha");
  });
}

// ---------------------------------------------------------------------------
// (e) rollback: a ACL de antes BYTE A BYTE
// ---------------------------------------------------------------------------
async function rollbacks(c) {
  await desfeita(c, async () => {
    const depois = await foto(c);
    // O molde independente: uma tabela nova do dono no schema public (o default privilege) com o REVOKE que a 20261141 faz.
    await c.query("CREATE TABLE public.prova_1480_molde (id int)");
    await c.query(
      "REVOKE ALL ON public.prova_1480_molde FROM PUBLIC, anon, authenticated",
    );
    const molde = (
      await c.query(
        "SELECT relacl::text AS acl FROM pg_class WHERE oid = 'public.prova_1480_molde'::regclass",
      )
    ).rows[0].acl;
    await c.query("DROP TABLE public.prova_1480_molde");
    assert.equal(
      molde,
      "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "o estado de antes medido no efêmero",
    );
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      assert.deepEqual(
        await ACL_VIVA(c),
        TABELAS.map((relname) => ({ relname, acl: molde })),
        `rollback ${vez}: a ACL volta BYTE A BYTE à de antes`,
      );
    }
    const desfeito = await foto(c);
    // Só a ACL difere entre depois e desfeito.
    assert.deepEqual(
      { ...desfeito, tb: desfeito.tb.map((t) => ({ ...t, acl: null })) },
      { ...depois, tb: depois.tb.map((t) => ({ ...t, acl: null })) },
      "o rollback só mexe na ACL",
    );
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      depois,
      "reaplicar depois do rollback volta ao estado da migration",
    );
  });
}

// ---------------------------------------------------------------------------
// (f) pré-voo
// ---------------------------------------------------------------------------
const CRIAR_OUTRO = "CREATE ROLE prova_1480_outro NOLOGIN";
const SABOTAGENS_DA_BASE = [
  [
    "service_role só com parte (sem DELETE em frota_lojas)",
    ["REVOKE DELETE ON public.frota_lojas FROM service_role"],
  ],
  [
    "service_role com GRANT OPTION em frota_segredo",
    ["GRANT ALL ON public.frota_segredo TO service_role WITH GRANT OPTION"],
  ],
  [
    "service_role com privilégio de coluna",
    ["GRANT SELECT (nome) ON public.frota_lojas TO service_role"],
  ],
  [
    "uma com tudo e a outra sem nada",
    ["REVOKE ALL ON public.frota_segredo FROM service_role"],
  ],
  [
    "privilégio concedido por outro papel",
    [
      CRIAR_OUTRO,
      "GRANT ALL ON public.frota_lojas TO prova_1480_outro WITH GRANT OPTION",
      "SET LOCAL ROLE prova_1480_outro",
      "GRANT SELECT ON public.frota_lojas TO service_role",
      "RESET ROLE",
    ],
  ],
  [
    "resolver_loja com outro corpo",
    [
      "CREATE OR REPLACE FUNCTION public.resolver_loja(p_host text, p_chave text) RETURNS TABLE (id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text) LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = '' AS $f$ BEGIN RETURN; END $f$",
    ],
  ],
  [
    "resolver_loja_com_estado ausente",
    ["DROP FUNCTION public.resolver_loja_com_estado(text, text)"],
  ],
  [
    "frota_segredo com outro dono",
    [CRIAR_OUTRO, "ALTER TABLE public.frota_segredo OWNER TO prova_1480_outro"],
  ],
  ["frota_segredo ausente", ["DROP TABLE public.frota_segredo"]],
];
async function preVoo(c) {
  await desfeita(c, async () => {
    await voltarAoAntes(c);
    const base = await foto(c);
    for (const [nome, sabotagem] of SABOTAGENS_DA_BASE) {
      const e = await tentar(c, async () => {
        for (const s of sabotagem) await c.query(s);
        await c.query(MIGRATION);
      });
      assert.match(
        e?.message ?? "(aplicou)",
        /B1_BASELINE_DIVERGENT/,
        `pré-voo deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base, "nenhuma recusa escreveu nada");
    assert.equal(
      await tentar(c, () => c.query(MIGRATION)),
      null,
      "controle: sem sabotagem, a mesma base aplica",
    );
  });
  // Depois da migration: service_role com só parte também recusa (reaplicar não cobre estado que o rollback não reproduz).
  await desfeita(c, async () => {
    const base = await foto(c);
    const e = await tentar(c, async () => {
      await c.query(
        "GRANT SELECT ON public.frota_lojas, public.frota_segredo TO service_role",
      );
      await c.query(MIGRATION);
    });
    assert.match(
      e?.message ?? "(aplicou)",
      /B1_BASELINE_DIVERGENT/,
      "pré-voo recusa service_role só com SELECT",
    );
    // O rollback recusa o que não é nem o estado da migration nem o de antes.
    for (const [nome, sabotagem] of [
      [
        "service_role só com SELECT",
        "GRANT SELECT ON public.frota_lojas, public.frota_segredo TO service_role",
      ],
      [
        "uma com tudo e a outra sem nada",
        "GRANT ALL ON public.frota_lojas TO service_role",
      ],
      [
        "privilégio de coluna",
        "GRANT UPDATE (supabase_url) ON public.frota_lojas TO service_role",
      ],
    ]) {
      const r = await tentar(c, async () => {
        await c.query(sabotagem);
        await c.query(ROLLBACK);
      });
      assert.match(
        r?.message ?? "(desfez)",
        /B1_BASELINE_DIVERGENT/,
        `rollback deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base);
  });
  return SABOTAGENS_DA_BASE.length + 1;
}

// ---------------------------------------------------------------------------
// (g) transação: sem COMMIT escondido; leitor não bloqueia; DDL na mesma tabela desiste em 5 s
// ---------------------------------------------------------------------------
async function transacao(c, url) {
  await c.query("BEGIN");
  await voltarAoAntes(c);
  await c.query("COMMIT");
  try {
    const base = await foto(c);
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("ROLLBACK");
    assert.deepEqual(
      await foto(c),
      base,
      "aplicar e desfazer não deixa nada: não há COMMIT dentro da migration",
    );
    const outro = new Client({ connectionString: url });
    await outro.connect();
    try {
      // O porteiro lendo a caderneta (trava ACCESS SHARE aberta) não segura a migration.
      await outro.query("BEGIN");
      await outro.query("SELECT count(*) FROM public.frota_lojas");
      await c.query("BEGIN");
      let t0 = Date.now();
      await c.query(MIGRATION);
      assert(
        Date.now() - t0 < 4000,
        `leitor aberto: a migration passou em ${Date.now() - t0} ms`,
      );
      await c.query("ROLLBACK");
      await outro.query("ROLLBACK");
      // Alguém ALTERANDO a definição de frota_lojas (a linha dela em pg_class) segura o REVOKE: espera o lock_timeout e desiste.
      await outro.query("BEGIN");
      await outro.query(
        "ALTER TABLE public.frota_lojas ENABLE ROW LEVEL SECURITY",
      );
      t0 = Date.now();
      await c.query("BEGIN");
      let e = null;
      try {
        await c.query(MIGRATION);
      } catch (err) {
        e = err;
      } finally {
        await c.query("ROLLBACK");
      }
      const ms = Date.now() - t0;
      assert.equal(e?.code, "55P03", "DDL aberta na caderneta: lock_timeout");
      assert(
        ms >= 4500 && ms < 20000,
        `desistiu em ${ms} ms (lock_timeout de 5 s)`,
      );
      await outro.query("ROLLBACK");
    } finally {
      await outro.end();
    }
    assert.deepEqual(await foto(c), base, "a desistência não escreveu nada");
  } finally {
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("COMMIT");
  }
  for (const { acl } of await ACL_VIVA(c)) assert(!/service_role=/.test(acl));
}

// ---------------------------------------------------------------------------
// (h) as consultas 184a/184b, EXECUTADAS no catálogo real
// ---------------------------------------------------------------------------
async function consulta(c, nome) {
  const sql = fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
  assert.equal(CONF.contarStatements(sql), 1);
  await c.query("SAVEPOINT leitura_catalogo");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const rows = (await c.query(sql)).rows;
    assert.equal(
      CONF.estruturaDoRolFechado(rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
      null,
      `${nome}: rol fechado`,
    );
    return rows
      .filter((r) => r.ok !== true)
      .map((r) => r.item)
      .sort();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT leitura_catalogo");
  }
}
async function portao(c) {
  const item = (rol, inicio) => {
    const x = CONF.ROL_FECHADO_POR_CONSULTA[rol].filter((i) =>
      i.startsWith(inicio),
    );
    assert.equal(x.length, 1, `item de ${rol}: ${inicio}`);
    return x[0];
  };
  let defeitos = 0;
  const plantar = async (rol, sabotagem, esperados) => {
    await c.query("SAVEPOINT defeito");
    try {
      for (const s of [].concat(sabotagem)) await c.query(s);
      assert.deepEqual(
        await consulta(c, rol),
        esperados.map((i) => item(rol, i)).sort(),
        `${rol} com o defeito "${[].concat(sabotagem).join("; ").slice(0, 90)}" reprova exatamente o item certo`,
      );
      defeitos++;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT defeito");
    }
  };
  const SR_LOJAS = "frota_lojas: service_role";
  const SR_SEGREDO = "frota_segredo: service_role";
  const FECHADAS = "frota_lojas e frota_segredo continuam";
  const UMA_SO = "resolver_loja e resolver_loja_com_estado: uma so";
  const DEFINER = "resolver_loja e resolver_loja_com_estado: SECURITY DEFINER";
  await desfeita(c, async () => {
    await semente(c); // linhas não mudam o veredito (as consultas não leem linha)
    assert.deepEqual(
      await consulta(c, A184),
      [],
      "184a positiva depois da migration",
    );
    assert.deepEqual(
      await consulta(c, B184),
      [item(B184, SR_LOJAS), item(B184, SR_SEGREDO)].sort(),
      "184b reprova só o que a migration fechou",
    );
    for (const [sabotagem, esperados] of [
      ["GRANT SELECT ON public.frota_lojas TO service_role", [SR_LOJAS]],
      ["GRANT TRIGGER ON public.frota_segredo TO service_role", [SR_SEGREDO]],
      [
        "GRANT SELECT (publishable_key) ON public.frota_lojas TO service_role",
        [SR_LOJAS],
      ],
      [
        // Herança: a ACL não cita o service_role, mas ele alcança a tabela por um papel de quem é membro.
        [
          CRIAR_OUTRO,
          "GRANT SELECT ON public.frota_segredo TO prova_1480_outro",
          "GRANT prova_1480_outro TO service_role",
        ],
        [SR_SEGREDO],
      ],
      ["GRANT SELECT ON public.frota_segredo TO anon", [FECHADAS]],
      [
        "GRANT SELECT (hash) ON public.frota_segredo TO authenticated",
        [FECHADAS],
      ],
      // PUBLIC alcança todo papel: reabre a tabela para o service_role também, e as duas linhas reprovam.
      ["GRANT SELECT ON public.frota_lojas TO PUBLIC", [FECHADAS, SR_LOJAS]],
      [
        "CREATE POLICY aberta ON public.frota_lojas FOR SELECT TO anon USING (true)",
        [FECHADAS],
      ],
      [
        "ALTER TABLE public.frota_segredo DISABLE ROW LEVEL SECURITY",
        [FECHADAS],
      ],
      [SABOTAGENS_DA_BASE[5][1][0], [UMA_SO]],
      [
        "CREATE FUNCTION public.resolver_loja(p text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        [UMA_SO, DEFINER],
      ],
      [`ALTER FUNCTION ${V2} SECURITY INVOKER`, [DEFINER]],
      [`REVOKE EXECUTE ON FUNCTION ${V1} FROM anon`, [DEFINER]],
      [`GRANT EXECUTE ON FUNCTION ${V2} TO service_role`, [DEFINER]],
      [`GRANT EXECUTE ON FUNCTION ${V1} TO PUBLIC`, [DEFINER]],
      [
        [
          CRIAR_OUTRO,
          "ALTER TABLE public.frota_segredo OWNER TO prova_1480_outro",
        ],
        [DEFINER],
      ],
    ])
      await plantar(A184, sabotagem, esperados);
    // depois do rollback: a 184b é POSITIVA e a 184a reprova exatamente as duas linhas do service_role
    await c.query(ROLLBACK);
    assert.deepEqual(
      await consulta(c, B184),
      [],
      "184b positiva na base de antes",
    );
    assert.deepEqual(
      await consulta(c, A184),
      [item(A184, SR_LOJAS), item(A184, SR_SEGREDO)].sort(),
    );
    const MESMO_DONO = "frota_lojas e frota_segredo existem";
    const BASE_1460 = "a 20261460000000 esta aplicada";
    for (const [sabotagem, esperados] of [
      ["REVOKE DELETE ON public.frota_lojas FROM service_role", [SR_LOJAS]],
      [
        "GRANT ALL ON public.frota_segredo TO service_role WITH GRANT OPTION",
        [SR_SEGREDO],
      ],
      [
        "GRANT SELECT (id) ON public.frota_segredo TO service_role",
        [SR_SEGREDO],
      ],
      [SABOTAGENS_DA_BASE[4][1], [SR_LOJAS]],
      [
        [
          CRIAR_OUTRO,
          "ALTER FUNCTION public.resolver_loja(text, text) OWNER TO prova_1480_outro",
        ],
        [MESMO_DONO],
      ],
      [SABOTAGENS_DA_BASE[5][1][0], [BASE_1460]],
      [
        "DROP FUNCTION public.resolver_loja_com_estado(text, text)",
        [MESMO_DONO, BASE_1460],
      ],
      ["DROP TABLE public.frota_segredo", [SR_SEGREDO, MESMO_DONO]],
    ])
      await plantar(B184, sabotagem, esperados);
  });
  return defeitos;
}

// ---------------------------------------------------------------------------
// (i) MUTANTES: a MESMA prova de comportamento tem de cair com cada defeito; e o pós-voo de cada um recusa sozinho.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261480000000\$[\s\S]*?END \$preflight_20261480000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posvoo_20261480000000\$[\s\S]*?END \$posvoo_20261480000000\$;\n?/,
      "",
    );
const trocar = (sql, de, para) => {
  assert.equal(
    sql.split(de).length,
    2,
    `mutante: o trecho tem de aparecer UMA vez: ${de.slice(0, 60)}`,
  );
  return sql.replace(de, () => para);
};
const MUTANTES = [
  [
    "sem o REVOKE",
    (s) => trocar(s, REVOKE, ""),
    "catálogo: service_role sem SELECT em frota_lojas",
  ],
  [
    "REVOKE só de SELECT",
    (s) =>
      trocar(
        s,
        REVOKE,
        "REVOKE SELECT ON TABLE public.frota_lojas, public.frota_segredo FROM service_role;",
      ),
    "catálogo: service_role sem INSERT em frota_lojas",
  ],
  [
    "REVOKE só de frota_lojas",
    (s) =>
      trocar(
        s,
        REVOKE,
        "REVOKE ALL ON TABLE public.frota_lojas FROM service_role;",
      ),
    "catálogo: service_role sem SELECT em frota_segredo",
  ],
  [
    "REVOKE que leva junto a porta do porteiro",
    (s) =>
      trocar(
        s,
        REVOKE,
        `${REVOKE}\nREVOKE EXECUTE ON FUNCTION public.resolver_loja_com_estado(text, text) FROM anon;`,
      ),
    "porteiro: anon executa public.resolver_loja_com_estado",
  ],
];
const MUTANTES_DO_ROLLBACK = [
  [
    "rollback que devolve só SELECT",
    (s) => trocar(s, GRANT, GRANT.replace("GRANT ALL", "GRANT SELECT")),
  ],
  [
    "rollback com GRANT OPTION",
    (s) => trocar(s, GRANT, GRANT.replace(";", " WITH GRANT OPTION;")),
  ],
];
async function mutantes(c) {
  const rodar = (sql) =>
    desfeita(c, async () => {
      await voltarAoAntes(c);
      await c.query(sql);
      await comportamento(c);
    });
  await rodar(SEM_CONFERENCIA(MIGRATION)); // controle: verde
  let mortos = 0;
  for (const [nome, muta, fragmento] of MUTANTES) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" não mudou nada`,
    );
    let motivo = null;
    try {
      await rodar(alterada);
    } catch (e) {
      motivo = e;
    }
    assert(motivo, `MUTANTE SOBREVIVEU: ${nome}`);
    assert.equal(
      motivo.code,
      "ERR_ASSERTION",
      `mutante "${nome}" morreu por erro inesperado (e não por asserção): ${motivo.message}`,
    );
    assert(
      motivo.message.includes(fragmento),
      `mutante "${nome}" morreu pelo motivo errado: ${motivo.message.split("\n")[0]}`,
    );
    // O mesmo defeito COM as conferências: o pós-voo recusa sem deixar nada.
    await desfeita(c, async () => {
      await voltarAoAntes(c);
      const e = await tentar(c, () => c.query(muta(MIGRATION)));
      assert.match(
        e?.message ?? "(aplicou)",
        /POSVOO_20261480000000/,
        `pós-voo deveria recusar: ${nome}`,
      );
    });
    mortos++;
    console.log(
      `    mutante morto: ${nome}: ${motivo.message.split("\n")[0].slice(0, 150)}`,
    );
  }
  for (const [nome, muta] of MUTANTES_DO_ROLLBACK) {
    await desfeita(c, async () => {
      const e = await tentar(c, () => c.query(muta(ROLLBACK)));
      assert.match(
        e?.message ?? "(desfez)",
        /POSVOO_ROLLBACK_20261480000000/,
        `pós-voo do rollback deveria recusar: ${nome}`,
      );
    });
    mortos++;
    console.log(`    mutante morto: ${nome}: pós-voo do rollback recusou`);
  }
  return mortos;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    // A sucessora 20261490 sai antes de tudo (ver o require do modulo -posterior no topo).
    await desfazerChaveSemBcryptNoClone(c);
    for (const { relname, acl } of await ACL_VIVA(c))
      assert(
        !/service_role=/.test(acl ?? ""),
        `o clone deve estar com a migration nova (${relname}: ${acl})`,
      );
    await provar(
      "antes: service_role (com BYPASSRLS) lia a frota e o hash e trocava o endereço de uma loja",
      () => antes(c),
    );
    await provar(
      "depois: service_role, anon e authenticated recebem 42501 nas duas tabelas; o anon ainda resolve a loja pelas duas portas",
      () => desfeita(c, () => comportamento(c)),
    );
    await provar("linha que já existia: nada muda nela (nem no rollback)", () =>
      dadoExistente(c),
    );
    await provar("reaplicar 2x (LF e CRLF) não muda nada nem as linhas", () =>
      reaplicar(c),
    );
    await provar(
      "rollback (2x) devolve a ACL byte a byte; reaplicar fecha de novo",
      () => rollbacks(c),
    );
    const recusas = await provar(
      "pré-voo recusa estado divergente sem escrever; o rollback recusa 3",
      () => preVoo(c),
    );
    await provar(
      "transação: sem COMMIT escondido; leitor não bloqueia; DDL aberta faz desistir em 5 s",
      () => transacao(c, url),
    );
    const defeitos = await provar(
      "consultas 184a/184b: catálogo real, defeitos plantados, rollback",
      () => portao(c),
    );
    const mortos = await provar("mutantes da migration e do rollback", () =>
      mutantes(c),
    );
    console.log(
      `\na-caderneta-fecha-para-o-service-role-viva: ${provas} provas ok; ${recusas} recusas do pré-voo; ${defeitos} defeitos plantados nas consultas; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Caderneta fechada para o service_role (PG17)",
      `${provas} provas, ${defeitos} defeitos plantados nas consultas 184a/184b, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) =>
  falhar("CADERNETA_FECHADA_PARA_O_SERVICE_ROLE", e.stack || e.message),
);
