// @vitest-environment jsdom
//
// Prévia "Como fica para o cliente" (PreviaDoFrete): o que cada uma das três
// linhas (Entrega na sua região, Retirar na loja, Fora da sua região) diz em
// cada situação da loja, e os três botões de valor do pedido (R$ 100, 150 e
// 250). Caça por mutação (25/11/2026): os testes que já existiam cobriam o
// desconto com pedido mínimo, o prazo "no mesmo dia" e os casos de "só
// retirada"; trocar o valor que começa marcado, inverter o "aria-pressed",
// perder a taxa padrão de R$ 10 ou dizer que a loja vende fora quando a
// cobertura é só da cidade passava em branco.
//
// Mutantes equivalentes: nenhum entre os 35 plantados (todos eram observáveis).
import { PreviaDoFrete } from "@/components/admin/shipping/PreviaDoFrete";
import type { StoreConfig } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Loja que entrega na cidade E deixa retirar, com transportadora nacional. */
function loja(sobre: Record<string, unknown> = {}): StoreConfig {
  return {
    originCep: "38400-000",
    localDeliveryEnabled: true,
    localDeliveryFee: 10,
    localDeliveryDays: 2,
    shippingCoverage: "national",
    storeAddress: "Rua A, 10",
    freeShippingMin: 0,
    enabledShippingMethods: ["sedex", "store-pickup"],
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalBenefitScope: "mais_barata",
    ...sobre,
  } as unknown as StoreConfig;
}

interface Linha {
  detalhe: string;
  valor: string;
  nota: string;
}

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(
  config: StoreConfig,
  extras: {
    nomesLigados?: readonly string[] | null;
    pendente?: boolean;
    pagamentoPeloAppLigado?: boolean;
    promocaoNacionalComPagamento?: boolean;
    promocaoNacionalSemPagamento?: boolean;
  } = {},
) {
  const { nomesLigados = ["Frenet"], pendente = false, ...resto } = extras;
  act(() => {
    raiz.render(
      <PreviaDoFrete
        config={config}
        nomesLigados={nomesLigados}
        pendente={pendente}
        {...resto}
      />,
    );
  });
}

/** A linha cujo nome é exatamente `nome`, ou null se não foi desenhada. */
function linha(nome: string): Linha | null {
  const alvo = [...host.querySelectorAll("p")].find(
    (p) => p.textContent === nome,
  );
  if (!alvo) return null;
  const textos = [
    ...(alvo.closest("div.flex")?.querySelectorAll("p") ?? []),
  ].map((p) => p.textContent ?? "");
  // [nome, detalhe, valor, nota]
  return { detalhe: textos[1], valor: textos[2], nota: textos[3] };
}

const ENTREGA = "Entrega na sua região";
const RETIRADA = "Retirar na loja";
const FORA = "Fora da sua região";

function botoesDeValor(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="group"] button')];
}

describe("PreviaDoFrete: os botões de valor do pedido", () => {
  it("são R$ 100, R$ 150 e R$ 250, e o R$ 100 já começa marcado", () => {
    montar(loja());
    const botoes = botoesDeValor();
    expect(botoes.map((b) => b.textContent)).toEqual([
      "R$ 100",
      "R$ 150",
      "R$ 250",
    ]);
    expect(botoes.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("clicar marca só o escolhido e desmarca o anterior", async () => {
    montar(loja());
    await act(async () => botoesDeValor()[2].click());
    expect(botoesDeValor().map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    await act(async () => botoesDeValor()[1].click());
    expect(botoesDeValor().map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("a taxa da cidade acompanha o valor escolhido quando o frete grátis é 'acima de R$ 150'", async () => {
    montar(loja({ freeShippingMin: 150 }), { nomesLigados: ["Frenet"] });
    expect(linha(ENTREGA)?.valor).toBe("R$ 10");
    await act(async () => botoesDeValor()[1].click());
    expect(linha(ENTREGA)?.valor).toBe("Grátis");
    expect(linha(ENTREGA)?.nota).toBe("entrega grátis");
  });
});

describe("PreviaDoFrete: sem CEP e rodapé de pendência", () => {
  it("sem CEP completo, só avisa — sem botões e sem linhas", () => {
    montar(loja({ originCep: "384" }));
    expect(host.textContent).toContain(
      "A prévia aparece quando o CEP de onde você envia estiver cadastrado.",
    );
    expect(botoesDeValor()).toHaveLength(0);
    expect(linha(ENTREGA)).toBeNull();
    expect(linha(FORA)).toBeNull();
    expect(host.textContent).not.toContain("Quanto o cliente paga");
  });

  it("com CEP completo mostra o título e as linhas", () => {
    montar(loja());
    expect(host.textContent).toContain("Quanto o cliente paga num pedido de");
    expect(host.textContent).not.toContain("A prévia aparece quando");
    expect(linha(ENTREGA)).not.toBeNull();
  });

  it("o aviso 'Toque em Salvar' só aparece com a mudança pendente", () => {
    montar(loja(), { pendente: false });
    expect(host.textContent).not.toContain("Toque em Salvar");
    montar(loja(), { pendente: true });
    expect(host.textContent).toContain(
      "Prévia do que está na tela. Toque em Salvar para valer na loja.",
    );
  });
});

describe("PreviaDoFrete: Entrega na sua região e Retirar na loja", () => {
  it("entrega + retirada: as duas linhas, com a taxa e o prazo", () => {
    montar(loja({ localDeliveryFee: 15.5, localDeliveryDays: 3 }));
    expect(linha(ENTREGA)).toEqual({
      detalhe: "CEPs que começam com 38400",
      valor: "R$ 15,50",
      nota: "chega em 3 dias",
    });
    expect(linha(RETIRADA)).toEqual({
      detalhe: "Rua A, 10",
      valor: "Grátis",
      nota: "busca quando quiser",
    });
  });

  it("sem taxa gravada usa R$ 10; com taxa 0 diz 'Grátis' e 'entrega grátis'", () => {
    montar(loja({ localDeliveryFee: undefined }));
    expect(linha(ENTREGA)?.valor).toBe("R$ 10");
    montar(loja({ localDeliveryFee: 0 }));
    expect(linha(ENTREGA)?.valor).toBe("Grátis");
    expect(linha(ENTREGA)?.nota).toBe("entrega grátis");
  });

  it("prazo de 1 dia fica no singular e nunca vira 'no mesmo dia'", () => {
    montar(loja({ localDeliveryDays: 1 }));
    expect(linha(ENTREGA)?.nota).toBe("chega em 1 dia");
  });

  it("sem prazo gravado diz 1 dia; prazo 2 diz 'dias' no plural", () => {
    montar(loja({ localDeliveryDays: undefined }));
    expect(linha(ENTREGA)?.nota).toBe("chega em 1 dia");
    montar(loja({ localDeliveryDays: 2 }));
    expect(linha(ENTREGA)?.nota).toBe("chega em 2 dias");
  });

  it("'só produtos marcados' na cidade avisa que o grátis depende do produto", () => {
    montar(loja({ freeShippingMin: -1, nationalShippingStrategy: undefined }));
    expect(linha(ENTREGA)?.nota).toBe("grátis se tiver produto marcado");
    expect(linha(ENTREGA)?.valor).toBe("R$ 10");
  });

  it("só entrego (sem retirada): não desenha a linha de retirada", () => {
    montar(loja({ enabledShippingMethods: ["sedex"] }));
    expect(linha(ENTREGA)).not.toBeNull();
    expect(linha(RETIRADA)).toBeNull();
  });

  it("só retiro: não desenha a entrega na região, só a retirada", () => {
    montar(loja({ localDeliveryEnabled: false }));
    expect(linha(ENTREGA)).toBeNull();
    expect(linha(RETIRADA)).not.toBeNull();
  });

  it("retirada sem endereço da loja diz o que falta", () => {
    montar(loja({ storeAddress: "" }));
    expect(linha(RETIRADA)?.detalhe).toBe("Falta o endereço da loja");
  });
});

describe("PreviaDoFrete: Fora da sua região", () => {
  it("cobertura só da cidade: a loja não vende fora, nem que haja transportadora ligada", () => {
    montar(
      loja({ shippingCoverage: "local", enabledShippingMethods: ["sedex"] }),
      {
        nomesLigados: ["Frenet"],
      },
    );
    expect(linha(FORA)).toEqual({
      detalhe: "a loja não vende",
      valor: "Não vende",
      nota: "",
    });
  });

  it("transportadoras ainda sem confirmar (lista nula)", () => {
    montar(loja(), { nomesLigados: null });
    expect(linha(FORA)).toEqual({
      detalhe: "transportadoras sem confirmar",
      valor: "A confirmar",
      nota: "",
    });
  });

  it("nenhuma transportadora ligada: não compra", () => {
    montar(loja(), { nomesLigados: [] });
    expect(linha(FORA)).toEqual({
      detalhe: "nenhuma transportadora ligada",
      valor: "Não compra",
      nota: "",
    });
  });

  it("duas transportadoras ligadas aparecem unidas por ' ou '", () => {
    montar(loja(), { nomesLigados: ["Frenet", "Correios"] });
    expect(linha(FORA)).toEqual({
      detalhe: "Frenet ou Correios",
      valor: "Na hora",
      nota: "preço da transportadora",
    });
  });

  it("'sempre grátis': valor Grátis, e a nota depende do alcance do benefício", () => {
    montar(loja({ nationalShippingStrategy: "sempre" }));
    expect(linha(FORA)).toEqual({
      detalhe: "Frenet",
      valor: "Grátis",
      nota: "na opção mais barata",
    });
    montar(
      loja({
        nationalShippingStrategy: "sempre",
        nationalBenefitScope: "todas",
      }),
    );
    expect(linha(FORA)?.nota).toBe("qualquer entrega");
  });

  it("'grátis acima de R$ 150' nacional: só o botão de 150 em diante vira Grátis", async () => {
    montar(
      loja({
        nationalShippingStrategy: "acima_de_valor",
        nationalShippingMin: 150,
      }),
    );
    expect(linha(FORA)?.valor).toBe("Na hora");
    expect(linha(FORA)?.nota).toBe("preço da transportadora");
    await act(async () => botoesDeValor()[1].click());
    expect(linha(FORA)?.valor).toBe("Grátis");
    expect(linha(FORA)?.nota).toBe("na opção mais barata");
  });

  it("'só produtos marcados' nacional: preço normal e a nota explica a condição", () => {
    montar(loja({ nationalShippingStrategy: "por_produto" }));
    expect(linha(FORA)).toEqual({
      detalhe: "Frenet",
      valor: "Na hora",
      nota: "grátis se tiver produto marcado",
    });
  });

  it("promoção por produto COM pagamento pelo app: o valor diz 'Grátis se tiver produto marcado'", () => {
    montar(loja({ nationalShippingStrategy: "por_produto" }), {
      promocaoNacionalComPagamento: true,
    });
    expect(linha(FORA)?.valor).toBe("Grátis se tiver produto marcado");
  });

  it("promoção por produto SEM pagamento pelo app: não finaliza pelo app", () => {
    montar(loja({ nationalShippingStrategy: "por_produto" }), {
      promocaoNacionalSemPagamento: true,
    });
    expect(linha(FORA)).toMatchObject({
      detalhe: "frete grátis se tiver produto marcado",
      valor: "Não finaliza pelo app",
    });
  });

  it("promoção com pagamento e sem pagamento ao mesmo tempo: vale a frase do COM", () => {
    montar(loja({ nationalShippingStrategy: "por_produto" }), {
      promocaoNacionalComPagamento: true,
      promocaoNacionalSemPagamento: true,
    });
    expect(linha(FORA)?.valor).toBe("Grátis se tiver produto marcado");
  });
});

describe("PreviaDoFrete: loja que só retira", () => {
  const SO_RETIRO = {
    localDeliveryEnabled: false,
    enabledShippingMethods: ["store-pickup"],
  };

  it("cobertura só da cidade: quem é de fora retira na loja", () => {
    montar(loja({ ...SO_RETIRO, shippingCoverage: "local" }), {
      nomesLigados: [],
    });
    expect(linha(FORA)).toEqual({
      detalhe: "quem é de fora retira na loja",
      valor: "Só retirada · Grátis",
      nota: "",
    });
  });

  it("sem transportadora ligada e sem nenhuma na lista: também só retirada", () => {
    montar(loja(SO_RETIRO), { nomesLigados: [] });
    expect(linha(FORA)).toMatchObject({
      detalhe: "quem é de fora retira na loja",
      valor: "Só retirada · Grátis",
    });
  });

  it("com transportadora na lista da loja, o servidor ainda cota: não vira só retirada", () => {
    montar(
      loja({
        localDeliveryEnabled: false,
        enabledShippingMethods: ["store-pickup", "sedex"],
      }),
      { nomesLigados: ["Frenet"] },
    );
    expect(linha(FORA)).toMatchObject({
      detalhe: "Frenet",
      valor: "Na hora",
    });
  });

  it("só retirada + entrega grátis por produto SEM transportadora: a nota pede o pagamento pelo app", () => {
    montar(
      loja({
        localDeliveryEnabled: false,
        enabledShippingMethods: ["store-pickup", "sedex"],
        nationalShippingStrategy: "por_produto",
      }),
      { nomesLigados: [] },
    );
    expect(linha(FORA)).toEqual({
      detalhe: "nenhuma transportadora ligada",
      valor: "Retirada grátis",
      nota: "Entrega grátis por produto exige o pagamento pelo app ligado.",
    });
  });

  it("o mesmo caso com o pagamento pelo app ligado: promete a entrega por produto e some a nota", () => {
    montar(
      loja({
        localDeliveryEnabled: false,
        enabledShippingMethods: ["store-pickup", "sedex"],
        nationalShippingStrategy: "por_produto",
      }),
      { nomesLigados: [], pagamentoPeloAppLigado: true },
    );
    expect(linha(FORA)).toEqual({
      detalhe: "nenhuma transportadora ligada",
      valor:
        "Retirada grátis; entrega grátis se o pedido tiver produto marcado",
      nota: "",
    });
  });
});
