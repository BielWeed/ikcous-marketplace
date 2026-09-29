// O RECHARTS NÃO ENTRA NO BOOT DO CLIENTE — frente tooling, tarefa
// vite-214 (A12.3 do plano).
//
// O DEFEITO: o `manualChunks` mandava `recharts|d3` para `vendor-charts`,
// mas não classificava o `clsx`. Sem regra, o Rollup funde o clsx no chunk
// do seu importador — e o recharts depende dele. Como `src/lib/utils.ts`
// importa clsx para montar o `cn()` usado em TODA a UI, o chunk de entrada
// passou a importar estaticamente o `vendor-charts`, e o Vite emite
// `<link rel="modulepreload">` para ele no index.html: 92 kB brotli de
// biblioteca de GRÁFICO para todo cliente da vitrine, no celular, em 3G,
// para entregar uma função de ~200 bytes que concatena className. Medido na
// época do achado: o boot cairia de 359,84 kB para 267,80 kB brotli (-25,6%).
//
// POR QUE O TESTE LÊ O vite.config.ts E NÃO O BUILD: o index.html do build
// muda de nome de chunk a cada versão de dependência, e um teste que exigisse
// "vendor-charts fora do modulepreload do dist" só rodaria depois de um
// build (minutos). A trava aqui é na REGRA — a única linha que decide o
// destino do clsx. Quem apagar a classificação do clsx (ou trocar por outra
// regra que o deixe sem destino próprio) reabre o defeito sem aviso: o
// fallback silencioso do Rollup funde o clsx de volta no chunk de quem o
// importa, e o primeiro importador pesado ganha o preload.
//
// A prova no ARTEFATO (build fixture, index.html sem modulepreload de
// vendor-charts, boot medido) ficou no relatório da tarefa; este teste é a
// trava permanente no repositório.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const configTexto = readFileSync("vite.config.ts", "utf-8");

describe("manualChunks — utilitários de className fora do chunk de gráficos", () => {
  it("clsx, tailwind-merge e class-variance-authority são classificados no vendor-ui-helpers", () => {
    // Recorta a regra do vendor-ui-helpers: do último `return "` antes dele
    // até o `return "vendor-ui-helpers"`. O destino do clsx é decidido por
    // ESTE bloco — classificar em outro vendor não vale (o vendor-ui-helpers
    // já é estático na entrada, então não nasce requisição nova).
    const fim = configTexto.indexOf('return "vendor-ui-helpers"');
    expect(fim).toBeGreaterThan(-1);
    // fim - 1: o próprio `return "vendor-ui-helpers"` começa com `return "` —
    // sem o -1, lastIndexOf devolve a MESMA ocorrência e a fatia sai vazia.
    const inicio = configTexto.lastIndexOf('return "', fim - 1);
    const regra = configTexto.slice(inicio, fim);
    for (const util of ["clsx", "tailwind-merge", "class-variance-authority"]) {
      expect(regra).toContain(`normalizedId.includes("${util}")`);
    }
  });

  it("a regra do clsx vem ANTES da regra do vendor-charts (a ordem é o que impede o fundimento)", () => {
    const clsxNaRegra = configTexto.indexOf('normalizedId.includes("clsx")');
    const charts = configTexto.indexOf('return "vendor-charts"');
    expect(clsxNaRegra).toBeGreaterThan(-1);
    expect(charts).toBeGreaterThan(-1);
    expect(clsxNaRegra).toBeLessThan(charts);
  });
});
