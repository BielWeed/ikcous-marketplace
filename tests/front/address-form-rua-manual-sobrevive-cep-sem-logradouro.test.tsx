// @vitest-environment jsdom
//
// Um CEP que não foi achado ainda é o dono da rua/bairro digitados para ele.
// Uma nova busca sem logradouro só preserva esses campos para o MESMO CEP.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FetchResolver = (data: unknown) => void;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddressForm — rua manual pertence ao CEP para o qual foi digitada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;

  beforeEach(() => {
    pendentes = new Map();
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
      vi.fn((url: string) => {
        const cep = /(\d{8})/.exec(url)?.[1] ?? "";
        // O 1º CEP (38509999) não existe em NENHUM provedor: abre os campos.
        if (cep === "38509999") {
          return Promise.resolve(
            url.includes("viacep")
              ? { ok: true, status: 200, json: async () => ({ erro: "true" }) }
              : {
                  ok: false,
                  status: 404,
                  json: async () => ({ error: true, code: "not_found" }),
                },
          );
        }
        return new Promise((resolve) => {
          pendentes.set(cep, (data: unknown) =>
            resolve({ json: () => Promise.resolve(data) } as Response),
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function preencherCepNaoEncontrado() {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");

    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    // 1º CEP: não existe. Os campos de endereço abrem e a pessoa preenche.
    await act(async () => {
      digitar("cep", "38509999");
    });
    await act(async () => {
      for (let n = 0; n < 30; n++) await Promise.resolve();
    });
    expect(document.getElementById("street")).not.toBeNull();

    act(() => {
      digitar("street", "Rua Sem Nome Oficial, 42");
      digitar("neighborhood", "Zona Rural");
    });
  }

  it("limpa rua e bairro preenchidos para A quando B traz só cidade e UF", async () => {
    await preencherCepNaoEncontrado();

    // A busca de A não achou, mas o preenchimento à mão pertence a A.
    act(() => {
      digitar("cep", "38500000");
    });
    expect(pendentes.size).toBe(1);
    pendentes.get("38500000")!({
      logradouro: "",
      bairro: "",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Mesmo sem resposta de um provedor, a rua e o bairro digitados
    // pertencem ao CEP A, não ao CEP B que trouxe apenas cidade e UF.
    expect(
      document.querySelector('[data-testid="cartao-do-endereco"]'),
    ).toBeNull();
    expect((document.getElementById("street") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (document.getElementById("neighborhood") as HTMLInputElement).value,
    ).toBe("");
    expect((document.getElementById("city") as HTMLInputElement).value).toBe(
      "Monte Carmelo",
    );
    expect((document.getElementById("state") as HTMLInputElement).value).toBe(
      "MG",
    );
    expect(document.getElementById("aviso-cep")?.textContent).toContain(
      "Este CEP não informa a rua e o bairro",
    );
  });

  it("redigitar o mesmo CEP preserva rua e bairro quando a nova busca traz só cidade e UF", async () => {
    await preencherCepNaoEncontrado();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ localidade: "Monte Carmelo", uf: "MG" }),
      })),
    );

    await act(async () => digitar("cep", "3850999"));
    await act(async () => digitar("cep", "38509999"));

    const cartao = document.querySelector('[data-testid="cartao-do-endereco"]');
    expect(cartao?.textContent).toContain("Rua Sem Nome Oficial, 42");
    expect(cartao?.textContent).toContain("Zona Rural");
    expect(cartao?.textContent).not.toContain("Achado pelo CEP");
  });
});
