"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, CASOS)
 * ou do JSON da própria RPC no Postgres efêmero; nunca de entrada de rede nem
 * de terceiro. */

/**
 * PROVA VIVA (só teste; nenhum SQL de produção muda) da GUARDA DE PERÍODO de
 * public.fin_resumo (corpo vivo desde 20261399300000_o_estorno_em_andamento_
 * nao_e_conta_vencida.sql) e de public.fin_extrato (corpo vivo desde
 * 20261199000000_portas_do_painel_exigem_admin_atual.sql), contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero (rpc-ci):
 *
 *   IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400
 *     -> 22023 'Período inválido (até 400 dias).'
 *
 * Por que importa: sem a guarda, p_inicio NULL faz fin__movimentos(NULL, p_fim)
 * devolver o ledger INTEIRO (fin_resumo mostraria entradas, saídas e resultado de
 * todo o histórico com a série vazia; fin_extrato devolveria o razão todo num
 * único JSON) e fim antes do início zera tudo em silêncio. O vizinho
 * financeiro-viva.cjs só prova isso para fin_dre ("gap 4"); estas duas só eram
 * chamadas com 30 dias válidos.
 *
 * CENÁRIOS (admin ATUAL; cada TENTATIVA de chamada num SAVEPOINT próprio, porque
 * erro dentro da transação a aborta):
 *   R   fin_resumo recusa (NULL, hoje), (hoje, NULL), (hoje, hoje-30) invertido
 *       e (hoje-401, hoje): 22023 /Período inválido/ nas quatro
 *   X   o mesmo para fin_extrato
 *   CR  controle: fin_resumo com EXATAMENTE 400 dias passa e a série tem 401 dias
 *       (um por dia, extremos incluídos); período de 1 dia (hoje, hoje) também
 *   CX  controle: fin_extrato com exatamente 400 dias passa (array JSON)
 *
 * MUTANTES: MUTANTE_R119B=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha no cenário que o nome promete.
 * Nome desconhecido é ERRO. Sem MUTANTE_R119B a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-financeiro-recusa-periodo-invalido-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: fin_resumo e fin_extrato recusam período inválido (rpc-ci)";
const U_ADMIN = "d1190000-0000-4000-8000-0000000000b1";

const FUNCOES = {
  resumo: {
    regproc: "public.fin_resumo(date,date)",
    chamar: (ini, fim) => `SELECT public.fin_resumo(${ini}, ${fim}) AS r`,
    cenarioRecusa: "R",
    cenarioControle: "CR",
  },
  extrato: {
    regproc: "public.fin_extrato(date,date,uuid)",
    chamar: (ini, fim) => `SELECT public.fin_extrato(${ini}, ${fim}) AS r`,
    cenarioRecusa: "X",
    cenarioControle: "CX",
  },
};

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const CONDICAO =
  "p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400";

const MUTANTES = {};
for (const [nome, f] of Object.entries(FUNCOES)) {
  MUTANTES[`${nome}-sem-guarda-de-periodo`] = {
    funcao: f,
    espera: [f.cenarioRecusa],
    de: CONDICAO,
    para: "false",
  };
  MUTANTES[`${nome}-aceita-401-dias`] = {
    funcao: f,
    espera: [f.cenarioRecusa],
    de: "p_fim - p_inicio > 400",
    para: "p_fim - p_inicio > 401",
  };
  MUTANTES[`${nome}-recusa-400-dias`] = {
    funcao: f,
    espera: [f.cenarioControle],
    de: "p_fim - p_inicio > 400",
    para: "p_fim - p_inicio > 399",
  };
  MUTANTES[`${nome}-sem-checagem-de-nulo`] = {
    funcao: f,
    espera: [f.cenarioRecusa],
    de: "p_inicio IS NULL OR p_fim IS NULL OR ",
    para: "",
  };
  MUTANTES[`${nome}-sem-checagem-de-invertido`] = {
    funcao: f,
    espera: [f.cenarioRecusa],
    de: "p_fim < p_inicio OR ",
    para: "",
  };
}

// ------------------------------------------------------------------ chamadas

// Expressões SQL fixas (constantes do teste): hoje = o "hoje" do financeiro.
const HOJE = "public.fin__hoje()";
const CASOS_INVALIDOS = [
  ["início nulo", "NULL::date", HOJE],
  ["fim nulo", HOJE, "NULL::date"],
  ["fim antes do início (invertido)", HOJE, `${HOJE} - 30`],
  ["401 dias (um a mais que o limite)", `${HOJE} - 401`, HOJE],
];

/**
 * Uma tentativa num SAVEPOINT próprio: o erro do banco aborta a transação, e o
 * ROLLBACK TO a devolve viva. Devolve { r } se a RPC respondeu, { erro } se o
 * banco recusou. Só erro do banco (com `code`) é capturado; o resto sobe.
 */
async function tentar(c, sql) {
  await c.query("SAVEPOINT tentativa");
  try {
    const r = (await c.query(sql)).rows[0].r;
    return { r };
  } catch (erro) {
    if (!erro?.code) throw erro;
    return { erro };
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT tentativa");
    await c.query("RELEASE SAVEPOINT tentativa");
  }
}

function recusaTudo(f, rotulo) {
  return async (c) => {
    for (const [nome, ini, fim] of CASOS_INVALIDOS) {
      const t = await tentar(c, f.chamar(ini, fim));
      assert.ok(
        t.erro,
        `[${f.cenarioRecusa}] ${rotulo} com ${nome} tinha de ser RECUSADO, mas respondeu (${JSON.stringify(t.r)?.slice(0, 80)})`,
      );
      assert.strictEqual(
        t.erro.code,
        "22023",
        `[${f.cenarioRecusa}] ${rotulo} com ${nome}: código do erro (veio ${t.erro.code}: ${t.erro.message})`,
      );
      assert.match(
        t.erro.message,
        /Período inválido/,
        `[${f.cenarioRecusa}] ${rotulo} com ${nome}: mensagem`,
      );
    }
  };
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "R",
  nome: "R: fin_resumo recusa início nulo, fim nulo, invertido e 401 dias (22023, Período inválido)",
  corpo: recusaTudo(FUNCOES.resumo, "fin_resumo"),
});

CENARIOS.push({
  id: "X",
  nome: "X: fin_extrato recusa início nulo, fim nulo, invertido e 401 dias (22023, Período inválido)",
  corpo: recusaTudo(FUNCOES.extrato, "fin_extrato"),
});

CENARIOS.push({
  id: "CR",
  nome: "CR: controle — fin_resumo com exatamente 400 dias passa e a série tem 401 dias; 1 dia também passa",
  corpo: async (c) => {
    const f = FUNCOES.resumo;
    const t400 = await tentar(c, f.chamar(`${HOJE} - 400`, HOJE));
    assert.ok(
      !t400.erro,
      `[CR] fin_resumo com EXATAMENTE 400 dias tinha de passar (recusou: ${t400.erro?.code} ${t400.erro?.message})`,
    );
    assert.strictEqual(
      t400.r.serie.length,
      401,
      "[CR] a série do resumo tem um ponto por dia, extremos incluídos (400 dias = 401 pontos)",
    );
    const t1 = await tentar(c, f.chamar(HOJE, HOJE));
    assert.ok(
      !t1.erro,
      `[CR] fin_resumo de um dia só (início = fim) tinha de passar (recusou: ${t1.erro?.code} ${t1.erro?.message})`,
    );
    assert.strictEqual(t1.r.serie.length, 1, "[CR] um dia = um ponto na série");
  },
});

CENARIOS.push({
  id: "CX",
  nome: "CX: controle — fin_extrato com exatamente 400 dias passa e devolve a lista (array JSON)",
  corpo: async (c) => {
    const f = FUNCOES.extrato;
    const t400 = await tentar(c, f.chamar(`${HOJE} - 400`, HOJE));
    assert.ok(
      !t400.erro,
      `[CX] fin_extrato com EXATAMENTE 400 dias tinha de passar (recusou: ${t400.erro?.code} ${t400.erro?.message})`,
    );
    assert.ok(
      Array.isArray(t400.r),
      "[CX] o extrato de 400 dias devolve uma lista",
    );
    const t1 = await tentar(c, f.chamar(HOJE, HOJE));
    assert.ok(
      !t1.erro,
      `[CX] fin_extrato de um dia só (início = fim) tinha de passar (recusou: ${t1.erro?.code} ${t1.erro?.message})`,
    );
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R119B='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        m.funcao.regproc,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const def = await ler();
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.strictEqual(
    await ler(),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), admin atual, e cada cenário num
 * SAVEPOINT. Devolve {passou:[ids], falhou:[{id, nome, erro}]}. Erro que não é
 * de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    // Admin de verdade tem o papel nas DUAS fontes (is_admin e is_admin_atual).
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@financeiro119b.fixture.invalid', '{"role":"admin"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin Financeiro 119b', 'admin')
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
    );
    await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) => e.message.split("\n")[0];

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R119B || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R119B='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const id of r.passou) console.log(`  PASSOU ${id}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (id) => !r.falhou.some((f) => f.id === id),
      );
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "fin_resumo ou fin_extrato deixou de recusar período inválido (ou recusou um válido) — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-financeiro-recusa-periodo-invalido] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
