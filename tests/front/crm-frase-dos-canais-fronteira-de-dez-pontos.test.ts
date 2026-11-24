// A frase do cartão "App × loja física" do CRM (achada por mutação em
// 24/11/2026, dois ramos que nenhum teste segurava):
//  - a diferença de EXATOS 10 pontos ainda é "quase igual" (55% × 45%); só
//    acima disso a frase nomeia quem vendeu mais;
//  - os dois percentuais da frase fecham 100: com 12,5% × 87,5% a loja física
//    é 87% (100 − 13), não 88% — senão a soma passa de 100 e a lojista confere
//    e acha erro de conta.
import { fraseLeituraDosCanais } from "@/lib/crm";
import type { CanalDoCrm } from "@/types/crm";
import { describe, expect, it } from "vitest";

const canal = (nome: string, receita: number): CanalDoCrm => ({
  canal: nome,
  receita,
  pedidos: receita > 0 ? 1 : 0,
  ticketMedio: receita,
});

describe("fraseLeituraDosCanais: fronteiras", () => {
  it("55% contra 45% (10 pontos de diferença) ainda é 'quase igual'", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 55), canal("presencial", 45)),
    ).toBe("App e loja física dividem a receita quase igual neste período.");
    expect(
      fraseLeituraDosCanais(canal("online", 45), canal("presencial", 55)),
    ).toBe("App e loja física dividem a receita quase igual neste período.");
  });

  it("56% contra 44% (12 pontos) já nomeia quem vendeu mais", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 56), canal("presencial", 44)),
    ).toBe("O app fez 56% da receita do período.");
    expect(
      fraseLeituraDosCanais(canal("online", 44), canal("presencial", 56)),
    ).toBe("A loja física fez 56% da receita do período.");
  });

  it("os dois percentuais fecham 100 mesmo quando a fatia cai em meio ponto", () => {
    // App: 12,5% → 13. Loja física: 100 − 13 = 87 (não 88).
    expect(
      fraseLeituraDosCanais(canal("online", 1), canal("presencial", 7)),
    ).toBe("A loja física fez 87% da receita do período.");
  });
});
