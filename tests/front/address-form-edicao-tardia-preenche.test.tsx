// @vitest-environment jsdom
//
// Editar um endereço não pode abrir o formulário VAZIO.
//
// AddressForm só reseta o formulário UMA vez: quando isLoaded sobe. Sem
// cache local de endereços (primeiro acesso pós-login, storage cheio ou
// corrompido), o fetch do pai ainda estava correndo nesse instante —
// initialData chegava DEPOIS, o hasInitializedRef já tinha travado o reset
// vazio, e a edição nascia em branco: título "Editar Endereço", campos
// vazios, e salvar por cima redigitado sobrescrevia o endereço real. Este
// teste prende que o formulário se PREENCHE quando o endereço chega tarde.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

const mockConfig = vi.hoisted(() => ({
  shippingCoverage: "local" as const,
  originCep: "38500-000",
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enderecoDaEdicao: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  cep: "38500-000",
  street: "Rua Teste",
  number: "123",
  complement: "",
  neighborhood: "Centro",
  city: "Testópolis",
  state: "MG",
  reference: "",
  recipient_name: "Cliente Teste",
  is_default: true,
};

describe("AddressForm — endereço que chega DEPOIS do mount preenche a edição", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
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

  it("montou sem initialData (fetch correndo) e o endereço chegou depois: campos preenchem", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");

    // O instante do defeito: isLoaded já true, endereços ainda não chegaram
    // — o pai monta o form de edição com initialData indefinido.
    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    // O fetch completou: o pai re-renderiza AGORA com o endereço achado.
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={enderecoDaEdicao}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const cep = document.getElementById("cep") as HTMLInputElement;
    const street = document.getElementById("street") as HTMLInputElement;
    const nome = document.getElementById("name") as HTMLInputElement;

    // Âncora: os campos existem e a tela montou.
    expect(cep).toBeDefined();

    expect(cep.value).toBe("38500-000");
    expect(street.value).toBe("Rua Teste");
    expect(nome.value).toBe("Casa");
  });
});
