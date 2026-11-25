"use strict";
/**
 * Prova VIVA das consultas 160a/160b (o cupom que nao da desconto nao vale: validate_coupon_secure_v2 com a guarda de desconto
 * zero), com a migration 20261405800000 real. Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero
 * com SO as migrations anteriores; a 160b (antes) fica POSITIVA e a 160a reprova o corpo e a guarda; aplica a 20261405800000 e
 * a 160a fica POSITIVA nas 5 linhas, enquanto a 160b reprova as mesmas duas.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo com outro texto, a guarda
 * apagada ou repetida (corpo E guarda), sobrecarga, SECURITY INVOKER, STABLE/IMMUTABLE, STRICT, search_path trocado/sem
 * fixo/com configuracao a mais, EXECUTE para PUBLIC, authenticated sem EXECUTE, funcao apagada. O visitante (anon) VALIDA cupom
 * no checkout: a consulta nao proibe o EXECUTE dele, e a prova nao planta esse estrago. O estrago "dono trocado" e' plantado:
 * a consulta NAO o ve (ver o rotulo "ACHADO").
 *
 * Dado que ja existia: um cupom gravado antes da migration fica byte a byte depois dela e de reaplicar (a migration troca so o
 * texto da funcao). Reaplicar e idempotente: a 160a segue POSITIVA.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (cupom de R$ 0,00 recusado) e' da
 * prova o-cupom-que-nao-da-desconto-nao-vale-viva.cjs; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-cupom-que-nao-da-desconto-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A = "160a-conferir-o-cupom-que-nao-da-desconto-aplicado";
const B = "160b-antes-o-cupom-que-nao-da-desconto-base-vigente";
const ARQUIVO = "20261405800000_o_cupom_que_nao_da_desconto_nao_vale.sql";
const FN = "public.validate_coupon_secure_v2(text,numeric)";
const GUARDA = "IF v_discount <= 0 THEN";
const CODIGO = "PROVA160EXISTENTE";

const { rodarProva } = criarBancada({
  prefixo: "p160",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do cupom que nao da desconto (160a/160b)",
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
    corpo: item(A, "validate_coupon_secure_v2: corpo exato"),
    guarda: item(A, "validate_coupon_secure_v2: guarda de desconto zero"),
    attrs: item(A, "validate_coupon_secure_v2: assinatura e ACL"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 40)), v, `${k}: a 160b tem o mesmo rol`);
  }

  /** Troca a PRIMEIRA ocorrencia de `de` por `para` no corpo vivo (so o texto da funcao; atributos, dono e ACL ficam). */
  async function reescrever(c, de, para) {
    const def = (
      await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN])
    ).rows[0].d;
    assert.ok(def.includes(de), `trecho "${de}" nao esta no corpo`);
    await c.query(def.replace(de, () => para));
  }

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um cupom gravado ANTES da migration.
  await usar(antes, (c) =>
    c.query(
      `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active, alcance)
       VALUES ($1, 'percentage', 10, 0, 5, 1, NULL, true, 'codigo')`,
      [CODIGO],
    ),
  );
  const linhaDoCupom = async (c) =>
    (await c.query("SELECT * FROM public.coupons WHERE code = $1", [CODIGO]))
      .rows;

  const comuns = estragosDeFuncao({
    fn: FN,
    nome: "validate_coupon_secure_v2",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.corpo],
    estrutura: [i.attrs],
    drop: [i.corpo, i.guarda, i.attrs],
    anon: null,
    publico: [i.attrs],
    authSem: [i.attrs],
    authCom: null,
    servicoCom: null,
    dono: [],
    prefixoPapel: "p160",
  });
  // A funcao some: o item da guarda vira 'AUSENTE' (a contagem nao existe), nao '0'/'1'.

  // ---------- ANTES: 160b positiva; 160a reprova corpo e guarda ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, [i.corpo, i.guarda]);
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, B, sql, itens);
      }
      // A guarda "aparece" no corpo velho (o texto da guarda num comentario conta como marca): corpo E guarda mudam.
      await sabotar(
        c,
        "a guarda de desconto zero aparece no corpo vigente (num comentario)",
        B,
        (cc) =>
          reescrever(
            cc,
            "BEGIN\n",
            `BEGIN\n    -- ${GUARDA} (nao e' codigo)\n`,
          ),
        [i.corpo, i.guarda],
      );
    }),
  );
  marcar(
    "160b positiva (5 linhas) e 160a reprova SO o corpo e a guarda na base criada com as migrations anteriores a 20261405800000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await linhaDoCupom(c);
      assert.equal(antesDaMigration.length, 1, "o cupom ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [i.corpo, i.guarda]);
      marcar(
        "160a: as 5 linhas ok=true apos aplicar a 20261405800000; 160b reprova SO o corpo e a guarda",
      );
      assert.deepEqual(await linhaDoCupom(c), antesDaMigration);
      marcar(
        "dado que ja existia: o cupom fica byte a byte depois da migration (so o texto da funcao mudou)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await linhaDoCupom(c), antesDaMigration);
      marcar(
        "reaplicar a 20261405800000 deixa a 160a positiva e o cupom intacto (idempotente)",
      );
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, A, sql, itens);
      }
      await sabotar(
        c,
        "a guarda de desconto zero apagada do corpo (corpo e guarda)",
        A,
        (cc) => reescrever(cc, GUARDA, "IF false THEN"),
        [i.corpo, i.guarda],
      );
      await sabotar(
        c,
        "a guarda repetida num comentario (2 marcas: corpo e guarda)",
        A,
        (cc) => reescrever(cc, GUARDA, `${GUARDA} -- ${GUARDA}`),
        [i.corpo, i.guarda],
      );
      await sabotar(
        c,
        "a guarda invertida (IF v_discount >= 0): o texto da guarda some e o corpo muda",
        A,
        (cc) => reescrever(cc, GUARDA, "IF v_discount >= 0 THEN"),
        [i.corpo, i.guarda],
      );
    }),
  );
});
