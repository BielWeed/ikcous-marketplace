// @vitest-environment jsdom
//
// CARRINHO-03: editar um endereço já salvo e trocar o CEP não pode deixar
// rua/bairro do CEP ANTIGO colados com cidade/estado do CEP NOVO.
//
// O ViaCEP devolve `logradouro`/`bairro` como string vazia para CEP de
// localidade única (cidade inteira, sem rua). O callback do AddressForm só
// escrevia atrás de `if (endereco.logradouro)`/`if (endereco.bairro)` — com
// os dois vazios, os `if` não disparavam e o valor do CEP ANTERIOR
// sobrevivia, misturado com a cidade/estado do CEP novo. Prova de rede real,
// feita na auditoria: `curl https://viacep.com.br/ws/38500000/json/` devolve
// `{"logradouro":"","bairro":"","localidade":"Monte Carmelo","uf":"MG"}`.
//
// Este teste NÃO cobre cadastro novo (campos nascem vazios — lá não faz
// sentido apagar o que a pessoa digitou à mão com um vazio do serviço, e
// isso já está coberto por address-form-cep-race.test.tsx e
// use-busca-cep.test.tsx). Cobre só a EDIÇÃO: os campos já pertencem a um
// CEP diferente do que está sendo buscado agora.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

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

const enderecoSalvo: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  cep: "01310-100",
  street: "Rua Tiradentes",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  reference: "",
  recipient_name: "Cliente Teste",
  is_default: true,
};

describe("AddressForm — trocar o CEP de um endereço salvo não mistura rua antiga com cidade nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let fetchMock: ReturnType<typeof vi.fn>;

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
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: "38500-000",
    });
  });

  it("CEP de localidade única (logradouro/bairro vazios) limpa rua e bairro em vez de manter os do CEP antigo", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");

    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={enderecoSalvo}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    // Confere que o formulário abriu com o endereço antigo, para não
    // confundir "já nasceu vazio" com "foi limpo pela correção".
    expect((document.getElementById("street") as HTMLInputElement).value).toBe(
      "Rua Tiradentes",
    );
    expect(
      (document.getElementById("neighborhood") as HTMLInputElement).value,
    ).toBe("Centro");

    // A pessoa mudou de cidade: apaga o CEP antigo e digita o novo, de
    // localidade única (sem rua/bairro no ViaCEP).
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

    const street = document.getElementById("street") as HTMLInputElement;
    const neighborhood = document.getElementById(
      "neighborhood",
    ) as HTMLInputElement;
    const city = document.getElementById("city") as HTMLInputElement;
    const state = document.getElementById("state") as HTMLInputElement;

    // A cidade e o estado do CEP NOVO entram — isto já funcionava.
    expect(city.value).toBe("Monte Carmelo");
    expect(state.value).toBe("MG");

    // O defeito: rua e bairro não podem sobreviver do CEP ANTERIOR quando o
    // CEP mudou e a resposta nova não os determina.
    expect(street.value).toBe("");
    expect(neighborhood.value).toBe("");
  });
});
