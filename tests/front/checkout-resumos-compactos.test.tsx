// @vitest-environment jsdom
//
// PASSO A1 do redesenho da tela "Finalizar pedido" (22/10/2026, aprovado pelo
// dono): "Seus dados" e "Endereço de entrega" viram DOIS resumos compactos
// (nome + WhatsApp; endereço em 1-2 linhas; selo verde de ok; "Editar" e
// "Trocar" discretos) e só expandem para os MESMOS formulários de antes.
// Só APRESENTAÇÃO: nenhuma regra de preço, frete, cupom, validação ou pedido
// muda aqui. Harness herdado de checkout-compacto-e-cpf.test.tsx
// (ShippingCalculator REAL, `modoResumo` como o checkout passa).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function cabecalhoDaSecao(): HTMLButtonElement {
  return document.getElementById(
    "cabecalho-dados-e-entrega",
  ) as HTMLButtonElement;
}

function corpoDaSecao(): HTMLElement {
  return document.getElementById("secao-dados-e-entrega") as HTMLElement;
}

const cartaoDeDados = () =>
  document.querySelector('section[aria-label="Seus dados"]') as HTMLElement;
const cartaoDeEndereco = () =>
  document.querySelector(
    'section[aria-label="Endereço de entrega"]',
  ) as HTMLElement;
const botaoDentro = (el: Element | null, texto: string) =>
  [...(el?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
const selosDeOk = (el: Element | null) =>
  el?.querySelectorAll('[data-testid="selo-de-ok"]').length ?? 0;

describe("CheckoutView — PASSO A1: resumos compactos de dados e endereço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoEnderecos.lista = [CASA, TRABALHO];
    contaEstavel.user = {
      id: "user-1",
      user_metadata: { name: "Cliente Teste" },
    };
    contaEstavel.profile = { full_name: "", whatsapp: "" };
    espelho.selecionada = null;
    espelho.shippingCep = null;
    invoke.mockReset();
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-1" });
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

  async function preencherNomeEWhatsapp() {
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();
  }

  async function tocarNoCartaoDeEndereco(apelido: string) {
    const cartao = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    ].find((el) => el.textContent?.includes(apelido));
    expect(cartao, `cartão do endereço ${apelido}`).toBeDefined();
    await act(async () => {
      cartao?.click();
    });
    await drenar();
  }

  it("recolhida e completa: DOIS cartões separados, com selo de ok, nome, WhatsApp abreviado, apelido e endereço", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    await preencherNomeEWhatsapp();

    const dados = cartaoDeDados();
    const endereco = cartaoDeEndereco();
    expect(dados).not.toBeNull();
    expect(endereco).not.toBeNull();
    // Dois cartões, nenhum dentro do outro.
    expect(dados.contains(endereco)).toBe(false);
    expect(endereco.contains(dados)).toBe(false);

    expect(dados.textContent).toContain("Maria Teste");
    expect(dados.textContent).toContain("(34)");
    expect(dados.textContent).toContain("8888");
    expect(dados.textContent).not.toContain("999998888");
    expect(selosDeOk(dados)).toBe(1);

    expect(endereco.textContent).toContain("Casa");
    expect(endereco.textContent).toContain("Rua Principal");
    expect(endereco.textContent).toContain("Monte Carmelo");
    expect(selosDeOk(endereco)).toBe(1);

    // O cabeçalho "Seus dados e entrega" só existe com a seção aberta.
    expect(document.getElementById("cabecalho-dados-e-entrega")).toBeNull();
  });

  it("o endereço do resumo quebra em quantas linhas precisar: cidade e CEP nunca somem atrás de reticências", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    await preencherNomeEWhatsapp();
    const linha = Array.from(cartaoDeEndereco().querySelectorAll("p")).find(
      (p) => p.textContent?.includes("Rua Principal"),
    ) as HTMLElement;
    expect(linha).toBeDefined();
    expect(linha.textContent).toContain("Monte Carmelo");
    expect(linha.textContent).toContain("38500-000");
    expect(linha.className).not.toContain("line-clamp");
    // Palavra comprida (avenida, bairro) quebra em vez de estourar o cartão.
    expect(linha.className).toContain("break-words");
  });

  it("os formulários continuam no DOM (escondidos) com o resumo na tela — nada foi removido", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    const corpo = document.getElementById("secao-dados-e-entrega");
    expect(corpo?.hidden).toBe(true);
    expect(document.getElementById("checkout-name")).not.toBeNull();
    expect(document.getElementById("checkout-tel")).not.toBeNull();
    // Endereços salvos (logada): a lista com os cartões também segue montada.
    expect(corpo?.textContent).toContain("Trabalho");
  });

  it("'Editar' e 'Trocar' são alvos de 44px, anunciam o painel que abrem e abrem o MESMO formulário", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    await preencherNomeEWhatsapp();

    for (const [cartao, rotulo] of [
      [cartaoDeDados(), "Editar"],
      [cartaoDeEndereco(), "Trocar"],
    ] as const) {
      const botao = botaoDentro(cartao, rotulo);
      expect(botao, rotulo).toBeDefined();
      expect(botao?.type).toBe("button");
      expect(botao?.className).toContain("min-h-11");
      expect(botao?.className).toContain("min-w-11");
      expect(botao?.getAttribute("aria-expanded")).toBe("false");
      expect(botao?.getAttribute("aria-controls")).toBe(
        "secao-dados-e-entrega",
      );
    }

    await act(async () => {
      botaoDentro(cartaoDeDados(), "Editar")?.click();
    });
    await drenar();
    expect(corpoDaSecao().hidden).toBe(false);
    // Aberta: os dois resumos saem e o cabeçalho de recolher aparece.
    expect(cartaoDeDados()).toBeNull();
    expect(cartaoDeEndereco()).toBeNull();
    const cabecalho = cabecalhoDaSecao();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");
    // O foco não se perde com o botão que sumiu: vai para o cabeçalho.
    expect(document.activeElement?.id).toBe("cabecalho-dados-e-entrega");

    await act(async () => {
      cabecalho.click();
    });
    await drenar();
    expect(corpoDaSecao().hidden).toBe(true);
    expect(cartaoDeDados()).not.toBeNull();
    expect(document.getElementById("cabecalho-dados-e-entrega")).toBeNull();
    // Recolher devolve o foco ao "Editar" (o botão que tinha aberto).
    expect(document.activeElement?.textContent?.trim()).toBe("Editar");
  });

  it("'Trocar' do endereço abre a seção e escolher outro endereço recolhe de volta aos resumos, já com o novo", async () => {
    cotacoesControladas({ "38500000": [LOCAL], "01001000": [PAC_SP] });
    await montar();
    await preencherNomeEWhatsapp();

    await act(async () => {
      botaoDentro(cartaoDeEndereco(), "Trocar")?.click();
    });
    await drenar();
    expect(corpoDaSecao().hidden).toBe(false);

    await tocarNoCartaoDeEndereco("Trabalho");

    expect(corpoDaSecao().hidden).toBe(true);
    expect(cartaoDeEndereco().textContent).toContain("Trabalho");
    expect(cartaoDeEndereco().textContent).toContain("Praça da Sé");
    expect(espelho.selecionada?.id).toBe("melhorenvio-pac");
  });

  it("pendências: sem nome e sem WhatsApp o cartão de dados NÃO ganha selo de ok e aponta o que falta", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    const dados = cartaoDeDados();
    expect(selosDeOk(dados)).toBe(0);
    expect(
      dados.querySelector('[data-testid="checkout-resumo-falta-nome"]'),
    ).not.toBeNull();
    expect(
      dados.querySelector('[data-testid="checkout-resumo-falta-whatsapp"]'),
    ).not.toBeNull();
    // Com um dado só, o selo continua ausente até COMPLETAR os dois.
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await drenar();
    expect(selosDeOk(cartaoDeDados())).toBe(0);
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();
    expect(selosDeOk(cartaoDeDados())).toBe(1);
  });

  it("transportadora sem CPF: o cartão de dados pede o CPF e não mostra ok", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await preencherNomeEWhatsapp();
    await act(async () => {
      botaoDentro(cartaoDeEndereco(), "Trocar")?.click();
    });
    await drenar();
    await tocarNoCartaoDeEndereco("Trabalho");
    const dados = cartaoDeDados();
    expect(
      dados.querySelector('[data-testid="checkout-resumo-falta-cpf"]'),
    ).not.toBeNull();
    expect(selosDeOk(dados)).toBe(0);
  });

  it("logada SEM endereço: o cartão de endereço é um aviso âmbar tocável que abre o formulário, sem selo de ok", async () => {
    estadoEnderecos.lista = [];
    cotacoesControladas({});
    await montar();
    const endereco = cartaoDeEndereco();
    expect(selosDeOk(endereco)).toBe(0);
    const aviso = endereco.querySelector<HTMLButtonElement>(
      '[data-testid="checkout-resumo-falta-endereco"]',
    );
    expect(aviso?.textContent).toContain("Cadastre um endereço de entrega");
    expect(aviso?.className).toContain("min-h-11");
    // Aviso é âmbar (atenção), não vermelho de erro.
    expect(aviso?.className).toContain("text-amber-800");
    expect(aviso?.className).not.toContain("text-red");
    await act(async () => {
      aviso?.click();
    });
    await drenar();
    expect(corpoDaSecao().hidden).toBe(false);
  });

  it("convidada: sem endereço, o aviso de falta; com o endereço completo, o resumo com selo de ok e 'Editar'", async () => {
    pararABuscaDeCep();
    contaEstavel.user = null as any;
    contaEstavel.profile = null as any;
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    expect(
      cartaoDeEndereco().querySelector(
        '[data-testid="checkout-resumo-falta-endereco"]',
      ),
    ).not.toBeNull();
    expect(selosDeOk(cartaoDeEndereco())).toBe(0);

    for (const [id, valor] of [
      ["guest-cep", "38500000"],
      ["guest-number", "10"],
      ["guest-street", "Rua Nova"],
      ["guest-neighborhood", "Centro"],
      ["guest-city", "Monte Carmelo"],
      ["guest-state", "MG"],
    ] as const) {
      await act(async () => {
        digitar(id, valor);
      });
    }
    await drenar();
    const endereco = cartaoDeEndereco();
    expect(endereco.textContent).toContain("Rua Nova");
    expect(selosDeOk(endereco)).toBe(1);
    const linhaDoEndereco = Array.from(endereco.querySelectorAll("p")).find(
      (p) => p.textContent?.includes("Rua Nova"),
    ) as HTMLElement;
    expect(linhaDoEndereco.className).not.toContain("line-clamp");
    expect(linhaDoEndereco.className).toContain("break-words");
    expect(botaoDentro(endereco, "Editar")).toBeDefined();
  });
});
