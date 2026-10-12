// @vitest-environment jsdom
//
// Achado 2 da revisão (25/08/2026): a expressão `eraDeOutroCep` em
// AddressForm.tsx decide entre dois defeitos opostos —
//   1. sem a guarda de `cepAssociadoRef.current !== null`: um CEP de
//      localidade única, respondido para um cadastro NOVO onde a pessoa já
//      tinha digitado a rua à mão, apaga o que ela digitou (a busca nunca
//      teve um "CEP anterior" de verdade, mas a guarda ausente trataria
//      `null !== cepDaResposta` como "era de outro CEP").
//   2. com a guarda: cadastro novo, rua digitada à mão, CEP sem
//      logradouro/bairro → a rua sobrevive (comportamento certo, coberto
//      aqui).
// address-form-troca-cep-nao-mistura-endereco-antigo.test.tsx cobre o outro
// lado (EDIÇÃO, `cepAssociadoRef` não-nulo) — os dois juntos são o par
// completo que trava a expressão. Um mutante que remova só a checagem de
// `null` passa 12/12 na suíte sem este teste (medido na revisão).
//
// REDESENHO (03/10/2026): no cadastro novo a rua só aparece como campo
// DEPOIS de um CEP que a busca não achou (antes do CEP só existe o CEP). O
// caminho para "rua digitada à mão antes de um CEP aplicado" passou a ser:
// 1º CEP não encontrado -> campos abrem -> rua/bairro à mão -> 2º CEP, de
// localidade única -> a rua e o bairro à mão sobrevivem.
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

describe("AddressForm — cadastro novo: rua digitada à mão sobrevive a um CEP sem logradouro", () => {
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

  it("sem nenhuma busca anterior, a rua digitada à mão NÃO pode ser apagada por um CEP sem logradouro", async () => {
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

    // 2º CEP: de localidade única (sem rua/bairro). Nenhuma busca ANTERIOR foi
    // aplicada (a primeira não achou) — não existe "CEP dono" da rua digitada.
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

    // Com rua, bairro (à mão) + cidade e UF (do CEP) o endereço está
    // completo e vira cartão. Se a rua/bairro tivessem sido apagados, o
    // cartão NÃO existiria (os campos continuariam abertos, pedindo rua).
    const cartao = document.querySelector('[data-testid="cartao-do-endereco"]');
    expect(cartao).not.toBeNull();
    const texto = cartao?.textContent ?? "";

    // A cidade e o estado do CEP entram — isto já funcionava.
    expect(texto).toContain("Monte Carmelo");
    expect(texto).toContain("MG");

    // O caso que faltava: sem "dono" anterior, o que a pessoa digitou à mão
    // fica como está.
    expect(texto).toContain("Rua Sem Nome Oficial, 42");
    expect(texto).toContain("Zona Rural");
    // A rua NÃO veio do CEP: o selo "Achado pelo CEP" não pode afirmar isso.
    expect(texto).not.toContain("Achado pelo CEP");
  });
});
