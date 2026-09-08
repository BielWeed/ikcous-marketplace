// TRIPWIRE do acoplamento guarda x escrita de cor (condição da revisão
// 20260825-1255 para ACEITAR a guarda temporária do corPrimariaEfetiva;
// furos 1-3 corrigidos conforme a revisão 20260825-1315).
//
// O contrato, nas duas direções:
//   1. ENQUANTO nenhum caminho do app escrever `primaryColor`, a guarda
//      ("#000000 do banco → semente do build") TEM de existir — ela fecha a
//      janela "código deployado antes da migration no banco".
//   2. No dia em que uma escrita surgir (tela de escolher cor, pedido 004),
//      a guarda tem de SAIR JUNTO com ela — preto volta a ser escolha de
//      lojista, e o teste (e) de cor-da-loja-vem-do-banco INVERTE.
//
// DECISÃO REGISTRADA (02/09/2026, tela "Cor da loja" nos Ajustes): a
// escrita do item 2 SURGIU — updateConfig na AdminSettingsView, entrada
// nova na whitelist abaixo — e a guarda NÃO saiu, porque a tela RECUSA
// #000000 na escrita (validaCorDaLoja em src/config/cor-da-loja.ts, dono
// único da regra de cor). Ninguém grava preto pelo app → a invariante que
// sustentava a guarda continua de pé: preto no banco segue sendo resíduo
// de fábrica ou escrita manual, nunca escolha de lojista. A condição de
// saída REAL passou a ser: validaCorDaLoja parar de recusar preto — aí a
// guarda sai, o teste (e) de cor-da-loja-vem-do-banco inverte e esta
// entrada da whitelist é rebatizada de escrita sem guarda.
//
// Comentário não obriga ninguém (a lição da 1255): este teste é quem obriga.
// Ele falha nos DOIS descumprimentos — escrita sem tirar a guarda, guarda
// tirada sem escrita existir — com a mensagem dizendo o que fazer.
//
// O scan usa import.meta.glob ?raw (tempo de build do vitest), sem APIs de
// node — o tsconfig dos testes não tem tipos node e não se mexe em config
// compartilhada com frentes ativas.
import { describe, expect, it } from "vitest";

import { corPrimariaEfetiva } from "@/config/cor-da-loja";

const FONTES = import.meta.glob<string>("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Padrões que indicam ESCRITA (ou forma ambígua que merece revisão):
//   - `primaryColor:` chave de objeto, `primaryColor =` atribuição;
//   - shorthand com OU sem vírgula — `{ primaryColor }` e
//     `{ ...config, primaryColor }` são as formas mais prováveis de um
//     handler de React nascer (furo 1 da 1315: exigir vírgula escapava
//     exatamente as duas mais prováveis);
//   - qualquer `primary_color` (snake) em src/ é payload de escrita direta
//     no banco — hoje deve ser zero.
// O lookbehind `(?<!\.)` exclui leitura com ponto (`config.primaryColor`),
// e o lookahead não casa os terminadores de leitura (`)`, `.`).
// A flag `g` NÃO é detalhe (furo 2 vivo, canal #73): sem ela o `match`
// devolve no máximo UM resultado e a contagem vira 0/1 — os números
// esperados ficam decorativos, desconectados da comparação, e nenhum
// arquivo listado dispara por mais escrita que apareça nele.
// ARMADILHA FUTURA (canal #75): regex com `g` guarda `lastIndex` — se este
// MESMO objeto um dia for usado com `.test()` ou `.exec()`, o resultado
// alterna entre verdadeiro e falso a cada chamada. Este arquivo usa só
// `String.match` (que ignora `lastIndex`), e é assim que tem de ficar.
const PADRAO_ESCRITA =
  /(?<!\.)\bprimaryColor\s*(?=[:=,}\s]|$)|\bprimary_color\b/g;

// Ocorrências ESPERADAS por arquivo, todas medidas com o padrão acima em
// 25/08 (furo 2 da 1315: whitelist por arquivo INTEIRO escondia 27
// ocorrências, 10 delas no próprio StoreContext — o caminho de escrita).
// Ocorrência NOVA ou REMOVIDA em arquivo listado = o teste CAI e alguém
// decide (a contagem é bidirecional desde a revisão final de 25/08):
//   - é LEITURA legítima? atualiza o `n` aqui com o motivo;
//   - é ESCRITA? tira a guarda do corPrimariaEfetiva junto com ela e
//     INVERTE o teste (e) de cor-da-loja-vem-do-banco.
const LEITURAS_CONHECIDAS: Record<string, { n: number; porque: string }> = {
  "src/contexts/StoreContext.tsx": {
    n: 10,
    porque:
      "lê do banco (mapConfig) e aplica em runtime — inclusive updateConfig",
  },
  "src/types/database.types.ts": {
    n: 9,
    porque:
      "declaração do schema do banco (tipos gerados) — regen 04/09: +_retrato_primary_color_20260980 (tabela do retrato, migration 20260980 já aplicada no banco vivo), 3× Row/Insert/Update",
  },
  "src/types/supabase.ts": {
    n: 6,
    porque: "declaração do schema do banco (tipos gerados)",
  },
  "src/lib/realtimeSyncEngine.ts": {
    n: 2,
    porque: "destrutura primaryColor para LEITURA do cache offline",
  },
  "src/config/cor-da-loja.ts": {
    n: 1,
    porque: "a guarda em si + o default sem reserva",
  },
  "src/views/admin/AdminBannersView.tsx": {
    n: 1,
    porque:
      "lê config.primaryColor como sugestão de paleta (tem seletor: ligá-lo ao primaryColor conta como NOVA e cai aqui)",
  },
  "src/views/admin/AdminSettingsView.tsx": {
    n: 1,
    porque:
      "única ESCRITA do app (tela Cor da loja, pedido 004, 02/09) — recusa #000000 via validaCorDaLoja, então a guarda de leitura permanece; ver DECISÃO REGISTRADA no topo",
  },
  "src/config/branding.ts": {
    n: 1,
    porque: "declarações do branding de build (tipos/leitura da semente)",
  },
  "src/types/index.ts": {
    n: 0,
    porque:
      "tipo opcional (primaryColor?: string) — o `?` não casa o padrão; zero esperado",
  },
};

describe("acoplamento guarda x escrita de primaryColor (revisões 1255 + 1315)", () => {
  it("a varredura não é vazia (furo 3 da 1315: verde compatível com glob vazio não é evidência)", () => {
    // Hoje: 198 arquivos .ts/.tsx em src/. Se o glob um dia devolver vazio
    // (mudança de root do vite, padrão do glob, migração do ?raw), a direção
    // 1 morreria sem sinal — esta linha transforma "a sabotagem provou uma
    // vez" em "o teste prova toda rodada".
    expect(Object.keys(FONTES).length).toBeGreaterThan(150);
  });

  it("a guarda existe enquanto (e somente enquanto) nenhuma escrita de cor existe", () => {
    const problemas: string[] = [];
    for (const [caminhoAbsoluto, texto] of Object.entries(FONTES)) {
      const relativo = caminhoAbsoluto.replace(/^\/src\//, "src/");
      const achados = texto.match(PADRAO_ESCRITA)?.length ?? 0;
      // Chave vem do glob local das fontes do repo, não de entrada de
      // usuário — injeção por aqui é impossível por construção.
      // eslint-disable-next-line security/detect-object-injection
      const esperado = LEITURAS_CONHECIDAS[relativo]?.n ?? 0;
      // Bidirecional (revisão final de 25/08): comparar só `>` deixa uma
      // leitura que SUMIU num refactor baixar o real sem baixar o n — vagas
      // grátis para escrita nova entrar calada depois.
      if (achados !== esperado) {
        problemas.push(
          `${relativo}: ${achados} ocorrência(s) do padrão, esperava ${esperado}`,
        );
      }
    }

    if (problemas.length > 0) {
      throw new Error(
        `Escrita de primaryColor surgiu (ou a contagem do arquivo MUDOU — pra mais ou pra menos): ${problemas.join("; ")}. Se for LEITURA legítima, atualize o n em LEITURAS_CONHECIDAS com o motivo. Se for ESCRITA: a guarda temporária do corPrimariaEfetiva (#000000 → semente) precisa SAIR JUNTO com ela — preto passa a ser escolha de lojista. Remova a comparação em src/config/cor-da-loja.ts (bloco SOBRE #000000) e INVERTA o teste (e) de cor-da-loja-vem-do-banco.test.tsx. Depois atualize a whitelist deste tripwire com o novo caminho de escrita.`,
      );
    }

    // Sem escrita → a guarda TEM de existir (fecha a janela do deploy antes
    // da migration). Se alguém removê-la "porque a migration resolve", este
    // braço cai primeiro — a migration não protege a janela, a guarda protege.
    expect(corPrimariaEfetiva({ primaryColor: "#000000" } as never)).toBeNull();
    expect(corPrimariaEfetiva({ primaryColor: "#059669" } as never)).toBe(
      "#059669",
    );
  });
});
