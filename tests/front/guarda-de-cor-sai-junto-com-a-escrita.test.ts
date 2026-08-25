// TRIPWIRE do acoplamento guarda x escrita de cor (condição da revisão
// 20260825-1255 para ACEITAR a guarda temporária do corPrimariaEfetiva).
//
// O contrato, nas duas direções:
//   1. ENQUANTO nenhum caminho do app escrever `primaryColor`, a guarda
//      ("#000000 do banco → semente do build") TEM de existir — ela fecha a
//      janela "código deployado antes da migration no banco".
//   2. No dia em que uma escrita surgir (tela de escolher cor, pedido 004),
//      a guarda tem de SAIR JUNTO com ela — preto volta a ser escolha de
//      lojista, e o teste (e) de cor-da-loja-vem-do-banco INVERTE.
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

// Arquivos onde `primaryColor` aparece como LEITURA, declaração de tipo ou
// construção da config a partir do banco — não são caminhos de ESCRITA pelo
// usuário. Novo uso legítimo de leitura? Adicione aqui COM o motivo.
const LEITURAS_CONHECIDAS: Record<string, string> = {
  "src/config/cor-da-loja.ts": "a guarda em si + o default sem reserva",
  "src/contexts/StoreContext.tsx": "lê do banco (mapConfig) e aplica em runtime",
  "src/types/index.ts": "declaração do tipo (primaryColor?: string)",
  "src/views/admin/AdminBannersView.tsx": "lê config.primaryColor como sugestão de paleta",
  "src/config/branding.ts": "declarações do branding de build (tipos/leitura da semente)",
  "src/lib/realtimeSyncEngine.ts": "destrutura primaryColor para LEITURA do cache offline",
  "src/types/database.types.ts": "declaração do schema do banco (tipos gerados)",
  "src/types/supabase.ts": "declaração do schema do banco (tipos gerados)",
};

// Padrões que indicam ESCRITA: chave em objeto (primaryColor: v), atribuição
// (primaryColor =) e shorthand (primaryColor,). E qualquer primary_color
// (snake) em src/ é payload de escrita direta no banco — hoje deve ser zero.
const PADRAO_ESCRITA = /\bprimaryColor\s*[:=]|\bprimaryColor\s*,|\bprimary_color\b/;

describe("acoplamento guarda x escrita de primaryColor (revisão 20260825-1255)", () => {
  it("a guarda existe enquanto (e somente enquanto) nenhuma escrita de cor existe", () => {
    const escritas: string[] = [];
    for (const [caminhoAbsoluto, texto] of Object.entries(FONTES)) {
      const relativo = caminhoAbsoluto.replace(/^\/src\//, "src/");
      if (LEITURAS_CONHECIDAS[relativo]) continue;
      if (PADRAO_ESCRITA.test(texto)) {
        escritas.push(relativo);
      }
    }

    if (escritas.length > 0) {
      throw new Error(
        `Escrita de primaryColor surgiu em: ${escritas.join(", ")}. ` +
          "A guarda temporária do corPrimariaEfetiva (#000000 → semente) " +
          "precisa SAIR JUNTO com esta escrita — preto passa a ser escolha " +
          "de lojista. Remova a comparação em src/config/cor-da-loja.ts " +
          "(bloco SOBRE #000000) e INVERTA o teste (e) de " +
          "cor-da-loja-vem-do-banco.test.tsx. Depois atualize a whitelist " +
          "deste tripwire com o novo caminho de escrita.",
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
