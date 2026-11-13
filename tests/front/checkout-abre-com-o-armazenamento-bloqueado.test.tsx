// @vitest-environment jsdom
//
// O CHECKOUT ABRE COM O ARMAZENAMENTO DO NAVEGADOR BLOQUEADO (caça, r430-a).
//
// Chrome com "Bloquear todos os cookies e dados de sites", Safari com
// "Bloquear todos os cookies" e certos modos privados/WebViews fazem o próprio
// ACESSO a `window.localStorage` / `window.sessionStorage` lançar
// SecurityError — não só getItem/setItem. O CheckoutView lia o CEP salvo
// (`localStorage`) na criação do formulário e do ref do CEP, e o rascunho
// (`sessionStorage`) nos efeitos de montagem: a exceção chegava ao error
// boundary e a cliente ficava sem comprar, mesmo com internet (e recarregar
// repetia a mesma leitura). Sem armazenamento, o checkout abre sem CEP salvo e
// sem rascunho, e o CEP digitado continua buscando o endereço.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "national", originCep: "38500-000" },
    isLoaded: true,
  }),
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
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_CEP = "ikcous_last_shipping_cep";

type NomeDoArmazenamento = "localStorage" | "sessionStorage";

/** O bloqueio de verdade: o ACESSO à propriedade lança, como no navegador. */
function bloquearOAcesso(nome: NomeDoArmazenamento): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, nome);
  Object.defineProperty(globalThis, nome, {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, nome, original);
    else Reflect.deleteProperty(globalThis, nome);
  };
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

function digitarNoTextarea(id: string, texto: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(el, texto);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function valor(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

describe("CheckoutView (convidado) — armazenamento do navegador bloqueado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let restaurar: Array<() => void>;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  beforeEach(() => {
    restaurar = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    for (const desfazer of restaurar) desfazer();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("localStorage e sessionStorage lançam ao ACESSAR: o checkout abre, sem CEP salvo", async () => {
    restaurar.push(bloquearOAcesso("localStorage"));
    restaurar.push(bloquearOAcesso("sessionStorage"));

    await montar();

    expect(document.getElementById("guest-cep")).not.toBeNull();
    expect(valor("guest-cep")).toBe("");
  });

  it("com o armazenamento bloqueado, o CEP digitado segue buscando o endereço", async () => {
    restaurar.push(bloquearOAcesso("localStorage"));
    restaurar.push(bloquearOAcesso("sessionStorage"));
    await montar();

    await act(async () => {
      digitar("guest-cep", "01310100");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(valor("guest-cep")).toBe("01310-100");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("01310100")),
    ).toBe(true);
  });

  it("com o armazenamento bloqueado, preencher o formulário e as observações não lança (rascunho é só um extra)", async () => {
    restaurar.push(bloquearOAcesso("localStorage"));
    restaurar.push(bloquearOAcesso("sessionStorage"));
    await montar();

    await act(async () => {
      digitar("guest-number", "123");
    });
    await act(async () => {
      digitarNoTextarea("order-notes", "Deixar com o porteiro");
    });

    expect(valor("guest-number")).toBe("123");
    expect(
      (document.getElementById("order-notes") as HTMLTextAreaElement).value,
    ).toBe("Deixar com o porteiro");
  });

  it("controle: com o armazenamento normal, o que a cliente preenche vira rascunho na sessão", async () => {
    const sessao = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => sessao.get(chave) ?? null,
      setItem: (chave: string, v: string) => {
        sessao.set(chave, v);
      },
      removeItem: (chave: string) => {
        sessao.delete(chave);
      },
    });
    await montar();

    await act(async () => {
      digitar("guest-number", "123");
    });
    await act(async () => {
      digitarNoTextarea("order-notes", "Deixar com o porteiro");
    });

    const rascunho = JSON.parse(
      sessao.get("ikcous-rascunho-do-checkout-v1") ?? "{}",
    );
    expect(rascunho.numero).toBe("123");
    expect(rascunho.notas).toBe("Deixar com o porteiro");
  });

  it("controle: com o armazenamento normal, o CEP salvo volta e o CEP completo é guardado", async () => {
    const guardado = new Map<string, string>([[CHAVE_CEP, "01310-100"]]);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => guardado.get(chave) ?? null,
      setItem: (chave: string, v: string) => {
        guardado.set(chave, v);
      },
      removeItem: (chave: string) => {
        guardado.delete(chave);
      },
    });
    const sessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => sessao.get(chave) ?? null,
      setItem: (chave: string, v: string) => {
        sessao.set(chave, v);
      },
      removeItem: (chave: string) => {
        sessao.delete(chave);
      },
    });

    await montar();
    expect(valor("guest-cep")).toBe("01310-100");

    await act(async () => {
      digitar("guest-cep", "38500000");
    });
    expect(guardado.get(CHAVE_CEP)).toBe("38500-000");
  });
});
