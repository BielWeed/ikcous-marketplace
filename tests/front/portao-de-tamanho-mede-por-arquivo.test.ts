// O PORTÃO DE TAMANHO MEDE POR ARQUIVO — frente tooling, tarefa
// size-limit-16 (A12.2 do plano; decisão D8 do dono: NÃO mudar o teto de
// 800 kB, corrigir a medida).
//
// O DEFEITO: a entrada de JS do `.size-limit.cjs` não passava `webpack:
// false` (a de CSS passava). Sem isso o size-limit jogava os ~107 chunks
// num projeto webpack vazio, re-minificava e comprimia UMA VEZ em brotli —
// medindo o bundle FUNDIDO (606 kB) enquanto o que o CDN entrega de verdade
// são respostas brotli independentes por arquivo (~777 kB somados). São 170
// kB de "folga" que não existem: o portão aprovava no papel uma biblioteca
// nova de leitor de código de barras que, na entrega real, estouraria o teto.
//
// POR QUE O TESTE LÊ O ARQUIVO E NÃO RODA O SIZE: `npm run size` exige um
// build completo antes (minutos) e o CI já o roda como job próprio — o que
// este teste trava permanentemente é a FORMA da medida (por arquivo, sem
// webpack, sem medida de tempo) e o TETO (800 kB, decisão D8; abaixar ou
// subir o teto é outro PR, com número medido no CI, e quebra este teste de
// propósito).
//
// 26/09/2026 — decisão do dono ("dividir o portão", depois "Painel 450 ·
// cliente 550"): o teto único de 800 kB virou DOIS, classificados pelo grafo
// real do Rollup (`scripts/portaoDividido.ts`): o JS que qualquer visitante
// pode baixar (cliente, 550 kB) e o JS que só existe atrás do `is_admin`
// (painel, 450 kB). A forma da medida continua a mesma: por arquivo, sem
// webpack, sem medida de tempo.
//
// 29/09/2026 — decisão do dono (em voz): acrescentado o terceiro orçamento
// `opcional` (250 kB) para chunks SOB DEMANDA (allowlist restrita ao
// `assets/maplibre-gl-*`, o renderer do mapa vetorial). Os tetos de cliente
// e painel NÃO mudaram — este teste continua derrubando mudança neles.
//
// 13/10/2026 — decisão do dono de 12/10/2026 (onda 2 da PR #712): o worker
// do MapLibre (asset `.js` que o Vite emite à parte, ~116 kB brotli) ganhou
// orçamento PRÓPRIO, `workerDoMapa` (130 kB). NENHUM teto existente subiu:
// 550 cliente, 450 painel, 250 opcional, 100 CSS, 400 leitor zxing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const configTexto = readFileSync(".size-limit.cjs", "utf-8");

/** Recorta o objeto de configuração que contém a âncora (do `{` da linha
 * dele até o `}` que o fecha) — sem regex, porque o path é template
 * literal (`${output}`) e as chaves do placeholder confundem qualquer
 * `[^{}]*`. */
function entrada(ancora: string): string {
  const meio = configTexto.indexOf(ancora);
  expect(meio).toBeGreaterThan(-1);
  const inicio = configTexto.lastIndexOf("{", meio);
  const fim = configTexto.indexOf("},", meio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(meio);
  return configTexto.slice(inicio, fim);
}

describe(".size-limit.cjs — o portão mede o que o servidor entrega", () => {
  it("as entradas de JS (cliente, painel, opcional e worker do mapa) medem por arquivo e sem medida de tempo", () => {
    for (const ancora of [
      "cliente.map(",
      "painel.map(",
      "opcional.map(",
      "workerDoMapa.map(",
    ]) {
      const trechoJs = entrada(ancora);
      expect(trechoJs, ancora).toContain("webpack: false");
      // A medida de tempo roda o bundle em Chrome headless — quebra em runner
      // sem Chrome e não é o que o portão protege.
      expect(trechoJs, ancora).toContain("running: false");
    }
  });

  it("a entrada de CSS continua medindo por arquivo com o teto de 100 kB", () => {
    const trechoCss = entrada("assets/*.css");
    expect(trechoCss).toContain('limit: "100 kB"');
    expect(trechoCss).toContain("webpack: false");
  });

  it("os tetos de JS são os que o dono fixou: cliente 550 kB, painel 450 kB, opcional 250 kB, worker do mapa 130 kB, leitor 400 kB", () => {
    // Se algum PR precisar mexer num teto, que seja explícito AQUI: mudar o
    // número quebra este teste de propósito. (29/09/2026: o 250 kB do
    // `opcional` é o orçamento novo do chunk de mapa sob demanda — os
    // números de cliente e painel são os mesmos de 26/09. 13/10/2026: o
    // 130 kB do worker é orçamento NOVO; nenhum dos outros subiu.)
    expect(entrada("cliente.map(")).toContain('limit: "550 kB"');
    expect(entrada("painel.map(")).toContain('limit: "450 kB"');
    expect(entrada("opcional.map(")).toContain('limit: "250 kB"');
    expect(entrada("workerDoMapa.map(")).toContain('limit: "130 kB"');
    expect(entrada("assets/leitor-zxing-*.js")).toContain('limit: "400 kB"');
    expect(configTexto).not.toContain('limit: "800 kB"');
  });

  it("não existe teto além dos seis fixados (um sétimo, mais frouxo, esconderia bytes)", () => {
    // Contar TODOS os `limit:` do arquivo fecha a porta lateral: mover um
    // arquivo para uma entrada nova com teto folgado não muda nenhum dos
    // números acima, mas muda esta lista.
    const tetos = [...configTexto.matchAll(/limit:\s*"([^"]+)"/g)].map(
      (achado) => achado[1],
    );
    expect([...tetos].sort()).toEqual(
      ["550 kB", "450 kB", "250 kB", "130 kB", "100 kB", "400 kB"].sort(),
    );
  });
});
