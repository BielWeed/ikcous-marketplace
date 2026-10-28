"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261398000000_o_inicio_compara_o_mes_anterior_ate_a_mesma_hora.sql (painel_inicio) contra o
 * Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja.
 *
 * O que prova:
 *  (1) O defeito e a correcao: dia 1, a loja vendeu R$ 100 hoje as 05h e R$ 100 no dia 1 do mes anterior as 18h; o
 *      "mes anterior" (painel_inicio()->mes->receita_mes_anterior) valia 100 (seta falsa) e agora vale 0 (sem base). CONTROLE:
 *      o corpo anterior (o rollback) reproduz o 100 na mesma fixture.
 *  (2) A regra em todas as bordas, contra um ORACULO escrito aqui (datas em JS, sem SQL): dia 1, dia 15, o dia da virada de
 *      mes; a venda na hora exata de agora ENTRA (<=), 1 microssegundo depois NAO, 1 antes SIM; dia 28 a 31 contra fevereiro de
 *      28 e 29 dias e meses de 30 e 31 dias (dia 29/30/31 que nao existe no mes anterior: o ultimo dia do mes anterior vale
 *      INTEIRO, como sempre valeu, e a janela nao estoura); virada de ano (janeiro contra dezembro); relogio de verdade.
 *      O relogio da loja e' fixado so dentro de transacao desfeita (fin__hoje); a HORA vem do now() da propria transacao, que
 *      nao se fixa: as vendas ficam a 0, -1 e +1 microssegundo dessa hora, e nas pontas do dia (00:00 e 23:59:59.999999).
 *  (3) Fuso: o corte e' em America/Sao_Paulo nos dois lados; um corte em UTC (nos dois lados ou so na venda) e' pego.
 *  (4) O resto do Inicio nao muda: o JSON inteiro, menos mes.receita_mes_anterior, e igual ao do corpo anterior.
 *  (5) 11 MUTANTES do corpo novo (hora ignorada, corte no dia errado, estrito, UTC, corte tambem no dia que nao existe, deslocado
 *      por 1 dia...) reprovam a bateria, cada um no cenario CERTO.
 *  (6) Dados que ja existiam: aplicar e reaplicar (LF e CRLF) nao muda nenhum pedido nem lancamento; reaplicar 2x deixa a funcao
 *      igual (OID, dono, ACL, atributos e texto).
 *  (7) Rollback devolve o corpo da 20261390 byte a byte (md5 e sha256) com os mesmos atributos; o segundo rollback recusa.
 *  (8) Pre-voo (B1_BASELINE_DIVERGENT) recusa, sem escrever, corpo desconhecido, ACL diferente, atributo diferente,
 *      sobrecarga, funcao ausente e a loja que ainda esta no corpo da 20261228; o pre-voo do rollback recusa corpo desconhecido.
 *  (9) A porta: cliente comum, ex-admin (so o JWT velho) e visitante nao chamam; admin atual chama.
 * (10) As consultas 116a/116b (e 97a/97b, 8e, 17a, 30a) leem o estado certo nos tres corpos (228, 390, 398) e reprovam o estranho.
 * (11) Atomicidade em conexao SEM BEGIN: falhar no fim, pos-voo reprovando (corpo ou atributo) e leitor concorrente.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261398000000_o_inicio_compara_o_mes_anterior_ate_a_mesma_hora.sql";
const NOME_ANTERIOR =
  "20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.painel_inicio\(\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");
const emCRLF = (s) => s.replace(/\n/g, "\r\n");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const CORPO_NOVO = corpoDe(migration);
// O corpo da 20261228 (o que o rollback da 390 deixa): a loja que ainda nao recebeu a 390.
const CORPO_228 = corpoDe(
  ler(`supabase/migrations/rollback-manual-${NOME_ANTERIOR}`),
);
const HASH_228 = "ad5620273997ba9266f240f272bf399b";
const HASH_ANTES = "b4aa318b777824bd49aab4175d9133f8";
const HASH_NOVO = md5(CORPO_NOVO);
const ASSINATURA = "public.painel_inicio()";
const C116A =
  "116a-conferir-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-aplicado";
const C116B =
  "116b-antes-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-base-vigente";
const C97A = "97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado";
const C97B = "97b-antes-o-lucro-do-inicio-conta-o-mes-inteiro-base-vigente";
const PORTOES = [
  "8e-conferir-92-a-202-aplicado",
  "17a-conferir-estoque-do-painel-aplicado",
  "30a-conferir-numeros-do-painel-aplicado",
];

const ADMIN = "5e398000-0000-4000-8000-000000000001";
const CLIENTE = "5e398000-0000-4000-8000-000000000002";
const EX_ADMIN = "5e398000-0000-4000-8000-000000000003";

const num = (v) => Math.round(Number(v) * 10000) / 10000;

// ---------------------------------------------------------------------------------------------------------------------
// Oraculo de datas, em JS, sem SQL: o mes anterior "nos mesmos dias" e o corte do ultimo dia.
// ---------------------------------------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.toISOString().slice(0, 10);
const somaDias = (dia, n) =>
  iso(new Date(new Date(`${dia}T00:00:00Z`).getTime() + n * 86400000));
function janela(hoje) {
  const [a, m, d] = hoje.split("-").map(Number);
  const mesInicio = `${a}-${pad(m)}-01`;
  const antInicio = iso(new Date(Date.UTC(a, m - 2, 1)));
  const diasDoAnterior = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
  // O dia de hoje (d) existe no mes anterior quando d <= dias dele.
  const temODia = d <= diasDoAnterior;
  const antFim = temODia ? somaDias(antInicio, d - 1) : somaDias(mesInicio, -1);
  return { mesInicio, antInicio, antFim, temODia, diasDoAnterior };
}
/** Entra na base do mes anterior? `quando` e' a posicao da venda em relacao a hora de agora (as que ficam ATE ela: madrugada, antes, exata). */
function entra(hoje, dia, quando) {
  const j = janela(hoje);
  if (dia < j.antInicio || dia > j.antFim) return false;
  if (dia < j.antFim || !j.temODia) return true;
  return ["madrugada", "antes", "exata"].includes(quando);
}

// ---------------------------------------------------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------------------------------------------------
async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso398");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso398");
    await c.query("RELEASE SAVEPOINT caso398");
  }
}
async function logar(c, id) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [id]);
}
const inicio = async (c) =>
  (await c.query("SELECT public.painel_inicio() AS r")).rows[0].r;
async function rodar(c, nome) {
  return (await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))).rows;
}
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
async function fixarRelogio(c, dia) {
  await c.query(
    `CREATE OR REPLACE FUNCTION public.fin__hoje() RETURNS date LANGUAGE sql STABLE
       SET search_path TO 'public' AS $$ SELECT DATE '${dia}' $$`,
  );
}
async function instalar(c, corpo) {
  await c.query(
    `CREATE OR REPLACE FUNCTION public.painel_inicio() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${corpo}$x$`,
  );
}
async function pedidos(c) {
  return (
    await c.query(
      "SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY id), '[]') AS l FROM public.marketplace_orders o",
    )
  ).rows[0].l;
}
async function lancamentos(c) {
  return (
    await c.query(
      "SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') AS l FROM public.fin_lancamentos l",
    )
  ).rows[0].l;
}

/**
 * Venda paga no `dia` (AAAA-MM-DD, calendario de Sao Paulo), numa posicao em relacao a HORA de agora da transacao
 * (o now() dela, o mesmo que o painel_inicio le):
 *   madrugada = 00:00:00 (sempre ate a hora)  antes = hora - 1 us  exata = a hora  depois = hora + 1 us  fim = 23:59:59.999999.
 */
async function venda(c, { dia, quando, total }) {
  await c.query(
    `WITH h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::time AS hora),
          t AS (SELECT ((CASE $4::text
                           WHEN 'madrugada' THEN ($3::date + time '00:00:00')
                           WHEN 'antes' THEN ($3::date + h.hora) - interval '1 microsecond'
                           WHEN 'exata' THEN ($3::date + h.hora)
                           WHEN 'depois' THEN ($3::date + h.hora) + interval '1 microsecond'
                           WHEN 'fim' THEN ($3::date + time '23:59:59.999999')
                         END) AT TIME ZONE 'America/Sao_Paulo') AS t FROM h)
     INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     SELECT $1, 'Cliente 398', '{}'::jsonb, $2, $2, 'delivered', 'online', 'online', 'pago', t.t, t.t FROM t`,
    [CLIENTE, total, dia, quando],
  );
}

/** Um cenario: relogio da loja em `hoje` (null = o de verdade), as vendas, e o JSON do Inicio (de cada corpo pedido). */
async function cenario(c, hoje, vendas, { comAntigo = false } = {}) {
  return isolado(c, async () => {
    await logar(c, ADMIN);
    if (hoje) await fixarRelogio(c, hoje);
    for (const v of vendas) await venda(c, v);
    const novo = await inicio(c);
    let antigo = null;
    if (comAntigo) {
      await c.query(rollback);
      antigo = await inicio(c);
    }
    return { novo, antigo };
  });
}
const doAnterior = (j) => num(j.mes.receita_mes_anterior);
const semAnterior = (j) => ({
  ...j,
  mes: { ...j.mes, receita_mes_anterior: null },
});

// ---------------------------------------------------------------------------------------------------------------------
// A bateria: a mesma fixture em varios "hoje", contra o oraculo. Devolve as falhas (vazio = tudo certo).
// ---------------------------------------------------------------------------------------------------------------------
const HOJES = [
  "2025-03-01", // dia 1; anterior = fevereiro de 28 dias
  "2024-03-01", // dia 1; anterior = fevereiro de 29 dias
  "2025-03-15", // dia 15
  "2025-03-28", // o ultimo dia que EXISTE em fevereiro de 28 dias (corta na hora)
  "2025-03-29", // nao existe em fevereiro de 28 dias: fevereiro vale inteiro
  "2025-03-31",
  "2024-03-29", // existe em fevereiro bissexto (corta na hora)
  "2024-03-30", // nao existe: fevereiro bissexto vale inteiro
  "2024-03-31",
  "2025-05-30", // existe em abril (30 dias): corta
  "2025-05-31", // nao existe em abril: inteiro
  "2025-07-31", // junho de 30 dias
  "2025-08-31", // julho de 31 dias: existe, corta
  "2025-10-30", // setembro de 30: existe
  "2025-10-31", // nao existe
  "2025-12-31", // novembro de 30 dias
  "2026-01-01", // virada de ano, dia 1 (anterior = dezembro)
  "2026-01-15", // virada de ano
  "2026-01-31", // dezembro de 31 dias: existe
  "2026-02-28", // janeiro tem 31
  "2026-03-01", // fevereiro de 2026 (28)
  null, // o relogio de verdade
];
/** As vendas da bateria para um "hoje": potencias de 2, para saber qual entrou. */
function fixture(hoje) {
  const j = janela(hoje);
  const espelho = j.antFim;
  const vs = [
    { dia: j.antInicio, quando: "fim", total: 1 },
    { dia: somaDias(espelho, -1), quando: "fim", total: 2 },
    { dia: espelho, quando: "madrugada", total: 4 },
    { dia: espelho, quando: "antes", total: 8 },
    { dia: espelho, quando: "exata", total: 16 },
    { dia: espelho, quando: "depois", total: 32 },
    { dia: espelho, quando: "fim", total: 64 },
    { dia: somaDias(j.antInicio, -1), quando: "madrugada", total: 512 },
    { dia: j.mesInicio, quando: "madrugada", total: 256 },
    { dia: hoje ?? "", quando: "madrugada", total: 1024 },
  ];
  return vs.filter((v) => v.dia !== "");
}
async function bateria(c, { comAntigo = false } = {}) {
  const falhas = [];
  for (const h of HOJES) {
    const hoje =
      h ?? (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0].d;
    const vendas = fixture(hoje);
    const { novo, antigo } = await cenario(c, h, vendas, { comAntigo });
    const esperado = vendas
      .filter((v) => entra(hoje, v.dia, v.quando))
      .reduce((s, v) => s + v.total, 0);
    if (doAnterior(novo) !== esperado)
      falhas.push({ hoje, h, esperado, obtido: doAnterior(novo) });
    if (comAntigo) {
      if (
        JSON.stringify(Object.keys(novo)) !==
        JSON.stringify(Object.keys(antigo))
      )
        falhas.push({ hoje, h, esperado: "mesmas chaves", obtido: "outras" });
      if (
        JSON.stringify(semAnterior(novo)) !==
        JSON.stringify(semAnterior(antigo))
      )
        falhas.push({
          hoje,
          h,
          esperado: "resto igual",
          obtido: "resto mudou",
        });
    }
  }
  return falhas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Os mutantes do corpo novo
// ---------------------------------------------------------------------------------------------------------------------
const HORA_SP = "(pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)";
const COND =
  "AND (dia < v_mes_ant_fim OR NOT v_mes_ant_tem_o_dia\n                                       OR (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)";
const mutar = (corpo, de, para) => {
  assert.equal(
    corpo.split(de).length - 1,
    1,
    `o trecho do mutante nao aparece uma vez: ${de.slice(0, 50)}`,
  );
  const m = corpo.replace(de, () => para);
  assert.notEqual(m, corpo);
  return m;
};
const MUTANTES = [
  {
    nome: "hora ignorada (o dia inteiro, como antes)",
    corpo: mutar(CORPO_NOVO, COND, "AND true"),
    cai: ["2025-03-01", "2025-03-15", "2026-01-15"],
  },
  {
    nome: "o corte sempre fica de fora (nunca entra venda do ultimo dia)",
    corpo: mutar(
      CORPO_NOVO,
      "OR (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
      "OR false)",
    ),
    cai: ["2025-03-01", "2025-03-15"],
  },
  {
    nome: "estrito (< em vez de <=: a venda na hora exata sai)",
    corpo: mutar(
      CORPO_NOVO,
      `OR ${HORA_SP}`,
      `OR ${HORA_SP.replace("<=", "<")}`,
    ),
    cai: ["2025-03-15"],
  },
  {
    nome: "um microssegundo de folga (a venda 1 us depois entra)",
    corpo: mutar(
      CORPO_NOVO,
      `OR ${HORA_SP}`,
      `OR ${HORA_SP.replace("<= v_hora", "<= v_hora + interval '1 microsecond'")}`,
    ),
    cai: ["2025-03-15"],
  },
  {
    nome: "corte em UTC nos dois lados (hora de agora e hora da venda)",
    corpo: mutar(
      mutar(
        CORPO_NOVO,
        "v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;",
        "v_hora time := (now() AT TIME ZONE 'UTC')::time;",
      ),
      "OR (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
      "OR (pago_em AT TIME ZONE 'UTC')::time <= v_hora)",
    ),
    cai: ["2025-03-15"],
  },
  {
    nome: "corte so na venda em UTC (hora de agora em SP)",
    corpo: mutar(
      CORPO_NOVO,
      "OR (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
      "OR (pago_em AT TIME ZONE 'UTC')::time <= v_hora)",
    ),
    cai: ["2025-03-15"],
  },
  {
    nome: "corte tambem no dia que nao existe (dia 31 contra mes de 30: corta fevereiro/abril/setembro as 10h)",
    corpo: mutar(CORPO_NOVO, " OR NOT v_mes_ant_tem_o_dia", ""),
    cai: ["2025-03-29", "2024-03-30", "2025-05-31", "2025-10-31", "2025-12-31"],
  },
  {
    nome: "o dia existe com folga errada (< em vez de <=: o dia 28 contra fevereiro de 28 dias passa a ser tratado como inexistente)",
    corpo: mutar(
      CORPO_NOVO,
      "v_mes_ant_tem_o_dia := v_mes_ant_inicio + (v_hoje - v_mes_inicio) <= v_mes_inicio - 1;",
      "v_mes_ant_tem_o_dia := v_mes_ant_inicio + (v_hoje - v_mes_inicio) < v_mes_inicio - 1;",
    ),
    cai: ["2025-03-28", "2024-03-29", "2025-05-30", "2025-10-30", "2026-01-31"],
  },
  {
    nome: "o dia existe sempre (o dia 31 contra um mes de 30 dias corta o ultimo dia)",
    corpo: mutar(
      CORPO_NOVO,
      "v_mes_ant_tem_o_dia := v_mes_ant_inicio + (v_hoje - v_mes_inicio) <= v_mes_inicio - 1;",
      "v_mes_ant_tem_o_dia := true;",
    ),
    cai: ["2025-03-29", "2024-03-30", "2025-05-31", "2025-10-31"],
  },
  {
    nome: "corte no dia ERRADO (o dia anterior ao ultimo tambem corta)",
    corpo: mutar(
      CORPO_NOVO,
      "AND (dia < v_mes_ant_fim OR",
      "AND (dia < v_mes_ant_fim - 1 OR",
    ),
    cai: ["2025-03-15", "2025-03-28"],
  },
  {
    nome: "corte no dia ERRADO (o ultimo dia nunca corta: dia < fim + 1)",
    corpo: mutar(
      CORPO_NOVO,
      "AND (dia < v_mes_ant_fim OR",
      "AND (dia < v_mes_ant_fim + 1 OR",
    ),
    cai: ["2025-03-01", "2025-03-15"],
  },
  {
    nome: "o corte vale em todos os dias do mes anterior (so as horas, sem o `dia < fim`)",
    corpo: mutar(
      CORPO_NOVO,
      "AND (dia < v_mes_ant_fim OR NOT v_mes_ant_tem_o_dia\n                                       OR",
      "AND (NOT v_mes_ant_tem_o_dia\n                                       OR",
    ),
    cai: ["2025-03-15", "2026-01-15"],
  },
];

// ---------------------------------------------------------------------------------------------------------------------
async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    // A HORA da transacao (o now() dela, o mesmo que o painel_inicio le) nao pode estar na ponta do dia: as vendas de -1 e +1
    // microssegundo cairiam em outro dia. Na virada (a cada dia, por 2 s) espera e abre a transacao de novo.
    for (;;) {
      await c.query("BEGIN");
      const s = Number(
        (
          await c.query(
            "SELECT extract(epoch FROM (now() AT TIME ZONE 'America/Sao_Paulo')::time) AS s",
          )
        ).rows[0].s,
      );
      if (s > 1 && s < 86398) break;
      await c.query("ROLLBACK");
      console.log("  relogio de SP na virada do dia: esperando 3 s");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    for (const [id, noAuth] of [
      [ADMIN, "admin"],
      [CLIENTE, null],
      [EX_ADMIN, "admin"],
    ])
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@inicio398.invalid', $2::jsonb)`,
        [id, JSON.stringify(noAuth ? { role: noAuth } : {})],
      );
    for (const [id, papel] of [
      [ADMIN, "admin"],
      [CLIENTE, "customer"],
      [EX_ADMIN, "customer"],
    ])
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 398', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );

    // ---- 0. O topo instalado pelo CI (todas as migrations do zero) e' o desta migration; o anterior e' o da 390. ----
    const topo = await funcao(c);
    assert.equal(topo.prosrc, CORPO_NOVO, "o topo instalado nao e o da 398");
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(md5(CORPO_ANTES), HASH_ANTES, "o anterior nao e o da 390");
    assert.equal(md5(CORPO_228), HASH_228, "o da loja atrasada nao e o da 228");
    assert.notEqual(HASH_NOVO, HASH_ANTES);
    // A hora da transacao nao pode estar na ponta do dia: as vendas de -1 e +1 microssegundo cairiam em outro dia.
    const hora = (
      await c.query(
        "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::time AS h, extract(epoch FROM (now() AT TIME ZONE 'America/Sao_Paulo')::time) AS s",
      )
    ).rows[0];
    assert.ok(
      Number(hora.s) > 1 && Number(hora.s) < 86398,
      `o relogio de SP esta na virada do dia (${hora.h}): rode a prova de novo em um minuto`,
    );
    console.log(
      `  PASSOU o topo instalado e o corpo da 398 (md5 ${HASH_NOVO}); o anterior e o da 390; hora de SP da transacao ${hora.h}`,
    );

    // ---- 1. O defeito do relatorio e a correcao, com controle no corpo anterior. ----
    {
      const vendas = [
        { dia: "2025-02-01", quando: "fim", total: 100 }, // dia 1 do mes anterior, "as 18h": DEPOIS da hora de agora
        { dia: "2025-03-01", quando: "madrugada", total: 100 }, // hoje (dia 1) "as 05h"
      ];
      const { novo, antigo } = await cenario(c, "2025-03-01", vendas, {
        comAntigo: true,
      });
      assert.equal(doAnterior(novo), 0, "dia 1: sem base nos mesmos dias");
      assert.equal(
        doAnterior(antigo),
        100,
        "controle: o corpo anterior dizia 100",
      );
      assert.equal(num(novo.mes.receita), 100);
      assert.equal(num(novo.hoje.receita), 100);
      assert.deepEqual(semAnterior(novo), semAnterior(antigo));
    }
    console.log(
      "  PASSOU dia 1: venda de R$ 100 no dia 1 do mes anterior (depois da hora de agora) e R$ 100 hoje -> mes anterior 0 (era 100); o resto do JSON igual",
    );

    // ---- 2. Numeros a mao, em varios dias. ----
    {
      const h = async (hoje, vendas, esperadoNovo, esperadoAntigo) => {
        const { novo, antigo } = await cenario(c, hoje, vendas, {
          comAntigo: true,
        });
        assert.equal(doAnterior(novo), esperadoNovo, `${hoje}: corpo novo`);
        assert.equal(
          doAnterior(antigo),
          esperadoAntigo,
          `${hoje}: corpo anterior (controle)`,
        );
        assert.deepEqual(semAnterior(novo), semAnterior(antigo), hoje);
      };
      const v = (dia, quando, total) => ({ dia, quando, total });
      // Dia 15 de maio: abril do dia 1 ao 14 inteiros; dia 15 de abril so ate a hora; depois do dia 15 e antes do dia 1 fora.
      await h(
        "2025-05-15",
        [
          v("2025-04-14", "fim", 50),
          v("2025-04-15", "fim", 70),
          v("2025-04-15", "madrugada", 20),
          v("2025-04-15", "exata", 3),
          v("2025-04-15", "depois", 1000),
          v("2025-04-16", "madrugada", 9000),
          v("2025-03-31", "fim", 800),
        ],
        73,
        1143,
      );
      // Dia 31 de julho contra junho (30 dias): o dia 31 nao existe; junho vale INTEIRO, igual ao de antes.
      await h(
        "2025-07-31",
        [
          v("2025-06-30", "fim", 80),
          v("2025-06-30", "madrugada", 10),
          v("2025-06-29", "fim", 7),
          v("2025-07-01", "madrugada", 500),
        ],
        97,
        97,
      );
      // 31 de marco contra fevereiro de 28 e de 29 dias: o ultimo dia de fevereiro vale inteiro.
      await h("2025-03-31", [v("2025-02-28", "fim", 60)], 60, 60);
      await h("2024-03-31", [v("2024-02-29", "fim", 60)], 60, 60);
      // A fronteira: dia 28 de marco TEM espelho em fevereiro de 28 dias (corta); dia 29 nao tem (inteiro).
      await h("2025-03-28", [v("2025-02-28", "fim", 60)], 0, 60);
      await h("2025-03-29", [v("2025-02-28", "fim", 60)], 60, 60);
      await h("2024-03-29", [v("2024-02-29", "fim", 60)], 0, 60);
      await h("2024-03-30", [v("2024-02-29", "fim", 60)], 60, 60);
      // Virada de ano: janeiro contra dezembro.
      await h(
        "2026-01-15",
        [
          v("2025-12-14", "fim", 5),
          v("2025-12-15", "madrugada", 1),
          v("2025-12-15", "fim", 90),
          v("2025-12-31", "fim", 4000),
        ],
        6,
        96,
      );
      await h(
        "2026-01-31",
        [
          v("2025-12-31", "madrugada", 2),
          v("2025-12-31", "fim", 40),
          v("2025-12-30", "fim", 4),
        ],
        6,
        46,
      );
      // 31 de agosto contra julho (31): existe, corta.
      await h(
        "2025-08-31",
        [
          v("2025-07-31", "fim", 40),
          v("2025-07-31", "madrugada", 2),
          v("2025-07-30", "fim", 4),
        ],
        6,
        46,
      );
      // Dia 1 de janeiro: a base e' so o que saiu em 1o de dezembro ate a hora de agora.
      await h(
        "2026-01-01",
        [v("2025-12-01", "madrugada", 30), v("2025-12-01", "fim", 70)],
        30,
        100,
      );
    }
    console.log(
      "  PASSOU a mao: dia 15 (73 vs 1143), 31/jul contra junho, 31/mar contra fevereiro de 28 e 29 dias, a fronteira 28/29 de marco e 29/30 de marco bissexto, janeiro contra dezembro, 31/ago contra julho, 1o de janeiro",
    );

    // ---- 3. A bateria inteira contra o oraculo (21 "hoje" e o relogio de verdade), e o resto do JSON igual ao do corpo anterior. ----
    {
      const falhas = await bateria(c, { comAntigo: true });
      assert.deepEqual(falhas, [], "a bateria acusou falhas no corpo novo");
      // Controle: a MESMA bateria no corpo anterior reprova (o defeito existe).
      const controle = await isolado(c, async () => {
        await c.query(rollback);
        assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
        return bateria(c);
      });
      assert.ok(
        controle.length >= 10,
        `controle: o corpo anterior devia reprovar a bateria (reprovou ${controle.length})`,
      );
      console.log(
        `  PASSOU a bateria: ${HOJES.length} "hoje" (dia 1, 15, 28 a 31, fevereiro de 28 e 29, virada de ano, relogio de verdade) = oraculo; o corpo anterior reprova ${controle.length} deles`,
      );
    }

    // ---- 4. Mutantes: cada um reprova a bateria, e no cenario CERTO. ----
    for (const m of MUTANTES) {
      const falhas = await isolado(c, async () => {
        await instalar(c, m.corpo);
        assert.equal(md5((await funcao(c)).prosrc), md5(m.corpo));
        return bateria(c);
      });
      assert.ok(falhas.length > 0, `mutante NAO morreu: ${m.nome}`);
      const onde = new Set(falhas.map((f) => f.h));
      for (const esperado of m.cai)
        assert.ok(
          onde.has(esperado),
          `mutante "${m.nome}" devia cair em ${esperado} (caiu em ${[...onde].join(", ")})`,
        );
    }
    console.log(
      `  PASSOU ${MUTANTES.length} mutantes reprovam a bateria, cada um nos cenarios certos`,
    );

    // ---- 5. O resto do Inicio nao muda, numa fixture rica. ----
    await isolado(c, async () => {
      await logar(c, ADMIN);
      await fixarRelogio(c, "2026-10-20");
      await venda(c, { dia: "2026-10-20", quando: "madrugada", total: 100 });
      await venda(c, { dia: "2026-10-13", quando: "madrugada", total: 40 }); // semana passada, ate a hora
      await venda(c, { dia: "2026-10-13", quando: "fim", total: 900 }); // semana passada, depois da hora
      await venda(c, { dia: "2026-10-17", quando: "fim", total: 50 });
      await venda(c, { dia: "2026-09-10", quando: "fim", total: 70 });
      await venda(c, { dia: "2026-09-20", quando: "madrugada", total: 3 });
      await venda(c, { dia: "2026-09-20", quando: "fim", total: 5000 }); // depois da hora de agora: sai da base
      const novo = await inicio(c);
      await c.query(rollback);
      const velho = await inicio(c);
      assert.deepEqual(semAnterior(novo), semAnterior(velho));
      assert.deepEqual(Object.keys(novo), Object.keys(velho));
      assert.deepEqual(Object.keys(novo.mes), Object.keys(velho.mes));
      assert.equal(
        num(novo.mes.receita),
        1090,
        "a receita do mes segue ate hoje",
      );
      assert.equal(num(novo.mes.receita_mes_anterior), 73);
      assert.equal(num(velho.mes.receita_mes_anterior), 5073);
      assert.equal(num(novo.hoje.receita), 100);
      assert.equal(num(novo.hoje.receita_semana_passada), 40);
      assert.equal(Number(novo.mes.pedidos), 4);
    });
    console.log(
      "  PASSOU o JSON inteiro do Inicio, menos mes.receita_mes_anterior (73 contra 5073), e igual ao do corpo anterior",
    );

    // ---- 6. Dados que ja existiam + idempotencia (LF e CRLF). ----
    await venda(c, { dia: "2026-10-02", quando: "fim", total: 80 });
    await venda(c, { dia: "2026-09-02", quando: "depois", total: 12 });
    const pedAntes = await pedidos(c);
    const lancAntes = await lancamentos(c);
    await c.query(migration);
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo, "reaplicar mudou a funcao");
    await c.query(emCRLF(migration));
    assert.equal(
      md5((await funcao(c)).prosrc),
      HASH_NOVO,
      "a migration em CRLF deixou outro corpo",
    );
    assert.deepEqual(
      { ...(await funcao(c)), prosrc: null },
      { ...topo, prosrc: null },
      "CRLF mudou OID, dono, ACL ou atributos",
    );
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo);
    assert.deepEqual(await pedidos(c), pedAntes, "reaplicar mexeu em pedido");
    assert.deepEqual(
      await lancamentos(c),
      lancAntes,
      "reaplicar mexeu em lancamento",
    );
    console.log(
      "  PASSOU reaplicar 2x e em CRLF: mesma funcao (OID, dono, ACL, atributos, texto) e nenhum pedido nem lancamento que ja existia mudou",
    );

    // ---- 7. Rollback byte a byte; segundo rollback recusa; reaplicar volta. ----
    await isolado(c, async () => {
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        CORPO_ANTES,
        "o rollback nao devolveu o corpo da 390 byte a byte",
      );
      assert.equal(md5(volta.prosrc), HASH_ANTES);
      assert.equal(sha256(volta.prosrc), sha256(CORPO_ANTES));
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mudou OID, dono, ACL ou atributo",
      );
      assert.deepEqual(await pedidos(c), pedAntes);
      await isolado(c, async () => {
        await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      });
      await c.query(emCRLF(migration));
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao deixou o topo",
      );
      await c.query(emCRLF(rollback));
      assert.equal(
        md5((await funcao(c)).prosrc),
        HASH_ANTES,
        "rollback em CRLF",
      );
    });
    console.log(
      "  PASSOU rollback devolve o corpo da 390 byte a byte (texto, md5, sha256) com os mesmos atributos; o segundo rollback recusa; CRLF dos dois lados",
    );

    // ---- 8. Pre-voo: recusa sem escrever. ----
    const estranho = `${(await funcao(c)).prosrc}\n-- estranho\n`;
    assert.notEqual(estranho, topo.prosrc);
    const hashDoVivo = async () =>
      (
        await c.query(
          `SELECT md5(prosrc) h FROM pg_proc WHERE proname = 'painel_inicio' AND pronamespace = 'public'::regnamespace ORDER BY oid LIMIT 1`,
        )
      ).rows[0].h;
    const recusas = [
      [
        "corpo desconhecido",
        async () => instalar(c, estranho),
        /corpo vivo de public\.painel_inicio\(\) \(hash/,
      ],
      [
        "anon com EXECUTE",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`),
        /ACL de public\.painel_inicio\(\)/,
      ],
      [
        "authenticated sem EXECUTE",
        async () =>
          c.query(
            `REVOKE EXECUTE ON FUNCTION ${ASSINATURA} FROM authenticated`,
          ),
        /ACL de public\.painel_inicio\(\)/,
      ],
      [
        "PUBLIC com EXECUTE",
        async () =>
          c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO PUBLIC`),
        /ACL de public\.painel_inicio\(\)/,
      ],
      [
        "volatilidade diferente",
        async () => c.query(`ALTER FUNCTION ${ASSINATURA} VOLATILE`),
        /atributos de public\.painel_inicio\(\)/,
      ],
      [
        "SECURITY INVOKER",
        async () => c.query(`ALTER FUNCTION ${ASSINATURA} SECURITY INVOKER`),
        /atributos de public\.painel_inicio\(\)/,
      ],
      [
        "search_path diferente",
        async () =>
          c.query(
            `ALTER FUNCTION ${ASSINATURA} SET search_path = public, extensions`,
          ),
        /atributos de public\.painel_inicio\(\)/,
      ],
      [
        "sobrecarga",
        async () =>
          c.query(
            "CREATE FUNCTION public.painel_inicio(p_x integer) RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$",
          ),
        /painel_inicio tem sobrecarga/,
      ],
      [
        "fin_dre ausente",
        async () => c.query("DROP FUNCTION public.fin_dre(date,date)"),
        /funções que o corpo novo chama não existem: public\.fin_dre\(date,date\)/,
      ],
      [
        "crm__vendas ausente",
        async () =>
          c.query("DROP FUNCTION public.crm__vendas(timestamptz) CASCADE"),
        /funções que o corpo novo chama não existem: public\.crm__vendas\(timestamptz\)/,
      ],
      [
        "loja que ainda esta no corpo da 20261228 (nao recebeu a 390)",
        async () => instalar(c, CORPO_228),
        /corpo vivo de public\.painel_inicio\(\) \(hash ad5620273997ba9266f240f272bf399b\)/,
      ],
    ];
    for (const [rotulo, estraga, mensagem] of recusas)
      await isolado(c, async () => {
        await estraga();
        const antes = await hashDoVivo();
        await c.query("SAVEPOINT recusa398");
        await assert.rejects(
          () => c.query(migration),
          (e) =>
            /B1_BASELINE_DIVERGENT/.test(e.message) && mensagem.test(e.message),
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa398");
        assert.equal(
          await hashDoVivo(),
          antes,
          `${rotulo}: a migration escreveu apesar de recusar`,
        );
      });
    // O pre-voo do rollback recusa corpo desconhecido e a loja ja no corpo anterior (nada a desfazer).
    await isolado(c, async () => {
      await instalar(c, estranho);
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    });
    await isolado(c, async () => {
      await instalar(c, CORPO_ANTES);
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    });
    console.log(
      "  PASSOU pre-voo recusa sem escrever: corpo desconhecido, anon/PUBLIC com EXECUTE, authenticated sem, VOLATILE, SECURITY INVOKER, search_path, sobrecarga, fin_dre e crm__vendas ausentes e loja ainda no corpo da 228; o do rollback recusa corpo desconhecido e o corpo anterior",
    );

    // ---- 9. A porta. ----
    await isolado(c, async () => {
      await logar(c, CLIENTE);
      await assert.rejects(
        () => inicio(c),
        (e) => e.code === "42501",
      );
    });
    await isolado(c, async () => {
      await logar(c, EX_ADMIN);
      await assert.rejects(
        () => inicio(c),
        (e) => e.code === "42501",
      );
    });
    await isolado(c, async () => {
      await logar(c, ADMIN);
      assert.equal(typeof (await inicio(c)).mes.receita_mes_anterior, "number");
    });
    for (const papel of ["anon", "authenticated", "service_role"])
      assert.equal(
        (
          await c.query(
            `SELECT has_function_privilege('${papel}', '${ASSINATURA}', 'EXECUTE') AS x`,
          )
        ).rows[0].x,
        papel !== "anon",
      );
    console.log(
      "  PASSOU a porta: cliente e ex-admin (so o papel antigo no JWT) recusados, admin atual chama, anon sem EXECUTE",
    );

    // ---- 10. Consultas 116a/116b e os portoes vizinhos, nos tres corpos. ----
    // eslint-disable-next-line security/detect-non-literal-require -- caminho montado de literais do proprio teste, dentro do repositorio.
    const { ROL_FECHADO_POR_CONSULTA } = require(
      path.join(RAIZ, "scripts/publicacao/conferir-banco.cjs"),
    );
    const confereRol = (nome, rows) => {
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        // eslint-disable-next-line security/detect-object-injection -- `nome` e literal de consulta do proprio teste.
        [...ROL_FECHADO_POR_CONSULTA[nome]].sort(),
        `${nome}: rol fechado`,
      );
    };
    const nomeMd5 = "painel_inicio: corpo exato (md5)";
    const estados = [
      // [rotulo, instala, 116a, 116b, 97a, 97b]
      ["398 (topo)", async () => {}, [], [nomeMd5], [], [nomeMd5]],
      ["390", async () => c.query(rollback), [nomeMd5], [], [], [nomeMd5]],
      [
        "228",
        async () => {
          await instalar(c, CORPO_228);
        },
        [nomeMd5],
        [nomeMd5],
        [nomeMd5],
        [],
      ],
    ];
    for (const [rotulo, poe, e116a, e116b, e97a, e97b] of estados)
      await isolado(c, async () => {
        await poe();
        const a = await rodar(c, C116A);
        const b = await rodar(c, C116B);
        confereRol(C116A, a);
        confereRol(C116B, b);
        assert.deepEqual(reprovadas(a), e116a, `116a com o corpo da ${rotulo}`);
        assert.deepEqual(reprovadas(b), e116b, `116b com o corpo da ${rotulo}`);
        assert.deepEqual(
          reprovadas(await rodar(c, C97A)),
          e97a,
          `97a com o corpo da ${rotulo}`,
        );
        assert.deepEqual(
          reprovadas(await rodar(c, C97B)),
          e97b,
          `97b com o corpo da ${rotulo}`,
        );
        for (const portao of PORTOES)
          assert.deepEqual(
            reprovadas(await rodar(c, portao)),
            [],
            `${portao}: reprovou o corpo da ${rotulo}`,
          );
      });
    await isolado(c, async () => {
      await instalar(c, estranho);
      assert.deepEqual(reprovadas(await rodar(c, C116A)), [nomeMd5]);
      assert.deepEqual(reprovadas(await rodar(c, C116B)), [nomeMd5]);
      assert.deepEqual(reprovadas(await rodar(c, C97A)), [nomeMd5]);
      for (const portao of PORTOES)
        assert.ok(
          reprovadas(await rodar(c, portao)).length > 0,
          `${portao}: aceitou um corpo estranho`,
        );
    });
    console.log(
      "  PASSOU 116a (positiva so com o corpo novo) e 116b (so com a 390), rol fechado; 97a, 8e, 17a e 30a aceitam o corpo da 228, da 390 e da 398 e reprovam corpo estranho",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // ---- 11. ATOMICIDADE E CONCORRENCIA, em conexoes SEM BEGIN: o estado e' commitado de verdade no clone descartavel. ----
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  const leitor = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  await leitor.connect();
  const hash = async (cli = d) =>
    (
      await cli.query(
        `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = '${ASSINATURA}'::regprocedure`,
      )
    ).rows[0].h;
  try {
    assert.equal(await hash(), HASH_NOVO);
    await d.query(rollback);
    assert.equal(await hash(), HASH_ANTES);
    // (a) Falhar no fim, depois do CREATE: nada fica gravado.
    await assert.rejects(
      () => d.query(`${migration}\nSELECT 1/0;`),
      /division by zero/,
    );
    assert.equal(
      await hash(),
      HASH_ANTES,
      "a migration que falhou no fim deixou o corpo novo gravado pela metade",
    );
    // (b) Pos-voo reprovando o CORPO (o CREATE grava um texto que nao e' o esperado): a conferencia derruba tudo.
    const corpoErrado = migration.replace(
      "  v_mes_ant_tem_o_dia boolean;\n",
      "  v_mes_ant_tem_o_dia boolean; -- diferente\n",
    );
    assert.notEqual(corpoErrado, migration);
    await assert.rejects(
      () => d.query(corpoErrado),
      /conferencia 20261398: corpo vivo/,
    );
    assert.equal(await hash(), HASH_ANTES, "pos-voo do corpo nao desfez");
    // (c) Pos-voo reprovando um ATRIBUTO (mesmo texto, outra volatilidade): a conferencia derruba tudo.
    const atributoErrado = migration.replace(
      " STABLE SECURITY DEFINER",
      " VOLATILE SECURITY DEFINER",
    );
    assert.notEqual(atributoErrado, migration);
    await assert.rejects(
      () => d.query(atributoErrado),
      /conferencia 20261398: atributos de public\.painel_inicio\(\) mudaram/,
    );
    assert.equal(await hash(), HASH_ANTES, "pos-voo do atributo nao desfez");
    assert.equal(
      (
        await d.query(
          `SELECT provolatile FROM pg_proc WHERE oid = '${ASSINATURA}'::regprocedure`,
        )
      ).rows[0].provolatile,
      "s",
      "a volatilidade nao voltou",
    );
    // (d) Leitor concorrente: enquanto a troca esta aberta numa transacao, quem le o painel nao espera e enxerga o corpo INTEIRO
    //     (o de antes), nunca meio-termo; depois do COMMIT enxerga o novo.
    await d.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@inicio398.invalid', '{"role":"admin"}'::jsonb)`,
      [ADMIN],
    );
    await d.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Ficticio 398', 'admin') ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
      [ADMIN],
    );
    await leitor.query("SELECT set_config('app.rpc.user_id', $1, false)", [
      ADMIN,
    ]);
    await leitor.query("SET statement_timeout = '4s'");
    await d.query("BEGIN");
    await d.query(migration);
    assert.equal(await hash(), HASH_NOVO);
    assert.equal(
      await hash(leitor),
      HASH_ANTES,
      "o leitor concorrente viu a troca antes do COMMIT",
    );
    const durante = (await leitor.query("SELECT public.painel_inicio() AS r"))
      .rows[0].r;
    assert.equal(typeof durante.mes.receita_mes_anterior, "number");
    await d.query("COMMIT");
    assert.equal(
      await hash(leitor),
      HASH_NOVO,
      "o leitor nao viu o corpo novo apos o COMMIT",
    );
    const depois = (await leitor.query("SELECT public.painel_inicio() AS r"))
      .rows[0].r;
    assert.deepEqual(Object.keys(depois), Object.keys(durante));
    // (e) Transacao interrompida no meio (ROLLBACK depois de aplicar): volta ao corpo de antes.
    await d.query(rollback);
    assert.equal(await hash(), HASH_ANTES);
    await d.query("BEGIN");
    await d.query(migration);
    await d.query("ROLLBACK");
    assert.equal(
      await hash(),
      HASH_ANTES,
      "o ROLLBACK da transacao nao desfez a migration",
    );
    await d.query(migration);
    assert.equal(await hash(), HASH_NOVO);
    console.log(
      "  PASSOU atomicidade em conexao SEM BEGIN: falhar no fim, pos-voo reprovando corpo e atributo e ROLLBACK no meio nao deixam nada gravado; o leitor concorrente nao espera e ve o corpo inteiro (de antes ate o COMMIT, novo depois)",
    );
  } finally {
    // Garante o estado final do clone: o corpo novo.
    await d.query("ROLLBACK").catch(() => {});
    await d.query(migration).catch(() => {});
    await leitor.end().catch(() => {});
    await d.end();
  }
  console.log(
    "[o-inicio-compara-o-mes-anterior] prova viva concluida (20261398).",
  );
}

main().catch((erro) => {
  console.error(
    `[o-inicio-compara-o-mes-anterior] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});
