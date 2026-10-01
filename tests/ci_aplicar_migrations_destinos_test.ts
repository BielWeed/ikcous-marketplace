// @ts-nocheck
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { bashMultiplataforma } from "./_bash_multiplataforma.ts";

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/aplicar-migrations.yml", import.meta.url),
);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const SHA = "a".repeat(40);

function blocoDeExecucao(yaml: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex((linha) =>
    linha.includes('name: "Prova, apply e verificação"'),
  );
  assert(iNome >= 0, "passo de aplicação não encontrado");
  const iRun = linhas.findIndex(
    (linha, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(linha),
  );
  assert(iRun > iNome, "bloco run do passo não encontrado");
  const recuoRun = (linhas.at(iRun) ?? "").match(/^\s*/)[0].length;
  const corpo: string[] = [];
  for (const linha of linhas.slice(iRun + 1)) {
    if (linha.trim() && linha.match(/^\s*/)[0].length <= recuoRun) break;
    corpo.push(linha);
  }
  const recuo = Math.min(
    ...corpo
      .filter((linha) => linha.trim())
      .map((linha) => linha.match(/^\s*/)[0].length),
  );
  return corpo.map((linha) => linha.slice(recuo)).join("\n");
}

async function executar(
  projeto: string,
  {
    expectedSha = SHA,
    tokenLoja = "loja-falso",
    tokenSavy = "savy-falso",
    migracoes = "",
    catalogo = "vazio",
  } = {},
) {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const preload = await Deno.makeTempFile({ suffix: ".cjs" });
  await Deno.writeTextFile(
    preload,
    `const modo = ${JSON.stringify(catalogo)};
    let escreveuLedger = false;
    globalThis.fetch = async (url, options) => {
      console.log("ALVO=" + url);
      console.log("TOKEN=" + options.headers.Authorization);
      const query = JSON.parse(options.body).query;
      if (query.includes("INSERT INTO supabase_migrations.schema_migrations")) {
        if (!query.startsWith("BEGIN;\\n") || !query.endsWith("\\nCOMMIT;")) {
          return { ok: false, status: 400, text: async () => "ledger fora da transação" };
        }
        escreveuLedger = true;
        console.log("LEDGER_WRITE");
      }
      let linhas = [];
      if (query.includes("as ledger_livre")) {
        linhas = [{ ledger_livre: modo !== "ledger_ocupado" }];
      }
      if (query.includes("as ledger_gravado")) {
        linhas = [{ ledger_gravado: escreveuLedger && modo !== "ledger_sumiu" }];
      }
      if (modo !== "vazio" && query.includes("as paged8")) {
        linhas = [{ paged8: true, cancelados: true, codigo: true,
                    venda: true, col_canal: true, col_codigo: true }];
      }
      if (modo === "completo" && query.includes("public.iniciar_venda_presencial_pix") &&
          query.includes("tr_venda_do_balcao_paga_e_entregue") &&
          query.includes("tr_venda_do_balcao_guarda_o_status")) {
        linhas = [{ rpc_pix_84: true, gatilho_entrega_84: true, gatilho_status_84: true }];
      }
      if ((modo === "trigger_desligado" || modo === "trigger_trocado") && query.includes("as rpc_pix_84")) {
        const exigeAtivo = query.includes("t.tgenabled = 'O'");
        const exigeFuncao = query.includes("t.tgfoid = to_regprocedure");
        const gatilho = (modo === "trigger_desligado" && !exigeAtivo) ||
                        (modo === "trigger_trocado" && !exigeFuncao);
        linhas = [{ rpc_pix_84: true, gatilho_entrega_84: gatilho, gatilho_status_84: gatilho }];
      }
      if (modo === "completo" && query.includes("public.anular_venda_presencial")) {
        linhas = [{ rpc_anular_85: true }];
      }
      if (modo === "pix_falso" && query.includes("as rpc_pix_84")) {
        linhas = [{ rpc_pix_84: false, gatilho_entrega_84: true, gatilho_status_84: true }];
      }
      if (modo === "anular_falso" && query.includes("as rpc_anular_85")) {
        linhas = [{ rpc_anular_85: false }];
      }
      return { ok: true, text: async () => JSON.stringify(linhas) };
    };`,
  );
  const script = await Deno.makeTempFile({ suffix: ".sh" });
  await Deno.writeTextFile(script, blocoDeExecucao(yaml));
  try {
    const proc = new Deno.Command(bashMultiplataforma(), {
      args: [script.replaceAll("\\", "/")],
      cwd: RAIZ,
      env: {
        PROJETO: projeto,
        MIGRACOES: migracoes,
        EXPECTED_SHA: expectedSha,
        GITHUB_SHA: SHA,
        // O Actions avalia a expressão secrets[...] do workflow antes do step.
        SUPABASE_ACCESS_TOKEN: projeto === "savy" ? tokenSavy : tokenLoja,
        NODE_OPTIONS: `--require=${preload}`,
      },
      stdout: "piped",
      stderr: "piped",
    });
    const resultado = await proc.output();
    const dec = new TextDecoder();
    return {
      codigo: resultado.code,
      saida: dec.decode(resultado.stdout) + dec.decode(resultado.stderr),
    };
  } finally {
    await Deno.remove(preload);
    await Deno.remove(script);
  }
}

Deno.test("migrations: destinos fechados, credenciais próprias e SHA antes da consulta", async (t) => {
  const yaml = await Deno.readTextFile(WORKFLOW);

  await t.step("somente disparo manual e checkout do SHA selecionado", () => {
    assertStringIncludes(yaml, "workflow_dispatch:");
    assert(!/^ {2}push:/m.test(yaml));
    assert(!/^ {2}pull_request:/m.test(yaml));
    assertStringIncludes(yaml, "ref: ${{ github.sha }}");
  });

  await t.step(
    "cada segredo entra pelo próprio nome, sem token literal",
    () => {
      assertStringIncludes(
        yaml,
        "SUPABASE_ACCESS_TOKEN: ${{ secrets[inputs.projeto == 'savy' && 'SUPABASE_ACCESS_TOKEN_SAVY' || 'SUPABASE_ACCESS_TOKEN'] }}",
      );
      assert(!/SUPABASE_ACCESS_TOKEN:\s*["']?(?:sbp_|eyJ)/.test(yaml));
      assert(!yaml.includes("SUPABASE_ACCESS_TOKEN_LOJA:"));
      assert(!yaml.includes("SUPABASE_ACCESS_TOKEN_SAVY:"));
    },
  );

  await t.step(
    "IKCOUS consulta o projeto ativo com token da loja",
    async () => {
      const r = await executar("loja");
      assertEquals(r.codigo, 0, r.saida);
      assertStringIncludes(
        r.saida,
        "ALVO=https://api.supabase.com/v1/projects/dekxabvqdsuukijblazl/database/query",
      );
      assertStringIncludes(r.saida, "TOKEN=Bearer loja-falso");
      assert(!r.saida.includes("cafkrminfnokvgjqtkle"));
    },
  );

  await t.step(
    "Savy consulta o próprio projeto com o próprio token",
    async () => {
      const r = await executar("savy");
      assertEquals(r.codigo, 0, r.saida);
      assertStringIncludes(
        r.saida,
        "ALVO=https://api.supabase.com/v1/projects/gnjsrucsmjkajijrakzr/database/query",
      );
      assertStringIncludes(r.saida, "TOKEN=Bearer savy-falso");
    },
  );

  await t.step(
    "Savy sem token ou com SHA divergente para antes da primeira consulta",
    async () => {
      for (const opcoes of [
        { tokenSavy: "" },
        { expectedSha: "b".repeat(40) },
        { expectedSha: "a".repeat(39) },
      ]) {
        const r = await executar("savy", opcoes);
        assertEquals(r.codigo, 1, r.saida);
        assert(!r.saida.includes("ALVO="), r.saida);
      }
    },
  );

  await t.step(
    "destino livre é recusado antes da primeira consulta",
    async () => {
      const r = await executar("outro");
      assertEquals(r.codigo, 1, r.saida);
      assert(!r.saida.includes("ALVO="), r.saida);
    },
  );

  await t.step(
    "apply 84 e 85 falham se a conferência simulada não devolve objetos",
    async () => {
      for (const migracao of [
        "20261184000000_o_pix_do_balcao_abre_na_hora.sql",
        "20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql",
      ]) {
        const r = await executar("savy", {
          migracoes: migracao,
          catalogo: "base",
        });
        assertEquals(r.codigo, 1, `${migracao}: ${r.saida}`);
        assert(!r.saida.includes("FIM: tudo aplicado e verificado"), r.saida);
      }
    },
  );

  await t.step(
    "apply 84 e 85 só termina após catálogo e grants aprovados",
    async () => {
      for (const [migracao, marcador] of [
        ["20261184000000_o_pix_do_balcao_abre_na_hora.sql", "VERIFICAÇÃO 84:"],
        [
          "20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql",
          "VERIFICAÇÃO 85:",
        ],
      ]) {
        const r = await executar("savy", {
          migracoes: migracao,
          catalogo: "completo",
        });
        assertEquals(r.codigo, 0, `${migracao}: ${r.saida}`);
        assertStringIncludes(r.saida, marcador);
        assertStringIncludes(r.saida, "LEDGER_WRITE");
        assertStringIncludes(r.saida, "FIM: tudo aplicado e verificado");
      }
    },
  );

  await t.step("RPC sem grant não recebe sucesso após o apply", async () => {
    for (const [migracao, catalogo] of [
      ["20261184000000_o_pix_do_balcao_abre_na_hora.sql", "pix_falso"],
      [
        "20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql",
        "anular_falso",
      ],
    ]) {
      const r = await executar("savy", { migracoes: migracao, catalogo });
      assertEquals(r.codigo, 1, `${migracao}: ${r.saida}`);
      assert(!r.saida.includes("FIM: tudo aplicado e verificado"), r.saida);
    }
  });

  await t.step(
    "ledger e gatilhos incorretos não produzem sucesso",
    async () => {
      for (const catalogo of [
        "ledger_ocupado",
        "ledger_sumiu",
        "trigger_desligado",
        "trigger_trocado",
      ]) {
        const r = await executar("savy", {
          migracoes: "20261184000000_o_pix_do_balcao_abre_na_hora.sql",
          catalogo,
        });
        assertEquals(r.codigo, 1, `${catalogo}: ${r.saida}`);
        assert(!r.saida.includes("FIM: tudo aplicado e verificado"), r.saida);
        if (catalogo === "ledger_ocupado") {
          assert(!r.saida.includes("=== APLICANDO:"), r.saida);
        }
      }
    },
  );
});
