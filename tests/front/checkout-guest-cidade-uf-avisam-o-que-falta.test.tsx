// @vitest-environment jsdom
//
// COMPRA SEM CONTA: CIDADE E UF VAZIAS NÃO AVISAVAM O QUE FALTAVA. Rua e
// Bairro mostram a mensagem de erro e ficam ligados a ela (aria-describedby);
// Cidade e UF só ganhavam `aria-invalid`, sem frase nenhuma. E o aviso
// vermelho "Complete o endereço de entrega" da barra do Finalizar levava o
// foco ao nome, ao WhatsApp e ao CPF, mas NUNCA a um campo de endereço: com o
// CEP "não encontrado" e rua, número e bairro digitados, a pessoa tocava no
// aviso e nada apontava a cidade que faltava.
//
// O que este arquivo prende:
//   1. tocar no aviso leva o foco ao PRIMEIRO campo de endereço que falta, na
//      ordem da tela (CEP, número, rua, bairro, cidade, UF);
//   2. Cidade e UF mostram a mensagem e ficam ligadas a ela, como Rua/Bairro;
//   3. a UF digitada em minúscula sai em maiúscula no pedido (e SÓ ela mudou
//      no endereço enviado);
//   4. o exemplo da UF não parece valor preenchido.
//
// Montagem copiada de checkout-guest-endereco-editavel-cobertura-local.test.tsx
// (entrega local escolhida, convidado). A busca de CEP é parada (dublê que
// nunca responde): o assunto aqui não é a busca.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-uf-1" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "local" as "national" | "local",
    originCep: "38500-000" as string | undefined,
    localCepRange: "01310-100",
    storeCity: "Uberlândia" as string | undefined,
    storeState: "MG" as string | undefined,
  },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
      {
        product: {
          id: "prod-1",
          name: "Produto Teste",
          description: "",
          price: 100,
          images: [],
          category: "geral",
          stock: 10,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date().toISOString(),
        },
        quantity: 1,
      },
    ],
    cartTotal: 100,
    shippingFee: 0,
    clearCart: vi.fn(),
    selectedShippingOption: {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    },
    shippingCep: "",
  }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
// A barra do Finalizar (onde mora o aviso) só entra 380 ms depois da tela; aqui
// ela já nasce montada.
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
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

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function errosNaTela(): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const p of document.querySelectorAll<HTMLElement>('[id^="erro-"]')) {
    saida[p.id] = p.textContent ?? "";
  }
  return saida;
}

describe("CheckoutView (convidado) — o aviso da barra aponta o endereço que falta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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
    // Entrega local não pede CPF: o aviso da barra só depende do endereço.
    await act(async () => {
      botaoPorTexto("Pix na Entrega")?.click();
      await esperarMicrotarefas();
    });
  }

  // Cada digitação no seu próprio `act` (mesma razão de
  // checkout-guest-endereco-editavel-cobertura-local.test.tsx: validações
  // assíncronas concorrentes do zodResolver).
  async function preencher(campos: Record<string, string>) {
    for (const [id, valor] of Object.entries(campos)) {
      await act(async () => {
        digitar(id, valor);
        await esperarMicrotarefas();
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }

  const IDENTIFICACAO = {
    "checkout-name": "Cliente Teste",
    "checkout-tel": "34999999999",
  };

  async function tocarNoAviso() {
    const aviso = document.querySelector<HTMLButtonElement>(
      '[data-testid="checkout-pendencia-identificacao"]',
    );
    expect(aviso, "o aviso da barra tem de existir").not.toBeNull();
    await act(async () => {
      aviso?.click();
      await esperarMicrotarefas();
    });
    return aviso;
  }

  beforeEach(() => {
    sessionStorage.clear();
    createOrder.mockClear();
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
    Object.assign(mockConfig, {
      shippingCoverage: "local",
      storeState: "MG",
    });
  });

  it("CEP não achado, rua/número/bairro digitados: o aviso leva o foco à CIDADE e mostra a mensagem dela e da UF", async () => {
    await montar();
    await preencher({
      ...IDENTIFICACAO,
      "guest-cep": "99999-999",
      "guest-street": "Rua Teste",
      "guest-number": "100",
      "guest-neighborhood": "Centro",
    });

    // Âncora: só o que falta é cidade e UF.
    const aviso = await tocarNoAviso();
    expect(aviso?.textContent).toContain("Complete o endereço de entrega");

    expect(document.activeElement?.id).toBe("guest-city");

    const erros = errosNaTela();
    expect(erros["erro-guest-city"]).toBe("Cidade é obrigatória");
    expect(erros["erro-guest-state"]).toBe("Estado inválido");

    const cidade = document.getElementById("guest-city")!;
    const uf = document.getElementById("guest-state")!;
    expect(cidade.getAttribute("aria-invalid")).toBe("true");
    expect(cidade.getAttribute("aria-describedby")).toBe("erro-guest-city");
    expect(uf.getAttribute("aria-invalid")).toBe("true");
    expect(uf.getAttribute("aria-describedby")).toBe("erro-guest-state");
  });

  it("cidade preenchida e UF vazia: o foco vai à UF", async () => {
    await montar();
    await preencher({
      ...IDENTIFICACAO,
      "guest-cep": "99999-999",
      "guest-street": "Rua Teste",
      "guest-number": "100",
      "guest-neighborhood": "Centro",
      "guest-city": "Cidade Teste",
    });

    await tocarNoAviso();

    expect(document.activeElement?.id).toBe("guest-state");
    const erros = errosNaTela();
    expect(erros["erro-guest-state"]).toBe("Estado inválido");
    expect(erros["erro-guest-city"]).toBeUndefined();
  });

  it("UF que não existe ('ZZ') também recebe o foco: vazio OU inválido", async () => {
    await montar();
    await preencher({
      ...IDENTIFICACAO,
      "guest-cep": "99999-999",
      "guest-street": "Rua Teste",
      "guest-number": "100",
      "guest-neighborhood": "Centro",
      "guest-city": "Cidade Teste",
      "guest-state": "ZZ",
    });

    await tocarNoAviso();

    expect(document.activeElement?.id).toBe("guest-state");
  });

  it("ORDEM da tela: faltando o número (e a cidade), o foco vai ao número, não à cidade", async () => {
    await montar();
    await preencher({
      ...IDENTIFICACAO,
      "guest-cep": "99999-999",
      "guest-street": "Rua Teste",
      "guest-neighborhood": "Centro",
    });

    await tocarNoAviso();

    expect(document.activeElement?.id).toBe("guest-number");
  });

  it("CEP incompleto: o foco vai ao CEP, o primeiro da ordem", async () => {
    await montar();
    await preencher({
      ...IDENTIFICACAO,
      "guest-cep": "9999",
      "guest-street": "Rua Teste",
    });

    await tocarNoAviso();

    expect(document.activeElement?.id).toBe("guest-cep");
  });

  it("nome faltando continua na frente do endereço (a ordem antiga não muda)", async () => {
    await montar();
    await preencher({
      "checkout-tel": "34999999999",
      "guest-cep": "99999-999",
    });

    await tocarNoAviso();

    expect(document.activeElement?.id).toBe("checkout-name");
  });

  it("a UF digitada em minúscula sai em MAIÚSCULA no pedido, e o resto do endereço sai como foi digitado", async () => {
    await montar();
    await preencher({
      ...IDENTIFICACAO,
      "guest-cep": "01310-100",
      "guest-street": "Rua Teste",
      "guest-number": "100",
      "guest-neighborhood": "Centro",
      "guest-city": "Cidade Teste",
      "guest-state": "sp",
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const finalizar = botaoPorTexto("Finalizar Pedido")!;
    expect(finalizar.disabled).toBe(false);
    await act(async () => {
      finalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.addressData.state).toBe("SP");
    expect(pedido.addressData.city).toBe("Cidade Teste");
    expect(pedido.addressData.street).toBe("Rua Teste");
    expect(pedido.addressData.number).toBe("100");
    expect(pedido.addressData.neighborhood).toBe("Centro");
  });

  it("outra UF em minúscula (rj) também sai em maiúscula", async () => {
    await montar();
    await preencher({
      ...IDENTIFICACAO,
      "guest-cep": "01310-100",
      "guest-street": "Rua Teste",
      "guest-number": "100",
      "guest-neighborhood": "Centro",
      "guest-city": "Cidade Teste",
      "guest-state": "rj",
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    await act(async () => {
      botaoPorTexto("Finalizar Pedido")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder.mock.calls[0][0].addressData.state).toBe("RJ");
  });

  it("o exemplo da UF não parece um valor já preenchido (loja com estado definido)", async () => {
    await montar();
    const uf = document.getElementById("guest-state") as HTMLInputElement;
    // Entrega local + estado da loja: a dica aparece, mas como EXEMPLO.
    expect(uf.placeholder).not.toBe("MG");
    expect(uf.placeholder).toContain("UF");
    expect(uf.placeholder).toContain("MG");
    // Nada foi escrito dentro do campo.
    expect(uf.value).toBe("");
  });
});
