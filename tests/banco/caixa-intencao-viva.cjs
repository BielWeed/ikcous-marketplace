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
 *   - "legado": só CX1/CX2 contra as RPCs ANTIGAS fin_caixa_fechar(numeric,text)
 *     e fin_caixa_movimentar(text,numeric,text,uuid). A assinatura delas não tem
 *     onde receber a sessão nem a chave; o adaptador não esconde nada. Foi o RED
 *     da Etapa A (rpc-ci run 39418487244, SHA 4a909274: [DANO] em CX1 e CX2).
 *   - "chave": contrato novo da migration 20261252000000
 *     (fin_caixa_fechar_sessao / fin_caixa_movimentar_com_chave): CX1/CX2 têm de
 *     PASSAR, o legado continua como CONTROLE EXPLÍCITO e tem de seguir caindo em
 *     [DANO] (as antigas ficam intactas, risco nomeado do cliente antigo), e mais:
 *     validações puras, replay/divergência/autor, admin rebaixado, ACL/RLS,
 *     corridas reais com pg_blocking_pids (COMMIT, ROLLBACK, outra sessão,
 *     fechamento), portão 55a/55b, reaplicação, rollback que preserva a tabela e
 *     mutantes causais.
 *   O seletor não muda banco, guarda, permissão nem fonte: só qual RPC é chamada.
 *
 * CLASSES DE FALHA (para o vermelho cair na guarda CERTA):
 *   [DANO]          — a regra de dinheiro/sessão foi quebrada.
 *   [CONTRATO]      — o efeito no banco estava certo, mas a resposta do retry não
 *                     foi a da intenção original (erro ou outro id).
 *   [PRECONDICAO]   — o cenário não se montou; NÃO é evidência do defeito.
 *   [INDETERMINADO] — erro inesperado fora das asserções; NÃO é evidência.
 *
 * Trava de banco: efemero.cjs (CI_BANCO_EFEMERO=1 + localhost). Fixtures
 * fictícias, sem segredo. USO (no rpc-ci.yml):
 *   CAIXA_INTENCAO_ALVO=chave node tests/banco/rodar-isolado.cjs tests/banco/caixa-intencao-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_ADMIN = "5e111111-1111-4111-8111-111111111111";
const U_ADMIN2 = "5e333333-3333-4333-8333-333333333333";
const U_REB = "5e444444-4444-4444-8444-444444444444";
const K_SANGRIA = "5e222222-2222-4222-8222-222222222222";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const MP = "f1000000-0000-4000-8000-000000000003";

const TITULO = "Prova viva da intenção do caixa (CX1/CX2)";

const MIGRATIONS = path.join(__dirname, "../../supabase/migrations");
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const lerSql = (dir, nome) =>
  fs.readFileSync(path.join(dir, nome), "utf8").replace(/\r/g, "");
const NOME_252 = "20261252000000_o_caixa_preserva_a_intencao.sql";

// O CREATE OR REPLACE inteiro de uma função, como está no arquivo.
function definicao(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert(i >= 0, `definição de ${nome} ausente`);
  const fim = sql.indexOf("\n$$;", sql.indexOf("AS $$", i)) + "\n$$;".length;
  return sql.slice(i, fim);
}

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

async function erroDe(promessa) {
  try {
    await promessa;
    return null;
  } catch (erro) {
    return erro;
  }
}
async function recusa(promessa, codigo, detalhe, oQue) {
  const e = await erroDe(promessa);
  assert(e, `${oQue}: devia recusar com ${codigo} e aceitou`);
  assert.equal(e.code, codigo, `${oQue}: recusou com ${e.code} (${e.message})`);
  if (detalhe) assert.equal(e.detail, detalhe, `${oQue}: DETAIL ${e.detail}`);
}

// ── O seletor do instrumento ────────────────────────────────────────────────
// Cada alvo recebe a intenção COMPLETA (sessão, chave, conteúdo). O legado só
// consegue repassar o conteúdo: é a assinatura antiga, não o adaptador, que
// descarta a sessão e a chave.
const LEGADO = {
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
  movimentar: (cliente, _sessaoId, _chave, tipo, valor, descricao, contra) =>
    rpc(cliente, "SELECT public.fin_caixa_movimentar($1, $2, $3, $4) AS r", [
      tipo,
      valor,
      descricao,
      contra ?? null,
    ]),
};
const CHAVE = {
  descricao:
    "RPCs novas fin_caixa_fechar_sessao(uuid,numeric,text) e fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)",
  funcoes: [
    "public.fin_caixa_fechar_sessao(uuid,numeric,text)",
    "public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)",
  ],
  fechar: (cliente, sessaoId, contado, observacao) =>
    rpc(cliente, "SELECT public.fin_caixa_fechar_sessao($1, $2, $3) AS r", [
      sessaoId,
      contado,
      observacao,
    ]),
  movimentar: (cliente, sessaoId, chave, tipo, valor, descricao, contra) =>
    rpc(
      cliente,
      "SELECT public.fin_caixa_movimentar_com_chave($1, $2, $3, $4, $5, $6) AS r",
      [sessaoId, chave, tipo, valor, descricao, contra ?? null],
    ),
};
// Map, não objeto: "constructor"/"__proto__" no seletor não viram alvo.
const ALVOS = new Map(
  Object.entries({
    legado: LEGADO,
    chave: CHAVE,
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
async function sangriasDe(cliente, id) {
  return (await lancamentosDaSessao(cliente, id)).filter(
    (l) => l.tipo === "transferencia" && l.origem === "sangria",
  );
}
async function tentativa(cliente, chave) {
  return (
    (
      await cliente.query(
        "SELECT * FROM public.fin_caixa_movimento_tentativas WHERE chave = $1",
        [chave],
      )
    ).rows[0] || null
  );
}
async function abrir(cliente, valor, conta = null) {
  const { id } = await rpc(
    cliente,
    "SELECT public.fin_caixa_abrir($1, $2) AS r",
    [valor, conta],
  );
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

async function montarUsuario(cliente, id, papelAuth, papelPerfil) {
  await cliente.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, $1::text || '@caixa.teste', jsonb_build_object('role', $2::text))
     ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data`,
    [id, papelAuth],
  );
  await cliente.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa Caixa', $2)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [id, papelPerfil],
  );
}
async function montarAdmin(cliente) {
  // Admin de verdade tem o papel nas DUAS fontes (is_admin_atual, 20261199000000).
  await montarUsuario(cliente, U_ADMIN, "admin", "admin");
}

let contaCaixa2;
async function segundaContaCaixa(cliente) {
  if (contaCaixa2) return contaCaixa2;
  const hoje = await rpc(cliente, "SELECT public.fin__hoje()::text AS r");
  ({ id: contaCaixa2 } = await rpc(
    cliente,
    "SELECT public.fin_conta_salvar($1::jsonb) AS r",
    [
      JSON.stringify({
        nome: "Caixa 2 da prova",
        tipo: "caixa",
        saldo_inicial: 0,
        saldo_inicial_em: hoje,
      }),
    ],
  ));
  return contaCaixa2;
}

// ── CX1/CX2: as mesmas para os dois alvos ──────────────────────────────────

async function cx1(cliente, alvo) {
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
}

async function cx2(cliente, alvo) {
  await logar(cliente, U_ADMIN);
  precondicao(
    (await abertas(cliente)).length === 0,
    "havia caixa aberto antes do CX2 (a limpeza do CX1 devia ter fechado)",
  );
  // Chave fixa no RED (legado ignora); no alvo chave, uma por execução, para o
  // mesmo cenário poder rodar de novo (controles dos mutantes).
  const k = alvo === LEGADO ? K_SANGRIA : randomUUID();
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
      k,
      "sangria",
      50,
      "Depósito no banco",
    );
    precondicao(
      (await sangriasDe(cliente, s)).length === 1 &&
        (await esperado(cliente, s)) === 250,
      "a 1ª sangria não gravou exatamente uma transferência de 50",
    );

    // O aparelho repete a MESMA tentativa (mesma chave, mesmo conteúdo).
    let segunda;
    let erroRetry;
    try {
      segunda = await alvo.movimentar(
        cliente,
        s,
        k,
        "sangria",
        50,
        "Depósito no banco",
      );
    } catch (erro) {
      erroRetry = erro;
    }

    const depois = await sangriasDe(cliente, s);
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
}

function classe(erro) {
  if (erro instanceof ErroPrecondicao) return "PRECONDICAO";
  if (erro instanceof assert.AssertionError) {
    const m = /^\[(DANO|CONTRATO)\]/.exec(erro.message);
    // Asserção do contrato novo sem marcador também é [CONTRATO]; nunca [DANO].
    return m ? m[1] : "CONTRATO";
  }
  return "INDETERMINADO";
}

// ── Só no alvo chave ───────────────────────────────────────────────────────

async function controleLegado(c) {
  for (const [nome, corpo] of [
    ["CX1", cx1],
    ["CX2", cx2],
  ]) {
    let motivo;
    try {
      await corpo(c, LEGADO);
    } catch (e) {
      motivo = e;
    }
    assert(
      motivo,
      `controle legado ${nome} PASSOU: o instrumento não vê o defeito`,
    );
    assert.equal(
      classe(motivo),
      "DANO",
      `controle legado ${nome} caiu fora do [DANO]: ${motivo.message}`,
    );
  }
}

async function fechamento(c) {
  await logar(c, U_ADMIN);
  const s = await abrir(c, 80);
  try {
    const intacta = await sessao(c, s);
    const lancAntes = await lancamentosDaSessao(c, s);
    await recusa(CHAVE.fechar(c, null, 80, null), "22023", null, "sessão nula");
    for (const v of [
      null,
      "NaN",
      "Infinity",
      "-Infinity",
      -1,
      "9999999999.995",
      "10000000000",
    ]) {
      await recusa(CHAVE.fechar(c, s, v, null), "22023", null, `contado ${v}`);
    }
    await recusa(
      CHAVE.fechar(c, s, 80, "x".repeat(501)),
      "22023",
      null,
      "observação de 501",
    );
    await recusa(
      CHAVE.fechar(c, randomUUID(), 80, null),
      "22023",
      null,
      "sessão inexistente",
    );
    assert.deepStrictEqual(
      await sessao(c, s),
      intacta,
      "recusa escreveu na sessão",
    );
    assert.deepStrictEqual(await lancamentosDaSessao(c, s), lancAntes);

    // Contado 70 contra 80: quebra de 10, um ajuste.
    const r1 = await CHAVE.fechar(c, s, 70, "  faltou troco  ");
    assert.equal(r1.replay, false);
    assert.equal(num(r1.diferenca), -10);
    const fechada = await sessao(c, s);
    const lancFechada = await lancamentosDaSessao(c, s);
    assert.equal(fechada.observacao, "faltou troco");
    // Mesmo autor, mesmo contado e observação normalizados: devolve o gravado.
    const r2 = await CHAVE.fechar(c, s, "70.00", "faltou troco");
    assert.deepEqual(
      { ...r2, replay: undefined },
      { ...r1, replay: undefined },
      "replay devolveu outra resposta",
    );
    assert.equal(r2.replay, true);
    for (const [contado, obs, oQue] of [
      [71, "faltou troco", "outro contado"],
      [70, "outra", "outra observação"],
      [70, null, "sem observação"],
    ]) {
      await recusa(
        CHAVE.fechar(c, s, contado, obs),
        "22023",
        "fechamento_divergente",
        oQue,
      );
    }
    await logar(c, U_ADMIN2);
    await recusa(
      CHAVE.fechar(c, s, 70, "faltou troco"),
      "22023",
      "fechamento_divergente",
      "outro autor",
    );
    await logar(c, U_ADMIN);
    assert.deepStrictEqual(
      await sessao(c, s),
      fechada,
      "replay/divergência reescreveu S",
    );
    assert.deepStrictEqual(await lancamentosDaSessao(c, s), lancFechada);
  } finally {
    await logar(c, U_ADMIN);
    await fecharSeAberta(c, CHAVE, s);
  }
}

async function movimento(c) {
  await logar(c, U_ADMIN);
  const s = await abrir(c, 300);
  let s2;
  try {
    const k1 = randomUUID();
    await recusa(
      CHAVE.movimentar(c, s, null, "sangria", 50, "x"),
      "22023",
      null,
      "chave nula",
    );
    await recusa(
      CHAVE.movimentar(c, null, k1, "sangria", 50, "x"),
      "22023",
      null,
      "sessão nula",
    );
    await recusa(
      CHAVE.movimentar(c, s, k1, "outro", 50, "x"),
      "22023",
      null,
      "tipo inválido",
    );
    for (const v of [
      null,
      "NaN",
      "Infinity",
      "-Infinity",
      0,
      -5,
      "0.004",
      "10000000000",
    ]) {
      await recusa(
        CHAVE.movimentar(c, s, k1, "sangria", v, "x"),
        "22023",
        null,
        `valor ${v}`,
      );
    }
    await recusa(
      CHAVE.movimentar(c, s, k1, "sangria", 50, "x".repeat(141)),
      "22023",
      null,
      "descrição de 141",
    );
    await recusa(
      CHAVE.movimentar(c, s, k1, "sangria", 301, "demais"),
      "22023",
      null,
      "sangria maior que o esperado",
    );
    await recusa(
      CHAVE.movimentar(c, s, k1, "sangria", 50, "x", randomUUID()),
      "22023",
      null,
      "contrapartida inexistente",
    );
    await recusa(
      CHAVE.movimentar(c, randomUUID(), k1, "sangria", 50, "x"),
      "22023",
      null,
      "sessão inexistente",
    );
    assert.equal(
      await tentativa(c, k1),
      null,
      "recusa deixou reserva da chave",
    );
    assert.equal((await sangriasDe(c, s)).length, 0, "recusa gravou sangria");

    const r1 = await CHAVE.movimentar(c, s, k1, "sangria", 50, "  Depósito  ");
    assert.equal(r1.replay, false);
    assert.equal(r1.status, "realizado");
    const r2 = await CHAVE.movimentar(c, s, k1, "sangria", "50.00", "Depósito");
    assert.deepEqual(r2, { ...r1, replay: true }, "replay da mesma chave");
    const t = await tentativa(c, k1);
    assert.equal(t.lancamento_id, r1.id);
    assert.equal(t.descricao, "Depósito");
    for (const [args, oQue] of [
      [["sangria", 51, "Depósito"], "outro valor"],
      [["suprimento", 50, "Depósito"], "outro tipo"],
      [["sangria", 50, "Outro"], "outra descrição"],
      [["sangria", 50, "Depósito", MP], "outra contrapartida"],
    ]) {
      await recusa(
        CHAVE.movimentar(c, s, k1, ...args),
        "22023",
        "tentativa_divergente",
        oQue,
      );
    }
    await logar(c, U_ADMIN2);
    await recusa(
      CHAVE.movimentar(c, s, k1, "sangria", 50, "Depósito"),
      "22023",
      "tentativa_divergente",
      "outro autor",
    );
    await logar(c, U_ADMIN);
    // Chave diferente, mesmo conteúdo: movimento legítimo novo.
    const r3 = await CHAVE.movimentar(
      c,
      s,
      randomUUID(),
      "sangria",
      50,
      "Depósito",
    );
    assert.notEqual(r3.id, r1.id);
    assert.equal((await sangriasDe(c, s)).length, 2);
    assert.equal(await esperado(c, s), 200);
    // Replay depois da contrapartida desativada.
    await c.query("UPDATE public.fin_contas SET ativa = false WHERE id = $1", [
      BANCO,
    ]);
    try {
      const r4 = await CHAVE.movimentar(c, s, k1, "sangria", 50, "Depósito");
      assert.equal(r4.replay, true, "replay com a conta desativada");
    } finally {
      await c.query("UPDATE public.fin_contas SET ativa = true WHERE id = $1", [
        BANCO,
      ]);
    }
    // Replay depois do esgotamento.
    const k3 = randomUUID();
    await CHAVE.movimentar(c, s, k3, "sangria", 200, "Tudo");
    assert.equal(await esperado(c, s), 0);
    const r5 = await CHAVE.movimentar(c, s, k3, "sangria", 200, "Tudo");
    assert.equal(r5.replay, true, "replay com a gaveta vazia");
    // Replay depois do fechamento; chave nova no caixa fechado recusa sem reserva.
    await CHAVE.fechar(c, s, 0, null);
    const r6 = await CHAVE.movimentar(c, s, k1, "sangria", 50, "Depósito");
    assert.deepEqual(r6, { ...r1, replay: true }, "replay depois de fechar");
    const k4 = randomUUID();
    await recusa(
      CHAVE.movimentar(c, s, k4, "suprimento", 10, "x"),
      "22023",
      null,
      "chave nova em caixa fechado",
    );
    assert.equal(await tentativa(c, k4), null, "caixa fechado deixou reserva");
    // A mesma chave noutra sessão (aberta) é outra intenção.
    s2 = await abrir(c, 100);
    await recusa(
      CHAVE.movimentar(c, s2, k1, "sangria", 50, "Depósito"),
      "22023",
      "tentativa_divergente",
      "mesma chave em outra sessão",
    );
    assert.equal((await sangriasDe(c, s2)).length, 0);
  } finally {
    await logar(c, U_ADMIN);
    if (s2) await fecharSeAberta(c, CHAVE, s2);
    await fecharSeAberta(c, CHAVE, s);
  }
}

// Chama como o app logado (papel authenticated + JWT), numa transação desfeita.
async function comoApp(c, uid, papelJwt, fn) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [
        uid,
        JSON.stringify({
          sub: uid,
          role: "authenticated",
          app_metadata: { role: papelJwt },
        }),
      ],
    );
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

// Quem muda o papel de U_REB é OUTRO admin real (U_ADMIN): o banco recusa, com razão,
// que alguém troque o próprio papel ("You cannot change your own role.").
async function mudarPapelDoRebaixado(c, papel) {
  await logar(c, U_ADMIN);
  await c.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [
    U_REB,
    papel,
  ]);
}

async function rebaixado(c) {
  await logar(c, U_ADMIN);
  await montarUsuario(c, U_REB, "admin", "admin");
  await logar(c, U_REB);
  const s = await abrir(c, 100);
  const k = randomUUID();
  try {
    await CHAVE.movimentar(c, s, k, "suprimento", 10, "troco");
    await CHAVE.fechar(c, s, 110, null);
    // Controle: o mesmo usuário, ainda admin, como o app: replay passa.
    const ctrlM = await comoApp(c, U_REB, "admin", () =>
      CHAVE.movimentar(c, s, k, "suprimento", 10, "troco"),
    );
    assert.equal(ctrlM.replay, true, "controle do replay como app");
    const ctrlF = await comoApp(c, U_REB, "admin", () =>
      CHAVE.fechar(c, s, 110, null),
    );
    assert.equal(ctrlF.replay, true, "controle do fechamento como app");
    // Rebaixado só no profiles, JWT velho dizendo admin: 42501 ANTES do replay.
    await mudarPapelDoRebaixado(c, "customer");
    await comoApp(c, U_REB, "admin", () =>
      recusa(
        CHAVE.movimentar(c, s, k, "suprimento", 10, "troco"),
        "42501",
        null,
        "rebaixado repetindo o movimento",
      ),
    );
    await comoApp(c, U_REB, "admin", () =>
      recusa(
        CHAVE.fechar(c, s, 110, null),
        "42501",
        null,
        "rebaixado repetindo o fechamento",
      ),
    );
  } finally {
    await mudarPapelDoRebaixado(c, "admin");
    await logar(c, U_REB);
    await fecharSeAberta(c, CHAVE, s);
    await logar(c, U_ADMIN);
  }
}

async function acl(c) {
  await c.query("BEGIN");
  try {
    for (const [papel, sql, oQue] of [
      [
        "authenticated",
        "SELECT * FROM public.fin_caixa_movimento_tentativas",
        "authenticated lê a tabela",
      ],
      [
        "authenticated",
        `INSERT INTO public.fin_caixa_movimento_tentativas (chave, sessao_id, tipo, valor, descricao, contrapartida_id, lancamento_id)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'sangria', 1, 'x', gen_random_uuid(), gen_random_uuid())`,
        "authenticated grava na tabela",
      ],
      [
        "service_role",
        "SELECT * FROM public.fin_caixa_movimento_tentativas",
        "service_role lê a tabela",
      ],
      [
        "anon",
        "SELECT public.fin_caixa_fechar_sessao(gen_random_uuid(), 1, NULL)",
        "anon executa o fechamento",
      ],
      [
        "anon",
        "SELECT public.fin_caixa_movimentar_com_chave(gen_random_uuid(), gen_random_uuid(), 'sangria', 1, 'x', NULL)",
        "anon executa o movimento",
      ],
    ]) {
      await c.query("SAVEPOINT acl");
      await c.query(`SET LOCAL ROLE ${papel}`);
      await recusa(c.query(sql), "42501", null, oQue);
      await c.query("ROLLBACK TO SAVEPOINT acl");
    }
  } finally {
    await c.query("ROLLBACK");
  }
}

async function observarEspera(c, pidA, pidB) {
  for (let i = 0; i < 150; i++) {
    const r = await c.query(
      "SELECT wait_event_type, pg_blocking_pids(pid) AS bloqueadores FROM pg_stat_activity WHERE pid = $1",
      [pidB],
    );
    if (
      r.rows[0]?.wait_event_type === "Lock" &&
      r.rows[0].bloqueadores.includes(pidA)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("B não foi observado esperando A no Postgres");
}

// Duas conexões reais. `chamadaA`/`chamadaB` recebem o cliente.
async function corrida(url, chamadaA, chamadaB, desfecho) {
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  let pendente;
  try {
    await logar(a, U_ADMIN);
    await logar(b, U_ADMIN);
    await a.query("BEGIN");
    await b.query("BEGIN");
    await a.query("SET LOCAL statement_timeout = '8s'");
    await b.query("SET LOCAL statement_timeout = '8s'");
    const pidA = (await a.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const rA = await chamadaA(a);
    pendente = chamadaB(b).then(
      (r) => ({ r }),
      (e) => ({ e }),
    );
    const observador = new Client({ connectionString: url });
    await observador.connect();
    try {
      await observarEspera(observador, pidA, pidB);
    } finally {
      await observador.end();
    }
    await a.query(desfecho);
    const rB = await pendente;
    await b.query(rB.e ? "ROLLBACK" : "COMMIT");
    return { rA, rB };
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    if (pendente) await pendente;
    await b.query("ROLLBACK").catch(() => {});
    await a.end();
    await b.end();
  }
}

async function corridas(c, url) {
  await logar(c, U_ADMIN);
  const conta2 = await segundaContaCaixa(c);
  for (const desfecho of ["COMMIT", "ROLLBACK"]) {
    const s = await abrir(c, 300);
    try {
      const k = randomUUID();
      const mov = (x) => CHAVE.movimentar(x, s, k, "sangria", 50, "corrida");
      const { rA, rB } = await corrida(url, mov, mov, desfecho);
      if (rB.e) throw rB.e;
      if (desfecho === "COMMIT") {
        assert.equal(rB.r.replay, true, "B depois do COMMIT de A é replay");
        assert.equal(rB.r.id, rA.id, "B devolve o lançamento de A");
      } else {
        assert.equal(rB.r.replay, false, "B depois do ROLLBACK de A cria");
        assert.notEqual(rB.r.id, rA.id);
      }
      assert.equal(
        (await sangriasDe(c, s)).length,
        1,
        `corrida ${desfecho} gravou em dobro`,
      );
      assert.equal((await tentativa(c, k)).lancamento_id, rB.r.id);
    } finally {
      await fecharSeAberta(c, CHAVE, s);
    }
  }
  // A mesma chave em duas sessões ao mesmo tempo: a PK global faz B esperar A.
  const s = await abrir(c, 300);
  const s2 = await abrir(c, 0, conta2);
  try {
    const k = randomUUID();
    const { rB } = await corrida(
      url,
      (x) => CHAVE.movimentar(x, s, k, "sangria", 50, "corrida"),
      (x) => CHAVE.movimentar(x, s2, k, "suprimento", 50, "corrida"),
      "COMMIT",
    );
    assert(rB.e, "a mesma chave em outra sessão foi aceita");
    assert.equal(rB.e.code, "22023");
    assert.equal(rB.e.detail, "tentativa_divergente");
    assert.equal((await sangriasDe(c, s)).length, 1);
    assert.equal((await lancamentosDaSessao(c, s2)).length, 0);
    // Fechamento concorrente da MESMA sessão: B espera a trava de A e vira replay.
    const contado = (await esperado(c, s)) + 5;
    const fechar = (x) => CHAVE.fechar(x, s, contado, "corrida");
    const f = await corrida(url, fechar, fechar, "COMMIT");
    if (f.rB.e) throw f.rB.e;
    assert.equal(f.rA.replay, false);
    // `corrida` devolve rB = { r } ou { e }: a resposta de B está em rB.r.
    assert.equal(
      f.rB.r.replay,
      true,
      `o 2º fechamento concorrente é replay (B respondeu ${JSON.stringify(f.rB.r)})`,
    );
    assert.equal(f.rB.r.id, f.rA.id, "o replay responde pela mesma sessão");
    assert.equal(
      (await lancamentosDaSessao(c, s)).filter(
        (l) => l.origem === "ajuste_caixa",
      ).length,
      1,
      "fechamento concorrente gravou o ajuste em dobro",
    );
  } finally {
    await fecharSeAberta(c, CHAVE, s2);
    await fecharSeAberta(c, CHAVE, s);
  }
}

async function portaoERollback(c) {
  const M252 = lerSql(MIGRATIONS, NOME_252);
  const R252 = lerSql(MIGRATIONS, `rollback-manual-${NOME_252}`);
  const M199 = lerSql(
    MIGRATIONS,
    "20261199000000_portas_do_painel_exigem_admin_atual.sql",
  );
  const consulta = async (nome) => {
    const sql = lerSql(CONSULTAS, `${nome}.sql`);
    // Só catálogo: executa como papel de API, nunca como dono.
    await c.query("SAVEPOINT leitura_catalogo");
    try {
      await c.query("SET LOCAL ROLE authenticated");
      return (await c.query(sql)).rows;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT leitura_catalogo");
    }
  };
  const A = "55a-conferir-intencao-do-caixa-aplicado";
  const B = "55b-antes-intencao-do-caixa-base-vigente";
  const ruins = async (nome) =>
    (await consulta(nome)).filter((r) => r.ok !== true).map((r) => r.item);
  const contarTentativas = async () =>
    Number(
      (
        await c.query(
          "SELECT count(*) AS n FROM public.fin_caixa_movimento_tentativas",
        )
      ).rows[0].n,
    );
  await c.query("BEGIN");
  try {
    assert.equal((await consulta(A)).length, 8);
    assert.equal((await consulta(B)).length, 6);
    assert.deepEqual(await ruins(A), [], "55a no banco aplicado");
    assert.deepEqual(await ruins(B), ["rpcs novas do caixa: ausentes"]);
    const mutacoes = [
      [
        "fin_caixa_fechar_sessao: corpo conhecido",
        // Callback, não string: na string de substituição "$$" vira "$" e o SQL quebra.
        definicao(M252, "fin_caixa_fechar_sessao").replace(
          /\nEND;\n\$\$;$/,
          () => "\n-- estranho\nEND;\n$$;",
        ),
      ],
      [
        "rpcs novas do caixa: atributos",
        "ALTER FUNCTION public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid) SET search_path = pg_catalog",
      ],
      [
        "rpcs novas do caixa: EXECUTE",
        "GRANT EXECUTE ON FUNCTION public.fin_caixa_fechar_sessao(uuid,numeric,text) TO anon",
      ],
      [
        "rpcs antigas do caixa: corpo",
        definicao(M199, "fin_caixa_fechar").replace(
          /\nEND;\n\$\$;$/,
          () => "\n-- estranho\nEND;\n$$;",
        ),
      ],
      [
        "fin_caixa_movimento_tentativas: forma conhecida",
        "ALTER TABLE public.fin_caixa_movimento_tentativas ADD COLUMN estranha text",
      ],
      [
        "fin_caixa_movimento_tentativas: so servidor",
        "GRANT SELECT ON public.fin_caixa_movimento_tentativas TO service_role",
      ],
    ];
    for (const [item, sql] of mutacoes) {
      await c.query("SAVEPOINT mutacao_portao");
      await c.query(sql);
      const r = await ruins(A);
      assert.equal(
        r.length,
        1,
        `55a deve reprovar somente ${item} (reprovou ${r})`,
      );
      assert(r[0].startsWith(item), `55a reprovou ${r[0]} no lugar de ${item}`);
      await c.query("ROLLBACK TO SAVEPOINT mutacao_portao");
    }
    const n = await contarTentativas();
    assert(n > 0, "as provas anteriores deviam ter deixado tentativas");
    // Reaplicar 2x é idêntico.
    await c.query(M252);
    await c.query(M252);
    assert.deepEqual(await ruins(A), []);
    assert.equal(await contarTentativas(), n);
    // Rollback comum: RPCs novas somem, tabela e linhas ficam, antigas intactas.
    await c.query(R252);
    await c.query(R252);
    assert.equal(
      await rpc(
        c,
        "SELECT to_regprocedure('public.fin_caixa_fechar_sessao(uuid,numeric,text)') IS NULL AND to_regprocedure('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)') IS NULL AS r",
      ),
      true,
    );
    assert.equal(await contarTentativas(), n, "o rollback apagou tentativas");
    assert.deepEqual(await ruins(B), [], "55b aceita a tabela preservada");
    assert(
      (await ruins(A)).length > 0,
      "55a não pode passar sem as RPCs novas",
    );
    // Reaplicar depois do rollback aceita a tabela preservada.
    await c.query(M252);
    assert.deepEqual(await ruins(A), []);
    assert.equal(await contarTentativas(), n);
  } finally {
    await c.query("ROLLBACK");
  }
}

// Prova pequena usada como alvo de mutante: a mesma chave com outro valor recusa.
async function divergenciaDeValor(c) {
  await logar(c, U_ADMIN);
  const s = await abrir(c, 300);
  try {
    const k = randomUUID();
    await CHAVE.movimentar(c, s, k, "sangria", 50, "x");
    await recusa(
      CHAVE.movimentar(c, s, k, "sangria", 51, "x"),
      "22023",
      "tentativa_divergente",
      "[MUTANTE] valor divergente",
    );
  } finally {
    await fecharSeAberta(c, CHAVE, s);
  }
}
async function replayDepoisDeFechar(c) {
  await logar(c, U_ADMIN);
  const s = await abrir(c, 300);
  try {
    const k = randomUUID();
    const r1 = await CHAVE.movimentar(c, s, k, "sangria", 50, "x");
    await CHAVE.fechar(c, s, 250, null);
    let r2;
    try {
      r2 = await CHAVE.movimentar(c, s, k, "sangria", 50, "x");
    } catch (e) {
      assert.fail(`[MUTANTE] replay depois de fechar recusou: ${e.message}`);
    }
    assert.equal(
      r2.id,
      r1.id,
      "[MUTANTE] replay depois de fechar devolveu outro id",
    );
  } finally {
    await fecharSeAberta(c, CHAVE, s);
  }
}

async function mutantes(c) {
  const M252 = lerSql(MIGRATIONS, NOME_252);
  const F = definicao(M252, "fin_caixa_fechar_sessao");
  const M = definicao(M252, "fin_caixa_movimentar_com_chave");
  const casos = [
    [
      "fechamento trava a última aberta",
      F,
      F.replace(
        "WHERE id = p_sessao_id FOR UPDATE;",
        "WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1 FOR UPDATE;",
      ),
      () => cx1(c, CHAVE),
      "[DANO] CX1",
    ],
    [
      "movimento sem reserva da chave",
      M,
      M.replace(
        "ON CONFLICT (chave) DO NOTHING;",
        "ON CONFLICT (chave) DO UPDATE SET criado_em = now();",
      ),
      () => cx2(c, CHAVE),
      "[DANO] CX2",
    ],
    [
      "replay sem comparar o valor",
      M,
      M.replace("\n       OR v_t.valor IS DISTINCT FROM v_valor", ""),
      () => divergenciaDeValor(c),
      "[MUTANTE] valor divergente",
    ],
    [
      "replay antes do gate do admin atual",
      M,
      M.replace("IF NOT public.is_admin_atual() THEN", "IF false THEN"),
      () => rebaixado(c),
      "rebaixado repetindo o movimento",
    ],
    [
      "status checado antes da reserva",
      M,
      M.replace(
        "  -- Reserva da tentativa ANTES",
        "  IF v_s.status <> 'aberto' THEN\n    RAISE EXCEPTION 'fechado' USING ERRCODE = '22023';\n  END IF;\n  -- Reserva da tentativa ANTES",
      ),
      () => replayDepoisDeFechar(c),
      "[MUTANTE] replay depois de fechar",
    ],
  ];
  for (const [nome, original, alterada, prova, marcador] of casos) {
    assert.notEqual(alterada, original, `mutante ${nome} não mudou o corpo`);
    await prova(); // controle obrigatoriamente verde
    let motivo;
    await c.query(alterada);
    try {
      await prova();
    } catch (e) {
      motivo = e;
    } finally {
      await c.query(original);
      await logar(c, U_ADMIN);
    }
    assert(motivo, `MUTANTE SOBREVIVEU: ${nome}`);
    assert(
      motivo instanceof assert.AssertionError &&
        motivo.message.includes(marcador),
      `mutante ${nome} morreu pelo motivo errado: ${motivo.message}`,
    );
    console.log(`    mutante morto: ${nome}`);
  }
  // Os corpos voltaram exatamente aos da migration.
  assert.deepEqual(await ruinsDo55a(c), []);
}
async function ruinsDo55a(c) {
  const sql = lerSql(CONSULTAS, "55a-conferir-intencao-do-caixa-aplicado.sql");
  return (await c.query(sql)).rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item);
}

// Fecha direto o que uma prova FALHA deixou aberto, para a próxima não herdar.
async function fecharSobras(c) {
  await c.query(
    "UPDATE public.fin_caixa_sessoes SET status = 'fechado', fechado_em = now() WHERE status = 'aberto'",
  );
}

async function main() {
  const nomeAlvo = process.env.CAIXA_INTENCAO_ALVO || "";
  const alvo = ALVOS.get(nomeAlvo);
  if (!alvo) {
    falhar(
      "USO",
      `CAIXA_INTENCAO_ALVO obrigatório e explícito ('legado' ou 'chave'); recebido '${nomeAlvo}'.`,
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
  const provas = [
    [
      "CX1 retry do fechamento de S1 depois que S2 abriu não toca S2",
      () => cx1(cliente, alvo),
    ],
    [
      "CX2 sangria de 50 com saldo 300 repetida com a mesma chave grava UMA transferência",
      () => cx2(cliente, alvo),
    ],
  ];
  if (alvo === CHAVE) {
    provas.push(
      [
        "controle: as RPCs antigas continuam caindo em [DANO] (CX1 e CX2)",
        () => controleLegado(cliente),
      ],
      [
        "fechamento: validação pura, replay, divergência e outro autor",
        () => fechamento(cliente),
      ],
      [
        "movimento: validação pura, replay, divergência, chaves distintas, conta inativa, gaveta vazia, caixa fechado, outra sessão",
        () => movimento(cliente),
      ],
      [
        "admin rebaixado recebe 42501 antes do replay (controle passa)",
        () => rebaixado(cliente),
      ],
      ["ACL/RLS: tabela só do servidor; anon não executa", () => acl(cliente)],
      [
        "corridas reais (pg_blocking_pids): COMMIT, ROLLBACK, outra sessão, fechamento",
        () => corridas(cliente, url),
      ],
      [
        "portão 55a/55b, reaplicação 2x e rollback que preserva a tabela",
        () => portaoERollback(cliente),
      ],
      ["mutantes causais morrem na asserção certa", () => mutantes(cliente)],
    );
  }
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
    await montarUsuario(cliente, U_ADMIN2, "admin", "admin");
    for (const [nome, corpo] of provas) {
      try {
        await corpo();
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
        await cliente.query("ROLLBACK").catch(() => {});
        await fecharSobras(cliente).catch(() => {});
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  anexarAoSummary(TITULO, linhas.join("\n"));
  if (falhas.length > 0) {
    falhar(
      "FALHOU",
      `${falhas.length}/${provas.length} provas do caixa falharam (${falhas.join(", ")}). Só [DANO] é evidência do defeito; [PRECONDICAO]/[INDETERMINADO] não provam nada.`,
    );
  }
  console.log(
    `\n[caixa-intencao] ${provas.length}/${provas.length} provas passaram (alvo=${nomeAlvo}).`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
