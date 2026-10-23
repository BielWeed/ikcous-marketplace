// @vitest-environment jsdom
//
// Cabeçalho Tinta da tela de endereço (23/10/2026): barra de 3 segmentos e o
// rótulo "Novo endereço · N de 3". O que se prova, por estado da tela:
// - recém-aberta: nenhum segmento cheio, "1 de 3";
// - CEP achado com endereço completo: segmentos 1 e 2 cheios, "3 de 3";
// - CEP que a busca devolve SEM rua: só o 1 cheio, "2 de 3";
// - número digitado: os três cheios;
// - apagar o CEP volta ao começo (o contador acompanha o formulário vivo);
// - edição: sem rótulo "Novo endereço", e a barra segue decorativa.
// "Novo endereço" fica num elemento só dele (a jornada e2e e outros testes
// procuram esse texto) e o "· N de 3" num <span> separado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addresses } = vi.hoisted(() => ({
  addresses: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1", user_metadata: {} },
    profile: { full_name: "Mariana Lopes" },
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses,
    loading: false,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", shippingCoverage: "local" },
    isLoaded: true,
  }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let respostaDoCep: Record<string, string> = {};

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

const COMPLETO = {
  logradouro: "Rua Exemplo",
  bairro: "Centro",
  localidade: "Cidade Exemplo",
  uf: "MG",
};

describe("AddressFormView — barra de passos e 'Novo endereço · N de 3'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    addresses.length = 0;
    respostaDoCep = COMPLETO;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => respostaDoCep,
        }),
      ),
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
    vi.unstubAllGlobals();
  });

  async function abrir(addressId?: string) {
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    await act(async () => {
      raiz.render(<AddressFormView addressId={addressId} onBack={vi.fn()} />);
    });
    await esvaziar();
  }

  const barra = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="barra-de-passos"]');
  const cheios = () =>
    [...(barra()?.children ?? [])].map(
      (s) => (s as HTMLElement).dataset.cheio === "true",
    );
  const rotulo = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="rotulo-do-passo"]');

  it("recém-aberta: 3 segmentos vazios, 'Novo endereço' sozinho e '· 1 de 3' à parte", async () => {
    await abrir();
    expect(cheios()).toEqual([false, false, false]);
    const r = rotulo();
    expect(r).not.toBeNull();
    const spans = [...(r?.children ?? [])];
    expect(spans.map((s) => s.textContent?.trim())).toEqual([
      "Novo endereço",
      "· 1 de 3",
    ]);
  });

  it("a barra é decorativa: aria-hidden (o texto 'N de 3' já informa)", async () => {
    await abrir();
    expect(barra()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("segmentos cheios usam a tinta (bg-foreground) e os vazios a linha fina (bg-border)", async () => {
    await abrir();
    for (const s of barra()?.children ?? []) {
      expect(s.classList.contains("bg-border")).toBe(true);
      expect(s.classList.contains("bg-foreground")).toBe(false);
      expect(s.classList.contains("h-[3px]")).toBe(true);
      expect(s.classList.contains("rounded-full")).toBe(true);
    }
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    const primeiro = barra()?.children[0] as HTMLElement;
    expect(primeiro.classList.contains("bg-foreground")).toBe(true);
    expect(primeiro.classList.contains("bg-border")).toBe(false);
  });

  it("CEP incompleto não enche o 1: continua '1 de 3'", async () => {
    await abrir();
    await act(async () => {
      digitar("cep", "3850000");
    });
    await esvaziar();
    expect(cheios()).toEqual([false, false, false]);
    expect(rotulo()?.textContent).toContain("1 de 3");
  });

  it("CEP achado com endereço completo: 1 e 2 cheios, '3 de 3'", async () => {
    await abrir();
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    expect(cheios()).toEqual([true, true, false]);
    expect(rotulo()?.textContent).toContain("3 de 3");
  });

  it("CEP de cidade inteira (a busca não traz rua): só o 1 cheio, '2 de 3'", async () => {
    respostaDoCep = { ...COMPLETO, logradouro: "", bairro: "" };
    await abrir();
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    expect(cheios()).toEqual([true, false, false]);
    expect(rotulo()?.textContent).toContain("2 de 3");
  });

  it("número preenchido (o nome vem da conta): os três cheios", async () => {
    await abrir();
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    await act(async () => {
      digitar("number", "1250");
    });
    expect(cheios()).toEqual([true, true, true]);
    expect(rotulo()?.textContent).toContain("3 de 3");
  });

  it("apagar o CEP depois de tudo preenchido: a barra volta ao começo", async () => {
    await abrir();
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    await act(async () => {
      digitar("number", "1250");
    });
    await act(async () => {
      digitar("cep", "3850");
    });
    await esvaziar();
    expect(cheios()[0]).toBe(false);
    expect(rotulo()?.textContent).toContain("1 de 3");
  });

  it("edição: sem rótulo 'Novo endereço', título 'Editar endereço', barra cheia", async () => {
    addresses.push({
      id: "end-1",
      user_id: "u1",
      name: "Casa",
      recipient_name: "Mariana Lopes",
      cep: "38500-000",
      street: "Rua Exemplo",
      number: "10",
      complement: "",
      neighborhood: "Centro",
      city: "Cidade Exemplo",
      state: "MG",
      reference: "",
      is_default: false,
    });
    await abrir("end-1");
    expect(rotulo()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Novo endereço");
    expect(hospedeiro.querySelector("h2")?.textContent).toBe("Editar endereço");
    expect(cheios()).toEqual([true, true, true]);
  });

  it("o título é um h2 de 28 px bold", async () => {
    await abrir();
    const h2 = hospedeiro.querySelector("h2");
    expect(h2?.textContent).toBe("Para onde vamos entregar?");
    for (const c of ["text-[28px]", "font-bold", "leading-8", "tracking-tight"])
      expect(h2?.classList.contains(c), c).toBe(true);
  });
});
