"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os arquivos lidos sao o rollback-manual desta migration, nomeado por constante desta prova; so PG efemero. */
/**
 * Prova VIVA das consultas 214a/214b (o frete de ida so volta com reembolso: o corpo novo de solicitar_devolucao e de
 * devolucao_elegibilidade), com a migration 20261658000000 real. Mesmo molde do portao 157 (conferencia-de-banco-comum.cjs): a
 * base nasce do zero com SO as migrations anteriores; a 214b (antes) fica POSITIVA nas 7 linhas e a 214a reprova SO os dois
 * corpos; aplica a 20261658000000 e a 214a fica POSITIVA, enquanto a 214b reprova SO os dois corpos.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`, nas DUAS funcoes: corpo com outro
 * texto, sobrecarga, SECURITY INVOKER, outra volatilidade, IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais,
 * EXECUTE para anon ou PUBLIC, authenticated sem EXECUTE, funcao apagada. "anon herda o authenticated" alcanca as DUAS (o papel e'
 * um so): reprova as duas linhas de ACL. O estrago "dono trocado" e' plantado tambem: a consulta NAO o ve (rotulo "ACHADO").
 *
 * Dado que ja existia: uma devolucao CONCLUIDA como troca e outra com reembolso, com o frete de ida ja gravado, ficam byte a byte
 * depois da migration, de reaplicar (LF e CRLF) e do rollback (a migration troca so o texto das funcoes). O rollback-manual devolve
 * os dois corpos de antes (a 214b volta POSITIVA), recusa rodar de novo (ja desfeito) e a migration volta por cima.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (troca e vale nao contam para o frete de
 * ida) e' da prova em devolucoes-viva.cjs; aqui se prova a CONSULTA e o ciclo aplicar/reaplicar/desfazer.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-frete-de-ida-so-volta-com-reembolso-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A = "214a-conferir-o-frete-de-ida-so-volta-com-reembolso-aplicado";
const B = "214b-antes-o-frete-de-ida-so-volta-com-reembolso-base-vigente";
const ARQUIVO = "20261658000000_o_frete_de_ida_so_volta_com_reembolso.sql";
const ROLLBACK = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "supabase",
    "migrations",
    `rollback-manual-${ARQUIVO}`,
  ),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const ELEGIBILIDADE = "public.devolucao_elegibilidade(uuid)";
const SOLICITAR =
  "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])";
const U_CLI = "d2140000-0000-4000-8000-000000000001";
const PEDIDO = "d2140000-0000-4000-8000-000000000002";
const DEV_TROCA = "d2140000-0000-4000-8000-000000000003";
const DEV_REEMBOLSO = "d2140000-0000-4000-8000-000000000004";

const { rodarProva } = criarBancada({
  prefixo: "p214",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do frete de ida que so volta com reembolso (214a/214b)",
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
    elCorpo: item(A, "devolucao_elegibilidade: corpo exato"),
    elAttrs: item(A, "devolucao_elegibilidade: uma so"),
    elAcl: item(A, "devolucao_elegibilidade: EXECUTE"),
    soCorpo: item(A, "solicitar_devolucao: corpo exato"),
    soAttrs: item(A, "solicitar_devolucao: uma so"),
    soAcl: item(A, "solicitar_devolucao: EXECUTE"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 30)), v, `${k}: a 214b tem o mesmo rol`);
  }
  const CORPOS = [i.elCorpo, i.soCorpo];

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: duas devolucoes concluidas (troca e reembolso) com o frete de ida gravado pela regra antiga.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao214.teste', '{}'::jsonb)",
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
       VALUES ($1,$2,'Fixture 214','{}',225,200,25,'delivered','online','online','pago',now(),now(),'ORD214',0)`,
      [PEDIDO, U_CLI],
    );
    for (const [id, protocolo, resolucao, frete] of [
      [DEV_TROCA, "DEV214T", "troca", 0],
      [DEV_REEMBOLSO, "DEV214R", "reembolso", 25],
    ]) {
      await c.query(
        `INSERT INTO public.devolucoes
           (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,resolucao_final,modalidade,metodo_retorno,status,valor_itens,
            valor_frete_ida,prazo_ate,politica,concluida_em,mensagem_loja)
         VALUES ($1,$2,$3,$4,'arrependimento','desisti',$5,$5,'nacional','envio_proprio','concluida',100,$6,
                 current_date+7,'{}',now(),'mensagem da loja')`,
        [id, protocolo, PEDIDO, U_CLI, resolucao, frete],
      );
    }
  });
  const dados = async (c) => ({
    pedido: (
      await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ])
    ).rows,
    devolucoes: (
      await c.query(
        "SELECT * FROM public.devolucoes WHERE order_id = $1 ORDER BY id",
        [PEDIDO],
      )
    ).rows,
  });

  // As duas funcoes: EXECUTE so de authenticated (nem PUBLIC nem anon), cada uma com as suas linhas de atributos e ACL.
  const dasDuas = [
    [ELEGIBILIDADE, "devolucao_elegibilidade", "s", "el", "p214a"],
    [SOLICITAR, "solicitar_devolucao", "v", "so", "p214b"],
  ].flatMap(([fn, nome, vol, k, papel]) =>
    estragosDeFuncao({
      fn,
      nome,
      volatilidade: vol,
      trocarCorpo,
      corpo: [i[`${k}Corpo`]],
      estrutura: [i[`${k}Attrs`]],
      drop: [i[`${k}Corpo`], i[`${k}Attrs`], i[`${k}Acl`]],
      anon: [i[`${k}Acl`]],
      publico: [i[`${k}Acl`]],
      authSem: [i[`${k}Acl`]],
      authCom: null,
      servicoCom: null,
      dono: [],
      prefixoPapel: papel,
    }).map(([rotulo, sql, itens]) =>
      // "anon herda o authenticated" e' um GRANT de PAPEL: alcanca as duas funcoes, entao reprova as duas linhas de ACL.
      rotulo.startsWith("anon herda o authenticated")
        ? [rotulo, sql, [i.elAcl, i.soAcl]]
        : [rotulo, sql, itens],
    ),
  );

  // ---------- ANTES: 214b positiva; 214a reprova os dois corpos ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, CORPOS);
      for (const [rotulo, sql, itens] of dasDuas) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "214b positiva (7 linhas) e 214a reprova SO os dois corpos na base criada com as migrations anteriores a 20261658000000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await dados(c);
      assert.equal(
        antesDaMigration.devolucoes.length,
        2,
        "as devolucoes ja existiam",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, CORPOS);
      marcar(
        "214a: as 7 linhas ok=true apos aplicar a 20261658000000; 214b reprova SO os dois corpos",
      );
      assert.deepEqual(await dados(c), antesDaMigration);
      marcar(
        "dado que ja existia: o pedido e as devolucoes (troca e reembolso, com o frete de ida gravado) ficam byte a byte depois da migration",
      );
      for (const texto of [MIGRATION, emCRLF(MIGRATION)]) {
        await c.query(texto);
        await consulta(c, A);
      }
      assert.deepEqual(await dados(c), antesDaMigration);
      marcar(
        "reaplicar a 20261658000000 (LF e CRLF) deixa a 214a positiva e os dados intactos (idempotente)",
      );
      for (const [rotulo, sql, itens] of dasDuas) {
        await sabotar(c, rotulo, A, sql, itens);
      }

      // ---------- rollback-manual: volta aos corpos de antes; repetido recusa; a migration volta por cima ----------
      await c.query(ROLLBACK);
      await consulta(c, B);
      await consulta(c, A, CORPOS);
      assert.deepEqual(await dados(c), antesDaMigration);
      await c.query("SAVEPOINT rollback_repetido");
      await assert.rejects(
        c.query(emCRLF(ROLLBACK)),
        /B1_BASELINE_DIVERGENT/,
        "o rollback repetido (ja desfeito) tem de recusar",
      );
      await c.query("ROLLBACK TO SAVEPOINT rollback_repetido");
      await consulta(c, B);
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await dados(c), antesDaMigration);
      marcar(
        "rollback-manual devolve os dois corpos de antes (214b positiva), recusa repetido e a migration volta por cima; dados intactos",
      );
    }),
  );
});
