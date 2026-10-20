"use strict";

/**
 * PROVA VIVA da intenção do caixa (frente caixa-db, plano
 * docs/superpowers/plans/2026-10-20-noturno-onda2-caixa-db.md; spec
 * docs/superpowers/specs/2026-10-20-noturno-onda2-design.md, CX1/CX2) contra o
 * Postgres EFÊMERO do rpc-ci.yml, num CLONE próprio (rodar-isolado.cjs).
 *
 * O que o operador do caixa QUER é sempre sobre UMA sessão que ele está vendo
 * e, no movimento, sobre UMA tentativa identificada (chave). A prova envia
 * essa intenção completa e mede o efeito no banco:
 *
 *   CX1 — fechar S1, a resposta se perde, alguém abre S2 na mesma conta e o
 *         aparelho repete o fechamento de S1. Seguro: S2 continua ABERTA e
 *         intocada (nenhum ajuste nela), S1 continua como foi fechada, e o
 *         retry responde pela S1.
 *   CX2 — caixa aberto com 300, sangria de 50 com a chave K, a resposta se
 *         perde e o aparelho repete a MESMA tentativa K. Seguro: UMA
 *         transferência só, esperado na gaveta = 250, e o retry devolve o
 *         mesmo lançamento.
 *
 * SELETOR DO INSTRUMENTO (obrigatório, sem padrão): CAIXA_INTENCAO_ALVO.
 *   - "legado": a prova chama as RPCs ANTIGAS fin_caixa_fechar(numeric,text) e
 *     fin_caixa_movimentar(text,numeric,text,uuid). A assinatura delas não tem
 *     onde receber a sessão nem a chave — esse é o defeito medido; o adaptador
 *     NÃO esconde nem corrige nada, só escolhe a função sob teste. Esperado na
 *     Etapa A: VERMELHO com [DANO] em CX1 e em CX2.
 *   - "chave": contrato novo (fin_caixa_fechar_sessao / fin_caixa_movimentar_com_chave).
 *     O adaptador nasce na Etapa B, junto com a migration; aqui ele recusa.
 *   O seletor não muda banco, guarda, permissão nem fonte: só qual RPC é chamada.
 *
 * CLASSES DE FALHA (para o vermelho cair na guarda CERTA):
 *   [DANO]          — a regra de dinheiro/sessão foi quebrada (o RED que vale).
 *   [CONTRATO]      — o efeito no banco estava certo, mas a resposta do retry não
 *                     foi a da intenção original (erro ou outro id).
 *   [PRECONDICAO]   — o cenário não se montou (fixture, função ausente, caixa já
 *                     aberto); NÃO é evidência do defeito.
 *   [INDETERMINADO] — erro inesperado fora das asserções; NÃO é evidência.
 *
 * Trava de banco: efemero.cjs (CI_BANCO_EFEMERO=1 + localhost). Fixtures
 * fictícias, sem segredo. USO (no rpc-ci.yml):
 *   CAIXA_INTENCAO_ALVO=legado node tests/banco/rodar-isolado.cjs tests/banco/caixa-intencao-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_ADMIN = "5e111111-1111-4111-8111-111111111111";
const K_SANGRIA = "5e222222-2222-4222-8222-222222222222";

const TITULO = "Prova viva da intenção do caixa (CX1/CX2)";

class ErroPrecondicao extends Error {}

function precondicao(condicao, mensagem) {
  if (!condicao) throw new ErroPrecondicao(mensagem);
}

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}
async function rpc(cliente, sql, params = []) {
  return (await cliente.query(sql, params)).rows[0].r;
}
const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

// ── O seletor do instrumento ────────────────────────────────────────────────
// Cada alvo recebe a intenção COMPLETA (sessão, chave, conteúdo). O legado só
// consegue repassar o conteúdo: é a assinatura antiga, não o adaptador, que
// descarta a sessão e a chave.
// Map, não objeto: "constructor"/"__proto__" no seletor não viram alvo.
const ALVOS = new Map(
  Object.entries({
    legado: {
      descricao:
        "RPCs antigas fin_caixa_fechar(numeric,text) e fin_caixa_movimentar(text,numeric,text,uuid)",
      funcoes: [
        "public.fin_caixa_fechar(numeric,text)",
        "public.fin_caixa_movimentar(text,numeric,text,uuid)",
      ],
      fechar: (cliente, _sessaoId, contado, observacao) =>
        rpc(cliente, "SELECT public.fin_caixa_fechar($1, $2) AS r", [
          contado,
          observacao,
        ]),
      movimentar: (cliente, _sessaoId, _chave, tipo, valor, descricao) =>
        rpc(cliente, "SELECT public.fin_caixa_movimentar($1, $2, $3) AS r", [
          tipo,
          valor,
          descricao,
        ]),
    },
  }),
);

async function sessao(cliente, id) {
  const { rows } = await cliente.query(
    `SELECT id, status, valor_contado, valor_esperado, diferenca, observacao,
            fechado_em, fechado_por
       FROM public.fin_caixa_sessoes WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function abertas(cliente) {
  return (
    await cliente.query(
      "SELECT id FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em",
    )
  ).rows.map((r) => r.id);
}
async function esperado(cliente, id) {
  return num(
    await rpc(
      cliente,
      "SELECT (public.fin__caixa_calculo($1) ->> 'esperado')::numeric AS r",
      [id],
    ),
  );
}
async function lancamentosDaSessao(cliente, id) {
  return (
    await cliente.query(
      `SELECT id, tipo, origem, valor FROM public.fin_lancamentos
        WHERE caixa_sessao_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;
}
async function abrir(cliente, valor) {
  const { id } = await rpc(cliente, "SELECT public.fin_caixa_abrir($1) AS r", [
    valor,
  ]);
  return id;
}
// Limpeza tolerante: só fecha o que ainda está aberto, pelo próprio alvo.
async function fecharSeAberta(cliente, alvo, id) {
  const s = await sessao(cliente, id);
  if (s && s.status === "aberto") {
    await alvo.fechar(
      cliente,
      id,
      await esperado(cliente, id),
      "limpeza da prova",
    );
  }
}

async function montarAdmin(cliente) {
  await cliente.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, $1::text || '@caixa.teste', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN],
  );
  // Admin de verdade tem o papel nas DUAS fontes (is_admin_atual, 20261199000000).
  await cliente.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Caixa', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN],
  );
}

const PROVAS = [];

PROVAS.push({
  nome: "CX1 retry do fechamento de S1 depois que S2 abriu não toca S2",
  corpo: async (cliente, alvo) => {
    await logar(cliente, U_ADMIN);
    precondicao(
      (await abertas(cliente)).length === 0,
      "havia caixa aberto antes do CX1 (o clone devia nascer sem nenhum)",
    );
    const s1 = await abrir(cliente, 100);
    const sessoes = [s1];
    try {
      // 1ª tentativa: o banco fecha S1 e a resposta se perde no caminho.
      await alvo.fechar(cliente, s1, 100, "fechamento de S1");
      const s1Fechada = await sessao(cliente, s1);
      precondicao(
        s1Fechada?.status === "fechado" && num(s1Fechada.valor_contado) === 100,
        `S1 não fechou com 100 na 1ª tentativa (status ${s1Fechada?.status}, contado ${s1Fechada?.valor_contado})`,
      );
      // Enquanto isso, a loja abre S2 na mesma conta.
      const s2 = await abrir(cliente, 100);
      sessoes.push(s2);
      const s2Antes = await sessao(cliente, s2);
      precondicao(
        s2 !== s1 && s2Antes?.status === "aberto",
        "S2 não abriu como sessão nova",
      );
      const lancS2Antes = await lancamentosDaSessao(cliente, s2);

      // O aparelho repete a MESMA intenção: fechar S1 com 100.
      let retry;
      let erroRetry;
      try {
        retry = await alvo.fechar(cliente, s1, 100, "fechamento de S1");
      } catch (erro) {
        erroRetry = erro;
      }

      const s2Depois = await sessao(cliente, s2);
      assert.equal(
        s2Depois.status,
        "aberto",
        `[DANO] CX1: o retry do fechamento de S1 FECHOU S2 (S2 ficou '${s2Depois.status}', contado ${s2Depois.valor_contado}, fechado_por ${s2Depois.fechado_por})`,
      );
      assert.deepStrictEqual(
        s2Depois,
        s2Antes,
        "[DANO] CX1: o retry do fechamento de S1 alterou a linha de S2",
      );
      assert.deepStrictEqual(
        await lancamentosDaSessao(cliente, s2),
        lancS2Antes,
        "[DANO] CX1: o retry do fechamento de S1 gravou lançamento na sessão S2",
      );
      assert.deepStrictEqual(
        await sessao(cliente, s1),
        s1Fechada,
        "[DANO] CX1: o retry reescreveu o fechamento já gravado de S1",
      );
      assert.equal(
        erroRetry,
        undefined,
        `[CONTRATO] CX1: o retry da mesma intenção devia responder pela S1, não recusar (${erroRetry?.message})`,
      );
      assert.equal(
        retry?.id,
        s1,
        `[CONTRATO] CX1: o retry respondeu pela sessão ${retry?.id}, não pela S1 pedida`,
      );
    } finally {
      for (const id of sessoes.reverse()) {
        await fecharSeAberta(cliente, alvo, id);
      }
    }
  },
});

PROVAS.push({
  nome: "CX2 sangria de 50 com saldo 300 repetida com a mesma chave grava UMA transferência",
  corpo: async (cliente, alvo) => {
    await logar(cliente, U_ADMIN);
    precondicao(
      (await abertas(cliente)).length === 0,
      "havia caixa aberto antes do CX2 (a limpeza do CX1 devia ter fechado)",
    );
    const s = await abrir(cliente, 300);
    try {
      precondicao(
        (await esperado(cliente, s)) === 300,
        `o esperado na gaveta ao abrir não é 300 (${await esperado(cliente, s)})`,
      );
      // 1ª tentativa: o banco grava a sangria e a resposta se perde.
      const primeira = await alvo.movimentar(
        cliente,
        s,
        K_SANGRIA,
        "sangria",
        50,
        "Depósito no banco",
      );
      const sangrias = async () =>
        (await lancamentosDaSessao(cliente, s)).filter(
          (l) => l.tipo === "transferencia" && l.origem === "sangria",
        );
      precondicao(
        (await sangrias()).length === 1 && (await esperado(cliente, s)) === 250,
        "a 1ª sangria não gravou exatamente uma transferência de 50",
      );

      // O aparelho repete a MESMA tentativa (mesma chave, mesmo conteúdo).
      let segunda;
      let erroRetry;
      try {
        segunda = await alvo.movimentar(
          cliente,
          s,
          K_SANGRIA,
          "sangria",
          50,
          "Depósito no banco",
        );
      } catch (erro) {
        erroRetry = erro;
      }

      const depois = await sangrias();
      assert.equal(
        depois.length,
        1,
        `[DANO] CX2: a sangria repetida com a mesma chave gravou ${depois.length} transferências (total ${depois.reduce((t, l) => t + num(l.valor), 0)})`,
      );
      assert.equal(
        await esperado(cliente, s),
        250,
        "[DANO] CX2: o esperado na gaveta depois do retry não é 250",
      );
      assert.equal(
        erroRetry,
        undefined,
        `[CONTRATO] CX2: o retry da mesma chave devia devolver o lançamento original, não recusar (${erroRetry?.message})`,
      );
      assert.equal(
        segunda?.id,
        primeira.id,
        `[CONTRATO] CX2: o retry devolveu o lançamento ${segunda?.id}, não o original ${primeira.id}`,
      );
    } finally {
      await fecharSeAberta(cliente, alvo, s);
    }
  },
});

function classe(erro) {
  if (erro instanceof ErroPrecondicao) return "PRECONDICAO";
  if (erro instanceof assert.AssertionError) {
    const m = /^\[(DANO|CONTRATO)\]/.exec(erro.message);
    if (m) return m[1];
  }
  return "INDETERMINADO";
}

async function main() {
  const nomeAlvo = process.env.CAIXA_INTENCAO_ALVO || "";
  if (nomeAlvo === "chave") {
    falhar(
      "USO",
      "CAIXA_INTENCAO_ALVO=chave é o contrato novo: o adaptador nasce na Etapa B, junto com a migration.",
    );
  }
  const alvo = ALVOS.get(nomeAlvo);
  if (!alvo) {
    falhar(
      "USO",
      `CAIXA_INTENCAO_ALVO obrigatório e explícito ('legado' nesta etapa); recebido '${nomeAlvo}'.`,
    );
  }
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  console.log(`[caixa-intencao] alvo=${nomeAlvo}: ${alvo.descricao}`);
  const linhas = [`Alvo do instrumento: \`${nomeAlvo}\` — ${alvo.descricao}`];
  const falhas = [];
  try {
    for (const fn of alvo.funcoes) {
      const existe = await rpc(
        cliente,
        "SELECT to_regprocedure($1) IS NOT NULL AS r",
        [fn],
      );
      if (!existe) {
        falhar("PRECONDICAO", `função sob teste ausente: ${fn}`);
      }
    }
    await montarAdmin(cliente);
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente, alvo);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        const c = classe(erro);
        falhas.push(c);
        console.error(`  FALHOU [${c}] ${nome}`);
        console.error(`    ${erro.message.split("\n")[0]}`);
        linhas.push(
          `- ❌ [${c}] ${nome}\n  - \`${erro.message.split("\n")[0]}\``,
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  anexarAoSummary(TITULO, linhas.join("\n"));
  if (falhas.length > 0) {
    falhar(
      "FALHOU",
      `${falhas.length}/${PROVAS.length} provas do caixa falharam (${falhas.join(", ")}). Só [DANO] é evidência do defeito; [PRECONDICAO]/[INDETERMINADO] não provam nada.`,
    );
  }
  console.log(
    `\n[caixa-intencao] ${PROVAS.length}/${PROVAS.length} provas passaram (alvo=${nomeAlvo}).`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
