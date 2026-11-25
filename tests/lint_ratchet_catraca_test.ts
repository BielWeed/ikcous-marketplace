// @ts-nocheck
/* eslint-disable security/detect-non-literal-fs-filename -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste, nunca de entrada externa. */
/**
 * A CATRACA em si — o `main()` de scripts/lint-ratchet.mjs e o `rodar` que
 * dispara eslint e biome.
 *
 * O teste vizinho (lint_ratchet_biome_nao_rodou_test.ts) cobre só as duas
 * funções de CONTAGEM (`contarBiome`, `contarEslint`, com executor injetado).
 * A decisão que de fato reprova o PR — comparar o medido com os tetos de
 * `.lint-baseline.json`, "SUBIU" reprova com exit 1, "baixou" só avisa, o
 * Biome só cobra no CI — mora no `main()`, que não é exportado e não tinha
 * nenhuma prova: `process.exit(1)` virar `process.exit(0)` ou `delta > 0`
 * virar `delta >= 0` deixava a suíte inteira verde, e o job "Catraca de lint"
 * é um dos portões do CI.
 *
 * COMO: o script é COPIADO para uma raiz descartável (ele deduz a raiz de
 * import.meta.url e lê `.lint-baseline.json`/`biome.json` dali) e executado
 * como processo filho com um PRELOAD que troca `child_process.execSync` por um
 * eslint/biome FALSOS, dirigidos por cenário. Nada aqui roda eslint de
 * verdade, nem toca no .lint-baseline.json do projeto.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const SCRIPT = new URL("../scripts/lint-ratchet.mjs", import.meta.url);

const PRELOAD = `
import cp from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const c = JSON.parse(process.env.H36_CENARIO);
cp.execSync = (comando, opcoes) => {
  fs.appendFileSync(c.registro, JSON.stringify({ comando, opcoes }) + "\\n");
  const responder = (cfg) => {
    if (cfg.modo === "enobufs") {
      const e = new Error("spawnSync ENOBUFS");
      e.code = "ENOBUFS";
      throw e;
    }
    if (cfg.modo === "lanca") {
      const e = new Error("saiu com 1");
      if (cfg.stdout !== undefined) e.stdout = cfg.stdout;
      if (cfg.stderr !== undefined) e.stderr = cfg.stderr;
      throw e;
    }
    return cfg.saida ?? "";
  };
  if (comando.includes("eslint")) {
    const m = comando.match(/--output-file "([^"]+)"/);
    fs.writeFileSync(m[1], JSON.stringify(c.eslint.relatorio));
    return responder(c.eslint);
  }
  if (comando.includes("biome")) return responder(c.biome);
  throw new Error("comando inesperado: " + comando);
};
syncBuiltinESMExports();
`;

type Medido = {
  eslintErros: number;
  eslintAvisos: number;
  biomeErros: number;
  biomeAvisos: number;
};

function saidaBiome(errors: number, warnings: number, unchanged = 40) {
  const resumo = {
    summary: { changed: 0, unchanged, matches: 0, errors, warnings },
    diagnostics: [],
    command: "check",
  };
  return `${JSON.stringify(resumo)}\ncheck ━━━━\n\n  × Some errors were emitted while running checks.\n`;
}

function relatorioEslint(errors: number, warnings: number) {
  // Dois arquivos: a catraca soma os dois.
  return [
    { filePath: "a.ts", messages: [], errorCount: errors, warningCount: 0 },
    { filePath: "b.ts", messages: [], errorCount: 0, warningCount: warnings },
  ];
}

type Opcoes = {
  baseline?: Medido;
  medido: Medido;
  ci?: boolean;
  resumo?: boolean;
  biomeJson?: string | null;
  biomeCenario?: Record<string, unknown>;
  eslintCenario?: Record<string, unknown>;
};

const TETO: Medido = {
  eslintErros: 0,
  eslintAvisos: 10,
  biomeErros: 13,
  biomeAvisos: 1,
};

async function catraca(o: Opcoes) {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "h36-catraca-")));
  try {
    mkdirSync(join(raiz, "scripts"));
    writeFileSync(
      join(raiz, "scripts", "lint-ratchet.mjs"),
      readFileSync(SCRIPT),
    );
    const t = o.baseline ?? TETO;
    writeFileSync(
      join(raiz, ".lint-baseline.json"),
      JSON.stringify({
        eslint: { errors: t.eslintErros, warnings: t.eslintAvisos },
        biome: { errors: t.biomeErros, warnings: t.biomeAvisos },
      }),
    );
    if (o.biomeJson !== null && o.biomeJson !== undefined) {
      writeFileSync(join(raiz, "biome.json"), o.biomeJson);
    }
    writeFileSync(join(raiz, "preload.mjs"), PRELOAD);
    const registro = join(raiz, "registro.jsonl");
    writeFileSync(registro, "");
    const resumoArquivo = join(raiz, "resumo.md");
    const m = o.medido;
    const cenario = {
      registro,
      eslint: {
        relatorio: relatorioEslint(m.eslintErros, m.eslintAvisos),
        ...(o.eslintCenario ?? {}),
      },
      biome: {
        saida: saidaBiome(m.biomeErros, m.biomeAvisos),
        ...(o.biomeCenario ?? {}),
      },
    };
    const env: Record<string, string> = {
      H36_CENARIO: JSON.stringify(cenario),
      PATH: Deno.env.get("PATH") ?? "",
      SystemRoot: Deno.env.get("SystemRoot") ?? "",
    };
    if (o.ci) env.CI = "true";
    if (o.resumo) env.GITHUB_STEP_SUMMARY = resumoArquivo;
    const saida = await new Deno.Command("node", {
      args: [
        "--import",
        pathToFileURL(join(raiz, "preload.mjs")).href,
        join(raiz, "scripts", "lint-ratchet.mjs"),
      ],
      cwd: raiz,
      clearEnv: true,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    let md = "";
    try {
      md = readFileSync(resumoArquivo, "utf8");
    } catch {
      /* sem resumo */
    }
    return {
      code: saida.code,
      stdout: dec.decode(saida.stdout),
      stderr: dec.decode(saida.stderr),
      md,
      raiz,
      chamadas: readFileSync(registro, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    };
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

const IGUAL = TETO;

Deno.test("nada subiu: aprova (exit 0) e a tabela diz ok nas quatro linhas", async () => {
  const r = await catraca({ medido: IGUAL, ci: true });
  assertEquals(r.code, 0, r.stderr + r.stdout);
  const linhas = r.stdout.split("\n");
  assertEquals(
    linhas[0],
    "ferramenta tipo       agora      teto       situação",
  );
  assertEquals(linhas[1], "-".repeat(72));
  assertEquals(linhas[2], "eslint     errors     0          0          ok");
  assertEquals(linhas[3], "eslint     warnings   10         10         ok");
  assertEquals(linhas[4], "biome      errors     13         13         ok");
  assertEquals(linhas[5], "biome      warnings   1          1          ok");
  assert(!r.stdout.includes("caiu"), r.stdout);
  assertEquals(r.stderr, "");
});

Deno.test("eslint ERRO acima do teto reprova: exit 1, SUBIU +N e o texto de reprovação", async () => {
  const r = await catraca({
    medido: { ...IGUAL, eslintErros: 1 },
    ci: true,
  });
  assertEquals(r.code, 1);
  assertStringIncludes(
    r.stdout,
    "eslint     errors     1          0          SUBIU +1",
  );
  assertStringIncludes(r.stderr, "Reprovado: a dívida de lint aumentou.");
  assertStringIncludes(r.stderr, "suba o teto em .lint-baseline.json");
});

Deno.test("eslint WARNING acima do teto reprova mesmo FORA do CI (eslint sempre cobra)", async () => {
  const r = await catraca({
    medido: { ...IGUAL, eslintAvisos: 15 },
    ci: false,
  });
  assertEquals(r.code, 1);
  assertStringIncludes(
    r.stdout,
    "eslint     warnings   15         10         SUBIU +5",
  );
});

Deno.test("subir só UM acima reprova (limite exato: delta 1 é subida, delta 0 não)", async () => {
  const um = await catraca({ medido: { ...IGUAL, eslintAvisos: 11 } });
  assertEquals(um.code, 1);
  const zero = await catraca({ medido: { ...IGUAL, eslintAvisos: 10 } });
  assertEquals(zero.code, 0);
});

Deno.test("biome acima do teto: no CI reprova; fora do CI só avisa e aprova", async () => {
  const noCi = await catraca({
    medido: { ...IGUAL, biomeErros: 16 },
    ci: true,
  });
  assertEquals(noCi.code, 1);
  assertStringIncludes(
    noCi.stdout,
    "biome      errors     16         13         SUBIU +3",
  );
  assert(!noCi.stdout.includes("não cobrado"), noCi.stdout);

  const local = await catraca({ medido: { ...IGUAL, biomeErros: 16 } });
  assertEquals(local.code, 0, local.stderr);
  assertStringIncludes(
    local.stdout,
    "biome      errors     16         13         subiu +3 (não cobrado fora do CI)",
  );

  const avisosNoCi = await catraca({
    medido: { ...IGUAL, biomeAvisos: 2 },
    ci: true,
  });
  assertEquals(avisosNoCi.code, 1);
  assertStringIncludes(
    avisosNoCi.stdout,
    "biome      warnings   2          1          SUBIU +1",
  );
});

Deno.test("caiu: aprova, pede para abaixar o teto — e só conta como 'baixou' o que é cobrado", async () => {
  const eslint = await catraca({
    medido: { ...IGUAL, eslintAvisos: 8 },
    ci: true,
  });
  assertEquals(eslint.code, 0);
  assertStringIncludes(
    eslint.stdout,
    "eslint     warnings   8          10         baixou -2 — abaixe o teto",
  );
  assertStringIncludes(
    eslint.stdout,
    "Alguma contagem caiu. Abaixe o teto em .lint-baseline.json",
  );

  // Biome menor, mas fora do CI: a linha diz que baixou, só que não é cobrado,
  // então a mensagem de "caiu" não aparece.
  const biomeLocal = await catraca({ medido: { ...IGUAL, biomeErros: 10 } });
  assertEquals(biomeLocal.code, 0);
  assertStringIncludes(
    biomeLocal.stdout,
    "biome      errors     10         13         baixou -3 — abaixe o teto",
  );
  assert(
    !biomeLocal.stdout.includes("Alguma contagem caiu"),
    biomeLocal.stdout,
  );

  const biomeCi = await catraca({
    medido: { ...IGUAL, biomeErros: 10 },
    ci: true,
  });
  assertStringIncludes(biomeCi.stdout, "Alguma contagem caiu");
});

Deno.test("uma subiu e outra caiu: reprova (a queda não compensa a subida)", async () => {
  const r = await catraca({
    medido: { ...IGUAL, eslintErros: 2, eslintAvisos: 1 },
    ci: true,
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "SUBIU +2");
  assertStringIncludes(r.stdout, "baixou -9");
  // Reprovou: não fica pedindo para abaixar o teto na mesma rodada.
  assert(!r.stdout.includes("Alguma contagem caiu"), r.stdout);
});

Deno.test("eslint soma os resultados de TODOS os arquivos", async () => {
  const r = await catraca({
    medido: { ...IGUAL, eslintErros: 0, eslintAvisos: 10 },
    eslintCenario: {
      relatorio: [
        { filePath: "a", errorCount: 0, warningCount: 4 },
        { filePath: "b", errorCount: 0, warningCount: 3 },
        { filePath: "c", errorCount: 0, warningCount: 3 },
      ],
    },
    ci: true,
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(
    r.stdout,
    "eslint     warnings   10         10         ok",
  );
});

Deno.test("resumo do GitHub: reprovado, aprovado-com-queda e aprovado limpo", async () => {
  const subiu = await catraca({
    medido: { ...IGUAL, eslintAvisos: 11 },
    ci: true,
    resumo: true,
  });
  assertEquals(subiu.code, 1);
  assertStringIncludes(subiu.md, "## Catraca de lint");
  assertStringIncludes(
    subiu.md,
    "| ferramenta | tipo | agora | teto | situação |",
  );
  assertStringIncludes(subiu.md, "| eslint | warnings | 11 | 10 | SUBIU +1 |");
  assertStringIncludes(subiu.md, "**Reprovado.** Alguma contagem subiu.");

  const caiu = await catraca({
    medido: { ...IGUAL, eslintAvisos: 9 },
    ci: true,
    resumo: true,
  });
  assertEquals(caiu.code, 0);
  assertStringIncludes(caiu.md, "Aprovado — e alguma contagem **caiu**.");
  assert(!caiu.md.includes("Reprovado"), caiu.md);

  const limpo = await catraca({ medido: IGUAL, ci: true, resumo: true });
  assertStringIncludes(limpo.md, "Aprovado. Nada subiu.");
  assert(!limpo.md.includes("caiu"), limpo.md);
});

Deno.test("sem GITHUB_STEP_SUMMARY nenhum resumo é escrito", async () => {
  const r = await catraca({ medido: IGUAL, ci: true, resumo: false });
  assertEquals(r.md, "");
});

Deno.test("fora do CI avisa que o Biome não é cobrado e lista as pastas que ele ignora", async () => {
  const r = await catraca({
    medido: IGUAL,
    biomeJson: JSON.stringify({ files: { ignore: ["supabase", "dist"] } }),
  });
  assertEquals(r.code, 0);
  assertStringIncludes(r.stdout, "Fora do CI o Biome não é cobrado");
  assertStringIncludes(
    r.stdout,
    "O Biome não olha estas pastas (biome.json → files.ignore): supabase, dist.",
  );
});

Deno.test("no CI esse aviso (e a lista de pastas) não aparece", async () => {
  const r = await catraca({
    medido: IGUAL,
    ci: true,
    biomeJson: JSON.stringify({ files: { ignore: ["supabase"] } }),
  });
  assert(!r.stdout.includes("Fora do CI"), r.stdout);
  assert(!r.stdout.includes("estas pastas"), r.stdout);
});

Deno.test("biome.json com `ignore` que não é lista, vazio, sem `files` ou ausente: o aviso sai sem a lista e a catraca não cai", async () => {
  const casos: Array<[string, string | null]> = [
    [
      "texto no lugar de lista",
      JSON.stringify({ files: { ignore: "supabase" } }),
    ],
    ["lista vazia", JSON.stringify({ files: { ignore: [] } })],
    ["sem files", JSON.stringify({ linter: {} })],
    ["JSON quebrado", "{ nao e json"],
    ["arquivo ausente", null],
  ];
  for (const [nome, conteudo] of casos) {
    const r = await catraca({ medido: IGUAL, biomeJson: conteudo });
    assertEquals(r.code, 0, `${nome}: ${r.stderr}`);
    assertStringIncludes(r.stdout, "Fora do CI o Biome não é cobrado");
    assert(!r.stdout.includes("estas pastas"), `${nome}: ${r.stdout}`);
  }
});

Deno.test("`rodar`: eslint e biome rodam na RAIZ, com buffer de 256 MiB, texto utf8 e stdio em pipe", async () => {
  const r = await catraca({ medido: IGUAL, ci: true });
  assertEquals(r.chamadas.length, 2);
  const [eslint, biome] = r.chamadas;
  assertStringIncludes(
    eslint.comando,
    'npx eslint . --format json --output-file "',
  );
  assertStringIncludes(eslint.comando, '" --cache --cache-strategy content');
  assertEquals(biome.comando, "npx biome check --reporter=json .");
  for (const { opcoes } of r.chamadas) {
    assertEquals(opcoes.maxBuffer, 268435456);
    assertEquals(opcoes.encoding, "utf8");
    assertEquals(opcoes.stdio, "pipe");
    assertEquals(
      String(opcoes.cwd).toLowerCase().replaceAll("\\", "/"),
      r.raiz.toLowerCase().replaceAll("\\", "/"),
    );
  }
});

Deno.test("`rodar`: eslint/biome que SAEM com erro (o caso normal) têm stdout e stderr juntados", async () => {
  // O biome acha problemas e sai com 1: o JSON vem no stdout, o rodapé no stderr.
  const noStdout = await catraca({
    medido: IGUAL,
    ci: true,
    biomeCenario: {
      modo: "lanca",
      stdout: saidaBiome(13, 1),
      stderr: "rodapé no stderr\n",
    },
  });
  assertEquals(noStdout.code, 0, noStdout.stderr);

  // Só o stderr tem o JSON (stdout ausente).
  const noStderr = await catraca({
    medido: IGUAL,
    ci: true,
    biomeCenario: { modo: "lanca", stderr: saidaBiome(13, 1) },
  });
  assertEquals(noStderr.code, 0, noStderr.stderr);

  // Só o stdout tem o JSON (stderr ausente).
  const soStdout = await catraca({
    medido: IGUAL,
    ci: true,
    biomeCenario: { modo: "lanca", stdout: saidaBiome(13, 1) },
  });
  assertEquals(soStdout.code, 0, soStdout.stderr);
});

Deno.test("`rodar`: saída que estoura o buffer FALHA ALTO nomeando o limite (nunca vira contagem)", async () => {
  const r = await catraca({
    medido: IGUAL,
    ci: true,
    biomeCenario: { modo: "enobufs" },
  });
  assert(r.code !== 0, "estouro de buffer não pode aprovar");
  assert(
    !r.stdout.includes("ferramenta"),
    "não pode ter chegado a imprimir a tabela",
  );
  assertStringIncludes(r.stderr, "estourou 268435456 bytes");
  assertStringIncludes(r.stderr, "npx biome check --reporter=json .");
});

Deno.test("biome que não processou arquivo reprova a catraca inteira (não vira 'dívida zero')", async () => {
  const r = await catraca({
    medido: IGUAL,
    ci: true,
    biomeCenario: { saida: saidaBiome(0, 0, 0) },
  });
  assert(r.code !== 0, "falha de execução não pode aprovar");
  assertStringIncludes(r.stderr, "biome não rodou");
});

Deno.test("IMPORTAR o script não roda a catraca (só executar como programa roda)", async () => {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "h36-catraca-import-")));
  try {
    mkdirSync(join(raiz, "scripts"));
    writeFileSync(
      join(raiz, "scripts", "lint-ratchet.mjs"),
      readFileSync(SCRIPT),
    );
    writeFileSync(
      join(raiz, ".lint-baseline.json"),
      JSON.stringify({
        eslint: { errors: 0, warnings: 0 },
        biome: { errors: 0, warnings: 0 },
      }),
    );
    writeFileSync(join(raiz, "preload.mjs"), PRELOAD);
    const registro = join(raiz, "registro.jsonl");
    writeFileSync(registro, "");
    const cenario = {
      registro,
      eslint: { relatorio: relatorioEslint(0, 0) },
      biome: { saida: saidaBiome(0, 0) },
    };
    const saida = await new Deno.Command("node", {
      args: [
        "--import",
        pathToFileURL(join(raiz, "preload.mjs")).href,
        "--input-type=module",
        "--eval",
        `const m = await import(${JSON.stringify(
          pathToFileURL(join(raiz, "scripts", "lint-ratchet.mjs")).href,
        )}); console.log("IMPORTADO", typeof m.contarBiome, typeof m.contarEslint);`,
      ],
      cwd: raiz,
      clearEnv: true,
      env: {
        H36_CENARIO: JSON.stringify(cenario),
        PATH: Deno.env.get("PATH") ?? "",
        SystemRoot: Deno.env.get("SystemRoot") ?? "",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const texto = new TextDecoder().decode(saida.stdout);
    assertEquals(saida.code, 0, new TextDecoder().decode(saida.stderr));
    assertStringIncludes(texto, "IMPORTADO function function");
    assert(
      !texto.includes("ferramenta"),
      "a tabela da catraca não pode sair no import",
    );
    assertEquals(
      readFileSync(registro, "utf8"),
      "",
      "nenhum eslint/biome pode rodar no import",
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
