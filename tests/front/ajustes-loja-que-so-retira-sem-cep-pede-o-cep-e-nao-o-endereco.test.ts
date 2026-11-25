// Caça por mutação (25/11/2026), subtítulo do grupo "Entrega" em Ajustes.
// "Falta: endereço da loja" é a pendência de quem SÓ RETIRA (entrega própria
// desligada) e já tem o CEP. Quem só retira e ainda não informou o CEP tem de
// ver "Falta: CEP da loja". O teste de tela provava o primeiro caso e o das
// fronteiras provava "sem CEP" só com a entrega própria ligada; ninguém juntava
// "só retira" com "sem CEP", então tirar a condição "tem CEP" passava.
import { subtitulosDosGrupos } from "@/components/admin/settings/grupos-de-ajustes";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { describe, expect, it } from "vitest";

type Entrada = Parameters<typeof subtitulosDosGrupos>[0];

const ENDERECO = montarEnderecoDaLoja({
  cep: "30130010",
  rua: "Avenida Afonso Pena",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
});

function entrega(config: Record<string, unknown>) {
  const entrada = {
    config: {
      storeName: "Ateliê da Serra",
      logoUrl: "https://exemplo.test/logo.png",
      whatsappNumber: "(31) 99999-9999",
      originCep: ENDERECO.originCep,
      storeAddress: ENDERECO.storeAddress,
      localCepRange: "30000-000, 31999-999",
      freeShippingMin: 0,
      localDeliveryFee: 10,
      shippingCoverage: "local",
      storeCity: "Belo Horizonte",
      storeState: "MG",
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
      ...config,
    },
    formasNaEntrega: ["cash"],
    nivelDoPix: "ok",
    nomesLigados: [],
  } as unknown as Entrada;
  return subtitulosDosGrupos(entrada).get("entrega");
}

describe("subtitulosDosGrupos: loja que só retira (entrega própria desligada)", () => {
  it("sem CEP da loja: 'Falta: CEP da loja', não o endereço", () => {
    expect(
      entrega({ localDeliveryEnabled: false, originCep: "", storeAddress: "" }),
    ).toBe("Falta: CEP da loja");
    expect(
      entrega({
        localDeliveryEnabled: false,
        originCep: null,
        storeAddress: "",
      }),
    ).toBe("Falta: CEP da loja");
  });

  it("com CEP completo e sem endereço conferido: 'Falta: endereço da loja'", () => {
    expect(
      entrega({
        localDeliveryEnabled: false,
        originCep: "30130-010",
        storeAddress: "",
      }),
    ).toBe("Falta: endereço da loja");
  });
});
