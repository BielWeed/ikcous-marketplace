"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-non-literal-regexp --
 * O unico caminho de arquivo e' o do roteiro docs/runbooks/desfazer-pelo-livro-de-registro.md dentro do repositorio; as chaves e as
 * expressoes montadas vem dos nomes de bloco do proprio roteiro e dos ids gerados pelo ensaio. */
/**
 * ENSAIO VIVO do roteiro docs/runbooks/desfazer-pelo-livro-de-registro.md (migration 20261510000000, o livro de registro) contra o
 * Postgres EFEMERO com as migrations aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real). Executa o SQL DO ROTEIRO,
 * bloco a bloco, so trocando os marcadores COLE-... pelos valores do ensaio: se o roteiro mudar, a prova mede o roteiro novo.
 *
 * O "desfazer" so faz sentido entre transacoes de verdade (o livro anota o numero da transacao): por isso a prova GRAVA no clone, que
 * e' descartado no fim. Cada passo "valendo" roda com o v_confirmar trocado para true; o ENSAIO (o padrao do roteiro) tem de terminar
 * em erro "ENSAIO" sem mudar nada.
 *
 * O QUE SE PROVA:
 *   (1) achar: as anotacoes do estrago (cupom, produto e o item apagado), com a transacao, na janela de tempo; so leitura;
 *   (2) valor-no-instante: o produto ANTES do estrago (preco 50, estoque 5) e agora (1, 0); o item apagado volta inteiro no instante
 *       de antes e vem vazio (NULL) depois; tabela fora das 17 e' recusada;
 *   (3) desfazer-transacao em ENSAIO: termina em "ENSAIO" e nada muda; valendo: cupom, produto e item voltam ao que eram;
 *   (4) desfazer-transacao com CONFLITO (a mesma linha mudou depois, em outra transacao): PARADO, listando o conflito, e nada muda;
 *   (5) restaurar-apagada: ENSAIO nada muda; valendo, a linha volta igual (to_jsonb); com a linha ja de volta, PARADO; filho antes do
 *       pai (item de pedido apagado junto com o pedido): PARADO pedindo o pai primeiro; pai e depois filho: volta.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-livro-de-registro-desfazer-ensaio-viva.cjs
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

const ROTEIRO = fs
  .readFileSync(
    path.join(
      __dirname,
      "../../docs/runbooks/desfazer-pelo-livro-de-registro.md",
    ),
    "utf8",
  )
  .replace(/\r/g, "");
const BLOCOS = Object.fromEntries(
  [...ROTEIRO.matchAll(/```sql\n-- BLOCO: ([\w-]+)\n([\s\S]*?)```/g)].map(
    (m) => [m[1], m[2]],
  ),
);
const CONFIRMAR = "v_confirmar boolean := false;";

/** O SQL de um bloco com os marcadores trocados (cada marcador TEM de estar no bloco). */
function bloco(nome, valores, { valendo = false } = {}) {
  let sql = BLOCOS[nome];
  assert.ok(sql, `o roteiro nao tem o bloco ${nome}`);
  for (const [marcador, valor] of Object.entries(valores)) {
    assert.ok(
      sql.includes(`'${marcador}'`),
      `${nome}: o roteiro nao tem mais o marcador '${marcador}'`,
    );
    sql = sql
      .split(`'${marcador}'`)
      .join(`'${String(valor).replace(/'/g, "''")}'`);
  }
  assert.ok(!/'COLE-[A-Z-]+'/.test(sql), `${nome}: sobrou marcador sem valor`);
  if (valendo) {
    assert.equal(
      sql.split(CONFIRMAR).length,
      2,
      `${nome}: o ENSAIO por padrao`,
    );
    sql = sql.replace(CONFIRMAR, "v_confirmar boolean := true;");
  }
  return sql;
}
const um = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];
async function gravando(c, fn) {
  await c.query("BEGIN");
  try {
    const r = await fn();
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
/** Roda um bloco que escreve; devolve { erro, avisos }. O erro NAO sobe. */
async function rodar(c, sql) {
  const avisos = [];
  const ouvir = (m) => avisos.push(m.message);
  c.on("notice", ouvir);
  try {
    await c.query(sql);
    return { erro: null, avisos };
  } catch (e) {
    return { erro: e, avisos };
  } finally {
    c.removeListener("notice", ouvir);
  }
}
const linha = async (c, tabela, id) =>
  (
    await um(
      c,
      `SELECT to_jsonb(t) AS j FROM public.${tabela} t WHERE t.id::text = $1`,
      [String(id)],
    )
  )?.j ?? null;
const agora = async (c) =>
  (await um(c, "SELECT clock_timestamp()::text AS t")).t;
const xid = async (c) =>
  (await um(c, "SELECT pg_current_xact_id()::text AS x")).x;

const CLIENTE = "15100000-0000-4000-8000-00000000d001";

async function semear(c) {
  return gravando(c, async () => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'desfazer-l1510@prova.invalid', '{}') ON CONFLICT (id) DO NOTHING",
      [CLIENTE],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa ficticia L1510', 'customer') ON CONFLICT (id) DO NOTHING",
      [CLIENTE],
    );
    const id = async (sql, p = []) =>
      (await um(c, `${sql} RETURNING id::text AS id`, p)).id;
    const s = {};
    s.produto = await id(
      "INSERT INTO public.produtos (nome, custo, preco_venda, estoque, ativo, frete_gratis) VALUES ('Produto desfazer L1510', 20, 50, 5, true, false)",
    );
    s.cupom = await id(
      "INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit) VALUES ('L1510DESFAZ', 'fixed', 10, true, 0, 10)",
    );
    s.cupom2 = await id(
      "INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit) VALUES ('L1510RESTAURA', 'fixed', 7, true, 0, 10)",
    );
    const pedido = () =>
      id(
        `INSERT INTO public.marketplace_orders (user_id, customer_name, customer_data, status, total, subtotal, shipping, payment_method)
         VALUES ($1, 'Pessoa ficticia L1510', '{}'::jsonb, 'delivered', 50, 50, 0, 'pix')`,
        [CLIENTE],
      );
    const item = (pedidoId) =>
      id(
        "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, 'Produto desfazer L1510', 1, 50)",
        [pedidoId, s.produto],
      );
    s.pedido = await pedido();
    s.item = await item(s.pedido);
    s.pedido2 = await pedido();
    s.item2 = await item(s.pedido2);
    return s;
  });
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
  };
  try {
    assert.equal(
      (
        await um(
          c,
          "SELECT to_regprocedure('public.livro_de_registro_anotar()') IS NOT NULL AS x",
        )
      ).x,
      true,
      "o clone deve estar com a migration nova",
    );
    assert.deepEqual(
      Object.keys(BLOCOS).sort(),
      ["achar", "desfazer-transacao", "restaurar-apagada", "valor-no-instante"],
      "os quatro blocos do roteiro",
    );
    await c.query("SET TIME ZONE 'UTC'");
    const s = await semear(c);
    const antesDoEstrago = {
      cupom: await linha(c, "coupons", s.cupom),
      produto: await linha(c, "produtos", s.produto),
      item: await linha(c, "marketplace_order_items", s.item),
    };
    const inicio = await agora(c);
    // O ESTRAGO: uma transacao que muda o cupom, o produto e apaga um item de pedido.
    const estrago = await gravando(c, async () => {
      const x = await xid(c);
      await c.query("UPDATE public.coupons SET value = 99 WHERE id = $1", [
        s.cupom,
      ]);
      await c.query(
        "UPDATE public.produtos SET preco_venda = 1, estoque = 0 WHERE id = $1",
        [s.produto],
      );
      await c.query(
        "DELETE FROM public.marketplace_order_items WHERE id = $1",
        [s.item],
      );
      return x;
    });
    const depoisDoEstrago = await agora(c);

    await provar(
      "achar: as tres anotacoes do estrago, com a transacao, na janela; so leitura",
      async () => {
        const r = await c.query(
          bloco("achar", {
            "COLE-A-TABELA": "",
            "COLE-O-ID-DA-LINHA": "",
            "COLE-O-INICIO": inicio,
            "COLE-O-FIM": depoisDoEstrago,
          }),
        );
        const rows = (Array.isArray(r) ? r.at(-1) : r).rows;
        assert.deepEqual(
          rows.map((x) => [
            x.tabela,
            x.linha_id,
            x.operacao,
            String(x.transacao),
          ]),
          [
            ["coupons", s.cupom, "U", estrago],
            ["produtos", s.produto, "U", estrago],
            ["marketplace_order_items", s.item, "D", estrago],
          ],
        );
        const soDoCupom = await c.query(
          bloco("achar", {
            "COLE-A-TABELA": "coupons",
            "COLE-O-ID-DA-LINHA": s.cupom,
            "COLE-O-INICIO": inicio,
            "COLE-O-FIM": depoisDoEstrago,
          }),
        );
        assert.equal(
          (Array.isArray(soDoCupom) ? soDoCupom.at(-1) : soDoCupom).rows.length,
          1,
        );
      },
    );

    const noInstante = async (tabela, id, instante) => {
      const r = await c.query(
        bloco("valor-no-instante", {
          "COLE-A-TABELA": tabela,
          "COLE-O-ID-DA-LINHA": id,
          "COLE-O-INSTANTE": instante,
        }),
      );
      return (Array.isArray(r) ? r.at(-1) : r).rows[0].valor;
    };
    await provar(
      "valor-no-instante: o produto e o item antes e depois do estrago; tabela fora das 17 recusada",
      async () => {
        assert.deepEqual(
          await noInstante("produtos", s.produto, inicio),
          antesDoEstrago.produto,
          "produto antes do estrago",
        );
        const agoraP = await noInstante("produtos", s.produto, depoisDoEstrago);
        assert.deepEqual(
          [agoraP.preco_venda, agoraP.estoque],
          [1, 0],
          "produto depois do estrago",
        );
        assert.deepEqual(
          await noInstante("marketplace_order_items", s.item, inicio),
          antesDoEstrago.item,
          "item apagado, antes",
        );
        assert.equal(
          await noInstante("marketplace_order_items", s.item, depoisDoEstrago),
          null,
          "item apagado, depois",
        );
        await c.query("BEGIN");
        try {
          await c.query("SAVEPOINT fora");
          const e = await c
            .query(
              bloco("valor-no-instante", {
                "COLE-A-TABELA": "profiles",
                "COLE-O-ID-DA-LINHA": CLIENTE,
                "COLE-O-INSTANTE": inicio,
              }),
            )
            .then(() => null)
            .catch((x) => x);
          assert.match(
            e?.message ?? "(passou)",
            /PARADO/,
            "tabela fora das 17",
          );
        } finally {
          await c.query("ROLLBACK");
        }
      },
    );

    await provar(
      "desfazer-transacao: ENSAIO nao muda nada; valendo, cupom, produto e item voltam",
      async () => {
        const vals = { "COLE-A-TRANSACAO": estrago };
        const fotoAntes = [
          await linha(c, "coupons", s.cupom),
          await linha(c, "produtos", s.produto),
          await linha(c, "marketplace_order_items", s.item),
        ];
        const ensaio = await rodar(c, bloco("desfazer-transacao", vals));
        assert.match(
          ensaio.erro?.message ?? "(gravou)",
          /ENSAIO/,
          "o padrao e' o ENSAIO",
        );
        assert.deepEqual(
          [
            await linha(c, "coupons", s.cupom),
            await linha(c, "produtos", s.produto),
            await linha(c, "marketplace_order_items", s.item),
          ],
          fotoAntes,
          "o ENSAIO nao mudou nada",
        );
        const valendo = await rodar(
          c,
          bloco("desfazer-transacao", vals, { valendo: true }),
        );
        assert.equal(valendo.erro, null, `valendo: ${valendo.erro?.message}`);
        assert.ok(
          valendo.avisos.some((a) => /FEITO/.test(a)),
          `o relatorio: ${valendo.avisos.join(" | ")}`,
        );
        assert.deepEqual(
          await linha(c, "coupons", s.cupom),
          antesDoEstrago.cupom,
          "o cupom voltou",
        );
        const p = await linha(c, "produtos", s.produto);
        assert.deepEqual(
          [p.preco_venda, p.estoque],
          [50, 5],
          "o produto voltou (preco e estoque)",
        );
        assert.deepEqual(
          await linha(c, "marketplace_order_items", s.item),
          antesDoEstrago.item,
          "o item apagado voltou igual",
        );
      },
    );

    await provar(
      "desfazer-transacao com CONFLITO (a linha mudou depois, noutra transacao): PARADO, lista o conflito, nada muda",
      async () => {
        const a = await gravando(c, async () => {
          const x = await xid(c);
          await c.query("UPDATE public.coupons SET value = 50 WHERE id = $1", [
            s.cupom,
          ]);
          return x;
        });
        await gravando(c, () =>
          c.query("UPDATE public.coupons SET value = 60 WHERE id = $1", [
            s.cupom,
          ]),
        );
        const foto = await linha(c, "coupons", s.cupom);
        for (const valendo of [false, true]) {
          const r = await rodar(
            c,
            bloco("desfazer-transacao", { "COLE-A-TRANSACAO": a }, { valendo }),
          );
          assert.match(
            r.erro?.message ?? "(gravou)",
            /PARADO/,
            "conflito para",
          );
          assert.match(
            r.erro.message,
            new RegExp(`coupons ${s.cupom}`),
            "o conflito e' listado",
          );
          assert.deepEqual(
            await linha(c, "coupons", s.cupom),
            foto,
            "nada mudou",
          );
        }
      },
    );

    await provar(
      "restaurar-apagada: ENSAIO nada muda; valendo volta igual; ja de volta = PARADO; filho antes do pai = PARADO; pai e filho voltam",
      async () => {
        const cupom2 = await linha(c, "coupons", s.cupom2);
        await gravando(c, () =>
          c.query("DELETE FROM public.coupons WHERE id = $1", [s.cupom2]),
        );
        const vals = {
          "COLE-A-TABELA": "coupons",
          "COLE-O-ID-DA-LINHA": s.cupom2,
        };
        const ensaio = await rodar(c, bloco("restaurar-apagada", vals));
        assert.match(ensaio.erro?.message ?? "(gravou)", /ENSAIO/);
        assert.equal(
          await linha(c, "coupons", s.cupom2),
          null,
          "o ENSAIO nao restaurou",
        );
        const valendo = await rodar(
          c,
          bloco("restaurar-apagada", vals, { valendo: true }),
        );
        assert.equal(valendo.erro, null, `valendo: ${valendo.erro?.message}`);
        assert.deepEqual(
          await linha(c, "coupons", s.cupom2),
          cupom2,
          "a linha voltou igual",
        );
        const deNovo = await rodar(
          c,
          bloco("restaurar-apagada", vals, { valendo: true }),
        );
        assert.match(
          deNovo.erro?.message ?? "(gravou)",
          /PARADO/,
          "a linha ja existe",
        );

        const pedido2 = await linha(c, "marketplace_orders", s.pedido2);
        const item2 = await linha(c, "marketplace_order_items", s.item2);
        await gravando(c, () =>
          c.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
            s.pedido2,
          ]),
        );
        assert.equal(
          await linha(c, "marketplace_order_items", s.item2),
          null,
          "o item foi junto (cascata)",
        );
        const filho = {
          "COLE-A-TABELA": "marketplace_order_items",
          "COLE-O-ID-DA-LINHA": s.item2,
        };
        const filhoPrimeiro = await rodar(
          c,
          bloco("restaurar-apagada", filho, { valendo: true }),
        );
        assert.match(
          filhoPrimeiro.erro?.message ?? "(gravou)",
          /PARADO.*pai/s,
          "filho antes do pai",
        );
        const pai = {
          "COLE-A-TABELA": "marketplace_orders",
          "COLE-O-ID-DA-LINHA": s.pedido2,
        };
        assert.equal(
          (await rodar(c, bloco("restaurar-apagada", pai, { valendo: true })))
            .erro,
          null,
        );
        assert.equal(
          (await rodar(c, bloco("restaurar-apagada", filho, { valendo: true })))
            .erro,
          null,
        );
        assert.deepEqual(
          await linha(c, "marketplace_orders", s.pedido2),
          pedido2,
          "o pedido voltou igual",
        );
        assert.deepEqual(
          await linha(c, "marketplace_order_items", s.item2),
          item2,
          "o item voltou igual",
        );
      },
    );

    console.log(
      `\no-livro-de-registro-desfazer-ensaio-viva: ${provas} provas ok`,
    );
    anexarAoSummary(
      "Roteiro de desfazer pelo livro (PG17)",
      `${provas} provas, cada bloco do roteiro em ENSAIO e valendo.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("LIVRO_DESFAZER", e.stack || e.message));
