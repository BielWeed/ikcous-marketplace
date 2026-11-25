// Ajustes mostra, sob o título de cada grupo, uma linha de status calculada por
// `subtitulosDosGrupos` (a mesma regra dos seis passos do Início). Os testes de
// tela já cobrem o caminho comum; aqui ficam as fronteiras que só a função
// pura alcança de forma barata:
//   - "Falta: corrigir a faixa de CEP" (CEP completo + alcance escrito sem
//     número) não podia ser confundido com "Falta: CEP da loja" (sem CEP);
//   - leitura das transportadoras que ainda não chegou (`nomesLigados: null`):
//     com cobertura nacional a entrega fica SEM subtítulo (string vazia, nada de
//     "a confirmar"), e só quando a loja atende apenas a cidade o resumo local
//     aparece mesmo sem a leitura;
//   - o passo "Como você recebe" NÃO entra na conta de "Minha loja": loja com
//     marca, endereço e WhatsApp preenchidos diz "Tudo preenchido" mesmo sem
//     forma de receber (quem avisa disso é o grupo Pagamentos);
//   - só três grupos têm subtítulo.
import {
  type NivelDoPixEmAjustes,
  subtitulosDosGrupos,
} from "@/components/admin/settings/grupos-de-ajustes";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { describe, expect, it } from "vitest";

type Entrada = Parameters<typeof subtitulosDosGrupos>[0];

const CEP_DE_RUA = "30130-010";
const ALCANCE_DA_CIDADE = "30000-000, 31999-999";

const ENDERECO = montarEnderecoDaLoja({
  cep: "30130010",
  rua: "Avenida Afonso Pena",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
});

function subtitulos(
  config: Record<string, unknown> = {},
  resto: {
    formasNaEntrega?: readonly string[];
    nivelDoPix?: NivelDoPixEmAjustes;
    nomesLigados?: readonly string[] | null;
  } = {},
) {
  const entrada = {
    config: {
      storeName: "Ateliê da Serra",
      logoUrl: "https://exemplo.test/logo.png",
      whatsappNumber: "(31) 99999-9999",
      originCep: ENDERECO.originCep,
      storeAddress: ENDERECO.storeAddress,
      localCepRange: ALCANCE_DA_CIDADE,
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
    formasNaEntrega: resto.formasNaEntrega ?? ["cash"],
    nivelDoPix: resto.nivelDoPix ?? "ok",
    nomesLigados: resto.nomesLigados === undefined ? [] : resto.nomesLigados,
  } as unknown as Entrada;
  return subtitulosDosGrupos(entrada);
}

describe("subtitulosDosGrupos — a pendência da faixa de CEP", () => {
  it("CEP completo + alcance escrito sem nenhum número: 'Falta: corrigir a faixa de CEP'", () => {
    expect(
      subtitulos({ originCep: CEP_DE_RUA, localCepRange: "abc" }).get(
        "entrega",
      ),
    ).toBe("Falta: corrigir a faixa de CEP");
    expect(
      subtitulos({ originCep: CEP_DE_RUA, localCepRange: " , , " }).get(
        "entrega",
      ),
    ).toBe("Falta: corrigir a faixa de CEP");
  });

  it("SEM CEP a pendência continua sendo o CEP, mesmo com o alcance escrito sem número", () => {
    for (const originCep of ["", null, undefined, "3013"]) {
      expect(
        subtitulos({ originCep, localCepRange: "abc" }).get("entrega"),
        String(originCep),
      ).toBe("Falta: CEP da loja");
    }
  });

  it("sem CEP e sem alcance: 'Falta: CEP da loja'", () => {
    expect(
      subtitulos({ originCep: "", localCepRange: "" }).get("entrega"),
    ).toBe("Falta: CEP da loja");
  });
});

describe("subtitulosDosGrupos — a leitura das transportadoras ainda não chegou", () => {
  it("cobertura nacional (ou sem cobertura gravada) + leitura pendente: o grupo existe, mas o subtítulo é vazio", () => {
    for (const shippingCoverage of ["national", undefined, ""]) {
      const mapa = subtitulos({ shippingCoverage }, { nomesLigados: null });
      expect(mapa.has("entrega"), String(shippingCoverage)).toBe(true);
      expect(mapa.get("entrega"), String(shippingCoverage)).toBe("");
    }
  });

  it("só na cidade + leitura pendente: o resumo local aparece mesmo assim", () => {
    expect(
      subtitulos({ shippingCoverage: "local" }, { nomesLigados: null }).get(
        "entrega",
      ),
    ).toBe("R$ 10 por entrega · Só na sua cidade");
  });

  it("cobertura nacional com a leitura feita e nenhuma transportadora ligada: o resumo vem completo", () => {
    const texto = subtitulos(
      { shippingCoverage: "national" },
      { nomesLigados: [] },
    ).get("entrega");
    expect(texto).toMatch(/^R\$ 10 por entrega · .+/);
    expect(texto).not.toBe("");
  });

  it("com uma transportadora ligada o nome dela entra depois do resumo local", () => {
    const texto = subtitulos(
      { shippingCoverage: "national" },
      { nomesLigados: ["Frenet"] },
    ).get("entrega");
    expect(texto).toBe("R$ 10 por entrega · Frenet ligado");
  });
});

describe("subtitulosDosGrupos — o que entra na conta de cada grupo", () => {
  it("'Minha loja' não olha 'Como você recebe': tudo preenchido, mesmo sem forma de receber", () => {
    const mapa = subtitulos({}, { formasNaEntrega: [], nivelDoPix: "off" });
    expect(mapa.get("minha-loja")).toBe("Tudo preenchido");
    expect(mapa.get("pagamentos")).toBe("Falta: Como você recebe");
  });

  it("'Minha loja' lista só o que é dela, na ordem dos passos", () => {
    const mapa = subtitulos(
      { storeName: "", logoUrl: "", storeAddress: "", whatsappNumber: "" },
      { formasNaEntrega: [], nivelDoPix: "off" },
    );
    expect(mapa.get("minha-loja")).toBe(
      "Falta: Nome e logo, Endereço, WhatsApp",
    );
  });

  it("nome sem logo (ou logo sem nome) ainda falta 'Nome e logo'", () => {
    expect(subtitulos({ logoUrl: "   " }).get("minha-loja")).toBe(
      "Falta: Nome e logo",
    );
    expect(subtitulos({ storeName: "  " }).get("minha-loja")).toBe(
      "Falta: Nome e logo",
    );
  });

  it("só 'minha-loja', 'entrega' e 'pagamentos' têm subtítulo; os outros três grupos ficam sem", () => {
    const chaves = [...subtitulos().keys()].sort();
    expect(chaves).toEqual(["entrega", "minha-loja", "pagamentos"]);
    expect(subtitulos().has("aparencia")).toBe(false);
    expect(subtitulos().has("devolucao")).toBe(false);
    expect(subtitulos().has("ferramentas")).toBe(false);
  });

  it("Pagamentos: PIX sozinho, PIX + entrega, entrega sozinha e PIX sem chave", () => {
    expect(
      subtitulos({}, { formasNaEntrega: [], nivelDoPix: "ok" }).get(
        "pagamentos",
      ),
    ).toBe("PIX");
    expect(
      subtitulos({}, { formasNaEntrega: ["cash"], nivelDoPix: "ok" }).get(
        "pagamentos",
      ),
    ).toBe("Na entrega + PIX");
    expect(
      subtitulos({}, { formasNaEntrega: ["cash"], nivelDoPix: "off" }).get(
        "pagamentos",
      ),
    ).toBe("Na entrega");
    expect(
      subtitulos({}, { formasNaEntrega: ["cash"], nivelDoPix: "alerta" }).get(
        "pagamentos",
      ),
    ).toBe("Na entrega · PIX sem chave");
  });

  it("PIX ligado sem chave e nada na entrega não é jeito de receber: 'Falta: Como você recebe'", () => {
    expect(
      subtitulos({}, { formasNaEntrega: [], nivelDoPix: "alerta" }).get(
        "pagamentos",
      ),
    ).toBe("Falta: Como você recebe");
  });
});
