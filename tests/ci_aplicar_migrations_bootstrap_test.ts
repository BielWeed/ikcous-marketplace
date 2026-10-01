// @ts-nocheck
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/aplicar-migrations.yml", import.meta.url),
);
const SHA = "a".repeat(40);
const M84 = "20261184000000_o_pix_do_balcao_abre_na_hora.sql";
const M85 = "20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql";

function bash(): string {
  if (Deno.build.os !== "windows") return "bash";
  const execPath = new TextDecoder()
    .decode(
      new Deno.Command("git", {
        args: ["--exec-path"],
        stdout: "piped",
      }).outputSync().stdout,
    )
    .trim()
    .replaceAll("\\", "/");
  let dir = execPath;
  for (let i = 0; i < 4; i++) {
    dir = dir.slice(0, dir.lastIndexOf("/"));
    for (const path of [`${dir}/bin/bash.exe`, `${dir}/usr/bin/bash.exe`]) {
      try {
        if (Deno.statSync(path).isFile) return path;
      } catch {
        /* tenta outro caminho */
      }
    }
  }
  throw new Error("bash do Git for Windows não encontrado");
}

function blocoDeApply(yaml: string): string {
  const linhas = yaml.split(/\r?\n/);
  const nome = linhas.findIndex((l) =>
    l.includes('name: "Prova, apply e verificação"'),
  );
  assert(nome >= 0, "passo de apply ausente");
  const inicio = linhas.findIndex(
    (l, i) => i > nome && /^\s*run:\s*\|\s*$/.test(l),
  );
  assert(inicio > nome, "bloco run ausente");
  const nivel = (linhas.at(inicio) ?? "").match(/^\s*/)[0].length;
  const corpo: string[] = [];
  for (const linha of linhas.slice(inicio + 1)) {
    if (linha.trim() && linha.match(/^\s*/)[0].length <= nivel) break;
    corpo.push(linha);
  }
  const recuo = Math.min(
    ...corpo.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length),
  );
  return corpo.map((l) => l.slice(recuo)).join("\n");
}

async function executar(
  yaml: string,
  projeto: string,
  {
    migracoes = "",
    expectedSha = SHA,
    token = "token-falso",
    catalogo = "ok",
  } = {},
) {
  const temp = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${temp}/supabase/migrations`, { recursive: true });
    // Fixtures locais: o PR de bootstrap não carrega migrations para produção.
    for (const nome of [M84, M85]) {
      await Deno.writeTextFile(
        `${temp}/supabase/migrations/${nome}`,
        "SELECT 1;",
      );
    }
    const preload = `${temp}/mock.cjs`;
    await Deno.writeTextFile(
      preload,
      `const catalogo = ${JSON.stringify(catalogo)};
       let escreveuLedger = false;
       globalThis.fetch = async (url, options) => {
         console.log("ALVO=" + url);
         console.log("TOKEN=" + options.headers.Authorization);
         const query = JSON.parse(options.body).query;
         if (query.includes("INSERT INTO supabase_migrations.schema_migrations")) {
           if (!query.startsWith("BEGIN;\\n") || !query.endsWith("\\nCOMMIT;")) {
             return {ok:false,status:400,text:async()=>"ledger fora da transação"};
           }
           escreveuLedger = true;
           console.log("LEDGER_WRITE");
         }
         let linhas = [];
         if (query.includes("as ledger_livre")) {
           linhas = [{ledger_livre:catalogo !== "ledger_ocupado"}];
         }
         if (query.includes("as ledger_gravado")) {
           linhas = [{ledger_gravado:escreveuLedger && catalogo !== "ledger_sumiu"}];
         }
         if (query.includes("as paged8")) {
           linhas = [{paged8:true,cancelados:true,codigo:true,venda:true,col_canal:true,col_codigo:true}];
         }
         if (query.includes("as rpc_pix_84")) {
           const gatilho = catalogo !== "trigger_desligado" || !query.includes("t.tgenabled = 'O'");
           const funcao = catalogo !== "trigger_trocado" || !query.includes("t.tgfoid = to_regprocedure");
           linhas = [{rpc_pix_84:catalogo !== "pix_falso",gatilho_entrega_84:gatilho && funcao,gatilho_status_84:gatilho && funcao}];
         }
         if (query.includes("as rpc_anular_85")) {
           linhas = [{rpc_anular_85:catalogo !== "anular_falso"}];
         }
         return {ok:true,text:async()=>JSON.stringify(linhas)};
       };`,
    );
    const script = `${temp}/aplicar.sh`;
    await Deno.writeTextFile(script, blocoDeApply(yaml));
    const proc = new Deno.Command(bash(), {
      args: [script.replaceAll("\\", "/")],
      cwd: temp,
      env: {
        PROJETO: projeto,
        MIGRACOES: migracoes,
        EXPECTED_SHA: expectedSha,
        GITHUB_SHA: SHA,
        SUPABASE_ACCESS_TOKEN: token,
        NODE_OPTIONS: `--require=${preload}`,
      },
      stdout: "piped",
      stderr: "piped",
    });
    const r = await proc.output();
    const texto = new TextDecoder();
    return {
      codigo: r.code,
      saida: texto.decode(r.stdout) + texto.decode(r.stderr),
    };
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
}

Deno.test("bootstrap manual de migrations isola IKCOUS e Savy", async (t) => {
  const yaml = await Deno.readTextFile(WORKFLOW).catch(() => "");
  assertStringIncludes(yaml, "workflow_dispatch:", "workflow falta em develop");

  await t.step(
    "sem gatilho automático; segredo e checkout pertencem ao destino",
    () => {
      assert(!/^ {2}(push|pull_request):/m.test(yaml));
      assertStringIncludes(yaml, "ref: ${{ github.sha }}");
      assertStringIncludes(
        yaml,
        "options:\n          - loja\n          - savy\n          - sandbox",
      );
      assertStringIncludes(
        yaml,
        "SUPABASE_ACCESS_TOKEN: ${{ secrets[inputs.projeto == 'savy' && 'SUPABASE_ACCESS_TOKEN_SAVY' || 'SUPABASE_ACCESS_TOKEN'] }}",
      );
    },
  );

  await t.step(
    "cada loja consulta seu ref, e SHA Savy bloqueia antes da rede",
    async () => {
      const loja = await executar(yaml, "loja");
      assertEquals(loja.codigo, 0, loja.saida);
      assertStringIncludes(
        loja.saida,
        "projects/dekxabvqdsuukijblazl/database/query",
      );
      const savy = await executar(yaml, "savy");
      assertEquals(savy.codigo, 0, savy.saida);
      assertStringIncludes(
        savy.saida,
        "projects/gnjsrucsmjkajijrakzr/database/query",
      );
      for (const opcoes of [{ expectedSha: "b".repeat(40) }, { token: "" }]) {
        const recusado = await executar(yaml, "savy", opcoes);
        assertEquals(recusado.codigo, 1, recusado.saida);
        assert(!recusado.saida.includes("ALVO="), recusado.saida);
      }
      const desconhecido = await executar(yaml, "outro");
      assertEquals(desconhecido.codigo, 1, desconhecido.saida);
      assert(!desconhecido.saida.includes("ALVO="), desconhecido.saida);
    },
  );

  await t.step(
    "84/85 exigem catálogo, grants e gatilhos após apply",
    async () => {
      for (const nome of [M84, M85]) {
        const ok = await executar(yaml, "savy", { migracoes: nome });
        assertEquals(ok.codigo, 0, ok.saida);
        assertStringIncludes(ok.saida, "FIM: tudo aplicado e verificado");
        assertStringIncludes(ok.saida, "LEDGER_WRITE");
        const falso = await executar(yaml, "savy", {
          migracoes: nome,
          catalogo: nome === M84 ? "pix_falso" : "anular_falso",
        });
        assertEquals(falso.codigo, 1, falso.saida);
        assert(
          !falso.saida.includes("FIM: tudo aplicado e verificado"),
          falso.saida,
        );
      }
      for (const catalogo of ["trigger_desligado", "trigger_trocado"]) {
        const falso = await executar(yaml, "savy", {
          migracoes: M84,
          catalogo,
        });
        assertEquals(falso.codigo, 1, falso.saida);
        assert(!falso.saida.includes("FIM: tudo aplicado e verificado"));
      }
      for (const catalogo of ["ledger_ocupado", "ledger_sumiu"]) {
        const falso = await executar(yaml, "savy", {
          migracoes: M84,
          catalogo,
        });
        assertEquals(falso.codigo, 1, falso.saida);
        assert(!falso.saida.includes("FIM: tudo aplicado e verificado"));
        if (catalogo === "ledger_ocupado") {
          assert(!falso.saida.includes("=== APLICANDO:"), falso.saida);
        }
      }
    },
  );
});
