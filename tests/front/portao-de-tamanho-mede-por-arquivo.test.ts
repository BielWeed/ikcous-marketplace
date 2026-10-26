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
  it("as entradas de JS (cliente e painel) medem por arquivo e sem medida de tempo", () => {
    for (const ancora of ["cliente.map(", "painel.map("]) {
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

  it("os tetos de JS são os fixados: cliente 584 kB, painel 490 kB", () => {
    // Se algum PR precisar mexer num teto, que seja explícito AQUI: mudar o
    // número quebra este teste de propósito. Painel 450 -> 455 em 15/10/2026
    // (lote da noite: 39 ajustes de tela juntos) e 455 -> 460 no mesmo dia
    // (integração dos lotes de banco 36 a 41, PR #885) e 460 -> 464,5 ao juntar
    // a base com o lote 4 (PR #883) e 464,5 -> 466 no lote R1 do reembolso e 466 -> 467 em 16/10/2026 e 467 -> 471 -> 472 em 17/10/2026 (ultima subida, redesenho do painel)
    // (chave anti-duplicação do lançamento financeiro, PR #981);
    // cliente 552 -> 556 em 21/10/2026 (cards compactos novos, aprovado pelo dono);
    // cliente 556 -> 560 em 22/10/2026 (redesenho da tela de produto, aprovado pelo dono);
    // painel 472 -> 476 em 22/10/2026 (telas pedidas do painel, lote 1.5.53, autorizado pelo dono);
    // cliente 560 -> 564 em 22/10/2026 (telas pedidas da 1.5.54: Finalizar, ofertas laterais, icones; regra do dono);
    // cliente 564 -> 568 em 23/10/2026 (1.5.55: medido 564,27 kB, nota da versao e ruido de hash; regra do dono);
    // cliente 568 -> 572 em 23/10/2026 (1.5.60: Perfil redesenhado e carrinho por variacao; regra do dono);
    // cliente 572 -> 576 em 23/10/2026 (1.5.62: sete telas no estilo Tinta; medido 572,28 kB; regra do dono);
    // painel 476 -> 480 em 24/10/2026 (1.5.65: folhas do Financeiro, Caixa na frente e barra do painel; medido 476,02 kB no CI do merge; regra do dono);
    // painel 480 -> 484 em 25/10/2026 (1.5.73: grade de variacoes explica cor e tamanho juntos; medido 480,36 kB; regra do dono);
    // cliente 576 -> 580 em 25/10/2026 (1.5.74: acessibilidade da loja; medido 576,02 kB; regra do dono);
    // painel 484 -> 488 em 26/10/2026 (1.5.79: categoria em galeria e correcoes da tela de produto; medido 484,02 kB; regra do dono);
    // cliente 580 -> 584 em 26/10/2026 (1.5.80: setas e icones certos; medido 580,05 kB no CI; regra do dono);
    // painel 488 -> 490 em 26/10/2026 (lote de correcoes do painel #1134 e tela de produto #1131; medido 488,31 kB; regra do dono);
    // ver comentário no `.size-limit.cjs`.
    expect(entrada("cliente.map(")).toContain('limit: "584 kB"');
    expect(entrada("painel.map(")).toContain('limit: "490 kB"');
    expect(configTexto).not.toContain('limit: "800 kB"');
  });
});
