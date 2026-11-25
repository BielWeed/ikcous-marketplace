"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * O arquivo lido e' uma migration do repositorio, nomeada por constante desta prova; so PG efemero. */
/**
 * Prova VIVA das consultas 87a/87b (o Resultado mostra tarifa, juro e quebra de caixa como despesa: fin_dre com o corpo novo),
 * com a migration 20261382000000 real. Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO
 * as migrations anteriores; a 87b (antes) fica POSITIVA e a 87a reprova SO o corpo; aplica a 20261382000000 e a 87a fica
 * POSITIVA nas 4 linhas, enquanto a 87b reprova SO o corpo.
 *
 * A 87a aceita tambem os corpos das duas SUCESSORAS de fin_dre (20261399600000, o custo da devolucao de outro mes, e
 * 20261405900000, o custo do cancelamento no mes da volta). A prova aplica as duas, em ordem, por cima da 382 e confere que a
 * 87a segue POSITIVA e a 87b reprova SO o corpo; e que a sucessora com o texto trocado volta a reprovar.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo com outro texto, sobrecarga,
 * SECURITY INVOKER, VOLATILE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais (atributos); EXECUTE para
 * anon ou PUBLIC (direto ou herdado) e authenticated sem EXECUTE (ACL); funcao apagada (corpo, atributos e ACL). O estrago
 * "dono trocado" e' plantado tambem: a consulta NAO o ve (ver o rotulo "ACHADO").
 *
 * Dado que ja existia: um pedido gravado antes da migration fica byte a byte depois dela, das sucessoras e de reaplicar.
 * Reaplicar e idempotente: a 87a segue POSITIVA.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (o sinal das linhas do grupo
 * financeiro) e' da prova tests/banco/fin-dre-sinal-viva.cjs; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-resultado-mostra-tarifa-juro-e-quebra-como-despesa-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A =
  "87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado";
const B =
  "87b-antes-resultado-mostra-tarifa-juro-e-quebra-como-despesa-base-vigente";
const ARQUIVO =
  "20261382000000_o_resultado_mostra_tarifa_juro_e_quebra_como_despesa.sql";
const SUCESSORAS = [
  "20261399600000_o_resultado_credita_o_custo_da_devolucao_de_outro_mes.sql",
  "20261405900000_o_custo_do_cancelamento_fica_no_mes_da_volta.sql",
];
const FN = "public.fin_dre(date,date)";
const U_CLI = "d0870000-0000-4000-8000-000000000001";
const PEDIDO = "d0870000-0000-4000-8000-000000000002";

const { rodarProva } = criarBancada({
  prefixo: "p87",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo:
    "Portao do Resultado com tarifa, juro e quebra como despesa (87a/87b)",
});

rodarProva(async (H) => {
  const {
    MIGRATION,
    usar,
    criar,
    montarBase,
    emTransacao,
    consulta,
    item,
    sabotar,
    trocarCorpo,
    marcar,
  } = H;
  const i = {
    corpo: item(A, "fin_dre: corpo exato"),
    attrs: item(A, "fin_dre: assinatura e atributos"),
    acl: item(A, "fin_dre: EXECUTE authenticated"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 26)), v, `${k}: a 87b tem o mesmo rol`);
  }
  const lerMigration = (nome) =>
    fs.readFileSync(
      path.join(__dirname, "..", "..", "supabase", "migrations", nome),
      "utf8",
    );

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um pedido gravado ANTES da migration (a fin_dre le pedidos para a receita).
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao87.teste', '{}'::jsonb)",
      [U_CLI],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente Prova', 'customer')",
      [U_CLI],
    );
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,payment_method,payment_status,paid_at,
          pagamento_recebido_em,gateway_payment_id,valor_estornado)
       VALUES ($1,$2,'Fixture 87','{}',100,100,0,'delivered','online','online','pago',now(),now(),'ORD87',0)`,
      [PEDIDO, U_CLI],
    );
  });
  const linhaDoPedido = async (c) =>
    (
      await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ])
    ).rows;

  // Atributos e ACL sao DUAS linhas separadas; a funcao e' STABLE (a diferenca do resto dos lotes).
  const comuns = estragosDeFuncao({
    fn: FN,
    nome: "fin_dre",
    volatilidade: "s",
    trocarCorpo,
    corpo: [i.corpo],
    estrutura: [i.attrs],
    drop: [i.corpo, i.attrs, i.acl],
    anon: [i.acl],
    publico: [i.acl],
    authSem: [i.acl],
    authCom: null,
    servicoCom: null,
    dono: [],
    prefixoPapel: "p87",
  });

  // ---------- ANTES: 87b positiva; 87a reprova so o corpo ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, [i.corpo]);
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "87b positiva (4 linhas) e 87a reprova SO o corpo na base criada com as migrations anteriores a 20261382000000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await linhaDoPedido(c);
      assert.equal(antesDaMigration.length, 1, "o pedido ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [i.corpo]);
      marcar(
        "87a: as 4 linhas ok=true apos aplicar a 20261382000000; 87b reprova SO o corpo",
      );
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
      marcar(
        "dado que ja existia: o pedido fica byte a byte depois da migration (so o texto da funcao mudou)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
      marcar(
        "reaplicar a 20261382000000 deixa a 87a positiva e o pedido intacto (idempotente)",
      );
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, A, sql, itens);
      }

      // ---------- as sucessoras de fin_dre, em ordem, por cima da 382 ----------
      for (const nome of SUCESSORAS) {
        await c.query(lerMigration(nome));
        await consulta(c, A);
        await consulta(c, B, [i.corpo]);
        marcar(
          `87a segue POSITIVA com a sucessora ${nome.split("_")[0]} por cima; 87b reprova SO o corpo`,
        );
        await sabotar(
          c,
          `corpo de fin_dre da sucessora ${nome.split("_")[0]} com outro texto`,
          A,
          (cc) => trocarCorpo(cc, FN),
          [i.corpo],
        );
      }
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
    }),
  );
});
