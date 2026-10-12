// @vitest-environment jsdom
//
// Endereço MISTURADO quando a busca do CEP NOVO falha, no checkout de
// CONVIDADO. O cliente acha o CEP A (rua, bairro, cidade e UF vêm da busca),
// troca para o CEP B, e a busca de B não acha o CEP, demora ou está fora do
// ar: rua, bairro, cidade e UF da busca de A seguiam na tela, e o pedido podia
// sair com o CEP B e a cidade A. Existia na base; desde o #761 vale em toda
// loja.
//
// O AddressForm (conta logada) já limpa nesse caso (efeito de `resultadoCep`,
// `eraDeOutroCep`). Aqui a mesma limpeza, nos três desfechos de falha, com a
// regra do #763 por cima: campo que o cliente digitou à mão (marcado e não
// vazio) NÃO é apagado.
//
// O fetch é um dublê controlado pelo teste (ver checkout-guest-cep.test.tsx).
// Montagem copiada de checkout-guest-cep-nao-sobrescreve-o-que-o-cliente-
// digitou.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "local", originCep: "38500-000" },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-guest-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAULISTA = {
  logradouro: "Avenida Paulista",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
};
const CEP_A = "01310100";

// Os três desfechos de falha do hook, e o aviso (toast) que cada um dá — o
// aviso não muda neste trabalho; o teste só confirma que continua saindo.
type Falha = "naoEncontrado" | "demorou" | "indisponivel";
const FALHAS: readonly (readonly [Falha, string])[] = [
  ["naoEncontrado", "CEP não encontrado"],
  ["demorou", "A busca de CEP demorou demais"],
  ["indisponivel", "Não foi possível buscar o CEP agora"],
];

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function valor(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

describe("CheckoutView (convidado) — busca do CEP novo que falha não deixa o endereço do CEP anterior", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Buscas do CEP A, seguradas até o teste responder.
  let pendentesDoA: Map<string, (data: unknown) => void>;
  // Chamadas ao fetch do CEP B ainda sem resposta (uma por provedor
  // consultado) e o desfecho de falha que o teste já mandou aplicar.
  let seguradasDoB: { resolver: () => void; rejeitar: () => void }[];
  let falhaDoB: Falha | null;
  // Quando preenchido, a PRÓXIMA busca do CEP A já falha na hora.
  let falhaDoA: "naoEncontrado" | "indisponivel" | null;
  let toastError: ReturnType<typeof vi.spyOn>;

  function responderFalha(falha: "naoEncontrado" | "indisponivel") {
    if (falha === "naoEncontrado") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ erro: true, error: true, code: "not_found" }),
      } as Response);
    }
    return Promise.reject(new TypeError("Failed to fetch"));
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
  }

  async function digitarEsperando(id: string, texto: string) {
    await act(async () => {
      digitar(id, texto);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function acharOCepA() {
    await digitarEsperando("guest-cep", "01310-100");
    expect(pendentesDoA.has(CEP_A)).toBe(true);
    await act(async () => {
      pendentesDoA.get(CEP_A)!(PAULISTA);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(valor("guest-city")).toBe("São Paulo");
  }

  // Digita o CEP B e deixa a busca de B EM VOO. Sem `setTimeout` de verdade:
  // o desfecho "demorou" roda com timers falsos.
  async function trocarParaOCepB() {
    await act(async () => {
      digitar("guest-cep", "38500-000");
      await Promise.resolve();
    });
  }

  // Aplica o desfecho de falha à busca de B, que já está em voo.
  async function falharABuscaDeB(falha: Falha) {
    if (falha === "demorou") {
      // Cada provedor pendura até o teto da tentativa (3 s); três tentativas.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      return;
    }
    await act(async () => {
      falhaDoB = falha;
      for (const s of seguradasDoB.splice(0)) {
        if (falha === "naoEncontrado") s.resolver();
        else s.rejeitar();
      }
      await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    });
  }

  beforeEach(() => {
    pendentesDoA = new Map();
    seguradasDoB = [];
    falhaDoB = null;
    falhaDoA = null;
    globalThis.sessionStorage.clear();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, v: string) => {
        armazem.set(chave, v);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    // `indisponivel` faz o hook registrar cada falha de provedor no console.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const cep = /\/(\d{8})(?:\/|$)/.exec(url)?.[1] ?? "";
        if (cep === CEP_A) {
          if (falhaDoA) return responderFalha(falhaDoA);
          return new Promise((resolve) => {
            pendentesDoA.set(cep, (data: unknown) =>
              resolve({ json: () => Promise.resolve(data) } as Response),
            );
          });
        }
        // CEP B: já mandaram falhar → responde a falha na hora; senão
        // segura, e honra o AbortSignal (é o que o teto da tentativa usa).
        if (falhaDoB === "naoEncontrado" || falhaDoB === "indisponivel") {
          return responderFalha(falhaDoB);
        }
        return new Promise((resolve, reject) => {
          seguradasDoB.push({
            resolver: () => resolve(responderFalha("naoEncontrado")),
            rejeitar: () => reject(new TypeError("Failed to fetch")),
          });
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
          );
        });
      }),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // O desfecho "demorou" só existe com timers falsos; os outros dois, não.
  function prepararTimers(falha: Falha) {
    if (falha === "demorou") {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    }
  }

  it.each(FALHAS)(
    "CEP A achado, troca para o CEP B e a busca falha (%s): rua, bairro, cidade e UF somem e o aviso sai",
    async (falha, aviso) => {
      await montar();
      await acharOCepA();
      expect(valor("guest-street")).toBe("Avenida Paulista");
      expect(valor("guest-neighborhood")).toBe("Bela Vista");
      expect(valor("guest-state")).toBe("SP");

      prepararTimers(falha);
      await trocarParaOCepB();
      await falharABuscaDeB(falha);

      expect(toastError).toHaveBeenCalledWith(expect.stringContaining(aviso));
      expect(valor("guest-street")).toBe("");
      expect(valor("guest-neighborhood")).toBe("");
      expect(valor("guest-city")).toBe("");
      expect(valor("guest-state")).toBe("");
    },
  );

  it.each(FALHAS)(
    "a rua que o cliente digitou durante a busca de B fica quando ela falha (%s); o resto é limpo",
    async (falha) => {
      await montar();
      await acharOCepA();

      prepararTimers(falha);
      await trocarParaOCepB();
      // A busca de B ainda está em voo: o cliente corrige a rua à mão.
      await act(async () => {
        digitar("guest-street", "Rua Do Cliente");
        await Promise.resolve();
      });
      await falharABuscaDeB(falha);

      expect(valor("guest-street")).toBe("Rua Do Cliente");
      expect(valor("guest-neighborhood")).toBe("");
      expect(valor("guest-city")).toBe("");
      expect(valor("guest-state")).toBe("");
    },
  );

  it("a rua corrigida à mão para o CEP A, ANTES de trocar para o B, é do A: com a busca de B falhando, sai com o resto", async () => {
    // Documenta a fronteira da regra: a marca de "editado à mão" vale para o
    // CEP em que o cliente digitou. Trocar o CEP a zera (é o contrato do
    // #763), então uma rua digitada para o CEP A não sobrevive misturada com
    // o CEP B — seria o mesmo defeito, com a rua no lugar da cidade.
    await montar();
    await acharOCepA();
    await digitarEsperando("guest-street", "Rua Do Cliente");

    await trocarParaOCepB();
    await falharABuscaDeB("naoEncontrado");

    expect(valor("guest-street")).toBe("");
    expect(valor("guest-city")).toBe("");
  });

  it("sem busca aplicada antes (campos digitados à mão antes do CEP): a busca que falha não limpa nada", async () => {
    await montar();
    await digitarEsperando("guest-street", "Rua Do Cliente");
    await digitarEsperando("guest-neighborhood", "Bairro Do Cliente");
    await digitarEsperando("guest-city", "Cidade Do Cliente");
    await digitarEsperando("guest-state", "RJ");

    await trocarParaOCepB();
    await falharABuscaDeB("naoEncontrado");

    // Nenhum dado de busca na tela: o que está lá é só do cliente.
    expect(valor("guest-street")).toBe("Rua Do Cliente");
    expect(valor("guest-neighborhood")).toBe("Bairro Do Cliente");
    expect(valor("guest-city")).toBe("Cidade Do Cliente");
    expect(valor("guest-state")).toBe("RJ");
  });

  it("redigitar o MESMO CEP A e a busca falhar desta vez: o endereço que veio dele fica (o dono dos campos é o mesmo CEP)", async () => {
    await montar();
    await acharOCepA();

    falhaDoA = "naoEncontrado";
    await digitarEsperando("guest-cep", "01310-10");
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    });

    expect(valor("guest-street")).toBe("Avenida Paulista");
    expect(valor("guest-city")).toBe("São Paulo");
  });

  it("depois de limpar, o cliente preenche à mão e um terceiro CEP também falha: o que ele digitou fica (o dono dos campos deixou de ser o A)", async () => {
    await montar();
    await acharOCepA();
    await trocarParaOCepB();
    await falharABuscaDeB("naoEncontrado");
    expect(valor("guest-city")).toBe("");

    await digitarEsperando("guest-city", "Monte Carmelo");
    // CEP diferente de B: as marcas zeram, mas já não há busca dona dos campos.
    await digitarEsperando("guest-cep", "20040-02");
    await act(async () => {
      digitar("guest-cep", "20040-020");
      await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    });

    expect(valor("guest-city")).toBe("Monte Carmelo");
  });

  it("depois de limpar, uma segunda tentativa do mesmo CEP B que também falha não apaga o que o cliente digitou entre as duas", async () => {
    await montar();
    await acharOCepA();
    await trocarParaOCepB();
    await falharABuscaDeB("naoEncontrado");
    expect(valor("guest-city")).toBe("");

    // O cliente preenche à mão (o aviso pediu isso) e tenta o mesmo CEP B de
    // novo. Os campos já são dele, e o dono deles não é mais o CEP A.
    await digitarEsperando("guest-city", "Monte Carmelo");
    await digitarEsperando("guest-cep", "38500-00");
    await digitarEsperando("guest-cep", "38500-000");
    await act(async () => {
      await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    });

    expect(valor("guest-city")).toBe("Monte Carmelo");
  });
});
