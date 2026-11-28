"use strict";

/**
 * Prova VIVA da migration 20261650000000 (a categoria que so tem produto EXCLUIDO pode ser apagada) num Postgres
 * EFEMERO, com os papeis de verdade e a porta REAL do painel (`apagar_categoria_vazia`). O clone (rodar-isolado.cjs) e' a
 * arvore migrada: a 20261650000000 ja esta no ar. Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  CONTROLE   com o corpo da 20261237000000 (o rollback-manual aplicado), a categoria so com excluidos e' RECUSADA (55006,
 *             "ajuda do suporte"): o defeito. O comportamento DEPOIS rodado ali fica vermelho.
 *  DEPOIS     so excluidos: apaga, devolve produtos_excluidos, e o produto excluido NAO e' tocado (mesmo xmin, categoria
 *             'Inverno', deleted_at igual). O relatorio de vendas por categoria (get_category_analytics) devolve "Inverno"
 *             para o pedido antigo ANTES e DEPOIS de apagar, linha igual. 1 vivo (ou pausado) + excluidos, banner ou regra de
 *             devolucao: continua RECUSANDO, sem a frase do suporte e contando so o que a lojista ve. Permissao igual.
 *  MIGRATION  reaplicar 2x e em CRLF = mesmo corpo e catalogo; rollback devolve o md5 e o COMMENT da 1237, 2x e em CRLF;
 *             ida e volta igual; o pre-voo recusa SEM escrever (corpo estranho, EXECUTE aberto ao anon, EXECUTE fechado
 *             ao logado, categoria__usos estranha) e o rollback recusa corpo estranho.
 *  MUTANTE    o comportamento DEPOIS rodado sobre um corpo que volta a contar o excluido fica VERMELHO.
 *  CONSULTAS  206a POSITIVA depois e negativa so na linha do corpo antes; 206b POSITIVA nos dois e negativa com corpo
 *             estranho; 38a (a da 1237) POSITIVA nos dois estados (aceita esta como sucessora).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-categoria-so-com-produto-excluido-pode-sair-viva.cjs
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
const ARQ = "20261650000000_a_categoria_so_com_produto_excluido_pode_sair.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const lerConsulta = (n) =>
  fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");
const C206A = lerConsulta(
  "206a-conferir-a-categoria-so-com-produto-excluido-pode-sair-aplicado",
);
const C206B = lerConsulta(
  "206b-antes-a-categoria-so-com-produto-excluido-pode-sair-base-vigente",
);
const C38A = lerConsulta("38a-conferir-gestao-de-categorias-aplicado");
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");

const SIG = "public.apagar_categoria_vazia(uuid)";
const SIG_USOS = "public.categoria__usos(uuid)";
const H_ANTES = "942449150bb5e6fadfa7cf003f3fa49e";
const H_NOVO = "f1526e7727709356677c83fdea745491";
const corpoDoArquivo = (sql) => {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.apagar_categoria_vazia(",
  );
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(i));
  const a = i + m.index + m[0].length;
  return sql.slice(a, sql.indexOf(m[1], a));
};
assert.equal(md5(corpoDoArquivo(MIGRATION)), H_NOVO, "o arquivo mudou");
assert.equal(md5(corpoDoArquivo(ROLLBACK)), H_ANTES, "o rollback mudou");

const COMENTARIO_ANTES =
  "Apaga a categoria só se nenhum produto, banner nem regra de devolução apontar para ela. Só o admin atual.";
const COMENTARIO_NOVO =
  "Apaga a categoria só se nenhum produto da lista (à venda ou pausado), banner nem regra de devolução apontar para ela; " +
  "produto excluído não segura e fica com o nome. Só o admin atual.";

const NOME = "Inverno";
let SEQ = 0;
const idDe = (prefixo) =>
  `1650cafe-${prefixo}-4000-8000-${String(++SEQ).padStart(12, "0")}`;
const U = {
  admin: "1650cafe-0000-4000-8000-0000000000a1",
  cliente: "1650cafe-0000-4000-8000-0000000000c1",
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});
const ADMIN = { uid: U.admin, claims: JWT_ADMIN };
// Uma janela so desta prova: o relatorio por categoria soma TODOS os pedidos do periodo.
const JANELA = ["2026-02-03T10:00:00.000Z", "2026-02-03T11:00:00.000Z"];
const NA_JANELA = "2026-02-03T10:30:00.000Z";

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashDe = async (sig) =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h ?? null;
const hashVivo = () => hashDe(SIG);
/** Tudo que a funcao e' no catalogo, menos o corpo (OID, dono, ACL, atributos). */
const catalogo = async () =>
  (
    await C.query(
      "SELECT (to_jsonb(p) - 'prosrc')::text AS j FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
      [SIG],
    )
  ).rows[0]?.j ?? null;
const comentarioVivo = async () =>
  (
    await C.query(
      "SELECT obj_description(to_regprocedure($1), 'pg_proc') AS c",
      [SIG],
    )
  ).rows[0]?.c ?? null;

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

/** Uma transacao por caso, sempre desfeita, no estado DEPOIS (o clone) ou ANTES (o rollback-manual aplicado). */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await C.query("BEGIN");
  try {
    await C.query("SET LOCAL TIME ZONE 'UTC'");
    assert.equal(
      await hashVivo(),
      H_NOVO,
      "o clone tem de estar com a 20261650000000 no ar",
    );
    if (estado === "antes") {
      assert.equal(await aplicar(ROLLBACK), null, "o rollback nao aplicou");
      assert.equal(await hashVivo(), H_ANTES, "o estado ANTES nao montou");
    }
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

const apagar = (id, ident = ADMIN, papel = "authenticated") =>
  tentar(papel, "SELECT public.apagar_categoria_vazia($1) AS r", [id], ident);

// ---------------------------------------------------------------------------
// Fixtures: pessoas, a categoria "Inverno", produtos (vivo, pausado, excluido), banner e regra de devolucao
// ---------------------------------------------------------------------------

async function semearPessoas() {
  for (const [id, meta] of [
    [U.cliente, "{}"],
    [U.admin, '{"role":"admin"}'],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@1650.teste', $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, meta],
    );
  }
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente 1650', 'customer'), ($2, 'Admin 1650', 'admin')
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

/**
 * A categoria "Inverno" e os produtos dela: [nome, 'vivo' | 'pausado' | 'excluido']. Um pedido PAGO antigo de cada
 * produto entra na janela do relatorio ANTES de o produto ser excluido (vendeu, depois a lojista excluiu).
 */
async function semear({ produtos = [], banner = false, regra = false } = {}) {
  await semearPessoas();
  const outros = (
    await C.query(
      "SELECT count(*)::int AS n FROM public.produtos WHERE lower(btrim(categoria)) = lower($1)",
      [NOME],
    )
  ).rows[0].n;
  assert.equal(outros, 0, "o clone ja tinha produto em 'Inverno'");
  const cat = idDe("0001");
  await C.query(
    "INSERT INTO public.categorias (id, nome, slug, ativo) VALUES ($1, $2, $3, true)",
    [cat, NOME, "inverno-1650"],
  );
  const ids = [];
  for (const [nome, estado] of produtos) {
    const id = idDe("0002");
    ids.push(id);
    await C.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, categoria)
       VALUES ($1, $2, 100, 10, $3, 40, $4)`,
      [id, nome, estado !== "pausado", NOME],
    );
    const pedido = idDe("0003");
    await C.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, shipping,
          discount, status, canal, payment_method, payment_status, created_at)
       VALUES ($1, $2, 'Cliente 1650', '{}'::jsonb, 100, 100, 0,
               0, 'delivered', 'online', 'online', 'pago', $3::timestamptz)`,
      [pedido, U.cliente, NA_JANELA],
    );
    await C.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 1, 100)`,
      [pedido, id, nome],
    );
    if (estado === "excluido")
      await C.query(
        "UPDATE public.produtos SET deleted_at = now() WHERE id = $1",
        [id],
      );
  }
  if (banner)
    await C.query(
      "INSERT INTO public.banners (id, image_url, title, link, active) VALUES ($1, 'https://x.teste/b.png', 'b1650', $2, true)",
      [idDe("0004"), `/?category=${NOME}`],
    );
  await C.query(
    "INSERT INTO public.politica_devolucao (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  await C.query(
    "UPDATE public.politica_devolucao SET categorias_sem_troca = $1::text[] WHERE id = 1",
    [regra ? [NOME] : []],
  );
  return { cat, ids };
}

const retratoDosProdutos = async (ids) =>
  (
    await C.query(
      `SELECT id::text, xmin::text AS x, categoria, deleted_at IS NOT NULL AS excluido, deleted_at::text AS quando
         FROM public.produtos WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [ids],
    )
  ).rows;
const categoriaExiste = async (cat) =>
  (
    await C.query(
      "SELECT EXISTS (SELECT 1 FROM public.categorias WHERE id = $1) AS e",
      [cat],
    )
  ).rows[0].e;
const relatorio = async () => {
  const r = await tentar(
    "authenticated",
    "SELECT name, value::text AS value, orders::text AS orders FROM public.get_category_analytics($1::timestamptz, $2::timestamptz)",
    JANELA,
    ADMIN,
  );
  assert.ok(r.linhas, `relatorio: ${r.erro}`);
  return r.linhas;
};

/** O que a migration promete, sobre o corpo que estiver vivo (levanta se falhar). */
async function comportamentoDepois() {
  const { cat, ids } = await semear({
    produtos: [
      ["Casaco 1650", "excluido"],
      ["Bota 1650", "excluido"],
    ],
  });
  const antes = await retratoDosProdutos(ids);
  const r = await apagar(cat);
  assert.ok(r.linhas, `so excluidos devia apagar: ${r.erro}`);
  assert.deepEqual(r.linhas[0].r, {
    id: cat,
    nome: NOME,
    apagada: true,
    produtos_excluidos: 2,
  });
  assert.equal(await categoriaExiste(cat), false, "a categoria ficou");
  // O excluido NAO e' tocado: mesma versao da linha, mesmo nome escrito, mesmo deleted_at.
  assert.deepEqual(await retratoDosProdutos(ids), antes);
  for (const p of antes) assert.equal(p.categoria, NOME);
}

// ---------------------------------------------------------------------------

prova(
  "CONTROLE: com o corpo da 20261237000000 a categoria so com excluidos e' recusada e manda ao suporte (o defeito)",
  () =>
    emTransacao(
      async () => {
        await C.query("SAVEPOINT controle");
        const { cat } = await semear({
          produtos: [["Casaco 1650", "excluido"]],
        });
        const r = await apagar(cat);
        assert.equal(r.codigo, "55006", r.erro);
        assert.match(r.erro, /ajuda do suporte/);
        assert.equal(await categoriaExiste(cat), true);
        await C.query("ROLLBACK TO SAVEPOINT controle");
        // O mesmo comportamento DEPOIS, rodado aqui, fica vermelho (a prova enxerga o defeito).
        await assert.rejects(comportamentoDepois());
      },
      { estado: "antes" },
    ),
);

prova(
  "DEPOIS: so excluidos apaga, devolve produtos_excluidos e o produto excluido fica byte a byte (categoria 'Inverno')",
  () => emTransacao(comportamentoDepois),
);

prova(
  "DEPOIS: o relatorio de vendas por categoria devolve 'Inverno' para o pedido antigo, igual antes e depois de apagar",
  () =>
    emTransacao(async () => {
      const { cat } = await semear({
        produtos: [
          ["Casaco 1650", "excluido"],
          ["Bota 1650", "excluido"],
        ],
      });
      const antes = await relatorio();
      assert.deepEqual(
        antes.map((l) => [l.name, l.orders]),
        [[NOME, "2"]],
        `o relatorio antes: ${JSON.stringify(antes)}`,
      );
      const r = await apagar(cat);
      assert.ok(r.linhas, r.erro);
      assert.deepEqual(await relatorio(), antes, "o relatorio mudou");
    }),
);

prova(
  "DEPOIS: 1 vivo (ou pausado) + excluidos, banner ou regra de devolucao continuam recusando 55006, sem o suporte e contando so o que a lojista ve",
  () =>
    emTransacao(async () => {
      const casos = [
        [
          {
            produtos: [
              ["Casaco 1650", "vivo"],
              ["Bota 1650", "excluido"],
              ["Luva 1650", "excluido"],
            ],
          },
          /ainda está em uso: 1 produto\. Mude os produtos/,
        ],
        [
          {
            produtos: [
              ["Casaco 1650", "pausado"],
              ["Bota 1650", "pausado"],
              ["Luva 1650", "excluido"],
            ],
          },
          /ainda está em uso: 2 produtos\. Mude os produtos/,
        ],
        [
          { produtos: [["Bota 1650", "excluido"]], banner: true },
          /ainda está em uso: 1 banner\. Mude os produtos/,
        ],
        [
          { produtos: [["Bota 1650", "excluido"]], regra: true },
          /ainda está em uso: a regra de devolução\. Mude os produtos/,
        ],
      ];
      for (const [semente, frase] of casos) {
        await C.query("SAVEPOINT caso");
        const { cat, ids } = await semear(semente);
        const antes = await retratoDosProdutos(ids);
        const r = await apagar(cat);
        assert.equal(r.codigo, "55006", `${frase}: ${r.erro}`);
        assert.match(r.erro, frase);
        assert.doesNotMatch(r.erro, /suporte|exclu/);
        assert.match(r.erro, /Se só quer tirá-la da vitrine, esconda\.$/);
        assert.equal(await categoriaExiste(cat), true, "apagou em uso");
        assert.deepEqual(await retratoDosProdutos(ids), antes);
        await C.query("ROLLBACK TO SAVEPOINT caso");
      }
    }),
);

prova(
  "PERMISSAO: anon sem EXECUTE, cliente com 'Acesso negado' e nada apagado; categoria inexistente P0002",
  () =>
    emTransacao(async () => {
      const { cat } = await semear({ produtos: [["Bota 1650", "excluido"]] });
      const anon = await apagar(cat, {}, "anon");
      assert.equal(anon.codigo, "42501", anon.erro);
      const cliente = await apagar(cat, {
        uid: U.cliente,
        claims: JWT_CLIENTE,
      });
      assert.equal(cliente.codigo, "42501", cliente.erro);
      assert.equal(await categoriaExiste(cat), true);
      const nada = await apagar("1650cafe-ffff-4000-8000-000000000000");
      assert.equal(nada.codigo, "P0002", nada.erro);
    }),
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo corpo e catalogo; rollback devolve o corpo e o COMMENT da 1237, 2x; ida e volta igual",
  () =>
    emTransacao(async () => {
      const cat = await catalogo();
      assert.equal(await comentarioVivo(), COMENTARIO_NOVO);
      for (const texto of [MIGRATION, MIGRATION, emCRLF(MIGRATION)]) {
        assert.equal(await aplicar(texto), null, "reaplicar falhou");
        assert.equal(await hashVivo(), H_NOVO);
        assert.equal(await catalogo(), cat, "o catalogo mudou ao reaplicar");
        assert.equal(await comentarioVivo(), COMENTARIO_NOVO);
      }
      for (const texto of [ROLLBACK, ROLLBACK, emCRLF(ROLLBACK)]) {
        assert.equal(await aplicar(texto), null, "rollback falhou");
        assert.equal(await hashVivo(), H_ANTES);
        assert.equal(await catalogo(), cat, "o catalogo mudou no rollback");
        assert.equal(await comentarioVivo(), COMENTARIO_ANTES);
      }
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashVivo(), H_NOVO);
      assert.equal(await catalogo(), cat);
    }),
);

/**
 * Instala no ar o corpo vivo de `sig` com uma linha a mais ("-- +1") e devolve o md5 dele. pg_get_functiondef SEMPRE fecha
 * o corpo com `$function$` (nunca com o delimitador do arquivo).
 */
async function instalarCorpoEstranho(sig, proibidos) {
  const def = (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
  const fim = def.lastIndexOf("$function$");
  assert.ok(fim > 0, "pg_get_functiondef sem o $function$ de fecho");
  await C.query(`${def.slice(0, fim)}-- +1\n${def.slice(fim)}`);
  const h = await hashDe(sig);
  assert.ok(
    !proibidos.includes(h),
    `o corpo estranho nao ficou estranho (md5 ${h})`,
  );
  return h;
}

prova(
  "PRE-VOO: corpo estranho, EXECUTE aberto ao anon, EXECUTE fechado ao logado e categoria__usos estranha recusam B1_BASELINE_DIVERGENT sem escrever; o rollback recusa corpo estranho",
  () =>
    emTransacao(async () => {
      const casos = [
        ["corpo estranho", () => instalarCorpoEstranho(SIG, [H_NOVO, H_ANTES])],
        ["EXECUTE aberto ao anon", `GRANT EXECUTE ON FUNCTION ${SIG} TO anon`],
        [
          "EXECUTE fechado ao logado",
          `REVOKE EXECUTE ON FUNCTION ${SIG} FROM authenticated`,
        ],
        [
          "categoria__usos estranha",
          () =>
            instalarCorpoEstranho(SIG_USOS, [
              "de71936e57268db232630d37e88fe6cd",
            ]),
        ],
      ];
      for (const [nome, estragar] of casos) {
        await C.query("SAVEPOINT caso");
        if (typeof estragar === "function") await estragar();
        else await C.query(estragar);
        const h = await hashVivo();
        const cat = await catalogo();
        const r = await aplicar(MIGRATION);
        assert.ok(r, `${nome}: o apply devia recusar`);
        assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
        assert.equal(await hashVivo(), h, `${nome}: escreveu o corpo`);
        assert.equal(await catalogo(), cat, `${nome}: mexeu no catalogo`);
        if (nome === "corpo estranho") {
          const rr = await aplicar(ROLLBACK);
          assert.ok(rr, "o rollback devia recusar corpo estranho");
          assert.match(rr.erro, /B1_BASELINE_DIVERGENT/);
          assert.equal(await hashVivo(), h);
        }
        await C.query("ROLLBACK TO SAVEPOINT caso");
      }
      assert.equal(await hashVivo(), H_NOVO);
    }),
);

prova(
  "MUTANTE: com o corpo novo voltando a contar o excluido como em uso, o comportamento DEPOIS fica vermelho",
  () =>
    emTransacao(async () => {
      const def = (
        await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          SIG,
        ])
      ).rows[0].d;
      const de = "IF v_produtos - v_excluidos > 0 THEN";
      assert.equal(def.split(de).length - 1, 1, "o trecho do mutante sumiu");
      await C.query(def.split(de).join("IF v_produtos > 0 THEN"));
      assert.notEqual(await hashVivo(), H_NOVO, "o mutante nao entrou");
      await assert.rejects(comportamentoDepois(), "MUTANTE SOBREVIVEU");
    }),
);

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
  "apagar_categoria_vazia: corpo exato (md5), a categoria so com produto excluido pode sair";
const LINHA_DOS_USOS =
  "categoria__usos: corpo da 20261237000000 (md5), conta os produtos com os excluidos a parte";

prova(
  "CONSULTAS: 206a positiva depois e so a linha do corpo negativa antes; 206b positiva nos dois e negativa com corpo estranho; 38a positiva nos dois",
  async () => {
    await emTransacao(async () => {
      assert.deepEqual(reprovadas(await linhasDaConsulta(C206A)), []);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C206B)), []);
      assert.equal((await linhasDaConsulta(C206A)).length, 3);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C38A)), []);
    });
    await emTransacao(
      async () => {
        assert.deepEqual(reprovadas(await linhasDaConsulta(C206A)), [
          LINHA_DO_CORPO,
        ]);
        assert.deepEqual(reprovadas(await linhasDaConsulta(C206B)), []);
        assert.deepEqual(reprovadas(await linhasDaConsulta(C38A)), []);
      },
      { estado: "antes" },
    );
    await emTransacao(async () => {
      await instalarCorpoEstranho(SIG, [H_NOVO, H_ANTES]);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C206B)), [
        LINHA_DO_CORPO,
      ]);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C206A)), [
        LINHA_DO_CORPO,
      ]);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C38A)), [
        "apagar_categoria_vazia: corpo e o da 20261237000000 (md5)",
      ]);
    });
    await emTransacao(async () => {
      await instalarCorpoEstranho(SIG_USOS, [
        "de71936e57268db232630d37e88fe6cd",
      ]);
      assert.deepEqual(reprovadas(await linhasDaConsulta(C206A)), [
        LINHA_DOS_USOS,
      ]);
      await C.query(`GRANT EXECUTE ON FUNCTION ${SIG} TO anon`);
      assert.ok(
        reprovadas(await linhasDaConsulta(C206A)).includes(
          "apagar_categoria_vazia: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno jsonb, search_path=public, EXECUTE so de authenticated e service_role",
        ),
      );
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
      `${falhas.length} de ${PROVAS.length} provas da categoria so com produto excluido falharam.`,
    );
  }
  console.log(
    `\n[a-categoria-so-com-produto-excluido] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));
