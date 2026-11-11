"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário); nunca de entrada de rede nem de terceiro. */

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja. SO TESTE: nenhum SQL de producao muda.
//
// PROVA VIVA de duas travas de public.store_config (todas da 20261174000000_formas_de_pagamento_por_loja.sql; nenhuma
// migration posterior redefine funcao, gatilho nem CHECK: as de 20261199, 20261239, 20261244 e 20261310 so redefinem
// upsert_store_config e citam o gatilho em comentario):
//
//  (a) GATILHO store_config_exige_forma_de_pagamento (BEFORE INSERT OR UPDATE, por linha): a loja nunca fica sem NENHUMA
//      forma de pagar. A linha FINAL com formas_pagamento_entrega vazia E pagamento_online = false e' recusada com
//      'LOJA_SEM_FORMA_DE_PAGAMENTO' (P0001) -- sem isso o checkout fica sem opcao e a loja para de vender sem erro visivel.
//      Desvio B1: um INSERT cuja linha id ja existe (candidato do ON CONFLICT) passa, e o BEFORE UPDATE que o ON CONFLICT
//      aciona valida a linha final; sem o desvio, salvar qualquer campo pelo painel numa loja que vende so pelo app seria
//      recusado (o candidato do upsert_store_config nasce com pagamento_online = false, o default da coluna).
//  (b) CHECKs store_config_formas_pagamento_entrega_check (so 'pix','card','cash') e
//      store_config_formas_pagamento_sem_duplicata_check (sem elemento repetido) -> 23514.
//
// Hoje o teste de texto da migration (tests/migration_formas_de_pagamento_por_loja_test.ts) so le o SQL e os vizinhos
// (a-loja-escolhe-como-entrega-viva, compra-online-travas-viva...) so gravam formas VALIDAS: nenhum tentava o estado proibido.
//
// Cenarios (valores exatos; cada um numa transacao DESFEITA; o clone nasce sem linha em store_config, a semente cria a id = 1):
//   1  UPDATE / INSERT / ON CONFLICT DO UPDATE que deixam formas = '{}' e pagamento_online = false -> P0001 LOJA_SEM_FORMA...,
//      linha IDENTICA depois da recusa (e a loja so-pelo-app que DESLIGA o pagamento online tambem e' recusada)
//   2  o mesmo pelo caminho do painel (RPC upsert_store_config, como admin): formas [] numa loja sem pagamento online -> recusa
//      e nada gravado; formas ['pix'] -> grava
//   3  CONTROLE B1: ON CONFLICT DO UPDATE e DO NOTHING sobre loja so-pelo-app (formas '{}', online true) PASSAM; o painel salva
//      nome/WhatsApp nessa loja e as formas continuam '{}'
//   4  CONTROLES: '{}' + online passa; ['pix'] / ['card'] / as tres + sem online passam; sair do so-pelo-app para ['cash'] passa
//   5  ['boleto'], ['PIX'], ['pix','boleto'] (fora da lista) e ['pix','pix'], ['cash','card','cash'] (repetido) -> 23514 com o
//      NOME do CHECK certo, tanto em UPDATE quanto pelo painel, e nada gravado
//
// Mutantes (MUTANTE_R110A=<nome>; nome desconhecido da ERRO), aplicados no clone dentro da transacao da prova, que e' desfeita.
// `espera` = a(s) prova(s) em que a execucao TEM de ficar vermelha:
//   sem-gatilho-de-forma-de-pagamento  DROP TRIGGER store_config_exige_forma_de_pagamento                    -> 1, 2
//   gatilho-sem-cardinalidade          a condicao vira so `NOT NEW.pagamento_online`                         -> 2, 4
//   gatilho-sem-pagamento-online       a condicao vira so `cardinality(...) = 0` (ignora o pagamento online)  -> 1, 3, 4
//   gatilho-sem-desvio-do-insert       o INSERT-fantasma do ON CONFLICT deixa de passar (B1 apagado)          -> 3
//   sem-check-de-duplicata             DROP CONSTRAINT store_config_formas_pagamento_sem_duplicata_check      -> 5
//   sem-check-de-valor                 DROP CONSTRAINT store_config_formas_pagamento_entrega_check            -> 5
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-nunca-fica-sem-forma-de-pagamento-viva.cjs
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const FN_GATILHO = "public.store_config_exige_forma_de_pagamento()";
const GATILHO = "store_config_exige_forma_de_pagamento";
const CK_VALOR = "store_config_formas_pagamento_entrega_check";
const CK_DUPLICATA = "store_config_formas_pagamento_sem_duplicata_check";
const FRASE = "LOJA_SEM_FORMA_DE_PAGAMENTO";
const ADMIN = "e110a000-0000-4000-8000-0000000000ad";
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const UPSERT = "SELECT public.upsert_store_config($1::jsonb) AS r";

// Trechos EXATOS do corpo vivo (pg_get_functiondef) que cada mutante de funcao troca; cada um tem de ocorrer UMA vez.
const CONDICAO =
  "IF cardinality(NEW.formas_pagamento_entrega) = 0 AND NOT NEW.pagamento_online THEN";
const MUTANTES = new Map(
  Object.entries({
    "sem-gatilho-de-forma-de-pagamento": { gatilho: true },
    "gatilho-sem-cardinalidade": {
      funcao: [CONDICAO, "IF NOT NEW.pagamento_online THEN"],
    },
    "gatilho-sem-pagamento-online": {
      funcao: [
        CONDICAO,
        "IF cardinality(NEW.formas_pagamento_entrega) = 0 THEN",
      ],
    },
    "gatilho-sem-desvio-do-insert": {
      funcao: ["IF TG_OP = 'INSERT' AND EXISTS (", "IF false AND EXISTS ("],
    },
    "sem-check-de-duplicata": { check: CK_DUPLICATA },
    "sem-check-de-valor": { check: CK_VALOR },
  }),
);

const defDaFuncao = async (c) =>
  (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      FN_GATILHO,
    ])
  ).rows[0].d.replace(/\r/g, "");
const temGatilho = async (c) =>
  (
    await c.query(
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = $1 AND tgrelid = 'public.store_config'::regclass AND NOT tgisinternal",
      [GATILHO],
    )
  ).rows[0].n === 1;
const temCheck = async (c, nome) =>
  (
    await c.query(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1 AND conrelid = 'public.store_config'::regclass",
      [nome],
    )
  ).rows[0].n === 1;

async function mutar() {
  const nome = process.env.MUTANTE_R110A;
  if (!nome) return;
  const m = MUTANTES.get(nome);
  if (!m) throw new Error(`MUTANTE_R110A desconhecido: ${nome}`);
  const c = P.conexao();
  if (m.gatilho) {
    assert.equal(await temGatilho(c), true, "o gatilho vivo nao existe");
    await c.query(`DROP TRIGGER ${GATILHO} ON public.store_config`);
    assert.equal(await temGatilho(c), false, "o gatilho nao foi derrubado");
  } else if (m.check) {
    assert.equal(await temCheck(c, m.check), true, `${m.check} nao existe`);
    await c.query(`ALTER TABLE public.store_config DROP CONSTRAINT ${m.check}`);
    assert.equal(await temCheck(c, m.check), false, `${m.check} ficou`);
  } else {
    const original = await defDaFuncao(c);
    assert.equal(
      original.split(m.funcao[0]).length - 1,
      1,
      `mutante ${nome}: o alvo tem de ocorrer UMA vez no corpo vivo`,
    );
    const alterado = original.replace(m.funcao[0], m.funcao[1]);
    assert.notEqual(alterado, original, "sabotagem nao aplicada");
    await c.query(alterado);
    assert.equal(
      await defDaFuncao(c),
      alterado,
      "o banco nao instalou exatamente o mutante",
    );
  }
  console.log(`MUTANTE aplicado: ${nome}`);
}

/** O admin da fixture (papel ATUAL em auth.users E profiles, que e' o que o painel confere) e a loja id = 1. */
async function semear({ formas, online }) {
  const c = P.conexao();
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@r110a.fixture.invalid', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin R110A', 'admin')",
    [ADMIN],
  );
  await loja(formas, online);
}

/** Poe a loja id = 1 no estado pedido (sempre um estado VALIDO). Cria a linha se o clone nao a trouxe. */
async function loja(formas, online) {
  await P.conexao().query(
    `INSERT INTO public.store_config (id, formas_pagamento_entrega, pagamento_online)
     VALUES (1, $1::text[], $2)
     ON CONFLICT (id) DO UPDATE
       SET formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           pagamento_online = EXCLUDED.pagamento_online`,
    [formas, online],
  );
}

/** A linha inteira (todas as colunas), para provar "a linha continua igual" depois de uma recusa. */
const linha = async () =>
  (
    await P.conexao().query(
      "SELECT to_jsonb(s) AS l FROM public.store_config s WHERE s.id = 1",
    )
  ).rows[0]?.l ?? null;
const estado = async () => {
  const l = await linha();
  return l && [l.formas_pagamento_entrega, l.pagamento_online];
};

/** SQL direto como o dono do banco (sessao direta). Devolve {linhas} ou {erro, codigo, restricao}. */
const direto = (sql, params = []) => P.tentar(null, sql, params, {});
/** O painel: upsert_store_config como admin ATUAL. */
const painel = (config) =>
  P.tentar("authenticated", UPSERT, [JSON.stringify(config)], {
    uid: ADMIN,
    claims: JWT_ADMIN,
  });

const UPD = "UPDATE public.store_config SET";

/** Recusa do gatilho: P0001 com a frase exata, sem DETAIL de outra trava. */
function recusaSemForma(r, quem) {
  assert.ok(r.erro, `${quem}: devia recusar com ${FRASE}`);
  assert.equal(r.codigo, "P0001", `${quem}: codigo ${r.codigo} (${r.erro})`);
  assert.equal(r.erro, FRASE, `${quem}: recusou com "${r.erro}"`);
}
function aceita(r, quem) {
  assert.equal(
    r.erro,
    undefined,
    `${quem}: devia aceitar, recusou: ${r.erro} (${r.codigo})`,
  );
}
function recusaCheck(r, quem, nomeDoCheck) {
  assert.ok(r.erro, `${quem}: devia recusar (23514 em ${nomeDoCheck})`);
  assert.equal(r.codigo, "23514", `${quem}: codigo ${r.codigo} (${r.erro})`);
  assert.equal(
    r.restricao,
    nomeDoCheck,
    `${quem}: caiu no CHECK ${r.restricao}, devia ser ${nomeDoCheck}`,
  );
}

prova(
  "1. estado proibido (sem forma de pagar e sem pagamento online) e' recusado em UPDATE, INSERT e ON CONFLICT",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await semear({ formas: ["pix"], online: false });
      await mutar();
      const antes = await linha();
      assert.deepEqual(await estado(), [["pix"], false], "semente");

      // UPDATE direto: esvaziar as formas de uma loja que nao vende pelo app.
      recusaSemForma(
        await direto(`${UPD} formas_pagamento_entrega = '{}' WHERE id = 1`),
        "UPDATE so formas '{}'",
      );
      assert.deepEqual(await linha(), antes, "a recusa gravou (UPDATE formas)");

      // O par do painel: formas '{}' e online false no MESMO comando.
      recusaSemForma(
        await direto(
          `${UPD} formas_pagamento_entrega = '{}', pagamento_online = false WHERE id = 1`,
        ),
        "UPDATE formas '{}' + online false",
      );
      assert.deepEqual(await linha(), antes, "a recusa gravou (UPDATE par)");

      // A loja que vende SO pelo app e DESLIGA o pagamento online ficaria sem nenhuma forma: tambem recusa.
      await loja([], true);
      const soApp = await linha();
      assert.deepEqual(await estado(), [[], true], "loja so pelo app");
      recusaSemForma(
        await direto(`${UPD} pagamento_online = false WHERE id = 1`),
        "desligar o pagamento online de quem so vende pelo app",
      );
      assert.deepEqual(
        await linha(),
        soApp,
        "a recusa gravou (desligar online)",
      );

      // ON CONFLICT DO UPDATE cuja linha FINAL fica sem forma: o INSERT-fantasma passa (B1), o UPDATE que ele aciona recusa.
      recusaSemForma(
        await direto(
          `INSERT INTO public.store_config (id, formas_pagamento_entrega) VALUES (1, '{}')
           ON CONFLICT (id) DO UPDATE SET pagamento_online = false`,
        ),
        "ON CONFLICT DO UPDATE que deixa a linha final sem forma",
      );
      assert.deepEqual(await linha(), soApp, "a recusa gravou (ON CONFLICT)");

      // INSERT REAL (a linha nao existe): o candidato E' a linha final.
      await c.query("DELETE FROM public.store_config");
      assert.equal(await linha(), null, "a linha nao foi apagada");
      recusaSemForma(
        await direto(
          "INSERT INTO public.store_config (id, formas_pagamento_entrega, pagamento_online) VALUES (1, '{}', false)",
        ),
        "INSERT real sem forma e sem online",
      );
      assert.equal(await linha(), null, "a recusa do INSERT criou a loja");
      // ... e o default da coluna (pagamento_online = false) com formas '{}' tambem.
      recusaSemForma(
        await direto(
          "INSERT INTO public.store_config (id, formas_pagamento_entrega) VALUES (1, '{}')",
        ),
        "INSERT real sem forma, online no default (false)",
      );
      assert.equal(
        await linha(),
        null,
        "a recusa do INSERT (default) criou a loja",
      );
    }),
);

prova(
  "2. o painel (upsert_store_config, admin) tambem nao deixa a loja sem forma de pagar, e nada e' gravado",
  () =>
    P.emTransacao(async () => {
      await semear({ formas: ["pix", "card"], online: false });
      await mutar();
      const antes = await linha();

      recusaSemForma(
        await painel({ formas_pagamento_entrega: [] }),
        "painel formas [] numa loja sem pagamento online",
      );
      assert.deepEqual(await linha(), antes, "a recusa do painel gravou");

      // Controle do mesmo caminho: com ao menos uma forma, o painel grava, e SO as formas mudam.
      aceita(
        await painel({ formas_pagamento_entrega: ["pix"] }),
        "painel formas ['pix']",
      );
      assert.deepEqual(await estado(), [["pix"], false], "o painel nao gravou");
      const l = await linha();
      for (const [k, v] of Object.entries(antes)) {
        if (k === "formas_pagamento_entrega" || k === "updated_at") continue;
        assert.deepEqual(l[k], v, `o painel mexeu em ${k}`);
      }

      // Tirar a ULTIMA forma pelo painel (sem pagamento online) e' o clique que deixaria o checkout sem opcao.
      recusaSemForma(
        await painel({ formas_pagamento_entrega: [] }),
        "painel tirando a ultima forma",
      );
      assert.deepEqual(await estado(), [["pix"], false], "a ultima forma saiu");
    }),
);

prova(
  "3. controle B1: a loja que vende so pelo app (formas '{}', online true) continua salvando",
  () =>
    P.emTransacao(async () => {
      await semear({ formas: [], online: true });
      await mutar();
      assert.deepEqual(await estado(), [[], true], "loja so pelo app");

      // O candidato do INSERT nasce com pagamento_online = false (default) e formas '{}': sem o desvio, o gatilho o recusaria.
      aceita(
        await direto(
          `INSERT INTO public.store_config (id, formas_pagamento_entrega) VALUES (1, '{}')
           ON CONFLICT (id) DO UPDATE SET store_name = 'Loja R110A'`,
        ),
        "ON CONFLICT DO UPDATE sobre loja so pelo app",
      );
      let l = await linha();
      assert.equal(l.store_name, "Loja R110A", "o DO UPDATE nao gravou");
      assert.deepEqual(
        await estado(),
        [[], true],
        "o DO UPDATE mexeu nas formas",
      );

      aceita(
        await direto(
          "INSERT INTO public.store_config (id, formas_pagamento_entrega) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING",
        ),
        "ON CONFLICT DO NOTHING sobre loja so pelo app",
      );
      assert.deepEqual(
        await estado(),
        [[], true],
        "o DO NOTHING mexeu na loja",
      );

      // O caminho real do painel: salvar nome/WhatsApp numa loja so-pelo-app (o upsert faz INSERT ... ON CONFLICT).
      aceita(
        await painel({
          store_name: "Outro nome",
          whatsapp_number: "5534999990000",
        }),
        "painel salvando nome/WhatsApp numa loja so pelo app",
      );
      l = await linha();
      assert.equal(l.store_name, "Outro nome");
      assert.equal(l.whatsapp_number, "5534999990000");
      assert.deepEqual(
        await estado(),
        [[], true],
        "salvar um campo sem relacao apagou ou mudou as formas",
      );
    }),
);

prova(
  "4. controles: o gatilho so recusa a conjuncao (sem forma E sem pagamento online); o resto passa",
  () =>
    P.emTransacao(async () => {
      await semear({ formas: ["pix", "card", "cash"], online: false });
      await mutar();

      // So pelo app: formas '{}' com online true.
      aceita(
        await direto(
          `${UPD} pagamento_online = true, formas_pagamento_entrega = '{}' WHERE id = 1`,
        ),
        "'{}' + online true",
      );
      assert.deepEqual(await estado(), [[], true]);
      // De volta a "so na entrega", uma forma de cada vez; online false com forma passa.
      for (const formas of [
        ["pix"],
        ["card"],
        ["cash"],
        ["cash", "pix"],
        ["pix", "card", "cash"],
      ]) {
        aceita(
          await direto(
            `${UPD} pagamento_online = false, formas_pagamento_entrega = $1::text[] WHERE id = 1`,
            [formas],
          ),
          `${JSON.stringify(formas)} + online false`,
        );
        assert.deepEqual(await estado(), [formas, false]);
      }
      // As duas coisas ligadas.
      aceita(
        await direto(`${UPD} pagamento_online = true WHERE id = 1`),
        "tres formas + online true",
      );
      assert.deepEqual(await estado(), [["pix", "card", "cash"], true]);
      // Online true com UMA forma, e UPDATE que nao toca nenhum dos dois campos.
      aceita(
        await direto(
          `${UPD} formas_pagamento_entrega = ARRAY['cash'] WHERE id = 1`,
        ),
        "online true + ['cash']",
      );
      aceita(
        await direto(`${UPD} store_name = 'Qualquer' WHERE id = 1`),
        "UPDATE de outro campo",
      );
      assert.deepEqual(await estado(), [["cash"], true]);
      // Loja sem pagamento online com formas validas aceita tambem a escrita de OUTRO campo (so a linha final importa).
      await loja(["pix"], false);
      aceita(
        await direto(`${UPD} store_name = 'Outra' WHERE id = 1`),
        "UPDATE de outro campo em loja so na entrega",
      );
      assert.deepEqual(await estado(), [["pix"], false]);
    }),
);

prova(
  "5. forma fora da lista e forma repetida sao recusadas pelo CHECK certo (23514), em UPDATE e pelo painel",
  () =>
    P.emTransacao(async () => {
      await semear({ formas: ["pix", "card"], online: true });
      await mutar();
      const antes = await linha();

      // Fora da lista permitida ('pix','card','cash'): so o CHECK de valor pega.
      for (const formas of [["boleto"], ["PIX"], ["pix", "boleto"], [""]]) {
        recusaCheck(
          await direto(
            `${UPD} formas_pagamento_entrega = $1::text[] WHERE id = 1`,
            [formas],
          ),
          `UPDATE ${JSON.stringify(formas)} (valor)`,
          CK_VALOR,
        );
        recusaCheck(
          await painel({ formas_pagamento_entrega: formas }),
          `painel ${JSON.stringify(formas)} (valor)`,
          CK_VALOR,
        );
        assert.deepEqual(
          await linha(),
          antes,
          `${JSON.stringify(formas)} gravou`,
        );
      }
      // Elemento nulo no meio da lista tambem nao e' valor da lista.
      recusaCheck(
        await direto(
          `${UPD} formas_pagamento_entrega = ARRAY['pix', NULL]::text[] WHERE id = 1`,
        ),
        "UPDATE ['pix', NULL] (valor)",
        CK_VALOR,
      );

      // Repetida (todas dentro da lista): so o CHECK de duplicata pega.
      for (const formas of [
        ["pix", "pix"],
        ["cash", "card", "cash"],
      ]) {
        recusaCheck(
          await direto(
            `${UPD} formas_pagamento_entrega = $1::text[] WHERE id = 1`,
            [formas],
          ),
          `UPDATE ${JSON.stringify(formas)} (duplicata)`,
          CK_DUPLICATA,
        );
        recusaCheck(
          await painel({ formas_pagamento_entrega: formas }),
          `painel ${JSON.stringify(formas)} (duplicata)`,
          CK_DUPLICATA,
        );
        assert.deepEqual(
          await linha(),
          antes,
          `${JSON.stringify(formas)} gravou`,
        );
      }

      // Controle: a lista valida, sem repeticao, passa pelos dois CHECKs (e a ordem nao importa).
      aceita(
        await direto(
          `${UPD} formas_pagamento_entrega = ARRAY['cash','pix','card'] WHERE id = 1`,
        ),
        "as tres, sem repetir",
      );
      assert.deepEqual(await estado(), [["cash", "pix", "card"], true]);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar("a loja nunca fica sem forma de pagamento");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
