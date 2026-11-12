// O PORTÃO DE TAMANHO MEDE POR ARQUIVO — frente tooling, tarefa
// size-limit-16 (A12.2 do plano; decisão D8 do dono: NÃO mudar o teto de
// 800 kB, corrigir a medida).
//
// O DEFEITO: a entrada de JS do `.size-limit.cjs` não passava `webpack:
// false` (a de CSS passava). Sem isso o size-limit jogava os ~107 chunks
// num projeto webpack vazio, re-minificava e comprimia UMA VEZ em brotli —
// medindo o bundle FUNDIDO (608 kB) enquanto o que o CDN entrega de verdade
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
      // Sem medida de tempo: ela roda o bundle em Chrome headless (quebra em
      // runner sem Chrome) e não é o que o portão protege. Como o plugin de
      // tempo saiu das dependências (ele puxava o `extract-zip`, alertas
      // altos do Dependabot), a chave `running` nem existe mais aqui.
      expect(trechoJs, ancora).not.toContain("running:");
    }
  });

  it("o plugin de tempo e o preset big-lib não voltam às dependências", () => {
    const pacote = JSON.parse(readFileSync("package.json", "utf-8")) as {
      devDependencies: Record<string, string>;
    };
    expect(pacote.devDependencies).not.toHaveProperty("@size-limit/time");
    expect(pacote.devDependencies).not.toHaveProperty(
      "@size-limit/preset-big-lib",
    );
    // `webpack: false` só é aceito pelo size-limit com o plugin instalado.
    expect(pacote.devDependencies).toHaveProperty("@size-limit/webpack");
    expect(pacote.devDependencies).toHaveProperty("@size-limit/file");
  });

  it("a entrada de CSS continua medindo por arquivo com o teto de 100 kB", () => {
    const trechoCss = entrada("assets/*.css");
    expect(trechoCss).toContain('limit: "100 kB"');
    expect(trechoCss).toContain("webpack: false");
  });

  it("os tetos de JS são os fixados: cliente 656 kB, painel 534 kB", () => {
    // Se algum PR precisar mexer num teto, que seja explícito AQUI: mudar o
    // número quebra este teste de propósito. cliente 652 -> 656 e painel 530 -> 534 em 12/11/2026 (1.5.173; a base ficou sem folga e cada PR novo reprovava; regra do dono: o teto sobe).
    // Painel 450 -> 455 em 15/10/2026
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
    // cliente 594 -> 596 e painel 495 -> 496 em 28/10/2026 (1.5.96, Caça 13; medido 594,57 e 495,31 kB; regra do dono);
    // cliente 596 -> 598 em 30/10/2026 (1.5.102, vitrine no celular; medido 597,01 kB no CI; regra do dono);
    // cliente 598 -> 599 em 31/10/2026 (1.5.106, banner do topo sem esmaecer e painel que revalida; medido 598,06 kB; regra do dono);
    // cliente 599 -> 600 em 02/11/2026 (1.5.111, correcoes da caca e a nota da versao; medido 599,1 kB no CI; regra do dono);
    // cliente 600 -> 601 em 03/11/2026 (1.5.112, correcoes da segunda caca; medido 600,28 kB; regra do dono);
    // cliente 601 -> 602 em 03/11/2026 (1.5.113, correcoes do CEP, devolucoes, balcao e pedidos; medido 601,13 kB; regra do dono);
    // cliente 602 -> 603 em 04/11/2026 (1.5.116, correcoes da caca; medido 602,37 kB no CI; regra do dono);
    // cliente 603 -> 604 e painel 501 -> 502 em 04/11/2026 (1.5.117, correcoes da segunda caca; medido 602,92 e 500,96 kB no build local; regra do dono);
    // cliente 604 -> 605 em 04/11/2026 (1.5.118, favoritos, carrinho entre abas e conta; medido 603,8 kB no build local; regra do dono);
    // cliente 605 -> 606 em 04/11/2026 (1.5.120, enderecos, balcao, busca e frete gratis; medido 605,14 kB no build local; regra do dono);
    // cliente 606 -> 607 em 04/11/2026 (1.5.122, ordem fixa de tamanhos e cores; medido 606,27 kB no build local; regra do dono);
    // cliente 607 -> 608 em 05/11/2026 (1.5.125, estoque baixo abre Produtos filtrado; medido 607,06 kB no build local; regra do dono);
    // painel 502 -> 503 em 04/11/2026 (1.5.121, pedidos do painel; medido 502,11 kB no build local; regra do dono);
    // cliente 608 -> 609 em 05/11/2026 (1.5.130, resumo do catálogo lido por chave; medido 608,05 kB no build local; regra do dono);
    // painel 503 -> 504 em 05/11/2026 (1.5.130, colar valor, balcão e Pagar e receber; medido 502,99 kB no build local; regra do dono);
    // cliente 609 -> 610 e painel 504 -> 506 em 05/11/2026 (1.5.135, painel e vitrine não dizem "falta" quando a leitura da loja falha, aviso de anotação não salva e motivo do prazo de devolução; medidos 609,2 e 505,27 kB no build local; regra do dono);
    // cliente 610 -> 613 e painel 506 -> 507 em 06/11/2026 (1.5.136, lote de correções da caça 22; medidos 612,42 e 506,55 kB no build local; regra do dono);
    // cliente 613 -> 614 e painel 507 -> 509 em 06/11/2026 (1.5.137, lote de correções da caça 22; medidos 613,3 e 508,03 kB no build local; regra do dono);
    // cliente 614 -> 615 em 06/11/2026 (1.5.139; medido 614,21 kB no build local; regra do dono; painel segue 509);
    // cliente 615 -> 617 em 06/11/2026 (1.5.140; medido 616,35 kB no build local; regra do dono; painel segue 509);
    // cliente 617 -> 619 e painel 509 -> 511 em 06/11/2026 (1.5.141; medidos 617,94 e 509,17 kB no build local; regra do dono);
    // cliente 619 -> 622 em 06/11/2026 (1.5.143; medido 620,64 kB no build local; regra do dono; painel segue 511, medido 510,35);
    // ver comentário no `.size-limit.cjs`.
    // cliente 622 -> 625 e painel 511 -> 513 em 06/11/2026 (1.5.144; medidos 623,12 e 511,45 kB no build local; regra do dono);
    // cliente 625 -> 628 em 06/11/2026 (1.5.146; medido 626,36 kB no build local; regra do dono; painel segue 513, medido 512,66);
    // cliente 628 -> 631 e painel 513 -> 515 em 06/11/2026 (1.5.147; medidos 628,71 e 513,51 kB no build local; regra do dono);
    // cliente 633 -> 635 e painel 518 -> 519 em 07/11/2026 (1.5.151; medidos 632,65 e 517,80 kB no build local; regra do dono);
    // cliente 631 -> 633 em 07/11/2026 (1.5.150; o commit de juncao mediu 631,07 kB; regra do dono);
    // painel 515 -> 518 em 06/11/2026 (1.5.148; medido 515,05 kB no build local; cliente segue 631, medido 629,18; regra do dono);
    // cliente 635 -> 638 e painel 519 -> 522 em 07/11/2026 (1.5.153; medidos 636,67 e 520,37 kB no build local; regra do dono);
    // cliente 643 -> 646 e painel 526 -> 530 em 08/11/2026 (1.5.158; o PR mediu 643,26 kB no CI e o painel 525,62 kB; regra do dono);
    // cliente 648 -> 652 em 10/11/2026 (1.5.165; o CI mediu 648,07 kB num PR so de teste, base ja no teto e ruido entre builds; regra do dono: o teto sobe, 4 kB de uma vez);
    // cliente 647 -> 648 em 10/11/2026 (evento de cancelamento durante a leitura de pedidos; o PR mediu 647,01 kB no CI, 10 B acima; regra do dono: o teto sobe);
    // cliente 646 -> 647 em 09/11/2026 (aviso honesto do reenvio de comprovante; o PR passou 122 B de 646 kB no CI; regra do dono: o teto sobe);
    // cliente 641 -> 643 e painel 522 -> 526 em 07/11/2026 (1.5.156; medidos 642,05 e 524,49 kB no build local; regra do dono);
    // cliente 639 -> 641 em 07/11/2026 (1.5.155; medido 639,61 kB no build local; regra do dono; painel segue 522, medido 520,70);
    // cliente 638 -> 639 em 07/11/2026 (1.5.154; medido 638,01 kB no build local; regra do dono; painel segue 522, medido 520,28);
    expect(entrada("cliente.map(")).toContain('limit: "656 kB"');
    expect(entrada("painel.map(")).toContain('limit: "534 kB"');
    expect(configTexto).not.toContain('limit: "800 kB"');
  });
});
