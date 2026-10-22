// @vitest-environment jsdom
//
// PASSO A5 do redesenho da tela "Finalizar pedido" (22/10/2026, aprovado pelo
// dono): ícones consistentes — cinza-escuro em quadradinho cinza claro, o Pix
// com o glifo OFICIAL que a casa já tem, e NADA de cor de marca nos ícones,
// quadradinhos, bolinhas de seleção e botões do formulário (o único amarelo
// da tela é o do botão Finalizar, na barra de baixo). Só apresentação.
//
// Harness herdado de checkout-compacto-e-cpf.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const {
  estadoEnderecos,
  contaEstavel,
  invoke,
  espelho,
  createOrder,
  criarPagamento,
  toastError,
  estadoLoja,
  cpfDaConta,
} = vi.hoisted(() => ({
  estadoEnderecos: { lista: [] as Address[] },
  contaEstavel: {
    user: { id: "user-1", user_metadata: { name: "Cliente Teste" } },
    profile: { full_name: "", whatsapp: "" },
  },
  invoke: vi.fn(),
  espelho: {
    selecionada: null as ShippingOption | null,
    shippingCep: null as string | null,
  },
  createOrder: vi.fn(),
  // PIX direto (25/09/2026): o checkout finalizado monta <PagamentoOnline>
  // de verdade, que chama `criarPagamento` no próprio mount (sem Brick) —
  // sem este mock a suíte quebra com "criarPagamento is not a function"
  // assim que um teste chega na tela de pagamento.
  criarPagamento: vi.fn(),
  toastError: vi.fn(),
  estadoLoja: { isLoaded: true },
  cpfDaConta: { ler: vi.fn(), gravar: vi.fn() },
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
const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 5,
  deliveryDays: 1,
  provider: "local",
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: estadoLoja.isLoaded,
  }),
}));

// CPF da conta (get_my_cpf/set_my_cpf) — dublê controlável por teste. O
// padrão (beforeEach) é leitura que FALHA: o checkout se comporta como se
// não soubesse se a conta tem CPF (não preenche, não mostra a caixa, não
// grava), que é o que os testes mais antigos deste arquivo esperam.
vi.mock("@/lib/cpf-da-conta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cpf-da-conta")>()),
  lerCpfDaConta: (...a: unknown[]) => cpfDaConta.ler(...a),
  gravarCpfDaConta: (...a: unknown[]) => cpfDaConta.gravar(...a),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: vi.fn(async () => {}),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
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
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    useEffect(() => {
      espelho.selecionada = selecionada;
      espelho.shippingCep = shippingCep;
    }, [selecionada, shippingCep]);
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

/** Diferente do dublê "em voo" de checkout-frete-automatico-troca-de-
 * endereco.test.tsx (que este harness herdou): aqui a cotação resolve NA
 * HORA para cada CEP conhecido — os testes deste arquivo são sobre a
 * seção "Seus dados e entrega" e o CPF, não sobre corrida de respostas. */
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
      const cep = opts.body.cep as string;
      const opcoes = mapa.get(cep);
      if (!opcoes) {
        return Promise.resolve({
          data: { options: [], cotacaoIncompleta: false },
          error: null,
        });
      }
      return Promise.resolve({
        data: { options: opcoes, revisaoConfig: "rev-fixa" },
        error: null,
      });
    },
  );
}

const PIX_OFICIAL = "M5.283 18.36a3.505";

const radios = () => [
  ...document.querySelectorAll<HTMLElement>('[role="radio"]'),
];
const radioDe = (texto: string) =>
  radios().find((r) => r.textContent?.includes(texto)) as HTMLElement;

describe("CheckoutView — PASSO A5: ícones e seleção neutros nas seções", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoEnderecos.lista = [CASA];
    contaEstavel.user = {
      id: "user-1",
      user_metadata: { name: "Cliente Teste" },
    };
    contaEstavel.profile = { full_name: "", whatsapp: "" };
    espelho.selecionada = null;
    espelho.shippingCep = null;
    invoke.mockReset();
    createOrder.mockReset();
    criarPagamento.mockReset();
    toastError.mockReset();
    estadoLoja.isLoaded = true;
    cpfDaConta.ler.mockReset();
    cpfDaConta.ler.mockResolvedValue({ ok: false, motivo: "falha" });
    cpfDaConta.gravar.mockReset();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    const sessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (c: string) => sessao.get(c) ?? null,
      setItem: (c: string, v: string) => {
        sessao.set(c, v);
      },
      removeItem: (c: string) => {
        sessao.delete(c);
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

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function montar() {
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
  }

  it("'Meio de pagamento' é título em texto normal, com o quadradinho neutro — o aria-label do grupo segue o mesmo", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    const titulo = document.getElementById("titulo-pagamento");
    expect(titulo?.tagName).toBe("H2");
    expect(titulo?.textContent).toBe("Meio de pagamento");
    expect(titulo?.className).not.toContain("uppercase");
    expect(titulo?.className).not.toContain("tracking-");
    const secao = titulo?.closest("section") as HTMLElement;
    expect(secao).not.toBeNull();
    const quadradinho = secao.querySelector("span[aria-hidden='true']");
    expect(quadradinho?.className).toContain("bg-zinc-100");
    expect(quadradinho?.className).toContain("text-zinc-700");
    expect(
      secao.querySelector('[role="radiogroup"]')?.getAttribute("aria-label"),
    ).toBe("Meio de pagamento");
  });

  it("o rótulo do grupo 'Na entrega' é legível (AA): cinza escuro, nunca o zinc-400 de 2,5:1", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    const rotulo = [...document.querySelectorAll("span")].find(
      (s) => s.textContent === "Na entrega",
    );
    expect(rotulo).toBeDefined();
    expect(rotulo?.className).toContain("text-zinc-600");
    expect(rotulo?.className).not.toContain("text-zinc-400");
  });

  it("cada meio de pagamento tem o ícone cinza-escuro em quadradinho cinza claro — nenhuma cor de marca ou de bandeira", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    for (const texto of [
      "Pagar agora com PIX",
      "Pix na Entrega",
      "Cartão na Entrega",
      "Dinheiro na Entrega",
    ]) {
      const opcao = radioDe(texto);
      expect(opcao, texto).toBeDefined();
      const tile = opcao.querySelector("span[aria-hidden='true']");
      expect(tile?.className, texto).toContain("bg-zinc-100");
      expect(tile?.className, texto).toContain("text-zinc-700");
      expect(tile?.className, texto).not.toMatch(
        /32BCAD|blue|amber|emerald|primary/,
      );
      expect(tile?.querySelector("svg"), texto).not.toBeNull();
    }
  });

  it("o Pix usa o glifo OFICIAL que a casa já tem (o mesmo nas duas opções de Pix)", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    for (const texto of ["Pagar agora com PIX", "Pix na Entrega"]) {
      const caminho = radioDe(texto).querySelector("svg path");
      expect(caminho?.getAttribute("d")?.startsWith(PIX_OFICIAL), texto).toBe(
        true,
      );
    }
  });

  it("a opção marcada: borda forte + bolinha escura com check (nunca a cor da marca); as outras, bolinha vazia", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    await act(async () => {
      radioDe("Dinheiro na Entrega").click();
    });
    await drenar();
    const marcada = radioDe("Dinheiro na Entrega");
    expect(marcada.getAttribute("aria-checked")).toBe("true");
    expect(marcada.className).toContain("border-zinc-900");
    const bolinha = marcada.querySelector(
      '[data-testid="selo-de-escolhida"]',
    ) as HTMLElement;
    expect(bolinha.className).toContain("bg-zinc-900");
    expect(bolinha.querySelector("svg")).not.toBeNull();
    for (const outra of radios().filter((r) => r !== marcada)) {
      expect(outra.getAttribute("aria-checked")).toBe("false");
      expect(outra.className).not.toContain("border-zinc-900");
      expect(
        outra.querySelector('[data-testid="bolinha-vazia"]'),
      ).not.toBeNull();
    }
    for (const r of radios()) expect(r.outerHTML).not.toContain("primary");
  });

  it("a escolha continua valendo: tocar em outro meio troca a marcada (mesma lógica de antes)", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    await act(async () => {
      radioDe("Cartão na Entrega").click();
    });
    await drenar();
    expect(radioDe("Cartão na Entrega").getAttribute("aria-checked")).toBe(
      "true",
    );
    await act(async () => {
      radioDe("Pix na Entrega").click();
    });
    await drenar();
    expect(radioDe("Pix na Entrega").getAttribute("aria-checked")).toBe("true");
    expect(radioDe("Cartão na Entrega").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("'Notas adicionais' segue com o mesmo texto e o quadradinho neutro", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    const rotulo = document.querySelector('label[for="order-notes"]');
    expect(rotulo?.textContent).toBe("Notas Adicionais (Opcional)");
    const quadradinho = rotulo
      ?.closest("section")
      ?.querySelector("span[aria-hidden='true']");
    expect(quadradinho?.className).toContain("bg-zinc-100");
  });

  it("o formulário não usa a cor da marca em lugar nenhum (botão 'Novo', foco das notas)", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    // Só o botão Finalizar (na barra de baixo, FORA daqui) segue amarelo.
    expect(hospedeiro.innerHTML).not.toMatch(
      /(?:bg|border|text|ring|fill)-primary|border-t-primary|focus:border-primary/,
    );
  });

  it("convidada: o aviso 'Entre na sua conta' tem o botão neutro e o toque leva ao login, como sempre", async () => {
    contaEstavel.user = null as any;
    contaEstavel.profile = null as any;
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    // Convidada compra "na entrega": os meios habituais seguem na tela.
    expect(radios().length).toBeGreaterThan(0);
    // O botão de PIX no app, bloqueado por falta de conta, leva ao login.
    onNavigate.mockClear();
    await act(async () => {
      radioDe("Pagar agora com PIX").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("auth");
  });
});
