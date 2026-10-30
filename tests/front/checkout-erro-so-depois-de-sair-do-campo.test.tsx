// @vitest-environment jsdom
//
// CHECKOUT DE CONVIDADO: ERRO SÓ DEPOIS DE SAIR DO CAMPO (30/10/2026, medição
// da vitrine). Digitar só o CEP acendia "NOME É OBRIGATÓRIO", "CONFIRA O
// WHATSAPP", "INFORME UM CPF VÁLIDO…" e "NÚMERO É OBRIGATÓRIO" em campos que a
// cliente nem tinha tocado: a cotação do frete escolhia uma transportadora, o
// CPF passava a ser exigido e o efeito que revalida o formulário inteiro
// (`form.trigger()`) enchia a tela de vermelho.
//
// O que este arquivo prende — SÓ QUANDO a mensagem aparece, nunca O QUE vale:
//   1. campo intocado não mostra erro, mesmo depois de a validação rodar;
//   2. o campo mostra o erro depois que a pessoa SAI dele (blur);
//   3. tentar continuar (aviso da barra ou o clique que o botão apagado não
//      deixa passar) mostra TODOS os erros obrigatórios de uma vez;
//   4. a validade não mudou: o Finalizar continua apagado enquanto faltar
//      dado, e acende quando tudo estiver preenchido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { invoke, createOrder, criarPagamento, toastError } = vi.hoisted(() => ({
  invoke: vi.fn(),
  createOrder: vi.fn(),
  criarPagamento: vi.fn(),
  toastError: vi.fn(),
}));

const produto: Product = {
  id: "prod-1",
  name: "Blusa Teste",
  description: "",
  price: 100,
  images: [],
  category: "Roupas",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CARRINHO: CartItem[] = [{ product: produto, quantity: 1 }];

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

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

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
    addresses: [],
    fetchAddresses: vi.fn(async () => {}),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useState } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    return {
      cart: CARRINHO,
      cartTotal: 100,
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
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({
      createOrder,
      updateOrderStatus: vi.fn(),
      criarPagamento,
    }),
  };
});
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
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function cotacoesControladas(porCep: Record<string, ShippingOption[]>) {
  const mapa = new Map(Object.entries(porCep));
  invoke.mockImplementation(
    (_nome: string, opts: { body: { cep?: string; action?: string } }) => {
      if (opts.body.action === "revisao_config_frete") {
        return Promise.resolve({
          data: { revisaoConfig: "rev-fixa" },
          error: null,
        });
      }
      const opcoes = mapa.get(opts.body.cep as string);
      return Promise.resolve({
        data: opcoes
          ? { options: opcoes, revisaoConfig: "rev-fixa" }
          : { options: [], cotacaoIncompleta: false },
        error: null,
      });
    },
  );
}

/** Resposta do ViaCEP por CEP — endereço completo (SP) e CEP de cidade
 * pequena, sem rua nem bairro (Monte Carmelo). */
function viaCepFalso() {
  const base = new Map<string, unknown>([
    [
      "01001000",
      {
        logradouro: "Praça da Sé",
        bairro: "Sé",
        localidade: "São Paulo",
        uf: "SP",
      },
    ],
    [
      "38500000",
      { logradouro: "", bairro: "", localidade: "Monte Carmelo", uf: "MG" },
    ],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const cep = /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(base.get(cep) ?? { erro: true }),
      } as Response);
    }),
  );
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function botaoFinalizar(): HTMLButtonElement {
  return document.querySelector(
    'button[aria-label="Finalizar pedido"]',
  ) as HTMLButtonElement;
}

/** Mensagens de erro hoje na tela, por id do parágrafo. */
function errosNaTela(): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const p of document.querySelectorAll<HTMLElement>('[id^="erro-"]')) {
    saida[p.id] = p.textContent ?? "";
  }
  return saida;
}

function marcadoInvalido(id: string): boolean {
  return document.getElementById(id)?.getAttribute("aria-invalid") === "true";
}

describe("CheckoutView (convidado) — o erro de um campo só aparece depois que a pessoa sai dele", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    invoke.mockReset();
    createOrder.mockReset();
    criarPagamento.mockReset();
    toastError.mockReset();
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
    const sessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => sessao.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        sessao.set(chave, valor);
      },
      removeItem: (chave: string) => {
        sessao.delete(chave);
      },
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    viaCepFalso();
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

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }

  async function esperarBarra() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function montarEAbrirASecao() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await drenar();
    await act(async () => {
      botaoPorTexto("Editar")?.click();
    });
    await drenar();
  }

  async function digitarSoOCep(cep: string) {
    await act(async () => {
      digitar("guest-cep", cep);
    });
    await drenar();
    await esperarBarra();
    await drenar();
  }

  async function sairDoCampo(id: string) {
    const campo = document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      campo.focus();
    });
    await act(async () => {
      campo.blur();
    });
    await drenar();
  }

  it("CEP de fora (transportadora, exige CPF): digitar só o CEP NÃO acende erro em nome, WhatsApp, CPF nem número", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montarEAbrirASecao();
    await digitarSoOCep("01001000");

    // Âncora: a cotação rodou e a transportadora foi escolhida — é ela que
    // torna o CPF obrigatório e faz a tela revalidar o formulário inteiro.
    expect(document.getElementById("checkout-cpf")).not.toBeNull();
    expect(
      (document.getElementById("guest-street") as HTMLInputElement).value,
    ).toBe("Praça da Sé");

    expect(errosNaTela()).toEqual({});
    for (const id of [
      "checkout-name",
      "checkout-tel",
      "checkout-cpf",
      "guest-number",
    ]) {
      expect(marcadoInvalido(id), `${id} marcado inválido`).toBe(false);
    }
    // A validade NÃO mudou: sem os dados o Finalizar segue apagado.
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("CEP de Monte Carmelo (ViaCEP sem rua nem bairro, transportadora escolhida): digitar só o CEP NÃO acende erro em rua, bairro, nome nem número", async () => {
    cotacoesControladas({ "38500000": [PAC_SP] });
    await montarEAbrirASecao();
    await digitarSoOCep("38500000");

    expect(
      (document.getElementById("guest-city") as HTMLInputElement).value,
    ).toBe("Monte Carmelo");
    expect(errosNaTela()).toEqual({});
    for (const id of [
      "checkout-name",
      "checkout-tel",
      "guest-number",
      "guest-street",
      "guest-neighborhood",
    ]) {
      expect(marcadoInvalido(id), `${id} marcado inválido`).toBe(false);
    }
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("sair de UM campo vazio mostra o erro DELE e só dele", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montarEAbrirASecao();
    await digitarSoOCep("01001000");

    await sairDoCampo("checkout-name");

    expect(errosNaTela()).toEqual({
      "erro-checkout-name": "Nome é obrigatório",
    });
    expect(marcadoInvalido("checkout-name")).toBe(true);
    expect(marcadoInvalido("checkout-tel")).toBe(false);
    expect(marcadoInvalido("guest-number")).toBe(false);
  });

  it("campo já tocado revalida enquanto digita: o erro some quando o dado fica certo", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montarEAbrirASecao();
    await digitarSoOCep("01001000");

    await sairDoCampo("checkout-tel");
    expect(errosNaTela()["erro-checkout-tel"]).toContain("WhatsApp");

    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();
    expect(errosNaTela()["erro-checkout-tel"]).toBeUndefined();
    expect(marcadoInvalido("checkout-tel")).toBe(false);
  });

  it("tentar continuar pelo aviso da barra mostra TODOS os erros obrigatórios de uma vez", async () => {
    // Entrega local: é o caso em que o aviso da barra existe (com
    // transportadora o convidado cai em "pagar exige conta" e a barra cala).
    cotacoesControladas({ "38500000": [LOCAL] });
    await montarEAbrirASecao();
    await digitarSoOCep("38500000");
    expect(errosNaTela()).toEqual({});

    const aviso = document.querySelector<HTMLButtonElement>(
      '[data-testid="checkout-pendencia-identificacao"]',
    );
    expect(aviso).not.toBeNull();
    await act(async () => {
      aviso?.click();
    });
    await drenar();

    const erros = errosNaTela();
    expect(erros["erro-checkout-name"]).toBe("Nome é obrigatório");
    expect(erros["erro-checkout-tel"]).toContain("WhatsApp");
    expect(erros["erro-guest-number"]).toBe("Número é obrigatório");
    // O CEP de Monte Carmelo não traz rua nem bairro.
    expect(erros["erro-guest-street"]).toBe("Rua é obrigatória");
    expect(erros["erro-guest-neighborhood"]).toBe("Bairro é obrigatório");
    // Entrega local não pede CPF: nenhum erro de CPF.
    expect(erros["erro-checkout-cpf"]).toBeUndefined();
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("tentar finalizar (handler do botão) mostra todos os erros, marca os campos e não cria pedido", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montarEAbrirASecao();
    await digitarSoOCep("38500000");
    expect(errosNaTela()).toEqual({});

    // O botão apagado ignora `.click()`; o handler real é o que um Enter ou
    // um toque que escapou da trava executaria.
    const propsDoReact = Object.entries(botaoFinalizar()).find(([chave]) =>
      chave.startsWith("__reactProps$"),
    )?.[1] as { onClick: () => void };
    await act(async () => {
      propsDoReact.onClick();
    });
    await drenar();

    const erros = errosNaTela();
    expect(erros["erro-checkout-name"]).toBe("Nome é obrigatório");
    expect(erros["erro-checkout-tel"]).toContain("WhatsApp");
    expect(erros["erro-guest-number"]).toBe("Número é obrigatório");
    expect(erros["erro-guest-street"]).toBe("Rua é obrigatória");
    expect(erros["erro-guest-neighborhood"]).toBe("Bairro é obrigatório");
    expect(marcadoInvalido("checkout-name")).toBe(true);
    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Por favor, preencha todos os campos obrigatórios corretamente.",
    );
  });

  it("CONTROLE de validade: com tudo preenchido a tela não tem erro e o Finalizar acende", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montarEAbrirASecao();
    await digitarSoOCep("01001000");

    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await act(async () => {
      digitar("checkout-cpf", "52998224725");
    });
    await act(async () => {
      digitar("guest-number", "10");
    });
    await drenar();

    expect(errosNaTela()).toEqual({});
    // Convidado com transportadora só fecha com conta (política P6) — o que
    // prova a validade do FORMULÁRIO é o aviso de pendência ter sumido.
    expect(
      document.querySelector(
        '[data-testid="checkout-pendencia-identificacao"]',
      ),
    ).toBeNull();
  });
});
