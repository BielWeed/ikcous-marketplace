// @vitest-environment jsdom
//
// FRETE AUTOMÁTICO NO CHECKOUT (22/09/2026, pedido do dono): o frete é
// cotado sozinho pelo endereço de entrega escolhido — sem campo de CEP nem
// "Calcular". Trocar de endereço (casa na cidade da loja → trabalho em outra
// cidade) derruba a cotação anterior NA HORA e recota; enquanto a cotação do
// destino novo não volta, o total é "a calcular" e o Finalizar fica travado.
// Resposta atrasada do endereço anterior nunca vira preço do pedido.
//
// Aqui a calculadora é a REAL, dentro do CheckoutView real; o `useCart` é um
// dublê COM ESTADO (useState), para que o que a calculadora grava (opção,
// CEP da cotação) volte como prop — o ciclo que o CartContext faz na loja.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const {
  estadoEnderecos,
  contaEstavel,
  dubleEnderecos,
  invoke,
  espelho,
  inicial,
} = vi.hoisted(() => ({
  estadoEnderecos: { lista: [] as Address[] },
  contaEstavel: {
    user: { id: "user-1", user_metadata: { name: "Cliente Teste" } },
    profile: { full_name: "Cliente Teste", whatsapp: "34999999999" },
  },
  dubleEnderecos: {
    fetchAddresses: vi.fn(async () => {}),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
  },
  invoke: vi.fn(),
  // Espelho do estado do dublê de carrinho, para as asserções.
  espelho: {
    selecionada: null as ShippingOption | null,
    shippingCep: null as string | null,
  },
  // Estado com que o carrinho CHEGA ao checkout (escolha feita no carrinho).
  inicial: {
    selecionada: null as ShippingOption | null,
    shippingCep: null as string | null,
  },
}));

const produto: Product = {
  id: "prod-1",
  name: "Blusa Teste",
  description: "",
  price: 128.25,
  images: [],
  category: "Roupas",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CARRINHO: CartItem[] = [{ product: produto, quantity: 2 }];

const CASA: Address = {
  id: "end-casa",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
};
const TRABALHO: Address = {
  id: "end-trabalho",
  user_id: "user-1",
  name: "Trabalho",
  recipient_name: "Cliente Teste",
  cep: "01001-000",
  street: "Praça da Sé",
  number: "1",
  complement: "",
  neighborhood: "Sé",
  city: "São Paulo",
  state: "SP",
  reference: "",
  is_default: false,
};

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 5,
  deliveryDays: 1,
  provider: "local",
};
const PAC_SP: ShippingOption = {
  id: "melhorenvio-pac",
  name: "PAC",
  price: 30,
  deliveryDays: 6,
  provider: "melhor_envio",
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: dubleEnderecos.fetchAddresses,
    addAddress: dubleEnderecos.addAddress,
    updateAddress: dubleEnderecos.updateAddress,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: contaEstavel.user,
    profile: contaEstavel.profile,
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useEffect, useState } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(
      inicial.selecionada,
    );
    const [shippingCep, setShippingCep] = useState<string | null>(
      inicial.shippingCep,
    );
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    useEffect(() => {
      espelho.selecionada = selecionada;
      espelho.shippingCep = shippingCep;
    }, [selecionada, shippingCep]);
    return {
      cart: CARRINHO,
      cartTotal: 256.5,
      // Mesma regra do CartContext: sem opção escolhida, frete indefinido.
      shippingFee: selecionada?.price ?? 0,
      freteIndefinido: !selecionada,
      freteGratis: false,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: selecionada,
      shippingCep,
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
      setSelectedShippingOption: setSelecionada,
      setShippingCep,
    };
  }
  return { useCart: useCartComEstado };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));
vi.mock("@/hooks/useEconomiaDoFreteExibida", () => ({
  useEconomiaDoFreteExibida: () => 0,
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Resposta = { data: unknown; error: unknown };

/** Cada CEP cotado fica preso numa promessa que o teste resolve quando quer. */
function cotacoesControladas() {
  const pendentes = new Map<string, Array<(r: Resposta) => void>>();
  invoke.mockImplementation(
    (_nome: string, opts: { body: { cep: string } }) =>
      new Promise<Resposta>((resolve) => {
        const lista = pendentes.get(opts.body.cep) ?? [];
        lista.push(resolve);
        pendentes.set(opts.body.cep, lista);
      }),
  );
  return {
    async responder(cep: string, resposta: Resposta) {
      const lista = pendentes.get(cep) ?? [];
      const resolver = lista.shift();
      expect(resolver, `nenhuma cotação em voo para ${cep}`).toBeDefined();
      await act(async () => {
        resolver?.(resposta);
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });
    },
  };
}

describe("CheckoutView — frete automático pelo endereço de entrega", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoEnderecos.lista = [CASA, TRABALHO];
    espelho.selecionada = null;
    espelho.shippingCep = null;
    inicial.selecionada = null;
    inicial.shippingCep = null;
    invoke.mockReset();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  function botaoFinalizar(): HTMLButtonElement {
    return document.querySelector(
      'button[aria-label="Finalizar pedido"]',
    ) as HTMLButtonElement;
  }

  // A trava DE FRETE do Finalizar sempre diz o motivo na tela. Com
  // transportadora (outra cidade), o Finalizar ainda depende da regra do
  // dono "transportadora exige pagamento antecipado" — assunto de
  // checkout-transportadora-exige-antecipado.test.tsx, não daqui. Por isso,
  // nos cenários de outra cidade, o que se mede é a trava de FRETE.
  function freteTravaOFinalizar(): boolean {
    const texto = document.body.textContent ?? "";
    return (
      texto.includes("Calculando o frete do endereço de entrega") ||
      texto.includes("Escolha uma opção de frete para continuar") ||
      texto.includes("Informe o endereço de entrega para calcular o frete")
    );
  }

  function regiaoDoFrete(): string {
    return (
      document.querySelector('section[aria-label="Entrega e frete"]')
        ?.textContent ?? ""
    );
  }

  async function escolherEndereco(apelido: string) {
    const cartao = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    ).find((el) => el.textContent?.includes(apelido));
    expect(cartao, `cartão do endereço ${apelido}`).toBeDefined();
    await act(async () => {
      cartao?.click();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("endereço salvo: cota sozinho, mostra 'Entrega para Casa' com o resumo e libera o Finalizar com o total certo", async () => {
    const frete = cotacoesControladas();
    await montar();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(regiaoDoFrete()).toContain("Entrega para Casa");
    expect(regiaoDoFrete()).toContain("Monte Carmelo/MG");
    // Cotação em voo: nada de total fechado, Finalizar travado.
    expect(botaoFinalizar().disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Calculando o frete do endereço de entrega",
    );

    await frete.responder("38500000", {
      data: { options: [LOCAL] },
      error: null,
    });

    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(espelho.shippingCep).toBe("38500-000");
    expect(document.body.textContent).toContain("261,50");
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("casa (local) → trabalho (outra cidade) com a cotação da casa EM VOO: a resposta atrasada é descartada, o total fica 'a calcular' e só a cotação do trabalho fecha o pedido", async () => {
    const frete = cotacoesControladas();
    await montar();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Com a cotação da CASA ainda em voo, a cliente escolhe o TRABALHO.
    await escolherEndereco("Trabalho");

    expect(invoke).toHaveBeenCalledTimes(2);
    const cepDaSegunda = (invoke.mock.calls[1][1] as { body: { cep: string } })
      .body.cep;
    expect(cepDaSegunda).toBe("01001000");
    expect(regiaoDoFrete()).toContain("Entrega para Trabalho");
    expect(botaoFinalizar().disabled).toBe(true);
    expect(freteTravaOFinalizar()).toBe(true);

    // A resposta ATRASADA da casa chega agora: não vira preço de nada.
    await frete.responder("38500000", {
      data: { options: [LOCAL] },
      error: null,
    });
    expect(espelho.selecionada).toBeNull();
    expect(espelho.shippingCep).toBeNull();
    expect(document.body.textContent).not.toContain("261,50");
    expect(botaoFinalizar().disabled).toBe(true);
    expect(freteTravaOFinalizar()).toBe(true);

    // A do trabalho chega: é ela que fecha.
    await frete.responder("01001000", {
      data: { options: [PAC_SP] },
      error: null,
    });
    expect(espelho.selecionada?.id).toBe("melhorenvio-pac");
    expect(espelho.shippingCep).toBe("01001-000");
    expect(document.body.textContent).toContain("286,50");
    expect(freteTravaOFinalizar()).toBe(false);
  });

  it("trocar de volta para a casa depois de cotado o trabalho: o preço do trabalho cai e a casa volta com a opção fresca do cache (mesmo carrinho, mesmo destino)", async () => {
    const frete = cotacoesControladas();
    await montar();
    await frete.responder("38500000", {
      data: { options: [LOCAL] },
      error: null,
    });
    await escolherEndereco("Trabalho");
    await frete.responder("01001000", {
      data: { options: [PAC_SP] },
      error: null,
    });
    expect(freteTravaOFinalizar()).toBe(false);
    expect(document.body.textContent).toContain("286,50");

    await escolherEndereco("Casa");

    // O preço de São Paulo não vale para a casa: nada de 286,50 na tela e
    // nenhum Finalizar com ele. (A casa já foi cotada antes, mas o cache
    // local só serve se o carrinho e o destino casarem — aqui casam, então
    // a opção fresca da casa volta do cache sem chamar a transportadora.)
    expect(document.body.textContent).not.toContain("286,50");
    expect(espelho.shippingCep).toBe("38500-000");
    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(document.body.textContent).toContain("261,50");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("editar o CEP do endereço escolhido (lista atualizada) recota para o CEP novo e trava enquanto isso", async () => {
    const frete = cotacoesControladas();
    await montar();
    await frete.responder("38500000", {
      data: { options: [LOCAL] },
      error: null,
    });
    expect(botaoFinalizar().disabled).toBe(false);

    // A casa mudou de CEP (edição salva; a lista compartilhada chegou).
    estadoEnderecos.lista = [
      { ...CASA, cep: "38400-100", city: "Uberlândia" },
      TRABALHO,
    ];
    await montar();

    expect(invoke).toHaveBeenLastCalledWith("calculate-shipping", {
      body: expect.objectContaining({ cep: "38400100" }),
    });
    expect(botaoFinalizar().disabled).toBe(true);
    expect(freteTravaOFinalizar()).toBe(true);
    expect(document.body.textContent).not.toContain("261,50");

    await frete.responder("38400100", {
      data: { options: [{ ...LOCAL, price: 18 }] },
      error: null,
    });
    expect(espelho.shippingCep).toBe("38400-100");
    expect(document.body.textContent).toContain("274,50");
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("falha na cotação: aviso com 'Tentar de novo', Finalizar travado; tentar de novo com sucesso libera", async () => {
    const frete = cotacoesControladas();
    await montar();
    await frete.responder("38500000", {
      data: null,
      error: { message: "Edge Function retornou 500" },
    });

    expect(document.body.textContent).toContain("Não foi possível calcular");
    expect(botaoFinalizar().disabled).toBe(true);
    // Frete desconhecido nunca aparece como grátis nem como R$ 0 fechado.
    expect(regiaoDoFrete()).not.toContain("GRÁTIS");
    expect(document.body.textContent).not.toContain("256,50 Total");

    const tentar = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );
    expect(tentar).toBeDefined();
    await act(async () => {
      tentar?.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    await frete.responder("38500000", {
      data: { options: [LOCAL] },
      error: null,
    });

    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("escolha do carrinho para o MESMO endereço, sem cache válido: a recotação em voo trava o Finalizar (preço pode ter mudado) e o preço novo substitui o antigo", async () => {
    // A cliente escolheu a entrega local no carrinho (R$ 5) e abriu o
    // checkout depois de o cache local vencer: a calculadora do checkout
    // recota na montagem. A escolha é deste destino (não cai), mas até a
    // resposta voltar o preço dela é de OUTRA rodada.
    inicial.selecionada = LOCAL;
    inicial.shippingCep = "38500-000";
    const frete = cotacoesControladas();
    await montar();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(botaoFinalizar().disabled).toBe(true);
    expect(freteTravaOFinalizar()).toBe(true);
    expect(document.body.textContent).not.toContain("261,50");

    await frete.responder("38500000", {
      data: { options: [{ ...LOCAL, price: 7 }] },
      error: null,
    });

    // Mesma modalidade, preço FRESCO.
    expect(espelho.selecionada).toEqual({ ...LOCAL, price: 7 });
    expect(document.body.textContent).toContain("263,50");
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("sem endereço cadastrado: nada é cotado, a tela pede o endereço e o Finalizar diz por que está travado", async () => {
    estadoEnderecos.lista = [];
    await montar();

    expect(invoke).not.toHaveBeenCalled();
    expect(regiaoDoFrete()).toContain("Cadastre ou escolha um endereço");
    expect(botaoFinalizar().disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Informe o endereço de entrega para calcular o frete",
    );
  });
});
