// @vitest-environment jsdom
//
// Caça 10, itens 5 e 7 (lote 228).
//
// DEFEITO 5: loja "Só retiro" com a transportadora fora do ar. A edge responde
// 200 com SÓ a retirada e `cotacaoIncompleta: true`; o front ignorava o sinal,
// mostrava "Retirar na loja" sem aviso nenhum e gravava essa lista no navegador
// por 2 h — nas visitas seguintes nem consultava o servidor de novo.
//
// DEFEITO 7: 429 (muitas consultas) e 400 (carrinho grande demais) caíam na
// frase genérica "tente novamente em instantes", e a cliente apertava "Tentar de
// novo" em vão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ID_RETIRADA_NA_LOJA } from "@/lib/guarda-de-frete";
import type { CartItem } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const carrinho: CartItem[] = [
  {
    product: {
      id: "prod-1",
      name: "Blusa Teste",
      description: "",
      price: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    },
    quantity: 1,
  },
];

const RETIRADA = {
  id: ID_RETIRADA_NA_LOJA,
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "retirada",
};
const PAC = { id: "pac", name: "PAC", price: 30, deliveryDays: 7 };

const FRASE_DA_FALHA =
  "Não conseguimos calcular a entrega agora. Tente de novo em instantes ou retire na loja.";

function erroHttp(context: Response) {
  return {
    data: null,
    error: {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context,
    },
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — cotação incompleta avisa e não é guardada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  const onSelectOption = vi.fn();

  beforeEach(() => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockReset();
    onSelectOption.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function cotar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={onSelectOption}
          cepDestino="19999999"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const chavesDeFrete = () =>
    [...armazem.keys()].filter((k) => k.startsWith("ikcous_shipping_cache_"));

  it("só a retirada + cotacaoIncompleta: mostra a frase, mantém a retirada na tela e NÃO guarda a cópia", async () => {
    invoke.mockResolvedValue({
      data: {
        options: [RETIRADA],
        cotacaoIncompleta: true,
        revisaoConfig: "rev-1",
      },
      error: null,
    });
    await cotar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      FRASE_DA_FALHA,
    );
    // A retirada continua escolhível: o aviso não derruba a opção.
    expect(hospedeiro.textContent).toContain("Retirar na loja");
    expect(hospedeiro.textContent).toContain("Tentar de novo");
    expect(chavesDeFrete()).toEqual([]);
  });

  it("Tentar de novo consulta o servidor outra vez (nada ficou guardado) e o aviso some quando a resposta vem completa", async () => {
    invoke.mockResolvedValueOnce({
      data: { options: [RETIRADA], cotacaoIncompleta: true },
      error: null,
    });
    await cotar();
    expect(invoke).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValueOnce({
      data: {
        options: [RETIRADA, PAC],
        cotacaoIncompleta: false,
        revisaoConfig: "rev-1",
      },
      error: null,
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).toContain("30,00");
    // A resposta COMPLETA volta a ser guardada.
    expect(chavesDeFrete()).toHaveLength(1);
  });

  it("controle: resposta completa continua guardada e sem aviso", async () => {
    invoke.mockResolvedValue({
      data: {
        options: [PAC],
        cotacaoIncompleta: false,
        cotacaoParcial: false,
        revisaoConfig: "rev-1",
      },
      error: null,
    });
    await cotar();

    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(chavesDeFrete()).toHaveLength(1);
  });

  it("cotacaoParcial (uma transportadora não respondeu): mostra o aviso, mantém as opções e não guarda a cópia", async () => {
    invoke.mockResolvedValue({
      data: {
        options: [PAC],
        cotacaoIncompleta: false,
        cotacaoParcial: true,
        revisaoConfig: "rev-1",
      },
      error: null,
    });
    await cotar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Algumas transportadoras não responderam agora. Toque em Tentar de novo para ver todas as opções.",
    );
    expect(hospedeiro.textContent).toContain("30,00");
    expect(chavesDeFrete()).toEqual([]);
  });

  it("composição do item 2: com a cópia válida guardada o carrinho NÃO consulta o servidor; depois de descartarCacheDeFreteDoNavegador (o que o botão da recusa faz) ele consulta", async () => {
    // Cópia guardada pela própria calculadora (mesmo formato de sempre).
    const completa = {
      data: { options: [PAC], revisaoConfig: "rev-1" },
      error: null,
    };
    invoke.mockImplementation(async (_nome: string, init: any) =>
      init?.body?.action === "revisao_config_frete"
        ? { data: { revisaoConfig: "rev-1" }, error: null }
        : completa,
    );
    await cotar();
    const cotacoes = () =>
      invoke.mock.calls.filter(([, init]) => !init?.body?.action).length;
    expect(cotacoes()).toBe(1);
    expect(chavesDeFrete()).toHaveLength(1);

    // Volta ao carrinho com a cópia válida: serve do navegador.
    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await cotar();
    expect(cotacoes()).toBe(1);

    // O botão "Calcular o frete de novo" apaga a cópia: o carrinho cota de verdade.
    const { descartarCacheDeFreteDoNavegador } = await import(
      "@/lib/revisao-do-frete"
    );
    Object.assign(globalThis.localStorage, {
      length: armazem.size,
      key: (i: number) => [...armazem.keys()].at(i) ?? null,
    });
    descartarCacheDeFreteDoNavegador();
    expect(chavesDeFrete()).toEqual([]);
    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await cotar();
    expect(cotacoes()).toBe(2);
  });

  it.each([
    [
      "429 muitas_consultas",
      429,
      { codigo: "muitas_consultas", error: "texto técnico proibido" },
      "Muitas consultas de frete em pouco tempo. Aguarde alguns minutos e tente de novo.",
    ],
    [
      "400 carrinho_grande_demais",
      400,
      { codigo: "carrinho_grande_demais", error: "texto técnico proibido" },
      "O carrinho tem itens demais para calcular o frete de uma vez. Tire alguns itens e tente de novo.",
    ],
  ])(
    "%s mostra a frase própria, não a genérica",
    async (_nome, status, corpo, frase) => {
      invoke.mockResolvedValue(
        erroHttp(new Response(JSON.stringify(corpo), { status })),
      );
      await cotar();

      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
        frase,
      );
      expect(hospedeiro.textContent).not.toContain("texto técnico proibido");
      expect(hospedeiro.textContent).not.toContain(
        "tente novamente em instantes",
      );
    },
  );
});
