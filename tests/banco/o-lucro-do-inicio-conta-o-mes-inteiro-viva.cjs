"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql (painel_inicio) contra o Postgres
 * EFEMERO com as migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja.
 *
 * O que prova:
 *  (1) O "Lucro estimado" do Inicio (painel_inicio()->mes->lucro_estimado) e o do Financeiro no MES INTEIRO
 *      (fin_dre(dia 1, ultimo dia)): despesa PREVISTA com referencia no ultimo dia entra; a do mes anterior, a do mes
 *      seguinte e a prevista CANCELADA nao entram. Controle: com o corpo anterior (o rollback) a mesma fixture diverge.
 *  (2) Janela do mes certa em fevereiro (28 e 29 dias), meses de 30 e 31 dias, virada de dezembro para janeiro e no dia 1,
 *      com o relogio da loja fixado so dentro de transacao desfeita.
 *  (3) O resto do Inicio nao muda: o JSON inteiro, menos mes.lucro_estimado, e igual ao do corpo anterior (receita, pedidos e
 *      ticket do mes seguem ate hoje).
 *  (4) Dados que ja existiam: aplicar e reaplicar nao muda nenhum lancamento nem pedido; reaplicar 2x deixa a funcao igual
 *      (OID, dono, ACL, atributos e texto).
 *  (5) Rollback devolve o corpo da 20261228 byte a byte com os mesmos atributos; o segundo rollback recusa; reaplicar volta.
 *  (6) Pre-voo (B1_BASELINE_DIVERGENT) recusa, sem escrever, corpo desconhecido, ACL diferente, atributo diferente,
 *      sobrecarga e funcao ausente; o pre-voo do rollback recusa corpo desconhecido.
 *  (7) A porta: cliente comum, ex-admin (so o JWT velho) e visitante nao chamam; admin atual chama.
 *  (8) As consultas 97a/97b e os portoes vizinhos (8e, 17a, 30a) leem o estado certo nos dois sentidos.
 *  (9) Atomicidade: a migration que falha no fim (depois do CREATE) nao deixa nada gravado.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-lucro-do-inicio-conta-o-mes-inteiro-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME = "20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql";
const NOME_ANTERIOR = "20261228000000_o_inicio_compara_ate_a_mesma_hora.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.painel_inicio\(\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "ad5620273997ba9266f240f272bf399b";
const HASH_NOVO = "b4aa318b777824bd49aab4175d9133f8";
const ASSINATURA = "public.painel_inicio()";
const C97A = "97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado";
const C97B = "97b-antes-o-lucro-do-inicio-conta-o-mes-inteiro-base-vigente";

const ADMIN = "5e390000-0000-4000-8000-000000000001";
const CLIENTE = "5e390000-0000-4000-8000-000000000002";
const EX_ADMIN = "5e390000-0000-4000-8000-000000000003";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const CAT_ALUGUEL = "f2000000-0000-4000-8000-000000000020";

const num = (v) => Math.round(Number(v) * 10000) / 10000;

async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso390");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso390");
    await c.query("RELEASE SAVEPOINT caso390");
  }
}
async function logar(c, id) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [id]);
}
const inicio = async (c) =>
  (await c.query("SELECT public.painel_inicio() AS r")).rows[0].r;
const fin = async (c, ini, fim) =>
  (await c.query("SELECT public.fin_dre($1, $2) AS r", [ini, fim])).rows[0].r;
async function rodar(c, nome) {
  const sql = ler(`scripts/publicacao/consultas/${nome}.sql`);
  const rows = (await c.query(sql)).rows;
  return rows;
}
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();

async function despesaPrevista(c, { valor, referencia, cancelada }) {
  await c.query(
    `INSERT INTO public.fin_lancamentos
       (tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
        data_competencia, data_vencimento, data_realizacao, origem, cancelado_em)
     VALUES ('saida', $1, $2, $3, $4, 'Despesa fixture 390', 'dinheiro', $5, $5, NULL, 'manual', $6)`,
    [
      cancelada ? "cancelado" : "previsto",
      valor,
      CAIXA,
      CAT_ALUGUEL,
      referencia,
      cancelada ? new Date().toISOString() : null,
    ],
  );
}
// Oraculo INDEPENDENTE da funcao: os limites do mes de `dia` (AAAA-MM-DD), calculados aqui.
function limitesDoMes(dia) {
  const [a, m] = dia.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return {
    inicio: `${a}-${pad(m)}-01`,
    fim: `${a}-${pad(m)}-${pad(ultimo)}`,
    proximoMes: m === 12 ? `${a + 1}-01-01` : `${a}-${pad(m + 1)}-01`,
    ultimoDoMesAnterior: new Date(Date.UTC(a, m - 1, 0))
      .toISOString()
      .slice(0, 10),
  };
}
async function fixarRelogio(c, dia) {
  await c.query(
    `CREATE OR REPLACE FUNCTION public.fin__hoje() RETURNS date LANGUAGE sql STABLE
       SET search_path TO 'public' AS $$ SELECT DATE '${dia}' $$`,
  );
}
async function lancamentos(c) {
  return (
    await c.query(
      "SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') AS l FROM public.fin_lancamentos l",
    )
  ).rows[0].l;
}
async function pedidos(c) {
  return (
    await c.query(
      "SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY id), '[]') AS l FROM public.marketplace_orders o",
    )
  ).rows[0].l;
}
// Venda paga num instante ABSOLUTO (nunca relativo ao dia em que a prova roda: o mes da fixture e' fixo).
async function venda(c, { quando, total }) {
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ($1, 'Cliente 390', '{}'::jsonb, $2, $2, 'delivered', 'online', 'online', 'pago', $3::timestamptz, $3::timestamptz)`,
    [CLIENTE, total, quando],
  );
}
// Um cenario: fixture de despesas previstas em volta do mes de `hoje` (relogio falso opcional); devolve os numeros.
async function cenario(c, hojeFalso) {
  return isolado(c, async () => {
    await logar(c, ADMIN);
    if (hojeFalso) await fixarRelogio(c, hojeFalso);
    const hoje = (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0]
      .d;
    const mes = limitesDoMes(hoje);
    const antes = num((await inicio(c)).mes.lucro_estimado);
    await despesaPrevista(c, { valor: 40, referencia: mes.fim });
    await despesaPrevista(c, {
      valor: 1000,
      referencia: mes.ultimoDoMesAnterior,
    });
    await despesaPrevista(c, { valor: 7000, referencia: mes.proximoMes });
    await despesaPrevista(c, {
      valor: 500,
      referencia: mes.fim,
      cancelada: true,
    });
    const json = await inicio(c);
    return {
      hoje,
      mes,
      antes,
      depois: num(json.mes.lucro_estimado),
      financeiro: num((await fin(c, mes.inicio, mes.fim)).lucro_liquido),
      cortadoEmHoje: num((await fin(c, mes.inicio, hoje)).lucro_liquido),
      json,
    };
  });
}
const semLucro = (j) => ({ ...j, mes: { ...j.mes, lucro_estimado: null } });

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    for (const [id, , noAuth] of [
      [ADMIN, "admin", "admin"],
      [CLIENTE, "customer", null],
      [EX_ADMIN, "customer", "admin"],
    ])
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@lucro390.invalid', $2::jsonb)`,
        [id, JSON.stringify(noAuth ? { role: noAuth } : {})],
      );
    for (const [id, papel] of [
      [ADMIN, "admin"],
      [CLIENTE, "customer"],
      [EX_ADMIN, "customer"],
    ])
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 390', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );

    // A 20261398000000 (o Inicio compara o mes anterior ate a mesma hora) sucede a 390 e esta no ar no clone: sai PRIMEIRO, pelo
    // rollback-manual dela (o da 390 so aceita o corpo da 390). Esta prova mede a 390 isolada.
    await require("./o-inicio-compara-o-mes-anterior-posterior.cjs").desfazerMesAnteriorNaTransacao(
      c,
    );

    // ---- 0. O topo da 390 (a 398, que a sucede, acabou de sair) e o desta migration; o anterior e o da 228. ----
    const topo = await funcao(c);
    assert.equal(topo.prosrc, CORPO_NOVO, "o topo instalado nao e o da 390");
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(md5(CORPO_ANTES), HASH_ANTES, "o anterior nao e o da 228");
    console.log("  PASSOU o topo instalado e o corpo da 390 (md5 conhecido)");

    // ---- 1 e 2. O lucro do Inicio = o do Financeiro no mes inteiro; meses de 28, 29, 30 e 31 dias; virada de ano; dia 1. ----
    // Controle: o MESMO cenario com o corpo anterior (o rollback) diverge.
    for (const hojeFalso of [
      null,
      "2026-02-10",
      "2028-02-10",
      "2026-04-10",
      "2026-10-10",
      "2026-12-05",
      "2026-11-01",
      "2026-10-31",
    ]) {
      const r = await cenario(c, hojeFalso);
      const onde = `hoje=${r.hoje} (mes ${r.mes.inicio}..${r.mes.fim})`;
      assert.equal(
        r.depois,
        r.financeiro,
        `${onde}: o lucro do Inicio tem de ser o do Financeiro no mes inteiro`,
      );
      assert.equal(
        num(r.antes - r.depois),
        40,
        `${onde}: so a prevista do ultimo dia entra`,
      );
      if (r.hoje < r.mes.fim) assert.notEqual(r.depois, r.cortadoEmHoje, onde);
    }
    // 31 de outubro (hoje = ultimo dia): igual ao corte em hoje, e a mesma regra.
    const controle = await isolado(c, async () => {
      await c.query(rollback);
      assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
      return cenario(c, "2026-10-10");
    });
    assert.equal(
      controle.depois,
      controle.cortadoEmHoje,
      "controle: o corpo anterior cortava o lucro em hoje",
    );
    assert.notEqual(
      controle.depois,
      controle.financeiro,
      "controle: o corpo anterior divergia do Financeiro",
    );
    console.log(
      "  PASSOU lucro do Inicio == Financeiro no mes inteiro (relogio de verdade, fev. 28 e 29, 30, 31 dias, dezembro, dia 1, ultimo dia); outro mes e cancelada nao entram; o corpo anterior diverge (controle)",
    );

    // ---- 3. O resto do Inicio nao muda: o JSON inteiro, menos o lucro, e o do corpo anterior. ----
    await isolado(c, async () => {
      await logar(c, ADMIN);
      await fixarRelogio(c, "2026-10-20");
      await venda(c, { quando: "2026-10-20 08:00:00-03", total: 100 });
      await venda(c, { quando: "2026-10-17 12:00:00-03", total: 50 });
      await venda(c, { quando: "2026-09-10 12:00:00-03", total: 70 });
      await despesaPrevista(c, { valor: 25, referencia: "2026-10-31" });
      const novo = await inicio(c);
      await c.query(rollback);
      const velho = await inicio(c);
      assert.deepEqual(semLucro(novo), semLucro(velho));
      assert.deepEqual(Object.keys(novo), Object.keys(velho));
      assert.deepEqual(Object.keys(novo.mes), Object.keys(velho.mes));
      assert.equal(
        num(novo.mes.receita),
        150,
        "a receita do mes segue ate hoje",
      );
      assert.equal(num(novo.mes.receita_mes_anterior), 70);
      assert.equal(num(novo.hoje.receita), 100);
      assert.equal(Number(novo.mes.pedidos), 2);
      assert.notEqual(novo.mes.lucro_estimado, velho.mes.lucro_estimado);
    });
    console.log(
      "  PASSOU o JSON inteiro do Inicio, menos mes.lucro_estimado, e igual ao do corpo anterior (receita e pedidos do mes seguem ate hoje)",
    );

    // ---- 4. Dados que ja existiam + idempotencia. ----
    await venda(c, { quando: "2026-10-02 12:00:00-03", total: 80 });
    await despesaPrevista(c, { valor: 12, referencia: "2026-10-31" });
    const lancAntes = await lancamentos(c);
    const pedAntes = await pedidos(c);
    await c.query(migration);
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo, "reaplicar mudou a funcao");
    assert.deepEqual(
      await lancamentos(c),
      lancAntes,
      "reaplicar mexeu em lancamento",
    );
    assert.deepEqual(await pedidos(c), pedAntes, "reaplicar mexeu em pedido");
    console.log(
      "  PASSOU reaplicar 2x: mesma funcao (OID, dono, ACL, atributos, texto) e nenhum lancamento nem pedido que ja existia mudou",
    );

    // ---- 5. Rollback byte a byte; segundo rollback recusa; reaplicar volta. ----
    await isolado(c, async () => {
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        CORPO_ANTES,
        "o rollback nao devolveu o corpo da 228 byte a byte",
      );
      assert.equal(md5(volta.prosrc), HASH_ANTES);
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mudou OID, dono, ACL ou atributo",
      );
      assert.deepEqual(await lancamentos(c), lancAntes);
      await isolado(c, async () => {
        await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      });
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao deixou o topo",
      );
    });
    console.log(
      "  PASSOU rollback devolve o corpo da 228 byte a byte com os mesmos atributos; o segundo rollback recusa; reaplicar volta ao topo",
    );

    // ---- 6. Pre-voo: recusa sem escrever. ----
    const estranho = (await funcao(c)).prosrc.replace(
      "BEGIN",
      "BEGIN -- estranho",
    );
    assert.notEqual(estranho, topo.prosrc);
    const recusas = [
      [
        "corpo desconhecido",
        async () =>
          c.query(
            `CREATE OR REPLACE FUNCTION public.painel_inicio() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${estranho}$x$`,
          ),
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
    ];
    for (const [rotulo, estraga, mensagem] of recusas)
      await isolado(c, async () => {
        await estraga();
        const antes = (
          await c.query(
            `SELECT md5(prosrc) h FROM pg_proc WHERE proname = 'painel_inicio' AND pronamespace = 'public'::regnamespace ORDER BY oid LIMIT 1`,
          )
        ).rows[0].h;
        await c.query("SAVEPOINT recusa390");
        await assert.rejects(
          () => c.query(migration),
          (e) =>
            /B1_BASELINE_DIVERGENT/.test(e.message) && mensagem.test(e.message),
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa390");
        const depois = (
          await c.query(
            `SELECT md5(prosrc) h FROM pg_proc WHERE proname = 'painel_inicio' AND pronamespace = 'public'::regnamespace ORDER BY oid LIMIT 1`,
          )
        ).rows[0].h;
        assert.equal(
          depois,
          antes,
          `${rotulo}: a migration escreveu apesar de recusar`,
        );
      });
    await isolado(c, async () => {
      await c.query(
        `CREATE OR REPLACE FUNCTION public.painel_inicio() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${estranho}$x$`,
      );
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    });
    // Loja que ainda nao recebeu a 228 (corpo da 212): recusa, nada a sobrescrever as cegas.
    await isolado(c, async () => {
      const corpo212 = ler(
        `supabase/migrations/rollback-manual-${NOME_ANTERIOR}`,
      ).match(
        /CREATE OR REPLACE FUNCTION public\.painel_inicio\(\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
      )[1];
      await c.query(
        `CREATE OR REPLACE FUNCTION public.painel_inicio() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${corpo212}$x$`,
      );
      assert.equal(
        md5((await funcao(c)).prosrc),
        "f11d22d076c59ab54d1beb280954dd15",
      );
      await assert.rejects(() => c.query(migration), /B1_BASELINE_DIVERGENT/);
    });
    console.log(
      "  PASSOU pre-voo recusa sem escrever: corpo desconhecido, anon/PUBLIC com EXECUTE, authenticated sem, VOLATILE, SECURITY INVOKER, search_path, sobrecarga, fin_dre ausente e corpo da 212; o do rollback recusa corpo desconhecido",
    );

    // ---- 7. A porta. ----
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
      assert.equal(typeof (await inicio(c)).mes.lucro_estimado, "number");
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
      "  PASSOU a porta: cliente e ex-admin (JWT velho) recusados, admin atual chama, anon sem EXECUTE",
    );

    // ---- 8. Consultas 97a/97b e portoes vizinhos (8e, 17a, 30a), nos dois sentidos. ----
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
    {
      const a = await rodar(c, C97A);
      const b = await rodar(c, C97B);
      confereRol(C97A, a);
      confereRol(C97B, b);
      assert.deepEqual(reprovadas(a), [], "97a positiva com o corpo novo");
      assert.deepEqual(
        reprovadas(b),
        [nomeMd5],
        "97b reprova so o md5 com o corpo novo",
      );
    }
    for (const portao of [
      "8e-conferir-92-a-202-aplicado",
      "17a-conferir-estoque-do-painel-aplicado",
      "30a-conferir-numeros-do-painel-aplicado",
    ]) {
      assert.deepEqual(
        reprovadas(await rodar(c, portao)),
        [],
        `${portao}: reprovou o corpo da 390`,
      );
    }
    await isolado(c, async () => {
      await c.query(rollback);
      const a = await rodar(c, C97A);
      const b = await rodar(c, C97B);
      assert.deepEqual(
        reprovadas(a),
        [nomeMd5],
        "97a reprova so o md5 com o corpo anterior",
      );
      assert.deepEqual(reprovadas(b), [], "97b positiva com o corpo anterior");
      for (const portao of [
        "8e-conferir-92-a-202-aplicado",
        "17a-conferir-estoque-do-painel-aplicado",
        "30a-conferir-numeros-do-painel-aplicado",
      ])
        assert.deepEqual(
          reprovadas(await rodar(c, portao)),
          [],
          `${portao}: reprovou o corpo da 228`,
        );
    });
    await isolado(c, async () => {
      await c.query(
        `CREATE OR REPLACE FUNCTION public.painel_inicio() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$${estranho}$x$`,
      );
      assert.deepEqual(reprovadas(await rodar(c, C97A)), [nomeMd5]);
      assert.deepEqual(reprovadas(await rodar(c, C97B)), [nomeMd5]);
      for (const portao of [
        "30a-conferir-numeros-do-painel-aplicado",
        "17a-conferir-estoque-do-painel-aplicado",
        "8e-conferir-92-a-202-aplicado",
      ])
        assert.ok(
          reprovadas(await rodar(c, portao)).length > 0,
          `${portao}: aceitou um corpo estranho`,
        );
    });
    console.log(
      "  PASSOU 97a (positiva so com o corpo novo) e 97b (so com o anterior), rol fechado de 4 linhas; 8e, 17a e 30a aceitam o corpo da 228 e o da 390 e reprovam corpo estranho",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }

  // ---- 9. ATOMICIDADE: o aplicador manda o arquivo inteiro numa consulta so; falhar no fim nao deixa NADA gravado. ----
  // Conexao propria, SEM BEGIN: o estado e commitado de verdade (no clone descartavel), e restaurado no fim.
  const d = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await d.connect();
  try {
    const hash = async () =>
      (
        await d.query(
          `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = '${ASSINATURA}'::regprocedure`,
        )
      ).rows[0].h;
    // O clone tem a 398 no ar de verdade (a transacao de cima foi desfeita): sai aqui tambem, com COMMIT, antes de medir a 390.
    await require("./o-inicio-compara-o-mes-anterior-posterior.cjs").desfazerMesAnteriorNaTransacao(
      d,
    );
    assert.equal(await hash(), HASH_NOVO);
    await d.query(rollback);
    assert.equal(await hash(), HASH_ANTES);
    await assert.rejects(
      () => d.query(`${migration}\nSELECT 1/0;`),
      /division by zero/,
    );
    assert.equal(
      await hash(),
      HASH_ANTES,
      "a migration que falhou no fim deixou o corpo novo gravado pela metade",
    );
    await d.query(migration);
    assert.equal(await hash(), HASH_NOVO);
    console.log(
      "  PASSOU migration que falha no fim (SELECT 1/0 depois do CREATE) nao deixa nada gravado; reaplicada, vira o corpo novo",
    );
  } finally {
    // Garante o estado final do clone: o corpo novo.
    await d.query(migration).catch(() => {});
    await d.end();
  }
  console.log("[o-lucro-do-inicio] prova viva concluida (20261390).");
}

main().catch((erro) => {
  console.error(`[o-lucro-do-inicio] FALHOU: ${erro.stack || erro.message}`);
  process.exit(1);
});
