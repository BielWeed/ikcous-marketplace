"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os unicos caminhos lidos sao os arquivos desta migration e das consultas 95a/95b, montados daqui (nunca entrada de rede). */
// SOMENTE Postgres efêmero do CI (rodar-isolado.cjs: clone descartável); nunca banco de loja.
// Migration 20261389000000: o frete tem limite de cotações por origem (frente E / E1) — o CONTADOR que a edge calculate-shipping consulta
// (frete_consumir_cota). O teto e quem conta moram na edge (supabase/functions/calculate-shipping/limite-por-origem.ts, provado em Deno);
// aqui se prova o que só o Postgres de verdade prova: a atomicidade sob chamadas simultâneas, o teto, a janela, a limpeza, o acesso.
//
// Tudo com conexões reais e COMMIT, no clone descartável. O banco base não é tocado.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const ROOT = path.resolve(__dirname, "../..");
const ARQ = "20261389000000_o_frete_tem_limite_de_cotacoes_por_origem.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const CONSULTA_A = ler(
  "scripts/publicacao/consultas/95a-conferir-o-frete-tem-limite-de-cotacoes-aplicado.sql",
);
const CONSULTA_B = ler(
  "scripts/publicacao/consultas/95b-antes-o-frete-tem-limite-de-cotacoes-ausente.sql",
);

const url = lerDatabaseUrlEfemera();
const novoCliente = async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
};

// Hash de 32 hex distinto por número (a edge manda o hash do IP; aqui o número vira o hash).
const origem = (n) =>
  String(n)
    .padStart(32, "0")
    .replace(/[^0-9a-f]/g, "a");
const passo = (texto) => console.log(`  ok - ${texto}`);

async function erro(c, sql, params = []) {
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return { codigo: e.code, mensagem: e.message };
  }
}

// O aplicador: BEGIN, o arquivo, COMMIT; qualquer erro desfaz tudo.
async function aplicar(c, sql) {
  await c.query("BEGIN");
  try {
    await c.query(sql);
    await c.query("COMMIT");
    return null;
  } catch (e) {
    await c.query("ROLLBACK");
    return { codigo: e.code, mensagem: e.message };
  }
}

async function estado(c) {
  return (
    await c.query(`SELECT
      to_regclass('public.frete_cota_por_origem') IS NOT NULL AS tabela,
      to_regprocedure('public.frete_consumir_cota(text,integer,integer)') IS NOT NULL AS funcao`)
  ).rows[0];
}

async function como(c, papel, acao) {
  await c.query(`SET ROLE ${papel}`); // literais fechados deste teste
  try {
    return await acao();
  } finally {
    await c.query("RESET ROLE");
  }
}

const consumir = async (c, o, limite, janela = 300) =>
  (
    await c.query("SELECT public.frete_consumir_cota($1, $2, $3) AS r", [
      o,
      limite,
      janela,
    ])
  ).rows[0].r;

const linhas = async (c, o) =>
  (
    await c.query(
      "SELECT janela_inicio, chamadas FROM public.frete_cota_por_origem WHERE origem = $1 ORDER BY janela_inicio",
      [o],
    )
  ).rows;

async function conferir(c, sql, quantas, passa) {
  const r = (await c.query(sql)).rows;
  assert.equal(r.length, quantas);
  const controle = "controle: catalogo publico visivel";
  assert.equal(r.find((x) => x.item === controle).ok, true);
  assert.equal(
    r.filter((x) => x.item !== controle).every((x) => x.ok === true),
    passa,
    JSON.stringify(r.filter((x) => x.ok !== true)),
  );
}

async function esperarBloqueio(c, pid) {
  for (let i = 0; i < 100; i++) {
    const r = await c.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("a segunda chamada não esperou a linha da primeira");
}

// A bateria que um contador correto passa e um mutante não: teto, bloqueio sem escrita, origens independentes.
async function provaDoTeto(c, base) {
  const o = origem(base);
  for (let i = 0; i < 3; i++)
    assert.equal((await consumir(c, o, 3)).permitido, true, `chamada ${i + 1}`);
  const barrada = await consumir(c, o, 3);
  assert.equal(barrada.permitido, false, "a 4a passa do teto");
  assert.ok(barrada.espere_segundos >= 1 && barrada.espere_segundos <= 300);
  assert.equal((await linhas(c, o))[0].chamadas, 3, "barrar não escreve");
  assert.equal((await consumir(c, origem(base + 1), 3)).permitido, true);
}

async function main() {
  const c = await novoCliente();
  try {
    // ---------- 1. Antes: nada existe; a 95b confere, a 95a responde "não" ----------
    await c.query(rollback); // o clone nasceu do base (que ainda não tem a 389, mas o rollback é inofensivo)
    assert.deepEqual(await estado(c), { tabela: false, funcao: false });
    await conferir(c, CONSULTA_B, 3, true);
    await conferir(c, CONSULTA_A, 6, false);
    passo(
      "antes da migration: nada existe, a 95b confere e a 95a responde não (nunca erro)",
    );

    // ---------- 2. Aplica como o aplicador (BEGIN ... COMMIT) ----------
    assert.equal(await aplicar(c, migration), null);
    assert.deepEqual(await estado(c), { tabela: true, funcao: true });
    await conferir(c, CONSULTA_A, 6, true);
    passo("aplicada: tabela e função existem e a 95a confere os 6 itens");

    // ---------- 3. O contador: teto, bloqueio sem escrita, origens independentes ----------
    await provaDoTeto(c, 1);
    passo(
      "teto: 3 passam, a 4a é barrada com espera entre 1 e 300 s, barrar não escreve, outra origem passa",
    );

    // A janela: a contagem de uma janela velha não vale na janela de agora.
    const o = origem(20);
    await consumir(c, o, 2);
    await c.query(
      "UPDATE public.frete_cota_por_origem SET janela_inicio = janela_inicio - interval '300 seconds' WHERE origem = $1",
      [o],
    );
    assert.equal(
      (await consumir(c, o, 1)).permitido,
      true,
      "janela nova recomeça do zero",
    );
    assert.equal((await consumir(c, o, 1)).permitido, false);
    assert.equal(
      (await linhas(c, o)).length,
      2,
      "a janela velha fica (até a limpeza), a nova tem a sua linha",
    );
    passo("janela fixa: a contagem recomeça na janela seguinte");

    // ---------- 4. Argumentos inválidos: 22023, nada gravado ----------
    const antes = (
      await c.query(
        "SELECT count(*)::int AS n FROM public.frete_cota_por_origem",
      )
    ).rows[0].n;
    for (const args of [
      [null, 3, 300],
      ["abc", 3, 300],
      [origem(1).toUpperCase().replace(/0/g, "A"), 3, 300],
      [origem(1), 0, 300],
      [origem(1), 100001, 300],
      [origem(1), null, 300],
      [origem(1), 3, 9],
      [origem(1), 3, 3601],
      [origem(1), 3, null],
    ]) {
      const e = await erro(
        c,
        "SELECT public.frete_consumir_cota($1, $2, $3)",
        args,
      );
      assert.equal(e?.codigo, "22023", JSON.stringify(args));
    }
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM public.frete_cota_por_origem",
        )
      ).rows[0].n,
      antes,
    );
    passo(
      "argumento inválido (origem fora do formato, teto 0 ou enorme, janela fora de 10..3600, NULL) recusa com 22023 e não grava",
    );

    // ---------- 5. Quem executa e quem lê ----------
    for (const papel of ["anon", "authenticated"]) {
      const e = await como(c, papel, () =>
        erro(c, "SELECT public.frete_consumir_cota($1, 3, 300)", [origem(30)]),
      );
      assert.equal(e?.codigo, "42501", `${papel} não executa`);
    }
    const doServico = await como(c, "service_role", () =>
      consumir(c, origem(31), 3),
    );
    assert.equal(doServico.permitido, true);
    for (const papel of ["anon", "authenticated", "service_role"]) {
      for (const sql of [
        "SELECT * FROM public.frete_cota_por_origem",
        `INSERT INTO public.frete_cota_por_origem VALUES ('${origem(1)}', now(), 1)`,
        "UPDATE public.frete_cota_por_origem SET chamadas = 1",
        "DELETE FROM public.frete_cota_por_origem",
      ]) {
        const e = await como(c, papel, () => erro(c, sql));
        assert.equal(e?.codigo, "42501", `${papel}: ${sql}`);
      }
    }
    passo(
      "só service_role executa; anon e authenticated tomam 42501; ninguém de aplicação lê nem escreve a tabela direto",
    );

    // ---------- 6. Limpeza: lotes de 500, só o que passou de 1 hora, sem esperar ninguém ----------
    await c.query("DELETE FROM public.frete_cota_por_origem");
    await c.query(`INSERT INTO public.frete_cota_por_origem (origem, janela_inicio, chamadas)
      SELECT lpad(to_hex(g), 32, '0'), now() - interval '2 hours', 1 FROM generate_series(1000, 1699) g`);
    await c.query(`INSERT INTO public.frete_cota_por_origem (origem, janela_inicio, chamadas)
      VALUES ('${origem(5)}', now() - interval '30 minutes', 9)`);
    await consumir(c, origem(40), 3); // 1a chamada da origem na janela: varre
    const restaram1 = (
      await c.query(
        "SELECT count(*)::int AS n FROM public.frete_cota_por_origem WHERE janela_inicio < now() - interval '1 hour'",
      )
    ).rows[0].n;
    assert.equal(
      restaram1,
      200,
      "apaga no máximo 500 velhas por chamada (700 - 500)",
    );
    await consumir(c, origem(40), 3); // 2a chamada na MESMA janela: não varre (só a 1a)
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM public.frete_cota_por_origem WHERE janela_inicio < now() - interval '1 hour'",
        )
      ).rows[0].n,
      200,
      "só a 1a chamada da origem na janela varre",
    );
    // Linha velha TRAVADA por outra sessão: a varredura passa por ela sem esperar (SKIP LOCKED).
    const trava = await novoCliente();
    try {
      await trava.query("BEGIN");
      await trava.query(
        "SELECT 1 FROM public.frete_cota_por_origem WHERE janela_inicio < now() - interval '1 hour' LIMIT 1 FOR UPDATE",
      );
      const inicio = Date.now();
      await consumir(c, origem(41), 3);
      assert.ok(
        Date.now() - inicio < 2000,
        "a varredura não esperou a linha travada",
      );
      const aindaVelhas = (
        await c.query(
          "SELECT count(*)::int AS n FROM public.frete_cota_por_origem WHERE janela_inicio < now() - interval '1 hour'",
        )
      ).rows[0].n;
      assert.equal(aindaVelhas, 1, "só a travada sobrou");
      await trava.query("ROLLBACK");
    } finally {
      await trava.end().catch(() => {});
    }
    assert.equal(
      (await linhas(c, origem(5))).length,
      1,
      "linha de 30 min não é varrida",
    );
    passo(
      "limpeza: até 500 linhas com mais de 1 h por chamada, só na 1a da origem na janela, linha de 30 min fica, linha travada é pulada sem esperar",
    );

    // ---------- 7. Chamadas simultâneas: o teto vale sob concorrência ----------
    for (let rodada = 0; rodada < 3; rodada++) {
      const o2 = origem(100 + rodada);
      const clientes = await Promise.all(
        Array.from({ length: 12 }, novoCliente),
      );
      try {
        const resultados = await Promise.all(
          clientes.map((cl) => consumir(cl, o2, 5, 3600)),
        );
        assert.equal(
          resultados.filter((r) => r.permitido).length,
          5,
          `rodada ${rodada}: exatamente 5 passam`,
        );
        assert.equal(resultados.filter((r) => !r.permitido).length, 7);
      } finally {
        await Promise.all(clientes.map((cl) => cl.end().catch(() => {})));
      }
      assert.equal(
        (await linhas(c, o2))[0].chamadas,
        5,
        "nenhuma unidade perdida nem passada do teto",
      );
    }
    passo(
      "12 conexões simultâneas, teto 5: exatamente 5 passam, 7 barradas, contador em 5 (3 rodadas)",
    );

    // A segunda espera a linha da primeira e reavalia: com teto 1 só uma passa; transação desfeita devolve a unidade.
    {
      const a = await novoCliente();
      const b = await novoCliente();
      try {
        const o3 = origem(110);
        await a.query("BEGIN");
        assert.equal((await consumir(a, o3, 1, 3600)).permitido, true);
        const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid;
        const emVoo = consumir(b, o3, 1, 3600);
        await esperarBloqueio(c, pidB);
        await a.query("COMMIT");
        assert.equal(
          (await emVoo).permitido,
          false,
          "a 2a esperou a 1a e viu o contador cheio",
        );

        const o4 = origem(111);
        await a.query("BEGIN");
        assert.equal((await consumir(a, o4, 1, 3600)).permitido, true);
        const emVoo2 = consumir(b, o4, 1, 3600);
        await esperarBloqueio(c, pidB);
        await a.query("ROLLBACK");
        assert.equal(
          (await emVoo2).permitido,
          true,
          "transação interrompida não gasta a unidade",
        );
        assert.equal((await linhas(c, o4))[0].chamadas, 1);
      } finally {
        await a.end().catch(() => {});
        await b.end().catch(() => {});
      }
    }
    passo(
      "a 2a chamada espera a linha da 1a (teto 1: uma só passa); transação desfeita no meio devolve a unidade",
    );

    // ---------- 8. Reaplicar: não zera, não duplica; CRLF também ----------
    await consumir(c, origem(120), 5);
    const antesReaplicar = await linhas(c, origem(120));
    assert.equal(await aplicar(c, migration), null);
    assert.equal(await aplicar(c, migration.replace(/\n/g, "\r\n")), null);
    assert.deepEqual(
      await linhas(c, origem(120)),
      antesReaplicar,
      "reaplicar não mexe nas contagens",
    );
    await conferir(c, CONSULTA_A, 6, true);
    passo(
      "reaplicar duas vezes (LF e CRLF) não zera nem duplica contagem e a 95a segue conferindo",
    );

    // ---------- 9. Pré-voo e pós-voo: recusam sem deixar nada pela metade ----------
    await c.query(rollback);
    await c.query("CREATE TABLE public.frete_cota_por_origem (x integer)");
    let e = await aplicar(c, migration);
    assert.match(e?.mensagem ?? "", /B1_BASELINE_DIVERGENT/);
    assert.deepEqual(
      await estado(c),
      { tabela: true, funcao: false },
      "a tabela alheia fica, nada foi criado",
    );
    await c.query("DROP TABLE public.frete_cota_por_origem");

    await c.query(
      "CREATE FUNCTION public.frete_consumir_cota(text, integer, integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
    );
    e = await aplicar(c, migration);
    assert.match(e?.mensagem ?? "", /B1_BASELINE_DIVERGENT/);
    assert.deepEqual(
      await estado(c),
      { tabela: false, funcao: true },
      "função alheia fica, tabela não foi criada",
    );
    await c.query(
      "DROP FUNCTION public.frete_consumir_cota(text, integer, integer)",
    );

    const sabotado = migration.replace(
      "TO service_role;\nCOMMENT ON FUNCTION",
      "TO service_role, anon;\nCOMMENT ON FUNCTION",
    );
    assert.notEqual(sabotado, migration, "a sabotagem tem de achar o GRANT");
    // Sem BEGIN: o arquivo inteiro é uma transação só (uma mensagem simples com vários comandos).
    e = await erro(c, sabotado);
    assert.match(e?.mensagem ?? "", /B2_POSVOO_DIVERGENTE/);
    assert.deepEqual(
      await estado(c),
      { tabela: false, funcao: false },
      "pós-voo que falha desfaz o arquivo inteiro",
    );
    passo(
      "pré-voo recusa tabela e função alheias; pós-voo que falha desfaz tudo, numa conexão sem BEGIN",
    );

    // ---------- 10. Rollback manual ----------
    assert.equal(await aplicar(c, migration), null);
    await consumir(c, origem(130), 5);
    assert.equal(await aplicar(c, rollback), null);
    assert.deepEqual(await estado(c), { tabela: false, funcao: false });
    await conferir(c, CONSULTA_B, 3, true);
    assert.equal(
      await aplicar(c, rollback),
      null,
      "repetir o rollback é no-op",
    );
    assert.equal(
      await aplicar(c, migration),
      null,
      "reaplicar depois do rollback funciona",
    );
    await conferir(c, CONSULTA_A, 6, true);
    passo(
      "rollback tira função e tabela, a 95b volta a conferir, repetir é no-op e reaplicar funciona",
    );

    // ---------- 11. Mutantes: a bateria reprova quem tira a guarda ----------
    const corpoMigration = (m) => m;
    const comMutante = async (trocar, bateria, rotulo) => {
      const mutante = trocar(corpoMigration(migration));
      assert.notEqual(
        mutante,
        migration,
        `${rotulo}: o mutante tem de mudar o texto`,
      );
      await c.query(rollback);
      // O mutante só roda sem a prova do corpo (hash) do pós-voo: aplica pela função, não pelo arquivo.
      await aplicar(c, migration);
      const fn = mutante.slice(
        mutante.indexOf(
          "CREATE OR REPLACE FUNCTION public.frete_consumir_cota",
        ),
        mutante.indexOf("$function$;") + "$function$;".length,
      );
      await c.query(fn);
      let reprovou = false;
      try {
        await bateria();
      } catch {
        reprovou = true;
      }
      assert.ok(reprovou, `${rotulo}: a bateria tinha de reprovar o mutante`);
      await c.query(rollback);
      await aplicar(c, migration);
    };
    await comMutante(
      (m) => m.replace("   WHERE c.chamadas < p_limite\n", "\n"),
      () => provaDoTeto(c, 200),
      "mutante M1 (sem o WHERE do teto)",
    );
    await comMutante(
      (m) =>
        m.replace(
          " OR p_limite IS NULL OR p_limite < 1 OR p_limite > 100000",
          "",
        ),
      async () => {
        const e2 = await erro(
          c,
          "SELECT public.frete_consumir_cota($1, 0, 300)",
          [origem(210)],
        );
        assert.equal(e2?.codigo, "22023");
      },
      "mutante M2 (sem validar o teto)",
    );
    await comMutante(
      (m) => m.replace("v_chamadas = 1", "v_chamadas > 0"),
      async () => {
        const velha = (n) =>
          c.query(`INSERT INTO public.frete_cota_por_origem (origem, janela_inicio, chamadas)
            VALUES ('${origem(n)}', now() - interval '2 hours', 1)`);
        await c.query("DELETE FROM public.frete_cota_por_origem");
        await velha(221);
        await consumir(c, origem(220), 5, 3600); // 1a da origem na janela: varre (certo e mutante)
        await velha(222);
        await consumir(c, origem(220), 5, 3600); // 2a na mesma janela: o certo NAO varre
        assert.equal(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM public.frete_cota_por_origem WHERE janela_inicio < now() - interval '1 hour'",
            )
          ).rows[0].n,
          1,
          "a varredura roda so na 1a chamada da origem na janela",
        );
      },
      "mutante M3 (varre em toda chamada)",
    );
    passo(
      "3 mutantes (sem o teto, sem validar argumento, varrendo em toda chamada) reprovam a bateria",
    );

    console.log(
      "\nO FRETE TEM LIMITE DE COTACOES POR ORIGEM: prova viva completa.",
    );
  } finally {
    await c.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
