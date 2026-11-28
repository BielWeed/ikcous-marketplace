"use strict";

/**
 * Prova VIVA da migration 20261652000000 (a loja nova confirma a entrega e o pagamento que vieram de fabrica) num Postgres
 * EFEMERO, com os papeis de verdade e a porta REAL do painel (`upsert_store_config`). O clone (rodar-isolado.cjs) e' a
 * arvore migrada: a 20261652000000 ja esta no ar. Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  LOJA QUE JA EXISTE  com o rollback aplicado (estado ANTES) e a ficha id = 1 de pe, aplicar a migration carimba as duas
 *                      colunas com o instante do apply SEM reescrever a linha (mesmo xmin, nenhuma linha nova no livro de
 *                      registro) e sem deixar default (a linha que nascer depois nasce NULL). Marca de instalacao
 *                      CONCLUIDA conta como loja que ja existe.
 *  LOJA NOVA           com a marca de instalacao EM CURSO (supabase_migrations.ikcous_instalacao id = 1, concluida_em
 *                      NULL), as colunas nascem NULL (pendente).
 *  RPC                 o admin atual confirma cada passo com `true` (hora do BANCO; o outro passo nao muda; a primeira
 *                      confirmacao fica); sem a chave nada muda; `false`, null, texto e data recusam 22023 sem gravar nem
 *                      a outra chave do mesmo pedido; cliente recusado; anon sem EXECUTE; a ficha que ainda nao existia
 *                      nasce NULL pela RPC sem a chave.
 *  MIGRATION           reaplicar 2x e em CRLF = mesmo corpo, catalogo e carimbo; rollback devolve o md5 da 1643 e tira
 *                      as duas colunas, e repetido recusa sem escrever; o pre-voo recusa SEM escrever (corpo estranho,
 *                      EXECUTE aberto ao anon, coluna pela metade, coluna com outro tipo).
 *  MUTANTES            sem o ramo da marca de instalacao a loja nova nasce confirmada (vermelho); sem o COALESCE a
 *                      segunda confirmacao troca a data (vermelho); sem a validacao, `false` confirma (vermelho); sem o
 *                      COALESCE do pagamento, ou com o ELSE da entrega ou do pagamento em NULL, as datas gravadas mudam
 *                      ao salvar outro campo ou ao confirmar de novo (vermelho).
 *  CONSULTAS           208a positiva depois e negativa so nas linhas do corpo e das colunas antes; 208b positiva nos
 *                      dois e negativa com corpo estranho; 203a, 60a, 47a, 40a, 8e e 9a positivas com esta no ar.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-nova-confirma-entrega-e-pagamento-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (migrations e consultas), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const ARQ = "20261652000000_a_loja_nova_confirma_entrega_e_pagamento.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const lerConsulta = (n) =>
  fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");
const C208A = lerConsulta(
  "208a-conferir-a-loja-nova-confirma-entrega-e-pagamento-aplicado",
);
const C208B = lerConsulta(
  "208b-antes-a-loja-nova-confirma-entrega-e-pagamento-base-vigente",
);
const ANTECESSORAS = [
  "203a-conferir-as-listas-dos-ajustes-nao-somem-entre-aparelhos-aplicado",
  "60a-conferir-estilo-card-frete-aplicado",
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
  "40a-conferir-identidade-legal-da-loja-aplicado",
  "8e-conferir-92-a-202-aplicado",
  "9a-conferir-60-a-66-aplicado",
];
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");

const SIG = "public.upsert_store_config(jsonb)";
const H_ANTES = "2f772ffd1370359ba6c64540b71c35b2";
const H_NOVO = "3c62896ca905200f1a931ac6ccfed297";
const corpoDoArquivo = (sql) => {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.upsert_store_config(",
  );
  const a = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(a, sql.indexOf("$$;", a));
};
assert.equal(md5(corpoDoArquivo(MIGRATION)), H_NOVO, "o arquivo mudou");
assert.equal(md5(corpoDoArquivo(ROLLBACK)), H_ANTES, "o rollback mudou");

const U = {
  admin: "1652cafe-0000-4000-8000-0000000000a1",
  cliente: "1652cafe-0000-4000-8000-0000000000c1",
};
const ADMIN = {
  uid: U.admin,
  claims: JSON.stringify({
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};
const CLIENTE = {
  uid: U.cliente,
  claims: JSON.stringify({
    role: "authenticated",
    app_metadata: { role: "customer" },
  }),
};
const ANTIGA = "2020-01-02T03:04:05+00:00";

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    )
  ).rows[0]?.h ?? null;
/** Tudo que a funcao e' no catalogo, menos o corpo (OID, dono, ACL, atributos). */
const catalogo = async () =>
  (
    await C.query(
      "SELECT (to_jsonb(p) - 'prosrc')::text AS j FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
      [SIG],
    )
  ).rows[0]?.j ?? null;
/** As colunas de confirmacao no catalogo: nome -> "tipo|notnull|default". */
const colunas = async () =>
  Object.fromEntries(
    (
      await C.query(
        `SELECT a.attname AS n, format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|' || a.atthasdef AS f
           FROM pg_attribute a
          WHERE a.attrelid = 'public.store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em')
          ORDER BY 1`,
      )
    ).rows.map((r) => [r.n, r.f]),
  );
const FORMA = {
  entrega_confirmada_em: "timestamp with time zone|false|false",
  pagamento_confirmado_em: "timestamp with time zone|false|false",
};
/** A ficha: as duas datas (texto ISO do banco, ou null) e o xmin. */
const ficha = async () =>
  (
    await C.query(
      `SELECT to_jsonb(s) ->> 'entrega_confirmada_em' AS entrega, to_jsonb(s) ->> 'pagamento_confirmado_em' AS pagamento,
              s.store_name, s.xmin::text AS xmin, (SELECT to_jsonb(now()) #>> '{}') AS agora
         FROM public.store_config s WHERE s.id = 1`,
    )
  ).rows[0];
/** Quantas linhas o livro de registro (20261510000000) tem: o apply nao pode gravar nenhuma. */
async function linhasNoLivro() {
  const existe = (
    await C.query(
      "SELECT to_regclass('public.livro_de_registro') IS NOT NULL AS e",
    )
  ).rows[0].e;
  if (!existe) return 0;
  return (
    await C.query("SELECT count(*)::int AS n FROM public.livro_de_registro")
  ).rows[0].n;
}

/** Aplica um texto dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** A marca do instalador: 'em-curso' (loja nova), 'concluida' (loja que o instalador terminou) ou nenhuma. */
async function marcaDeInstalacao(estado) {
  await C.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations");
  await C.query(
    "CREATE TABLE IF NOT EXISTS supabase_migrations.ikcous_instalacao (id int PRIMARY KEY CHECK (id = 1), iniciada_em timestamptz NOT NULL DEFAULT now(), concluida_em timestamptz)",
  );
  await C.query(
    "INSERT INTO supabase_migrations.ikcous_instalacao (id, concluida_em) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET concluida_em = EXCLUDED.concluida_em",
    [estado === "concluida" ? ANTIGA : null],
  );
}

/** Uma transacao por caso, sempre desfeita, no estado DEPOIS (o clone) ou ANTES (o rollback-manual aplicado). */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await C.query("BEGIN");
  try {
    await C.query("SET LOCAL TIME ZONE 'UTC'");
    assert.equal(
      await hashVivo(),
      H_NOVO,
      "o clone tem de estar com a 20261652000000 no ar",
    );
    await C.query(
      "INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    );
    if (estado === "antes") {
      assert.equal(await aplicar(ROLLBACK), null, "o rollback nao aplicou");
      assert.equal(await hashVivo(), H_ANTES, "o estado ANTES nao montou");
      assert.deepEqual(await colunas(), {}, "as colunas ficaram no ANTES");
    }
    await semearPessoas();
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`, com o JWT e o auth.uid() pedidos; devolve {linhas} ou {erro, codigo} sem derrubar a transacao. */
async function tentar(papel, sql, params = [], { uid = "", claims = "" } = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [uid, claims],
    );
    if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
    const linhas = (await C.query(sql, params)).rows;
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}
const salvar = (payload, ident = ADMIN, papel = "authenticated") =>
  tentar(
    papel,
    "SELECT public.upsert_store_config($1::jsonb) AS r",
    [JSON.stringify(payload)],
    ident,
  );

async function semearPessoas() {
  for (const [id, meta] of [
    [U.cliente, "{}"],
    [U.admin, '{"role":"admin"}'],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@1652.teste', $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, meta],
    );
  }
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente 1652', 'customer'), ($2, 'Admin 1652', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U.cliente, U.admin],
  );
  // O gatilho que copia o papel do profiles para o auth.users pode ter mexido: o papel de cada um fica fixado aqui.
  await C.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
    [U.admin],
  );
  await C.query(
    `UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id = $1`,
    [U.cliente],
  );
}

// ---------------------------------------------------------------------------
// As verificacoes de comportamento (cada uma recebe o texto da migration, para os mutantes reusarem)
// ---------------------------------------------------------------------------

/** Loja que JA EXISTE: aplicar carimba as duas com o instante do apply, sem reescrever a linha e sem default. */
async function lojaQueJaExisteNasceConfirmada(textoDaMigration) {
  const antes = await ficha();
  const livro = await linhasNoLivro();
  assert.equal(await aplicar(textoDaMigration), null, "o apply recusou");
  const depois = await ficha();
  assert.equal(depois.entrega, depois.agora, "entrega: o instante do apply");
  assert.equal(
    depois.pagamento,
    depois.agora,
    "pagamento: o instante do apply",
  );
  assert.equal(depois.xmin, antes.xmin, "a linha foi reescrita (xmin mudou)");
  assert.equal(
    await linhasNoLivro(),
    livro,
    "o livro de registro ganhou linha",
  );
  assert.deepEqual(await colunas(), FORMA, "as colunas ficaram com default");
}

/** Loja NOVA (marca de instalacao em curso): as duas nascem NULL. */
async function lojaNovaNascePendente(textoDaMigration) {
  await marcaDeInstalacao("em-curso");
  assert.equal(await aplicar(textoDaMigration), null, "o apply recusou");
  const f = await ficha();
  assert.equal(f.entrega, null, "loja nova: a entrega nasceu confirmada");
  assert.equal(f.pagamento, null, "loja nova: o pagamento nasceu confirmado");
  assert.deepEqual(await colunas(), FORMA);
}

/** A primeira confirmacao fica: confirmar de novo nao troca a data. */
async function aPrimeiraConfirmacaoFica() {
  await C.query(
    "UPDATE public.store_config SET entrega_confirmada_em = $1, pagamento_confirmado_em = NULL WHERE id = 1",
    [ANTIGA],
  );
  const r = await salvar({ entrega_confirmada_em: true });
  assert.ok(r.linhas, JSON.stringify(r));
  const f = await ficha();
  assert.equal(
    new Date(f.entrega).toISOString(),
    new Date(ANTIGA).toISOString(),
    "a segunda confirmacao trocou a data",
  );
  assert.equal(f.pagamento, null, "confirmar a entrega mexeu no pagamento");
}

/**
 * As datas gravadas ficam: salvar OUTRO campo da loja nao mexe em nenhuma das duas (os dois ELSE), e confirmar o
 * pagamento de novo nao troca a data dele (o COALESCE do pagamento). As datas entram por UPDATE com a ANTIGA, nao pela
 * RPC: dentro da transacao do caso o now() e' um so, e uma data gravada pela RPC empataria com o now() do mutante.
 */
async function asDatasGravadasFicam() {
  await C.query(
    "UPDATE public.store_config SET entrega_confirmada_em = $1, pagamento_confirmado_em = $1 WHERE id = 1",
    [ANTIGA],
  );
  const iguais = (valor, msg) =>
    assert.equal(
      valor === null ? null : new Date(valor).toISOString(),
      new Date(ANTIGA).toISOString(),
      msg,
    );
  const outro = await salvar({ store_name: "Loja 1652 outro campo" });
  assert.ok(outro.linhas, JSON.stringify(outro));
  const f = await ficha();
  assert.equal(
    f.store_name,
    "Loja 1652 outro campo",
    "o outro campo nao gravou",
  );
  iguais(f.entrega, "salvar outro campo mexeu na data da entrega");
  iguais(f.pagamento, "salvar outro campo mexeu na data do pagamento");
  const p = await salvar({ pagamento_confirmado_em: true });
  assert.ok(p.linhas, JSON.stringify(p));
  const g = await ficha();
  iguais(g.pagamento, "a segunda confirmacao do pagamento trocou a data");
  iguais(g.entrega, "confirmar o pagamento mexeu na data da entrega");
}

/** So `true` confirma: `false` recusa 22023 sem gravar nada (nem a outra chave). */
async function soTrueConfirma() {
  await C.query(
    "UPDATE public.store_config SET entrega_confirmada_em = NULL, pagamento_confirmado_em = NULL WHERE id = 1",
  );
  const antes = await ficha();
  const r = await salvar({
    pagamento_confirmado_em: false,
    store_name: "Loja 1652 nao grava",
  });
  assert.equal(r.codigo, "22023", JSON.stringify(r));
  const f = await ficha();
  assert.equal(f.pagamento, null);
  assert.equal(f.store_name, antes.store_name);
}

// ---------------------------------------------------------------------------
// As provas
// ---------------------------------------------------------------------------

prova(
  "LOJA QUE JA EXISTE: o apply carimba as duas colunas com o instante do apply, sem reescrever a linha, sem livro e sem default; marca CONCLUIDA tambem",
  async () => {
    await emTransacao(() => lojaQueJaExisteNasceConfirmada(MIGRATION), {
      estado: "antes",
    });
    await emTransacao(
      async () => {
        await marcaDeInstalacao("concluida");
        await lojaQueJaExisteNasceConfirmada(MIGRATION);
      },
      { estado: "antes" },
    );
  },
);

prova(
  "LOJA NOVA: com a marca de instalacao EM CURSO as duas nascem NULL; a ficha que nasce depois do apply tambem",
  async () => {
    await emTransacao(() => lojaNovaNascePendente(MIGRATION), {
      estado: "antes",
    });
    // A ficha que nasce DEPOIS (sem a marca): o default saiu, ela nasce NULL — pela RPC sem a chave e por INSERT direto.
    await emTransacao(async () => {
      await C.query("ALTER TABLE public.store_config DISABLE TRIGGER USER");
      await C.query("DELETE FROM public.store_config WHERE id = 1");
      await C.query("ALTER TABLE public.store_config ENABLE TRIGGER USER");
      const r = await salvar({ store_name: "Loja 1652" });
      assert.ok(r.linhas, JSON.stringify(r));
      const f = await ficha();
      assert.equal(f.entrega, null);
      assert.equal(f.pagamento, null);
      assert.equal(r.linhas[0].r.entrega_confirmada_em, null);
    });
  },
);

prova(
  "RPC: o admin confirma cada passo com true (hora do banco, o outro nao muda); sem a chave nada muda; a primeira confirmacao fica",
  async () => {
    await emTransacao(async () => {
      await C.query(
        "UPDATE public.store_config SET entrega_confirmada_em = NULL, pagamento_confirmado_em = NULL WHERE id = 1",
      );
      const sem = await salvar({ store_name: "Loja 1652" });
      assert.ok(sem.linhas, JSON.stringify(sem));
      assert.equal((await ficha()).entrega, null, "sem a chave, confirmou");
      const r = await salvar({ entrega_confirmada_em: true });
      assert.ok(r.linhas, JSON.stringify(r));
      const f = await ficha();
      assert.equal(f.entrega, f.agora, "a hora e' a do banco");
      assert.equal(f.pagamento, null, "confirmar a entrega mexeu no pagamento");
      assert.ok(r.linhas[0].r.entrega_confirmada_em, "o retorno traz a data");
      const p = await salvar({
        formas_pagamento_entrega: ["pix", "cash"],
        pagamento_confirmado_em: true,
      });
      assert.ok(p.linhas, JSON.stringify(p));
      assert.equal((await ficha()).pagamento, f.agora);
    });
    await emTransacao(aPrimeiraConfirmacaoFica);
  },
);

prova(
  "RPC: com as duas datas gravadas, salvar outro campo nao mexe nelas e confirmar o pagamento de novo nao troca a data",
  async () => {
    await emTransacao(asDatasGravadasFicam);
  },
);

prova(
  "RPC: false, null, texto e data recusam 22023 sem gravar nada; cliente recusado; anon sem EXECUTE",
  async () => {
    await emTransacao(async () => {
      await soTrueConfirma();
      for (const valor of [null, "true", "2026-11-27T10:00:00Z", 1]) {
        for (const chave of [
          "entrega_confirmada_em",
          "pagamento_confirmado_em",
        ]) {
          const r = await salvar({ [chave]: valor });
          assert.equal(r.codigo, "22023", `${chave}=${JSON.stringify(valor)}`);
        }
      }
      assert.equal((await ficha()).entrega, null);
      const cliente = await salvar({ entrega_confirmada_em: true }, CLIENTE);
      assert.ok(cliente.erro, "o cliente confirmou");
      assert.match(cliente.erro, /Não autorizado/);
      const anon = await salvar(
        { entrega_confirmada_em: true },
        { uid: "", claims: "" },
        "anon",
      );
      assert.equal(anon.codigo, "42501", JSON.stringify(anon));
      assert.equal(
        (await ficha()).entrega,
        null,
        "alguem sem permissao gravou",
      );
    });
  },
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo corpo, catalogo e carimbo; rollback devolve a 1643 e tira as colunas, e repetido recusa",
  async () => {
    await emTransacao(async () => {
      const cat = await catalogo();
      const carimbo = await ficha();
      for (const texto of [MIGRATION, MIGRATION, emCRLF(MIGRATION)]) {
        assert.equal(await aplicar(texto), null);
        assert.equal(await hashVivo(), H_NOVO);
        assert.equal(await catalogo(), cat, "o catalogo mudou ao reaplicar");
        assert.deepEqual(await colunas(), FORMA);
        const f = await ficha();
        assert.equal(f.entrega, carimbo.entrega, "reaplicar recarimbou");
        assert.equal(f.xmin, carimbo.xmin, "reaplicar reescreveu a linha");
      }
      assert.equal(await aplicar(emCRLF(ROLLBACK)), null);
      assert.equal(await hashVivo(), H_ANTES);
      assert.equal(await catalogo(), cat, "o catalogo mudou no rollback");
      assert.deepEqual(await colunas(), {});
      const repetido = await aplicar(ROLLBACK);
      assert.ok(repetido, "o rollback repetido devia recusar");
      assert.match(repetido.erro, /B1_BASELINE_DIVERGENT/);
      assert.equal(await hashVivo(), H_ANTES);
      // Ida e volta: o corpo da 1643 ignora as chaves (nao recusa, nao grava).
      const r = await salvar({ entrega_confirmada_em: true });
      assert.ok(r.linhas, JSON.stringify(r));
      assert.equal(r.linhas[0].r.entrega_confirmada_em, undefined);
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashVivo(), H_NOVO);
      assert.equal(await catalogo(), cat);
    });
  },
);

prova(
  "PRE-VOO: corpo estranho, EXECUTE aberto ao anon, coluna pela metade e coluna com outro tipo recusam SEM escrever",
  async () => {
    const casos = [
      ["corpo estranho", () => instalarCorpoEstranho(), "depois"],
      [
        "EXECUTE aberto ao anon",
        `GRANT EXECUTE ON FUNCTION ${SIG} TO anon`,
        "depois",
      ],
      [
        "coluna pela metade",
        "ALTER TABLE public.store_config ADD COLUMN entrega_confirmada_em timestamptz",
        "antes",
      ],
      [
        "coluna com outro tipo",
        "ALTER TABLE public.store_config ADD COLUMN entrega_confirmada_em boolean, ADD COLUMN pagamento_confirmado_em boolean",
        "antes",
      ],
      [
        "coluna com default",
        "ALTER TABLE public.store_config ADD COLUMN entrega_confirmada_em timestamptz DEFAULT now(), ADD COLUMN pagamento_confirmado_em timestamptz",
        "antes",
      ],
    ];
    for (const [nome, estragar, estado] of casos) {
      await emTransacao(
        async () => {
          if (typeof estragar === "function") await estragar();
          else await C.query(estragar);
          const h = await hashVivo();
          const cat = await catalogo();
          const cols = await colunas();
          const r = await aplicar(MIGRATION);
          assert.ok(r, `${nome}: o apply devia recusar`);
          assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
          assert.equal(await hashVivo(), h, `${nome}: trocou o corpo`);
          assert.equal(await catalogo(), cat, `${nome}: mexeu no catalogo`);
          assert.deepEqual(await colunas(), cols, `${nome}: mexeu nas colunas`);
        },
        { estado },
      );
    }
    await emTransacao(async () => {
      await instalarCorpoEstranho();
      const r = await aplicar(ROLLBACK);
      assert.ok(r, "o rollback devia recusar corpo estranho");
      assert.deepEqual(
        await colunas(),
        FORMA,
        "o rollback recusado tirou coluna",
      );
    });
  },
);

/** O comportamento rodado sobre um texto mutado tem de ficar VERMELHO. */
async function vermelho(nome, fn) {
  let passou = false;
  await C.query("SAVEPOINT mutante");
  try {
    await fn();
    passou = true;
  } catch {
    // vermelho: o esperado
  } finally {
    await C.query("ROLLBACK TO SAVEPOINT mutante");
  }
  assert.equal(passou, false, `MUTANTE ${nome}: a prova continuou verde`);
}
const mutar = (texto, de, para) => {
  const limpo = texto.replace(/\r/g, "");
  assert.equal(
    limpo.split(de).length - 1 >= 1,
    true,
    `mutante: trecho ausente ${de}`,
  );
  return limpo.split(de).join(para);
};

prova(
  "MUTANTES: sem a marca de instalacao, sem o COALESCE e sem a validacao, a prova fica vermelha",
  async () => {
    const semMarca = mutar(
      MIGRATION,
      "    IF v_loja_em_instalacao THEN\n",
      "    IF false THEN\n",
    );
    await emTransacao(
      () =>
        vermelho("sem a marca de instalacao", () =>
          lojaNovaNascePendente(semMarca),
        ),
      {
        estado: "antes",
      },
    );
    const semCoalesce = mutar(
      MIGRATION,
      "THEN COALESCE(store_config.entrega_confirmada_em, now())",
      "THEN now()",
    );
    await emTransacao(async () => {
      await C.query(corpoParaAplicar(semCoalesce));
      await vermelho("sem o COALESCE", aPrimeiraConfirmacaoFica);
    });
    const semValidacao = mutar(
      MIGRATION,
      "    RAISE EXCEPTION 'Confirmação inválida.' USING ERRCODE = '22023';\n",
      "    NULL;\n",
    );
    await emTransacao(async () => {
      await C.query(corpoParaAplicar(semValidacao));
      await vermelho("sem a validacao", soTrueConfirma);
    });
    for (const [nome, de, para] of [
      [
        "sem o COALESCE do pagamento",
        "THEN COALESCE(store_config.pagamento_confirmado_em, now())",
        "THEN now()",
      ],
      [
        "ELSE da entrega vira NULL",
        "ELSE store_config.entrega_confirmada_em END",
        "ELSE NULL END",
      ],
      [
        "ELSE do pagamento vira NULL",
        "ELSE store_config.pagamento_confirmado_em END",
        "ELSE NULL END",
      ],
    ]) {
      const mutado = mutar(MIGRATION, de, para);
      await emTransacao(async () => {
        await C.query(corpoParaAplicar(mutado));
        await vermelho(nome, asDatasGravadasFicam);
      });
    }
  },
);

/** So o CREATE OR REPLACE do texto (sem pre-voo nem conferencia, que recusariam o corpo mutado). */
function corpoParaAplicar(texto) {
  const i = texto.indexOf(
    "CREATE OR REPLACE FUNCTION public.upsert_store_config(",
  );
  return texto.slice(i, texto.indexOf("$$;", i) + 3);
}

async function instalarCorpoEstranho() {
  const def = (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [SIG])
  ).rows[0].d;
  const fim = def.lastIndexOf("$function$");
  assert.ok(fim > 0, "pg_get_functiondef sem o $function$ de fecho");
  await C.query(`${def.slice(0, fim)}-- +1\n${def.slice(fim)}`);
  const h = await hashVivo();
  assert.ok(
    ![H_NOVO, H_ANTES].includes(h),
    `o corpo estranho nao ficou estranho (md5 ${h})`,
  );
}

const linhasDaConsulta = async (sql) => {
  await C.query("SAVEPOINT consulta");
  try {
    await C.query("SET LOCAL transaction_read_only = on");
    return (await C.query(sql)).rows;
  } finally {
    await C.query("ROLLBACK TO SAVEPOINT consulta");
  }
};
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
const LINHA_DO_CORPO =
  "upsert_store_config: corpo exato (md5), aceita as chaves de confirmacao";
const LINHA_DAS_COLUNAS =
  "store_config: entrega_confirmada_em e pagamento_confirmado_em timestamptz, anulaveis, sem default";

prova(
  "CONSULTAS: 208a positiva depois e so corpo e colunas negativas antes; 208b positiva nos dois e negativa com corpo estranho; antecessoras positivas",
  async () => {
    await emTransacao(async () => {
      assert.deepEqual(reprovadas(await linhasDaConsulta(C208A)), []);
      assert.equal((await linhasDaConsulta(C208A)).length, 4);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C208B)), []);
      assert.equal((await linhasDaConsulta(C208B)).length, 4);
      for (const n of ANTECESSORAS) {
        assert.deepEqual(
          reprovadas(await linhasDaConsulta(lerConsulta(n))),
          [],
          `${n} positiva com a 1652 no ar`,
        );
      }
    });
    await emTransacao(
      async () => {
        assert.deepEqual(
          reprovadas(await linhasDaConsulta(C208A)),
          [LINHA_DO_CORPO, LINHA_DAS_COLUNAS].sort(),
        );
        assert.deepEqual(reprovadas(await linhasDaConsulta(C208B)), []);
      },
      { estado: "antes" },
    );
    await emTransacao(async () => {
      await instalarCorpoEstranho();
      assert.deepEqual(reprovadas(await linhasDaConsulta(C208B)), [
        "upsert_store_config: corpo da 20261643000000 ou desta (md5)",
      ]);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C208A)), [
        LINHA_DO_CORPO,
      ]);
    });
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.stack || e.message)
            .split("\n")
            .join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas da loja nova que confirma a entrega e o pagamento falharam.`,
    );
  }
  console.log(
    `\n[a-loja-nova-confirma] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));
