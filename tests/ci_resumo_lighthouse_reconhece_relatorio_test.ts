import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/**
 * O resumo do Lighthouse lê o relatório que o `lhci collect` grava —
 * scripts/ci/resumo-lighthouse.mjs + .github/workflows/saude.yml
 *
 * O DEFEITO QUE ESTES TESTES FECHAM (P2 r4003274113 no PR #583, confirmado
 * em 15/09/2026): o resumo filtrava SÓ `lighthouse-*.report.json`, mas o
 * `lhci collect` grava os relatórios como `lhr-<timestamp>.json` — nome
 * montado em `@lhci/utils/src/saved-reports.js` (`const baseFilename =
 * `lhr-${Date.now()}``). Nenhum arquivo casava: o resumo caía no ramo
 * "fumaça não feita", publicava um warning e saía 0 — e o job, por ser
 * informativo, ficava VERDE sem publicar um único número de Lighthouse.
 *
 * O QUE ESTES TESTES MEDEM: o script REAL (o arquivo em scripts/ci/, não uma
 * cópia) rodado sobre pastas-fixture, sem navegador, sem build e sem lhci —
 * reconhecer o nome certo, escolher o mais recente e diagnosticar quando
 * não há relatório.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const SCRIPT = fromFileUrl(
  new URL("../scripts/ci/resumo-lighthouse.mjs", import.meta.url),
);

/** LHR mínimo só com o que o resumo lê: 4 categorias e as auditorias centrais. */
function lhrMinimo({ performance = 0.9 }) {
  return JSON.stringify({
    categories: {
      performance: { score: performance },
      accessibility: { score: 0.85 },
      "best-practices": { score: 1 },
      seo: { score: 0.77 },
    },
    audits: {
      "first-contentful-paint": { numericValue: 1234.5 },
      "largest-contentful-paint": { numericValue: 2345.6 },
      "total-blocking-time": { numericValue: 120.4 },
      "cumulative-layout-shift": { numericValue: 0.012 },
      "speed-index": { numericValue: 2000.2 },
    },
  });
}

/**
 * Monta uma sandbox com `.lighthouseci/` preenchida por `arquivos` ({nome:
 * conteudo}) e roda o script REAL com o cwd nela — é assim que o workflow
 * chama: o script resolve `.lighthouseci` a partir de process.cwd().
 */
async function rodarResumo(arquivos) {
  const sandbox = await Deno.makeTempDir({ prefix: "ci_lighthouse_" });
  const pasta = `${sandbox}/.lighthouseci`;
  await Deno.mkdir(pasta);
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    await Deno.writeTextFile(`${pasta}/${nome}`, conteudo);
  }
  const proc = new Deno.Command("node", {
    args: [SCRIPT],
    cwd: sandbox,
    stdout: "piped",
    stderr: "piped",
  });
  const saida = await proc.output();
  return {
    code: saida.code,
    stdout: new TextDecoder().decode(saida.stdout),
  };
}

// --------------------------------------------------------------------------

Deno.test("o resumo do Lighthouse lê o relatório que o lhci grava", async (t) => {
  await t.step(
    "O DEFEITO: relatório com o nome REAL do lhci (lhr-<timestamp>.json) publica os números",
    async () => {
      const r = await rodarResumo({
        "lhr-1750000000000.json": lhrMinimo({ performance: 0.9 }),
      });
      assertEquals(r.code, 0);
      assertStringIncludes(r.stdout, "### 🚦 Lighthouse");
      assertStringIncludes(r.stdout, "**90**");
      assertStringIncludes(r.stdout, "1235 ms");
      assert(
        !r.stdout.includes("::warning::"),
        `o resumo publicou warning com relatório presente — o filtro não reconhece o nome do lhci.\nsaida:\n${r.stdout}`,
      );
    },
  );

  await t.step(
    "vários relatórios -> publica o mais recente, não o primeiro",
    async () => {
      const sandbox = await Deno.makeTempDir({ prefix: "ci_lighthouse_" });
      const pasta = `${sandbox}/.lighthouseci`;
      await Deno.mkdir(pasta);
      const velho = `${pasta}/lhr-1000000000000.json`;
      const novo = `${pasta}/lhr-2000000000000.json`;
      await Deno.writeTextFile(velho, lhrMinimo({ performance: 0.1 }));
      await Deno.writeTextFile(novo, lhrMinimo({ performance: 0.9 }));
      // mtime explícito: a ordem de escrita no disco não decide a leitura.
      await Deno.utime(velho, 1000, 1000);
      await Deno.utime(novo, 2000, 2000);
      const proc = new Deno.Command("node", {
        args: [SCRIPT],
        cwd: sandbox,
        stdout: "piped",
        stderr: "piped",
      });
      const saida = new TextDecoder().decode((await proc.output()).stdout);
      assertStringIncludes(saida, "**90**");
      assert(
        !saida.includes("**10**"),
        `o resumo publicou o relatório VELHO.\nsaida:\n${saida}`,
      );
    },
  );

  await t.step(
    "arquivos na pasta mas NENHUM relatório -> warning diagnostica o que havia",
    async () => {
      const r = await rodarResumo({
        "manifest.json": "{}",
        "lhr-1750000000000.html": "<html></html>",
      });
      assertEquals(r.code, 0);
      assertStringIncludes(r.stdout, "::warning::");
      // O diagnóstico diz o que esperava e o que havia — "não olhei" não pode
      // se parecer com "não fez".
      assertStringIncludes(r.stdout, "lhr-");
      assertStringIncludes(r.stdout, "manifest.json");
    },
  );

  await t.step(
    "pasta .lighthouseci ausente -> warning e saída 0 (mesma receita do CI)",
    async () => {
      const sandbox = await Deno.makeTempDir({ prefix: "ci_lighthouse_" });
      const proc = new Deno.Command("node", {
        args: [SCRIPT],
        cwd: sandbox,
        stdout: "piped",
        stderr: "piped",
      });
      const saida = await proc.output();
      assertEquals(saida.code, 0);
      const stdout = new TextDecoder().decode(saida.stdout);
      assertStringIncludes(stdout, "::warning::");
      assertStringIncludes(stdout, "não existe");
    },
  );
});
