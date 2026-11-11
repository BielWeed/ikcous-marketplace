// @vitest-environment jsdom
//
// CAÇA r122-d (checkout-validacao-de-campos, achado 1): no formulário do
// VISITANTE, rua, número, bairro e cidade só eram recusados quando o texto
// aparado (`trim()`) ficava vazio. O `trim()` do JavaScript não tira U+200B
// (espaço de largura zero), U+2800 (Braille em branco) nem U+3164
// (preenchimento Hangul): um endereço colado com esses caracteres passava como
// "preenchido" e o pedido do visitante nascia com endereço ilegível (o banco
// só confere CEP e CPF). O NOME do mesmo formulário e o endereço da conta já
// usavam `nomeTemConteudoVisivel`. Aqui o visitante preenche tudo até ficar
// VÁLIDO (o controle prova que o botão acende) e só então um campo vira
// "só invisível". Harness de
// `checkout-nome-so-espacos-e-campos-de-texto-tem-teto.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { estado, produto } = vi.hoisted(() => {
  const produto = {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
  return {
    produto,
    estado: {
      user: null as null | { id: string },
      enderecos: [] as unknown[],
      cart: [{ product: produto, quantity: 1 }] as unknown[],
      cartTotal: 100,
      config: {
        shippingCoverage: "local",
        originCep: "38500-000",
        localCepRange: "01310-100",
        enableCoupons: false,
        whatsappNumber: "",
      } as Record<string, unknown>,
      offline: false,
    },
  };
});

const createOrder = vi.fn();
const clearCart = vi.fn();
const removeFromCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.enderecos,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: estado.cart,
      cartTotal: estado.cartTotal,
      shippingFee: 0,
      clearCart,
      removeFromCart,
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

const botaoFinalizar = () => botaoPorTexto("Finalizar Pedido");

function preencherValido() {
  digitar("checkout-name", "Cliente Teste");
  digitar("checkout-tel", "34999999999");
  digitar("guest-street", "Rua Teste");
  digitar("guest-number", "100");
  digitar("guest-neighborhood", "Centro");
}

const CAMPOS = [
  {
    id: "guest-street",
    campo: "rua",
    mensagem: "Rua é obrigatória",
    valido: "Rua Teste",
  },
  {
    id: "guest-number",
    campo: "número",
    mensagem: "Número é obrigatório",
    valido: "100",
  },
  {
    id: "guest-neighborhood",
    campo: "bairro",
    mensagem: "Bairro é obrigatório",
    valido: "Centro",
  },
  {
    id: "guest-city",
    campo: "cidade",
    mensagem: "Cidade é obrigatória",
    valido: "Cidade Teste",
  },
] as const;

// Escritos por código (não literais) para o arquivo continuar legível e para
// nenhum editor normalizar os caracteres.
const ZW = String.fromCodePoint(0x200b);
const BR = String.fromCodePoint(0x2800);
const HG = String.fromCodePoint(0x3164);

const SO_SEM_DESENHO = [
  { nome: "espaços comuns", valor: "   " },
  { nome: "U+200B (largura zero)", valor: ZW },
  { nome: "U+2800 (Braille em branco)", valor: BR },
  { nome: "U+3164 (preenchimento Hangul)", valor: HG },
  // Mistura: espaço comum + invisíveis de dois tipos, sem nenhuma letra.
  { nome: "mistura de espaço, U+200B e U+3164", valor: ` ${ZW}${HG} ` },
] as const;

describe("CheckoutView (visitante) — endereço só com caractere invisível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.user = null;
    estado.enderecos = [];
    estado.offline = false;
    estado.cart = [{ product: produto, quantity: 1 }];
    estado.cartTotal = 100;
    estado.config = {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    };
    createOrder.mockReset();
    sessionStorage.clear();
    pararABuscaDeCep();
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
    vi.restoreAllMocks();
  });

  /** Monta o checkout do visitante, preenche tudo e, no último assentamento,
   * põe `valor` no campo `id` (quando dado). */
  async function montarEPreencher(id?: string, valor?: string) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      preencherValido();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-city", "Cidade Teste");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-state", "SP");
      await esperarMicrotarefas();
    });
    if (id !== undefined && valor !== undefined) {
      await act(async () => {
        digitar(id, valor);
        await esperarMicrotarefas();
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
  }

  it("controle: com os quatro campos de verdade, o Finalizar está aceso", async () => {
    await montarEPreencher();

    expect(botaoFinalizar()).toBeDefined();
    expect(botaoFinalizar()!.disabled).toBe(false);
  });

  for (const { id, campo, mensagem, valido } of CAMPOS) {
    describe(`${campo} (#${id})`, () => {
      it.each(SO_SEM_DESENHO)(
        `${campo} só com $nome: Finalizar apagado, aviso do campo, nenhum pedido e foco da barra no campo`,
        async ({ valor }) => {
          await montarEPreencher(id, valor);

          // (1) o botão não acende
          expect(botaoFinalizar()).toBeDefined();
          expect(botaoFinalizar()!.disabled).toBe(true);

          // (2) depois de focar e sair do campo, a mensagem já existente
          const campoEl = document.getElementById(id) as HTMLInputElement;
          await act(async () => {
            campoEl.focus();
          });
          await act(async () => {
            campoEl.blur();
            await esperarMicrotarefas();
            await esperarMicrotarefas();
          });
          expect(document.getElementById(`erro-${id}`)?.textContent).toBe(
            mensagem,
          );

          // (3) nenhum pedido é criado
          expect(createOrder).not.toHaveBeenCalled();

          // (4) o aviso da barra leva o foco até ESTE campo
          const aviso = document.querySelector(
            '[data-testid="checkout-pendencia-identificacao"]',
          ) as HTMLButtonElement | null;
          expect(aviso).not.toBeNull();
          // O texto da barra e o cartão de resumo dizem "falta endereço" (e
          // não "confira seus dados", nem um resumo com endereço em branco).
          expect(aviso!.textContent).toContain(
            "Complete o endereço de entrega para finalizar",
          );
          expect(
            document.querySelector(
              '[data-testid="checkout-resumo-falta-endereco"]',
            ),
          ).not.toBeNull();
          (document.activeElement as HTMLElement | null)?.blur();
          await act(async () => {
            aviso!.click();
            await esperarMicrotarefas();
          });
          expect(document.activeElement?.id).toBe(id);

          // Ainda sem pedido depois do toque no aviso.
          expect(createOrder).not.toHaveBeenCalled();
        },
      );

      it(`${campo} com texto visível (e invisível nas pontas) acende o Finalizar`, async () => {
        await montarEPreencher(id, `${ZW}${valido}${ZW}`);

        expect(botaoFinalizar()!.disabled).toBe(false);
      });
    });
  }
});
