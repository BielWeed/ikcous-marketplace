// @vitest-environment jsdom
//
// A barra de frete do carrinho (`estadoDaBarraDeFrete`, em
// `src/views/customer/CartView.tsx`) decide a frase de DINHEIRO que a cliente
// lê: "Liberado", "Meta Frete Grátis" (com "Faltam R$ ...") ou o aviso de que o
// grátis não vale para a opção escolhida. Os testes de tela cobrem a meta por
// valor; estas três bordas escapavam (achadas por mutação):
//
//  1. retirada na loja numa loja SEM meta por valor ("sempre" ou "por_produto"):
//     o `ehRetirada` NÃO pode empurrar para "meta" — a promessa do preset vale
//     e a função devolve "liberado" (o cartão fica escondido pelo portão
//     `deveExibirMetaDeFreteGratis`, mas a função não depende disso);
//  2. frete grátis garantido por OUTRO motivo com a meta por valor ainda não
//     batida e SEM retirada: é "liberado" — a regra do "Faltam R$ ..." só vale
//     para a retirada, onde o preço zero é natureza e não promessa;
//  3. preço da opção escolhida ainda indefinido (`null`): sem opção escolhida
//     não há o que "cobrar", então nunca sai "grátis só na mais barata" nem
//     "meta atingida sem grátis" (dizer isso sobre uma opção que não existe
//     seria inventar o aviso).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { estadoDaBarraDeFrete } from "@/views/customer/CartView";

type Args = Parameters<typeof estadoDaBarraDeFrete>[0];

function barra(
  sobrepor: Partial<Args>,
): ReturnType<typeof estadoDaBarraDeFrete> {
  return estadoDaBarraDeFrete({
    freteGratis: false,
    ehRetirada: false,
    estrategiaDoCanal: "acima_de_valor",
    minimoDoCanal: 100,
    nationalBenefitScope: "mais_barata",
    subtotal: 50,
    precoDaOpcaoEscolhida: 20,
    ...sobrepor,
  });
}

describe("estadoDaBarraDeFrete — retirada numa loja sem meta por valor", () => {
  it("grátis 'sempre' ou 'por_produto' com retirada escolhida: liberado (a promessa do preset é real)", () => {
    for (const estrategiaDoCanal of ["sempre", "por_produto"] as const) {
      expect(
        barra({
          estrategiaDoCanal,
          ehRetirada: true,
          freteGratis: true,
          minimoDoCanal: 0,
          subtotal: 10,
          precoDaOpcaoEscolhida: 0,
        }),
      ).toBe("liberado");
    }
  });

  it("controle: retirada com meta por valor ainda não batida NÃO comemora (o preço zero da retirada não conta)", () => {
    expect(
      barra({
        ehRetirada: true,
        freteGratis: true,
        subtotal: 99.99,
        precoDaOpcaoEscolhida: 0,
      }),
    ).toBe("meta");
  });

  it("controle: retirada com a meta por valor batida (no centavo exato) comemora", () => {
    expect(
      barra({
        ehRetirada: true,
        freteGratis: true,
        subtotal: 100,
        precoDaOpcaoEscolhida: 0,
      }),
    ).toBe("liberado");
  });
});

describe("estadoDaBarraDeFrete — loja sem meta por valor não inventa 'meta atingida'", () => {
  it("'sempre' ou 'por_produto' (mínimo 0) com a opção escolhida cobrando e sem grátis garantido: nunca diz que a meta foi atingida", () => {
    for (const estrategiaDoCanal of ["sempre", "por_produto"] as const) {
      for (const nationalBenefitScope of ["mais_barata", "todas"] as const) {
        const estado = barra({
          estrategiaDoCanal,
          nationalBenefitScope,
          freteGratis: false,
          minimoDoCanal: 0,
          subtotal: 80,
          precoDaOpcaoEscolhida: 12.9,
        });
        expect(estado).not.toBe("gratis_so_na_mais_barata");
        expect(estado).not.toBe("meta_atingida_sem_gratis");
      }
    }
  });
});

describe("estadoDaBarraDeFrete — grátis garantido sem a meta por valor batida, sem retirada", () => {
  it("meta por valor distante, mas o frete da opção escolhida já é grátis: liberado", () => {
    expect(
      barra({ freteGratis: true, subtotal: 30, precoDaOpcaoEscolhida: 0 }),
    ).toBe("liberado");
  });

  it("controle: sem grátis garantido e meta distante, segue na meta", () => {
    expect(barra({ freteGratis: false, subtotal: 30 })).toBe("meta");
  });
});

describe("estadoDaBarraDeFrete — preço da opção escolhida indefinido", () => {
  it("meta por valor batida e preço null: nunca afirma que a opção escolhida cobra", () => {
    for (const nationalBenefitScope of ["mais_barata", "todas"] as const) {
      for (const freteGratis of [true, false]) {
        const estado = barra({
          nationalBenefitScope,
          freteGratis,
          subtotal: 150,
          precoDaOpcaoEscolhida: null,
        });
        expect(estado).not.toBe("gratis_so_na_mais_barata");
        expect(estado).not.toBe("meta_atingida_sem_gratis");
      }
    }
  });

  it("preço null com grátis garantido e meta batida: liberado", () => {
    expect(
      barra({ freteGratis: true, subtotal: 150, precoDaOpcaoEscolhida: null }),
    ).toBe("liberado");
  });

  it("controle: meta batida e a opção escolhida cobra: o alcance decide a frase", () => {
    expect(
      barra({
        subtotal: 150,
        precoDaOpcaoEscolhida: 12.9,
        nationalBenefitScope: "mais_barata",
      }),
    ).toBe("gratis_so_na_mais_barata");
    expect(
      barra({
        subtotal: 150,
        precoDaOpcaoEscolhida: 12.9,
        nationalBenefitScope: "todas",
      }),
    ).toBe("meta_atingida_sem_gratis");
  });
});
