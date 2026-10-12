// @vitest-environment jsdom
//
// Corrida da busca de CEP contra a digitação à mão, no checkout de CONVIDADO.
//
// O PR #761 tirou a condição "só loja nacional" da busca: ela agora roda em
// toda loja. A busca passa por até 3 provedores (teto de 8 s) e, num 3G, o
// cliente já começou a digitar rua ou cidade quando a resposta chega — e a
// resposta atrasada apagava o que ele digitou. Foi o CI (Linux, rede de
// verdade) que pegou: "expected 'São Paulo' to be 'Cidade Teste'".
//
// Regra provada aqui: a resposta da busca só PREENCHE um campo (rua, bairro,
// cidade, UF) se o cliente não o editou à mão desde que digitou o CEP atual.
// Campo vazio, ou com o valor de uma busca anterior: preenche. Campo digitado
// depois do CEP: fica. Digitar outro CEP zera a marca de "editado à mão".
//
// O fetch é um dublê que só responde quando o teste manda — é isso que torna a
// ORDEM (digitação antes da resposta) determinística. Montagem copiada de
// checkout-guest-cep.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
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

type FetchResolver = (data: unknown) => void;

const PAULISTA = {
  logradouro: "Avenida Paulista",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
};
const CEP_PAULISTA = "01310100";

const MONTE_CARMELO = {
  logradouro: "Rua Nova",
  bairro: "Bairro Novo",
  localidade: "Monte Carmelo",
  uf: "MG",
};
const CEP_MONTE_CARMELO = "38500000";

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

describe("CheckoutView (convidado) — a busca de CEP não sobrescreve o que o cliente digitou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let armazem: Map<string, string>;

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

  // Responde a busca pendente do CEP e deixa a resposta chegar aos campos.
  async function responder(cep: string, dados: unknown) {
    expect(pendentes.has(cep)).toBe(true);
    await act(async () => {
      pendentes.get(cep)!(dados);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    pendentes = new Map();
    // O checkout grava um rascunho da compra no sessionStorage a cada
    // digitação, e o jsdom o mantém entre os casos do arquivo: o caso seguinte
    // nasceria com o CEP já preenchido, e digitar o MESMO CEP de novo não
    // dispara `onChange` (o valor não mudou) — a busca nunca sairia. Cada caso
    // é uma visita nova.
    globalThis.sessionStorage.clear();
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, v: string) => {
        armazem.set(chave, v);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    // Mock SIMPLES de propósito (ignora o AbortSignal): só resolve quando o
    // teste mandar. Ver o mesmo raciocínio em checkout-guest-cep.test.tsx.
    fetchMock = vi.fn((url: string) => {
      const cep = /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
      return new Promise((resolve) => {
        pendentes.set(cep, (data: unknown) =>
          resolve({ json: () => Promise.resolve(data) } as Response),
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

  it("a busca que chega ANTES de qualquer digitação à mão preenche os quatro campos", async () => {
    await montar();

    await digitarEsperando("guest-cep", "01310-100");
    await responder(CEP_PAULISTA, PAULISTA);

    expect(valor("guest-street")).toBe("Avenida Paulista");
    expect(valor("guest-neighborhood")).toBe("Bela Vista");
    expect(valor("guest-city")).toBe("São Paulo");
    expect(valor("guest-state")).toBe("SP");
  });

  it("o cliente editou só a cidade antes da resposta: rua, bairro e UF são preenchidos, a cidade fica", async () => {
    await montar();

    await digitarEsperando("guest-cep", "01310-100");
    await digitarEsperando("guest-city", "Cidade Teste");
    await responder(CEP_PAULISTA, PAULISTA);

    expect(valor("guest-city")).toBe("Cidade Teste");
    expect(valor("guest-street")).toBe("Avenida Paulista");
    expect(valor("guest-neighborhood")).toBe("Bela Vista");
    expect(valor("guest-state")).toBe("SP");
  });

  // Cada campo é protegido sozinho: um mutante que proteja só a cidade, ou
  // que proteja todos quando UM foi editado, cai em alguma linha desta tabela.
  it.each([
    ["guest-street", "Rua Do Cliente"],
    ["guest-neighborhood", "Bairro Do Cliente"],
    ["guest-city", "Cidade Do Cliente"],
    ["guest-state", "RJ"],
  ] as const)(
    "o cliente editou %s antes da resposta: só ele é mantido",
    async (idEditado, textoDigitado) => {
      await montar();

      await digitarEsperando("guest-cep", "01310-100");
      await digitarEsperando(idEditado, textoDigitado);
      await responder(CEP_PAULISTA, PAULISTA);

      const esperado = new Map([
        ["guest-street", "Avenida Paulista"],
        ["guest-neighborhood", "Bela Vista"],
        ["guest-city", "São Paulo"],
        ["guest-state", "SP"],
      ]);
      esperado.set(idEditado, textoDigitado);
      for (const [id, v] of esperado) {
        expect(valor(id), id).toBe(v);
      }
    },
  );

  it("trocar o CEP depois de uma edição à mão volta a permitir o preenchimento", async () => {
    await montar();

    await digitarEsperando("guest-cep", "01310-100");
    await digitarEsperando("guest-city", "Cidade Teste");
    await digitarEsperando("guest-street", "Rua Do Cliente");
    await responder(CEP_PAULISTA, PAULISTA);
    expect(valor("guest-city")).toBe("Cidade Teste");
    expect(valor("guest-street")).toBe("Rua Do Cliente");

    // Outro CEP: a marca de "editado à mão" pertencia ao CEP anterior.
    await digitarEsperando("guest-cep", "38500-000");
    await responder(CEP_MONTE_CARMELO, MONTE_CARMELO);

    expect(valor("guest-city")).toBe("Monte Carmelo");
    expect(valor("guest-street")).toBe("Rua Nova");
    expect(valor("guest-neighborhood")).toBe("Bairro Novo");
    expect(valor("guest-state")).toBe("MG");
  });

  it("a edição à mão feita NO CEP NOVO volta a valer: troca o CEP, edita a cidade, a resposta nova não a apaga", async () => {
    await montar();

    await digitarEsperando("guest-cep", "01310-100");
    await responder(CEP_PAULISTA, PAULISTA);
    expect(valor("guest-city")).toBe("São Paulo");

    await digitarEsperando("guest-cep", "38500-000");
    await digitarEsperando("guest-city", "Cidade Do Cliente");
    await responder(CEP_MONTE_CARMELO, MONTE_CARMELO);

    expect(valor("guest-city")).toBe("Cidade Do Cliente");
    // O que ele NÃO editou segue a busca nova, em vez de ficar com o da antiga.
    expect(valor("guest-street")).toBe("Rua Nova");
    expect(valor("guest-neighborhood")).toBe("Bairro Novo");
    expect(valor("guest-state")).toBe("MG");
  });

  it("apagar e redigitar o último dígito do MESMO CEP não faz a rua corrigida à mão virar 'da busca'", async () => {
    await montar();

    await digitarEsperando("guest-cep", "01310-100");
    await responder(CEP_PAULISTA, PAULISTA);
    await digitarEsperando("guest-street", "Rua Do Cliente");

    // Mesmo CEP, redigitado: o campo do CEP passa por 7 dígitos e volta aos 8.
    await digitarEsperando("guest-cep", "01310-10");
    await digitarEsperando("guest-cep", "01310-100");
    // A segunda busca do mesmo CEP volta com a cidade escrita de outro jeito:
    // o campo que o cliente NÃO tocou acompanha a busca, a rua dele não.
    await responder(CEP_PAULISTA, {
      ...PAULISTA,
      localidade: "Sao Paulo (SP)",
    });

    expect(valor("guest-street")).toBe("Rua Do Cliente");
    expect(valor("guest-city")).toBe("Sao Paulo (SP)");
    expect(valor("guest-neighborhood")).toBe("Bela Vista");
  });

  it("CEP que nasce do localStorage (visita anterior): corrigir a rua e redigitar o MESMO CEP também não a apaga", async () => {
    // O dono dos campos é o CEP da visita anterior, e nenhuma busca saiu ainda
    // nesta sessão: só `cepAssociadoRef` sabe que redigitar o mesmo CEP não é
    // CEP novo.
    armazem.set("ikcous_last_shipping_cep", "01310-100");
    await montar();
    expect(valor("guest-cep")).toBe("01310-100");

    await digitarEsperando("guest-street", "Rua Do Cliente");
    await digitarEsperando("guest-cep", "01310-10");
    await digitarEsperando("guest-cep", "01310-100");
    await responder(CEP_PAULISTA, PAULISTA);

    expect(valor("guest-street")).toBe("Rua Do Cliente");
    expect(valor("guest-city")).toBe("São Paulo");
  });

  it("o campo editado e depois esvaziado antes da resposta é preenchido (não há valor do cliente a proteger)", async () => {
    await montar();

    await digitarEsperando("guest-cep", "01310-100");
    await digitarEsperando("guest-city", "Cidade Teste");
    await digitarEsperando("guest-city", "");
    await responder(CEP_PAULISTA, PAULISTA);

    expect(valor("guest-city")).toBe("São Paulo");
  });

  it("o campo digitado ANTES do CEP continua sendo preenchido pela busca (a marca vale desde o CEP atual)", async () => {
    await montar();

    await digitarEsperando("guest-city", "Cidade Antiga");
    await digitarEsperando("guest-cep", "01310-100");
    await responder(CEP_PAULISTA, PAULISTA);

    expect(valor("guest-city")).toBe("São Paulo");
  });

  it("CEP novo cuja resposta vem sem rua: a rua que o cliente digitou no meio da espera não é limpa", async () => {
    await montar();

    // Busca 1 aplicada: o dono dos campos passa a ser o CEP da Paulista.
    await digitarEsperando("guest-cep", "01310-100");
    await responder(CEP_PAULISTA, PAULISTA);

    // Busca 2: CEP de localidade única (sem logradouro nem bairro). Sem a
    // proteção, `eraDeOutroCep` limparia a rua que o cliente acabou de digitar.
    await digitarEsperando("guest-cep", "38500-000");
    await digitarEsperando("guest-street", "Rua Do Cliente");
    await responder(CEP_MONTE_CARMELO, {
      logradouro: "",
      bairro: "",
      localidade: "Monte Carmelo",
      uf: "MG",
    });

    expect(valor("guest-street")).toBe("Rua Do Cliente");
    // O que ele não tocou e que a busca nova não determina é do CEP antigo:
    // limpa, como sempre foi (CARRINHO-03).
    expect(valor("guest-neighborhood")).toBe("");
    expect(valor("guest-city")).toBe("Monte Carmelo");
    expect(valor("guest-state")).toBe("MG");
  });
});
