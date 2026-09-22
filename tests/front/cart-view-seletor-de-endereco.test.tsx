// @vitest-environment jsdom
//
// SELETOR DE ENDEREÇO DO CARRINHO EM FOLHA (22/09/2026, relato da cliente no
// celular): "Trocar" abria um painel NO FLUXO, abaixo do card de frete — com
// o carrinho rolado até o fim ele caía atrás do rodapé fixo Total/Finalizar
// e da navegação, e a cliente não via os outros endereços nem o "Novo
// endereço". Agora "Trocar" abre uma folha modal (Sheet, z-[130]) com a
// lista e o "Cadastrar novo endereço" — inclusive com UM endereço só.
//
// jsdom não faz layout: o que se prova AQUI é o comportamento (abre, lista,
// escolhe, fecha, cadastra). A prova GEOMÉTRICA (a folha fica por cima dos
// rodapés fixos) mora em tests/e2e/jornada-trocar-endereco-carrinho.spec.ts.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption, View } from "@/types";

const { conta, estadoEnderecos, invoke, espelho } = vi.hoisted(() => ({
  conta: {
    usuario: { id: "conta-a", user_metadata: { name: "Cliente A" } } as {
      id: string;
      user_metadata: { name: string };
    } | null,
  },
  estadoEnderecos: { lista: [] as Address[] },
  invoke: vi.fn(),
  espelho: {
    enderecoSelecionadoId: null as string | null,
    selecionada: null as ShippingOption | null,
    // Id GUARDADO no início da montagem (o que o CartContext já tinha).
    idInicial: null as string | null,
    // Toda gravação feita pelo carrinho, na ordem — "não grava" se prova
    // pela AUSÊNCIA aqui, não pelo valor final (gravar o mesmo id não muda
    // o estado e passaria despercebido).
    gravacoes: [] as (string | null)[],
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

function endereco(
  id: string,
  name: string,
  cep: string,
  city: string,
  state: string,
  is_default = false,
): Address {
  return {
    id,
    user_id: "conta-a",
    name,
    recipient_name: "Cliente A",
    cep,
    street: `Rua ${name}`,
    number: "10",
    complement: "",
    neighborhood: "Centro",
    city,
    state,
    reference: "",
    is_default,
  };
}

const CASA = endereco(
  "end-casa",
  "Casa",
  "38500-000",
  "Monte Carmelo",
  "MG",
  true,
);
const TRABALHO = endereco(
  "end-trabalho",
  "Trabalho",
  "01001-000",
  "São Paulo",
  "SP",
);
const SITIO = endereco("end-sitio", "Sítio", "38400-000", "Uberlândia", "MG");
const NOVO = endereco(
  "end-novo",
  "Casa Nova",
  "30110-000",
  "Belo Horizonte",
  "MG",
);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      freeShippingMin: 0,
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    getFreeShippingEligibleProducts: vi.fn(() => []),
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: async () => {},
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useEffect, useState } = await import("react");
  const fixos = {
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    getCartTotal: vi.fn(() => 256.5),
    getCartCount: vi.fn(() => 2),
  };
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, gravarEnderecoSelecionadoId] = useState<
      string | null
    >(espelho.idInicial);
    const setEnderecoSelecionadoId = (id: string | null) => {
      espelho.gravacoes.push(id);
      gravarEnderecoSelecionadoId(id);
    };
    useEffect(() => {
      espelho.selecionada = selecionada;
      espelho.enderecoSelecionadoId = enderecoSelecionadoId;
    }, [selecionada, enderecoSelecionadoId]);
    return {
      ...fixos,
      cart: CARRINHO,
      cartTotal: 256.5,
      cartCount: 2,
      isLoading: false,
      shippingFee: selecionada?.price ?? 0,
      freteIndefinido: !selecionada,
      freteGratis: false,
      selectedShippingOption: selecionada,
      shippingCep,
      enderecoSelecionadoId,
      setSelectedShippingOption: setSelecionada,
      setShippingCep,
      setEnderecoSelecionadoId,
    };
  }
  return { useCart: useCartComEstado };
});

vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    fetchUserOrders: vi.fn(async () => {}),
    orders: [],
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario, profile: null, loading: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function opcoesPara(cep: string): ShippingOption[] {
  return cep === "38500000"
    ? [
        {
          id: "local-delivery",
          name: "Entrega local",
          price: 10,
          deliveryDays: 1,
          provider: "local",
        },
      ]
    : [
        {
          id: "melhorenvio-pac",
          name: "PAC",
          price: 30,
          deliveryDays: 6,
          provider: "melhor_envio",
        },
      ];
}

describe("CartView — seletor de endereço em folha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    conta.usuario = { id: "conta-a", user_metadata: { name: "Cliente A" } };
    estadoEnderecos.lista = [CASA, TRABALHO, SITIO];
    espelho.enderecoSelecionadoId = null;
    espelho.selecionada = null;
    espelho.idInicial = null;
    espelho.gravacoes = [];
    invoke.mockReset();
    invoke.mockImplementation(
      async (_nome: string, opts: { body: { cep: string } }) => ({
        data: { options: opcoesPara(opts.body.cep) },
        error: null,
      }),
    );
    onNavigate.mockClear();
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

  async function montar(isActive = true) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={onNavigate} isActive={isActive} />);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  function regiao(): HTMLElement | null {
    return hospedeiro.querySelector('section[aria-label="Entrega e frete"]');
  }

  function botaoTrocar(): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Trocar",
    );
  }

  // A folha é portalada no body: busca no DOCUMENTO, não no hospedeiro.
  function folha(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]');
  }

  function cartoesDaFolha(): HTMLElement[] {
    return Array.from(
      folha()?.querySelectorAll<HTMLElement>('[role="button"]') ?? [],
    );
  }

  function botaoCadastrarDaFolha(): HTMLButtonElement | undefined {
    return Array.from(folha()?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Cadastrar novo endereço"),
    );
  }

  async function clicar(el: HTMLElement | undefined | null) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("UM endereço só: 'Trocar' existe e abre a folha com ele e o 'Cadastrar novo endereço'", async () => {
    estadoEnderecos.lista = [CASA];
    await montar();

    const trocar = botaoTrocar();
    expect(trocar).toBeDefined();
    expect(trocar?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(folha()).toBeNull();

    await clicar(trocar);

    const dialogo = folha();
    expect(dialogo).not.toBeNull();
    expect(dialogo?.textContent).toContain("Entregar em");
    const cartoes = cartoesDaFolha();
    expect(cartoes).toHaveLength(1);
    expect(cartoes[0].textContent).toContain("Casa");
    expect(cartoes[0].textContent).toContain("Selecionado");
    expect(botaoCadastrarDaFolha()).toBeDefined();
    // O card não vira "Fechar": a folha tem o próprio caminho de fechar.
    expect(botaoTrocar()?.textContent?.trim()).toBe("Trocar");
  });

  it("vários: escolher OUTRO grava a escolha compartilhada, FECHA a folha e recota para o CEP novo", async () => {
    await montar();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(espelho.selecionada?.id).toBe("local-delivery");

    await clicar(botaoTrocar());
    expect(cartoesDaFolha().map((c) => c.textContent)).toEqual([
      expect.stringContaining("Casa"),
      expect.stringContaining("Trabalho"),
      expect.stringContaining("Sítio"),
    ]);

    await clicar(
      cartoesDaFolha().find((c) => c.textContent?.includes("Trabalho")),
    );

    expect(espelho.enderecoSelecionadoId).toBe("end-trabalho");
    expect(folha()).toBeNull();
    expect(regiao()?.textContent ?? "").toContain("Entrega para Trabalho");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(
      (invoke.mock.calls[1][1] as { body: { cep: string } }).body.cep,
    ).toBe("01001000");
    expect(espelho.selecionada?.id).toBe("melhorenvio-pac");

    // Reabrir: o escolhido agora é o Trabalho.
    await clicar(botaoTrocar());
    const marcado = cartoesDaFolha().find((c) =>
      c.textContent?.includes("Selecionado"),
    );
    expect(marcado?.textContent).toContain("Trabalho");
  });

  it("escolher o MESMO id já guardado só fecha: não grava escolha nem recota", async () => {
    espelho.idInicial = "end-trabalho";
    await montar();
    expect(regiao()?.textContent ?? "").toContain("Entrega para Trabalho");
    expect(invoke).toHaveBeenCalledTimes(1);

    await clicar(botaoTrocar());
    await clicar(
      cartoesDaFolha().find((c) => c.textContent?.includes("Trabalho")),
    );

    expect(folha()).toBeNull();
    expect(espelho.gravacoes).toEqual([]);
    expect(espelho.enderecoSelecionadoId).toBe("end-trabalho");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("id guardado de endereço que SUMIU da lista: tocar o principal (efetivo) grava o id dele — sem recotar", async () => {
    // O id guardado aponta para um endereço apagado: o carrinho cai no
    // principal (Casa), que a folha mostra como "Selecionado". Tocar nele
    // tem de trocar o id morto pelo da Casa — senão o checkout envia um
    // addressId que não existe mais.
    espelho.idInicial = "end-apagado";
    await montar();
    expect(regiao()?.textContent ?? "").toContain("Entrega para Casa");
    expect(invoke).toHaveBeenCalledTimes(1);

    await clicar(botaoTrocar());
    const casa = cartoesDaFolha().find((c) => c.textContent?.includes("Casa"));
    expect(casa?.textContent).toContain("Selecionado");
    await clicar(casa);

    expect(folha()).toBeNull();
    expect(espelho.gravacoes).toEqual(["end-casa"]);
    expect(espelho.enderecoSelecionadoId).toBe("end-casa");
    // O CEP efetivo não mudou (já era o da Casa): nada é recotado.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(regiao()?.textContent ?? "").toContain("Entrega para Casa");
  });

  it("fechar com Escape devolve o foco ao botão 'Trocar' (a folha abre por estado, sem gatilho do Radix)", async () => {
    await montar();
    const trocar = botaoTrocar();
    trocar?.focus();
    await clicar(trocar);
    expect(folha()).not.toBeNull();
    expect(document.activeElement).not.toBe(trocar);

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      // O FocusScope do Radix devolve o foco num setTimeout(0).
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(folha()).toBeNull();
    expect(document.activeElement).toBe(botaoTrocar());
  });

  it("'Cadastrar novo endereço' NÃO devolve o foco ao 'Trocar' (a cliente está indo para o formulário)", async () => {
    await montar();
    const trocar = botaoTrocar();
    trocar?.focus();
    await clicar(trocar);
    await act(async () => {
      botaoCadastrarDaFolha()?.click();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(onNavigate).toHaveBeenCalledWith("address-form");
    expect(folha()).toBeNull();
    expect(document.activeElement).not.toBe(botaoTrocar());
  });

  it("fechar pelo X e reabrir: a folha some e volta com a lista inteira", async () => {
    await montar();
    await clicar(botaoTrocar());
    expect(folha()).not.toBeNull();

    await clicar(folha()?.querySelector<HTMLElement>('[aria-label="Fechar"]'));
    expect(folha()).toBeNull();
    expect(espelho.enderecoSelecionadoId).toBeNull();

    await clicar(botaoTrocar());
    expect(folha()).not.toBeNull();
    expect(cartoesDaFolha()).toHaveLength(3);
    expect(botaoCadastrarDaFolha()).toBeDefined();
  });

  it("'Cadastrar novo endereço' na folha: fecha, vai ao formulário, e o endereço NOVO vira o de entrega", async () => {
    await montar();
    await clicar(botaoTrocar());
    await clicar(botaoCadastrarDaFolha());

    expect(onNavigate).toHaveBeenCalledWith("address-form");
    expect(folha()).toBeNull();

    // O formulário salvou (carrinho fora de foco, montado atrás); a lista
    // compartilhada chegou; a cliente volta ao carrinho.
    await montar(false);
    estadoEnderecos.lista = [CASA, TRABALHO, SITIO, NOVO];
    await montar(false);
    await montar(true);

    expect(espelho.enderecoSelecionadoId).toBe("end-novo");
    expect(regiao()?.textContent ?? "").toContain("Entrega para Casa Nova");
    expect(folha()).toBeNull();
  });

  it("aba perde o foco com a folha aberta: a folha fecha e NÃO reabre sozinha na volta", async () => {
    await montar();
    await clicar(botaoTrocar());
    expect(folha()).not.toBeNull();

    await montar(false);
    expect(folha()).toBeNull();

    await montar(true);
    expect(folha()).toBeNull();
    expect(botaoTrocar()).toBeDefined();
  });

  it("lista longa: a lista rola DENTRO da folha e o 'Cadastrar novo endereço' fica FORA da área que rola", async () => {
    estadoEnderecos.lista = Array.from({ length: 12 }, (_, i) =>
      endereco(
        `end-${i}`,
        `Endereço ${i + 1}`,
        i === 0 ? "38500-000" : `01${String(100 + i)}-000`,
        "Cidade",
        "MG",
        i === 0,
      ),
    );
    await montar();
    await clicar(botaoTrocar());

    const lista = folha()?.querySelector<HTMLElement>(
      '[data-testid="seletor-endereco-lista"]',
    );
    expect(lista).toBeTruthy();
    expect(lista?.className).toContain("overflow-y-auto");
    expect(lista?.querySelectorAll('[role="button"]')).toHaveLength(12);
    const cadastrar = botaoCadastrarDaFolha();
    expect(cadastrar).toBeDefined();
    expect(lista?.contains(cadastrar ?? null)).toBe(false);
  });

  it("sem endereço: continua o botão 'Cadastrar endereço' direto, sem folha", async () => {
    estadoEnderecos.lista = [];
    await montar();

    expect(botaoTrocar()).toBeUndefined();
    const cadastrar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cadastrar endereço",
    );
    await clicar(cadastrar);
    expect(onNavigate).toHaveBeenCalledWith("address-form");
    expect(folha()).toBeNull();
  });
});
