"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// F5 / 20261382: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: a linha de cada categoria do grupo "financeiro" no detalhe da DRE
// (fin_dre -> linhas[]) sai com o MESMO sinal do total (entrada menos saida): tarifa,
// juros pagos e quebra de caixa negativos, rendimento e sobra positivos, e a soma das
// linhas fecha com resultado_financeiro. O resto do resultado nao muda.
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/fin-dre-sinal-viva.cjs
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261382000000_o_resultado_mostra_tarifa_juro_e_quebra_como_despesa.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.fin_dre\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
// O corpo que estava no ar antes: o da 20261242000000 (a ultima que redefine fin_dre).
const CORPO_ANTES = corpoDe(
  ler(
    "supabase/migrations/20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql",
  ),
);
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "afc3e13805ce37819cfdcd094043087c";

const ADMIN = "5e382000-0000-4000-8000-000000000001";
const CLIENTE = "5e382000-0000-4000-8000-000000000002";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const CAT = {
  rendimento: "f2000000-0000-4000-8000-000000000003",
  sobra: "f2000000-0000-4000-8000-000000000005",
  tarifa: "f2000000-0000-4000-8000-000000000030",
  quebra: "f2000000-0000-4000-8000-000000000031",
  aluguel: "f2000000-0000-4000-8000-000000000020",
  taxaCartao: "f2000000-0000-4000-8000-000000000012",
  imposto: "f2000000-0000-4000-8000-000000000011",
  outrasReceitas: "f2000000-0000-4000-8000-000000000002",
  compraMercadoria: "f2000000-0000-4000-8000-000000000040",
};
const INI = "2031-03-01";
const FIM = "2031-03-31";
const VAZIO_INI = "2031-04-01";
const VAZIO_FIM = "2031-04-30";

const cent = (v) => Math.round(Number(v) * 100);
const dre = async (c, ini = INI, fim = FIM) =>
  (await c.query("SELECT public.fin_dre($1, $2) AS r", [ini, fim])).rows[0].r;
const valoresDe = (d, grupo) =>
  Object.fromEntries(
    d.linhas
      .filter((l) => l.grupo === grupo)
      .map((l) => [l.categoria, cent(l.valor)]),
  );
const semLinhas = ({ linhas: _linhas, ...resto }) => resto;

async function funcao(c) {
  const a = (
    await c.query(`SELECT to_jsonb(p) AS a FROM pg_proc p
      WHERE oid = 'public.fin_dre(date,date)'::regprocedure`)
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function lancamentos(c) {
  return (
    await c.query(
      "SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') AS l FROM public.fin_lancamentos l",
    )
  ).rows[0].l;
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso382");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso382");
    await c.query("RELEASE SAVEPOINT caso382");
  }
}
async function recusa(c, acao, mensagem) {
  await isolado(c, async () => {
    await assert.rejects(acao, (e) => mensagem.test(e.message));
  });
}
async function lanca(c, o) {
  const realizado = (o.status || "realizado") === "realizado";
  await c.query(
    `INSERT INTO public.fin_lancamentos
       (tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
        data_competencia, data_vencimento, data_realizacao, origem, cancelado_em)
     VALUES ($1, $2, $3, $4, $5, $6, 'dinheiro', $7, $7, $8, $9, $10)`,
    [
      o.tipo,
      o.status || "realizado",
      o.valor,
      CAIXA,
      o.categoria,
      o.descricao,
      o.dia || "2031-03-10",
      realizado ? o.dia || "2031-03-10" : null,
      o.origem || "manual",
      o.status === "cancelado" ? new Date().toISOString() : null,
    ],
  );
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // O topo instalado pelo CI (todas as migrations do zero) e o desta migration.
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o corpo da 382",
    );
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o corpo anterior nao e o da 242",
    );

    for (const [id, papel] of [
      [ADMIN, "admin"],
      [CLIENTE, "customer"],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@dre382.invalid', $2::jsonb)`,
        [id, JSON.stringify(papel === "admin" ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 382', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );
    }
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

    // Fixture (dado que JA existia antes da migration): um mes inteiro de 2031.
    //   financeiro: tarifa 12,50 (realizada) + juros 7,50 (prevista) = 20,00 de saida;
    //               quebra 5,00 (saida, ajuste do caixa); rendimento 8,00 e sobra 3,00 (entradas);
    //               um lancamento CANCELADO de 99,00 que nao pode contar.
    //   demais:     aluguel 30 (despesa fixa), taxa do cartao 4 (custo variavel), imposto 2
    //               (deducao), outras receitas 10 (receita), compra de mercadoria 50 (fora da DRE).
    await lanca(c, {
      tipo: "saida",
      valor: 12.5,
      categoria: CAT.tarifa,
      descricao: "Tarifa fixture",
    });
    await lanca(c, {
      tipo: "saida",
      valor: 7.5,
      categoria: CAT.tarifa,
      descricao: "Juros fixture",
      status: "previsto",
      dia: "2031-03-20",
    });
    await lanca(c, {
      tipo: "saida",
      valor: 99,
      categoria: CAT.tarifa,
      descricao: "Tarifa cancelada",
      status: "cancelado",
    });
    await lanca(c, {
      tipo: "saida",
      valor: 5,
      categoria: CAT.quebra,
      descricao: "Quebra fixture",
      origem: "ajuste_caixa",
    });
    await lanca(c, {
      tipo: "entrada",
      valor: 8,
      categoria: CAT.rendimento,
      descricao: "Rendimento fixture",
    });
    await lanca(c, {
      tipo: "entrada",
      valor: 3,
      categoria: CAT.sobra,
      descricao: "Sobra fixture",
      origem: "ajuste_caixa",
    });
    await lanca(c, {
      tipo: "saida",
      valor: 30,
      categoria: CAT.aluguel,
      descricao: "Aluguel fixture",
    });
    await lanca(c, {
      tipo: "saida",
      valor: 4,
      categoria: CAT.taxaCartao,
      descricao: "Taxa fixture",
    });
    await lanca(c, {
      tipo: "saida",
      valor: 2,
      categoria: CAT.imposto,
      descricao: "Imposto fixture",
    });
    await lanca(c, {
      tipo: "entrada",
      valor: 10,
      categoria: CAT.outrasReceitas,
      descricao: "Outra receita fixture",
    });
    await lanca(c, {
      tipo: "saida",
      valor: 50,
      categoria: CAT.compraMercadoria,
      descricao: "Compra fixture",
    });
    const dadosAntes = await lancamentos(c);

    // CONTROLE: com o corpo ANTERIOR (o rollback desta migration) o defeito aparece
    // nesta mesma fixture. Sem isto o resto da prova poderia passar por acaso.
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(
      anterior.prosrc,
      CORPO_ANTES,
      "o rollback nao devolveu o corpo da 242 byte a byte",
    );
    assert.equal(md5(anterior.prosrc), HASH_ANTES);
    assert.deepEqual(
      { ...anterior, prosrc: null },
      { ...topo, prosrc: null },
      "o rollback mudou OID, dono, ACL ou atributo",
    );
    const antes = await dre(c);
    const antesVazio = await dre(c, VAZIO_INI, VAZIO_FIM);
    assert.deepEqual(
      valoresDe(antes, "financeiro"),
      {
        "Tarifas bancárias e juros pagos": 2000,
        "Quebra de caixa": 500,
        "Rendimentos e juros recebidos": 800,
        "Sobra de caixa": 300,
      },
      "controle: o corpo anterior devia mostrar tarifa e quebra SEM sinal",
    );
    assert.equal(
      cent(antes.resultado_financeiro),
      800 + 300 - 2000 - 500,
      "o total ja era entrada menos saida",
    );
    console.log(
      "  PASSOU controle: o corpo anterior mostrava tarifa +20,00 e quebra +5,00; o total (-14,00) ja estava certo",
    );

    // A migration, sobre a fixture que ja existia.
    await c.query(migration);
    assert.deepEqual(
      await funcao(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI",
    );
    assert.deepEqual(
      await lancamentos(c),
      dadosAntes,
      "apply alterou lancamento que ja existia",
    );
    const depois = await dre(c);

    // 1. O sinal certo no detalhe.
    assert.deepEqual(valoresDe(depois, "financeiro"), {
      "Tarifas bancárias e juros pagos": -2000,
      "Quebra de caixa": -500,
      "Rendimentos e juros recebidos": 800,
      "Sobra de caixa": 300,
    });
    console.log(
      "  PASSOU tarifa+juros -20,00 (inclui o previsto), quebra -5,00, rendimento +8,00, sobra +3,00; o cancelado nao conta",
    );

    // 2. As linhas fecham com o total.
    const soma = depois.linhas
      .filter((l) => l.grupo === "financeiro")
      .reduce((s, l) => s + cent(l.valor), 0);
    assert.equal(soma, cent(depois.resultado_financeiro));
    assert.equal(
      cent(depois.lucro_liquido),
      cent(depois.resultado_operacional) + cent(depois.resultado_financeiro),
    );
    console.log(
      "  PASSOU a soma das linhas do financeiro (-14,00) fecha com resultado_financeiro e com o lucro liquido",
    );

    // 3. O resto do resultado nao mudou: totais, outros grupos e a ORDEM das linhas.
    assert.deepEqual(semLinhas(depois), semLinhas(antes), "um total mudou");
    const fora = (d) => d.linhas.filter((l) => l.grupo !== "financeiro");
    assert.deepEqual(
      fora(depois),
      fora(antes),
      "uma linha de outro grupo mudou",
    );
    assert.deepEqual(valoresDe(depois, "despesa_fixa"), {
      "Aluguel e condomínio": 3000,
    });
    assert.deepEqual(valoresDe(depois, "custo_variavel"), {
      "Taxas de cartão e Mercado Pago": 400,
    });
    assert.deepEqual(valoresDe(depois, "deducao"), {
      "Impostos sobre vendas (DAS/Simples)": 200,
    });
    assert.deepEqual(valoresDe(depois, "receita"), { "Outras receitas": 1000 });
    assert.equal(
      depois.linhas.some((l) => l.grupo === "fora_dre"),
      false,
    );
    assert.deepEqual(
      depois.linhas.map((l) => `${l.grupo}/${l.categoria}`),
      antes.linhas.map((l) => `${l.grupo}/${l.categoria}`),
      "a ordem das linhas mudou",
    );
    console.log(
      "  PASSOU totais, outros grupos e a ordem das linhas iguais ao corpo anterior",
    );

    // 4. Borda: categoria do financeiro com entrada E saida no mesmo periodo (o banco
    //    aceita, a tela de lancamento nao): vira o liquido, e a soma continua fechando.
    await isolado(c, async () => {
      await lanca(c, {
        tipo: "entrada",
        valor: 4,
        categoria: CAT.tarifa,
        descricao: "Estorno de tarifa fixture",
      });
      const misto = await dre(c);
      assert.equal(
        valoresDe(misto, "financeiro")["Tarifas bancárias e juros pagos"],
        -1600,
      );
      const s = misto.linhas
        .filter((l) => l.grupo === "financeiro")
        .reduce((x, l) => x + cent(l.valor), 0);
      assert.equal(s, cent(misto.resultado_financeiro));
    });
    console.log(
      "  PASSOU categoria com entrada e saida no mesmo periodo: liquido -16,00 e a soma ainda fecha",
    );

    // 5. Borda: periodo sem nenhum lancamento (e periodo so de receita) nao muda.
    const vazioDepois = await dre(c, VAZIO_INI, VAZIO_FIM);
    assert.deepEqual(vazioDepois, antesVazio);
    assert.deepEqual(vazioDepois.linhas, []);
    assert.equal(cent(vazioDepois.resultado_financeiro), 0);
    await isolado(c, async () => {
      await lanca(c, {
        tipo: "entrada",
        valor: 7,
        categoria: CAT.outrasReceitas,
        descricao: "So receita",
        dia: "2031-05-10",
      });
      const soReceita = await dre(c, "2031-05-01", "2031-05-31");
      assert.deepEqual(soReceita.linhas, [
        { grupo: "receita", categoria: "Outras receitas", valor: 7 },
      ]);
    });
    console.log(
      "  PASSOU periodo vazio igual ao anterior e periodo so de receita intacto",
    );

    // 6. Porta e permissoes: nada de ACL mudou; quem nao e admin continua barrado.
    assert.equal(
      (
        await c.query(
          "SELECT has_function_privilege('anon', 'public.fin_dre(date,date)', 'EXECUTE') AS x",
        )
      ).rows[0].x,
      false,
    );
    assert.equal(
      (
        await c.query(
          "SELECT has_function_privilege('authenticated', 'public.fin_dre(date,date)', 'EXECUTE') AS x",
        )
      ).rows[0].x,
      true,
    );
    assert.equal(
      (
        await c.query(`SELECT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
        WHERE p.oid = 'public.fin_dre(date,date)'::regprocedure AND g.grantee = 0 AND g.privilege_type = 'EXECUTE') AS x`)
      ).rows[0].x,
      false,
    );
    await isolado(c, async () => {
      await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [
        CLIENTE,
      ]);
      await assert.rejects(
        () => dre(c),
        (e) => e.code === "42501",
      );
    });
    await recusa(c, () => dre(c, FIM, INI), /Período inválido/);
    console.log(
      "  PASSOU anon/PUBLIC sem EXECUTE, authenticated com; cliente comum recebe 42501; periodo invertido recusa",
    );

    // 7. Reaplicar e inofensivo; o pre-voo recusa corpo desconhecido sem escrever.
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    assert.deepEqual(await dre(c), depois);
    await isolado(c, async () => {
      await c.query(
        `CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date) RETURNS jsonb
         LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
         AS $$ BEGIN RETURN '{}'::jsonb; END; $$`,
      );
      const estranho = await funcao(c);
      await c.query("SAVEPOINT recusa382");
      await assert.rejects(() => c.query(migration), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT recusa382");
      assert.deepEqual(await funcao(c), estranho, "a recusa gravou algo");
    });
    console.log(
      "  PASSOU reaplicar nao muda nada; corpo desconhecido derruba a migration sem gravar",
    );

    // 8. Rollback: devolve o corpo da 242; o segundo recusa; e a migration volta limpa.
    await c.query(rollback);
    assert.equal((await funcao(c)).prosrc, CORPO_ANTES);
    await c.query("SAVEPOINT segundo382");
    await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT segundo382");
    assert.equal((await funcao(c)).prosrc, CORPO_ANTES);
    assert.deepEqual(await dre(c), antes);
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    assert.deepEqual(await dre(c), depois);
    assert.deepEqual(
      await lancamentos(c),
      dadosAntes,
      "ida e volta alterou lancamento",
    );
    console.log(
      "  PASSOU rollback devolve a 242 byte a byte, o segundo rollback recusa, e a ida e volta nao toca nos lancamentos",
    );

    // 9. Os portoes de publicacao que fixam o hash de fin_dre (8e: rol 92-202; 45a: custo do dia)
    //    aceitam os DOIS corpos exatos (o da 242 e o desta) e reprovam so a linha do fin_dre com
    //    qualquer outro. Sem este passo a 382 deixaria a 8e e a 45a vermelhas numa loja que a recebeu.
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
    const PORTOES = [
      ["8e-conferir-92-a-202-aplicado", /^corpo final fin_dre/],
      [
        "45a-conferir-custo-do-dia-aplicado",
        /^fin_dre: corpo e o da 20261242000000/,
      ],
    ];
    const rodar = async ([nome, linhaDoDre]) => {
      const rows = (await c.query(consulta(nome))).rows;
      const dela = rows.filter((r) => linhaDoDre.test(r.item));
      assert.equal(
        dela.length,
        1,
        `${nome}: a linha do fin_dre sumiu ou duplicou`,
      );
      return { dela: dela[0], resto: rows.filter((r) => r !== dela[0]) };
    };
    for (const portao of PORTOES) {
      // corpo da 382 no ar (estado da arvore inteira)
      let r = await rodar(portao);
      assert.equal(r.dela.ok, true, `${portao[0]}: reprovou o corpo da 382`);
      assert.equal(
        r.resto.every((x) => x.ok),
        true,
        `${portao[0]}: outra linha reprovou`,
      );
      // corpo da 242 no ar (loja que ainda nao recebeu a 382)
      await isolado(c, async () => {
        await c.query(rollback);
        r = await rodar(portao);
        assert.equal(r.dela.ok, true, `${portao[0]}: reprovou o corpo da 242`);
        assert.equal(
          r.resto.every((x) => x.ok),
          true,
        );
      });
      // corpo estranho (um comentario a mais) no ar: reprova a linha do fin_dre, so ela
      await isolado(c, async () => {
        const estranho = (await funcao(c)).prosrc.replace(
          "BEGIN",
          "BEGIN -- estranho",
        );
        await c.query(
          `CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date) RETURNS jsonb
           LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $corpo$${estranho}$corpo$`,
        );
        r = await rodar(portao);
        assert.equal(
          r.dela.ok,
          false,
          `${portao[0]}: aceitou um corpo estranho`,
        );
        assert.equal(
          r.resto.every((x) => x.ok),
          true,
          `${portao[0]}: reprovou fora do fin_dre`,
        );
      });
    }
    console.log(
      "  PASSOU 8e e 45a aceitam o corpo da 242 e o da 382 e reprovam so a linha do fin_dre com corpo estranho",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  console.log("[fin-dre-sinal] prova viva concluida (20261382).");
}

main().catch((erro) => {
  console.error(`[fin-dre-sinal] FALHOU: ${erro.stack || erro.message}`);
  process.exit(1);
});
