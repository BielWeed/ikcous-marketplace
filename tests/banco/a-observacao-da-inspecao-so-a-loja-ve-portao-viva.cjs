"use strict";
/**
 * Prova VIVA das consultas 156a/156b (a observacao da inspecao da devolucao so a loja ve: devolucao_detalhe com o corpo
 * novo e authenticated sem leitura da coluna observacao_inspecao de public.devolucoes), com a migration 20261404 real.
 * Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations anteriores; a 156b
 * (antes) fica POSITIVA e a 156a reprova SO as linhas do corpo e da leitura da observacao; aplica a 20261404 e a 156a fica
 * POSITIVA nas 8 linhas, enquanto a 156b reprova as mesmas.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo trocado, sobrecarga,
 * atributos e EXECUTE de devolucao_detalhe; a observacao reaberta por GRANT de coluna, de tabela, por PUBLIC (tabela e coluna)
 * ou por pg_read_all_data; uma coluna que authenticated perde ou ganha; anon lendo por tabela, coluna, PUBLIC ou papel
 * predefinido; service_role sem a leitura; RLS desligada; tabela e funcao sumidas.
 *
 * Dado que ja existia: uma devolucao COM a observacao da inspecao gravada antes da migration fica byte a byte; antes dela o
 * authenticated alcanca a coluna, depois leva permission denied e ainda le as outras colunas. Reaplicar e idempotente.
 * Limite da prova: a clausula "service_role le a observacao" da 156a nunca decide sozinha (sem o SELECT de tabela nao ha
 * SELECT de coluna), entao nenhum estrago a isola; o que se prova e' a linha inteira.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (a cliente dona nao recebe a chave
 * pela RPC, o admin atual recebe) e' da prova a-observacao-da-inspecao-so-a-loja-ve-viva.cjs; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-observacao-da-inspecao-so-a-loja-ve-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");

const A = "156a-conferir-a-observacao-da-inspecao-so-a-loja-ve-aplicado";
const B = "156b-antes-a-observacao-da-inspecao-so-a-loja-ve-base-vigente";
const ARQUIVO = "20261404000000_a_observacao_da_inspecao_so_a_loja_ve.sql";
const FN = "public.devolucao_detalhe(uuid)";
const T = "public.devolucoes";
const NOTA = "NOTA-INVENTADA-DA-INSPECAO-156";
const U_CLI = "d1560000-0000-4000-8000-000000000001";
const PEDIDO = "d1560000-0000-4000-8000-000000000002";
const DEV = "d1560000-0000-4000-8000-000000000003";

const { rodarProva } = criarBancada({
  prefixo: "p156",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao da observacao da inspecao so a loja ve (156a/156b)",
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
    tentar,
    marcar,
  } = H;
  const i = {
    corpo: item(A, "devolucao_detalhe: corpo exato"),
    attrs: item(A, "devolucao_detalhe: uma so"),
    obs: item(A, "devolucoes: authenticated le observacao_inspecao"),
    outras: item(A, "devolucoes: authenticated le as outras colunas"),
    anon: item(A, "devolucoes: anon sem leitura"),
    serv: item(A, "devolucoes: service_role le"),
    rls: item(A, "devolucoes: RLS ligada"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 40)), v, `${k}: a 156b tem o mesmo rol`);
  }

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: uma devolucao com a observacao da inspecao, gravada ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao156.teste', '{}'::jsonb)",
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
       VALUES ($1,$2,'Fixture 156','{}',100,100,0,'delivered','online','online','pago',now(),now(),'ORD156',0)`,
      [PEDIDO, U_CLI],
    );
    await c.query(
      `INSERT INTO public.devolucoes
         (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,resolucao_final,modalidade,metodo_retorno,status,valor_itens,
          valor_frete_ida,prazo_ate,politica,observacao_inspecao,concluida_em,mensagem_loja)
       VALUES ($1,'DEV156',$2,$3,'arrependimento','outro','troca','troca','nacional','envio_proprio','concluida',40,0,
               current_date+7,'{}',$4,now(),'mensagem da loja')`,
      [DEV, PEDIDO, U_CLI, NOTA],
    );
  });
  const linhaDaDevolucao = async (c) =>
    (await c.query(`SELECT * FROM ${T} WHERE id = $1`, [DEV])).rows;
  // Uma coluna qualquer que authenticated le (nao a observacao).
  const umaColuna = async (c) =>
    (
      await c.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = '${T}'::regclass AND attnum > 0 AND NOT attisdropped
            AND attname <> 'observacao_inspecao' ORDER BY attnum LIMIT 1`,
      )
    ).rows[0].attname;

  // Estragos que valem nos dois estados (o rol e' o mesmo; muda so o esperado de duas linhas).
  const comuns = [
    [
      "corpo de devolucao_detalhe com outro texto",
      (c) => trocarCorpo(c, FN),
      [i.corpo],
    ],
    [
      "devolucao_detalhe repetida (sobrecarga)",
      "CREATE FUNCTION public.devolucao_detalhe(integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
      [i.attrs],
    ],
    [
      "devolucao_detalhe SECURITY INVOKER",
      `ALTER FUNCTION ${FN} SECURITY INVOKER`,
      [i.attrs],
    ],
    ["devolucao_detalhe VOLATILE", `ALTER FUNCTION ${FN} VOLATILE`, [i.attrs]],
    ["devolucao_detalhe STRICT", `ALTER FUNCTION ${FN} STRICT`, [i.attrs]],
    [
      "devolucao_detalhe com search_path = public, extensions",
      `ALTER FUNCTION ${FN} SET search_path = public, extensions`,
      [i.attrs],
    ],
    [
      "devolucao_detalhe sem search_path fixo",
      `ALTER FUNCTION ${FN} RESET search_path`,
      [i.attrs],
    ],
    [
      "anon ganha EXECUTE em devolucao_detalhe",
      `GRANT EXECUTE ON FUNCTION ${FN} TO anon`,
      [i.attrs],
    ],
    [
      "PUBLIC ganha EXECUTE em devolucao_detalhe",
      `GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`,
      [i.attrs],
    ],
    [
      "authenticated perde EXECUTE em devolucao_detalhe",
      `REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`,
      [i.attrs],
    ],
    ["devolucao_detalhe apagada", `DROP FUNCTION ${FN}`, [i.corpo, i.attrs]],
    ["anon ganha SELECT na tabela", `GRANT SELECT ON ${T} TO anon`, [i.anon]],
    [
      "anon ganha SELECT numa coluna",
      (c) =>
        umaColuna(c).then((col) =>
          c.query(`GRANT SELECT (${col}) ON ${T} TO anon`),
        ),
      [i.anon],
    ],
    [
      "PUBLIC ganha INSERT na tabela",
      `GRANT INSERT ON ${T} TO PUBLIC`,
      [i.anon],
    ],
    [
      "PUBLIC ganha UPDATE numa coluna",
      (c) =>
        umaColuna(c).then((col) =>
          c.query(`GRANT UPDATE (${col}) ON ${T} TO PUBLIC`),
        ),
      [i.anon],
    ],
    [
      "anon herda pg_read_all_data (membro do papel)",
      "GRANT pg_read_all_data TO anon",
      [i.anon],
    ],
    [
      "service_role perde o SELECT da tabela",
      `REVOKE SELECT ON ${T} FROM service_role`,
      [i.serv],
    ],
    [
      "service_role perde tudo",
      `REVOKE ALL ON ${T} FROM service_role`,
      [i.serv],
    ],
    [
      "service_role fica so com o SELECT da coluna da observacao (sem o da tabela)",
      [
        `REVOKE SELECT ON ${T} FROM service_role`,
        `GRANT SELECT (observacao_inspecao) ON ${T} TO service_role`,
      ],
      [i.serv],
    ],
    ["RLS desligada", `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`, [i.rls]],
  ];

  // ---------- ANTES: 156b positiva; 156a reprova corpo e leitura da observacao ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, [i.corpo, i.obs]);
      // A ponte com o mundo real: antes, authenticated alcanca a coluna da observacao (a RLS so filtra linhas).
      assert.equal(
        await tentar(
          c,
          "authenticated",
          `SELECT observacao_inspecao FROM ${T}`,
        ),
        null,
      );
      const estragosB = [
        ...comuns,
        [
          "authenticated perde o SELECT da tabela",
          `REVOKE SELECT ON ${T} FROM authenticated`,
          [i.obs, i.outras],
        ],
        [
          "authenticated ganha uma coluna nova (le 35)",
          `ALTER TABLE ${T} ADD COLUMN p156_extra integer`,
          [i.outras],
        ],
        [
          "PUBLIC ganha SELECT na tabela",
          `GRANT SELECT ON ${T} TO PUBLIC`,
          [i.anon],
        ],
        [
          "tabela sumida",
          `DROP TABLE ${T} CASCADE`,
          [i.obs, i.outras, i.anon, i.serv, i.rls],
        ],
      ];
      for (const [rotulo, sql, itens] of estragosB) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "156b positiva (8 linhas) e 156a reprova SO o corpo e a leitura da observacao na base criada so com migrations anteriores a 20261404",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await linhaDaDevolucao(c);
      assert.equal(antesDaMigration.length, 1);
      assert.equal(antesDaMigration[0].observacao_inspecao, NOTA);
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [i.corpo, i.obs]);
      marcar(
        "156a: as 8 linhas ok=true apos aplicar a 20261404; 156b reprova SO o corpo e a leitura da observacao",
      );
      // Dado que ja existia: a devolucao e a nota ficam byte a byte; so a LEITURA pelo navegador mudou.
      assert.deepEqual(await linhaDaDevolucao(c), antesDaMigration);
      assert.equal(
        await tentar(
          c,
          "authenticated",
          `SELECT observacao_inspecao FROM ${T}`,
        ),
        "42501",
      );
      assert.equal(
        await tentar(c, "authenticated", `SELECT * FROM ${T}`),
        "42501",
      );
      assert.equal(
        await tentar(
          c,
          "authenticated",
          `SELECT id, protocolo, status FROM ${T}`,
        ),
        null,
      );
      assert.equal(await tentar(c, "anon", `SELECT id FROM ${T}`), "42501");
      marcar(
        "dado que ja existia: a devolucao e a nota ficam intactas; authenticated leva permission denied na nota e no SELECT * e segue lendo as outras colunas; anon nao le",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await linhaDaDevolucao(c), antesDaMigration);
      marcar(
        "reaplicar a 20261404 deixa a 156a positiva e a devolucao intacta (idempotente)",
      );

      const estragosA = [
        ...comuns,
        [
          "authenticated ganha SELECT na coluna da observacao",
          `GRANT SELECT (observacao_inspecao) ON ${T} TO authenticated`,
          [i.obs],
        ],
        [
          "authenticated ganha SELECT na tabela inteira",
          `GRANT SELECT ON ${T} TO authenticated`,
          [i.obs],
        ],
        [
          "authenticated herda pg_read_all_data (membro do papel)",
          "GRANT pg_read_all_data TO authenticated",
          [i.obs],
        ],
        [
          "PUBLIC ganha SELECT na coluna da observacao (anon e authenticated herdam)",
          `GRANT SELECT (observacao_inspecao) ON ${T} TO PUBLIC`,
          [i.obs, i.anon],
        ],
        [
          "PUBLIC ganha SELECT na tabela (anon e authenticated herdam)",
          `GRANT SELECT ON ${T} TO PUBLIC`,
          [i.obs, i.anon],
        ],
        [
          "anon herda o authenticated (membro do papel)",
          "GRANT authenticated TO anon",
          [i.attrs, i.anon],
        ],
        [
          "authenticated perde uma das outras colunas",
          (c) =>
            umaColuna(c).then((col) =>
              c.query(`REVOKE SELECT (${col}) ON ${T} FROM authenticated`),
            ),
          [i.outras],
        ],
        [
          "authenticated perde todas as colunas",
          `REVOKE SELECT ON ${T} FROM authenticated`,
          [i.outras],
        ],
        [
          "authenticated ganha uma coluna nova (le 35)",
          [
            `ALTER TABLE ${T} ADD COLUMN p156_extra integer`,
            `GRANT SELECT (p156_extra) ON ${T} TO authenticated`,
          ],
          [i.outras],
        ],
        [
          "tabela sumida",
          `DROP TABLE ${T} CASCADE`,
          [i.obs, i.outras, i.anon, i.serv, i.rls],
        ],
      ];
      for (const [rotulo, sql, itens] of estragosA) {
        await sabotar(c, rotulo, A, sql, itens);
      }
    }),
  );
});
