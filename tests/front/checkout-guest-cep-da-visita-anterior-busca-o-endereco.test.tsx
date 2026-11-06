// @vitest-environment jsdom
//
// COMPRA SEM CONTA: O CEP JÁ VEM PREENCHIDO DE UMA VISITA ANTERIOR, MAS O
// ENDEREÇO NÃO ERA BUSCADO. O campo CEP nasce de `ikcous_last_shipping_cep`,
// só que a busca (ViaCEP e cia.) rodava apenas quando a pessoa DIGITAVA: quem
// voltava ao checkout via o CEP completo e rua/bairro/cidade/UF vazios, e
// nada os preenchia. Além disso, o `onChange` gravava o CEP a cada tecla,
// inclusive o pedaço ("0131"), e esse pedaço voltava como "CEP" na visita
// seguinte.
//
// O que este arquivo prende:
//   1. CEP completo semeado + endereço todo vazio, convidado: UMA busca na
//      abertura e os quatro campos preenchidos;
//   2. a busca não apaga o que a pessoa digitou enquanto ela está em voo;
//   3. sem a semente completa (CEP parcial) ou com endereço já preenchido
//      (rascunho da sessão), NENHUMA busca na abertura;
//   4. CEP que ninguém acha: uma busca só, campos vazios, sem laço;
//   5. só um CEP de 8 dígitos é gravado no aparelho.
//
// Montagem copiada de checkout-guest-cep.test.tsx (ViaCEP dublê que responde
// só quando o teste manda).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
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
const CHAVE_RASCUNHO = "ikcous-rascunho-do-checkout-v1";

const PAULISTA = {
  logradouro: "Avenida Paulista",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
};

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

describe("CheckoutView (convidado) — CEP semeado do aparelho busca o endereço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, (dados: unknown) => void>;
  let armazem: Map<string, string>;
  let sessao: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Quantas vezes a rede foi consultada para este CEP (qualquer provedor). */
  function consultasDoCep(cep: string): number {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes(cep))
      .length;
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  async function responder(cep: string, dados: unknown) {
    await act(async () => {
      pendentes.get(cep)!(dados);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  beforeEach(() => {
    pendentes = new Map();
    armazem = new Map<string, string>();
    sessao = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, v: string) => {
        armazem.set(chave, v);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
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
    // Mock SIMPLES (ignora o AbortSignal), responde só quando o teste mandar.
    fetchMock = vi.fn((url: string) => {
      const cep = /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
      return new Promise((resolve) => {
        pendentes.set(cep, (dados: unknown) =>
          resolve({ json: () => Promise.resolve(dados) } as Response),
        );
      });
    });
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("CEP completo da visita anterior + endereço vazio: busca UMA vez e preenche rua, bairro, cidade e UF", async () => {
    armazem.set(CHAVE_CEP, "01310-100");
    await montar();

    // O CEP semeado está na tela e a busca saiu SEM ninguém digitar.
    expect(valor("guest-cep")).toBe("01310-100");
    expect(consultasDoCep("01310100")).toBe(1);

    await responder("01310100", PAULISTA);

    expect(valor("guest-street")).toBe("Avenida Paulista");
    expect(valor("guest-neighborhood")).toBe("Bela Vista");
    expect(valor("guest-city")).toBe("São Paulo");
    expect(valor("guest-state")).toBe("SP");
    // Uma re-renderização depois da resposta não dispara outra busca.
    expect(consultasDoCep("01310100")).toBe(1);
  });

  it("BORDA: o que a pessoa digita com a busca em voo NÃO é apagado pela resposta", async () => {
    armazem.set(CHAVE_CEP, "01310-100");
    await montar();
    expect(consultasDoCep("01310100")).toBe(1);

    await act(async () => {
      digitar("guest-street", "Rua que eu digitei");
      await Promise.resolve();
    });

    await responder("01310100", PAULISTA);

    expect(valor("guest-street")).toBe("Rua que eu digitei");
    // O que ela não tocou, a busca preenche.
    expect(valor("guest-neighborhood")).toBe("Bela Vista");
    expect(valor("guest-city")).toBe("São Paulo");
    expect(valor("guest-state")).toBe("SP");
  });

  it("BORDA: CEP semeado PARCIAL ('01310') não dispara busca na abertura", async () => {
    armazem.set(CHAVE_CEP, "01310");
    await montar();

    expect(valor("guest-cep")).toBe("01310");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BORDA: sem CEP semeado, nenhuma busca na abertura", async () => {
    await montar();
    expect(valor("guest-cep")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BORDA: rascunho da sessão com a rua já escrita — o endereço não está vazio, então NÃO busca (nada é sobrescrito)", async () => {
    armazem.set(CHAVE_CEP, "01310-100");
    sessao.set(
      CHAVE_RASCUNHO,
      JSON.stringify({
        nome: "",
        whatsapp: "",
        cep: "01310-100",
        numero: "",
        rua: "Rua do rascunho",
        bairro: "",
        cidade: "",
        estado: "",
        complemento: "",
        notas: "",
        cupom: null,
        contaDoCupom: null,
        contaDosDados: null,
      }),
    );
    await montar();

    expect(valor("guest-street")).toBe("Rua do rascunho");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BORDA: CEP que ninguém acha — uma busca só, campos vazios, sem laço", async () => {
    armazem.set(CHAVE_CEP, "99999-999");
    await montar();
    expect(consultasDoCep("99999999")).toBe(1);

    await responder("99999999", { erro: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(valor("guest-cep")).toBe("99999-999");
    expect(valor("guest-street")).toBe("");
    expect(valor("guest-city")).toBe("");
    expect(valor("guest-state")).toBe("");
    // Os provedores de reserva podem ser consultados DENTRO da mesma busca;
    // o que não pode é abrir uma segunda busca (o ViaCEP, o primeiro da cadeia,
    // foi consultado uma vez).
    expect(consultasDoCep("viacep.com.br/ws/99999999")).toBe(1);
  });

  it("só grava o CEP no aparelho com 8 dígitos: o pedaço digitado não vira 'último CEP'", async () => {
    await montar();

    await act(async () => {
      digitar("guest-cep", "0131");
      await Promise.resolve();
    });
    expect(armazem.get(CHAVE_CEP)).toBeUndefined();

    await act(async () => {
      digitar("guest-cep", "013101");
      await Promise.resolve();
    });
    expect(armazem.get(CHAVE_CEP)).toBeUndefined();

    await act(async () => {
      digitar("guest-cep", "01310100");
      await Promise.resolve();
    });
    expect(armazem.get(CHAVE_CEP)).toBe("01310-100");
  });

  it("CEP completo gravado antes continua valendo quando a pessoa começa a apagar", async () => {
    armazem.set(CHAVE_CEP, "01310-100");
    await montar();

    await act(async () => {
      digitar("guest-cep", "01310-10");
      await Promise.resolve();
    });
    // Apagar um dígito não troca a semente por um pedaço: o último CEP COMPLETO
    // segue sendo o que foi gravado.
    expect(armazem.get(CHAVE_CEP)).toBe("01310-100");
  });
});
