// @vitest-environment jsdom
//
// O SAFARI DO IPHONE AMPLIA A TELA QUANDO UM CAMPO COM FONTE MENOR QUE 16 px
// GANHA FOCO. Os campos do formulário de endereço usavam `text-[15px]`: ao
// tocar no CEP ou no número a tela dava zoom e o botão de salvar saía de
// vista. O campo passa a ter 16 px no celular (`text-base`) e os 15 px de
// sempre de `md` (768 px) para cima — o desktop não muda, e o zoom do usuário
// segue livre (nada de `maximum-scale`).
//
// O CSS do Tailwind não existe no jsdom: o que se prova é a classe no
// elemento renderizado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "local", originCep: "38500-000" },
    isLoaded: true,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ENDERECO_COMPLETO: Address = {
  id: "end-1",
  user_id: "u1",
  // Apelido que não é Casa nem Trabalho: abre o campo de texto do apelido.
  name: "Escritório",
  recipient_name: "Maria Teste",
  cep: "38500-000",
  street: "Rua Tiradentes",
  number: "10",
  complement: "Apto 2",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "Perto da praça",
  is_default: false,
};

/**
 * Os campos que aparecem com o endereço já preenchido (cartão do endereço).
 * O CEP tem fonte própria (22 px) e é conferido à parte.
 */
const CAMPOS_DO_CARTAO = [
  "number",
  "complement",
  "reference",
  "recipient_name",
  "name",
] as const;

/** Os que só aparecem depois de "Editar" (rua, bairro, cidade, UF). */
const CAMPOS_DO_ENDERECO = ["street", "neighborhood", "city", "state"] as const;

/** Passa no iPhone: 16 px no celular, 15 px de `md` para cima. */
function naoDaZoomNoIphone(el: Element | null): boolean {
  if (!el) return false;
  const c = el.classList;
  return (
    c.contains("text-base") &&
    c.contains("md:text-[15px]") &&
    !c.contains("text-[15px]")
  );
}

describe("AddressForm — campos não dão zoom no iPhone", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    // O interruptor "endereço padrão" (Radix) mede o tamanho; o jsdom não tem.
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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

  async function montar() {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={ENDERECO_COMPLETO}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          onCancel={vi.fn()}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }

  async function abrirOsCamposDoEndereco() {
    const editar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Editar",
    );
    expect(editar, "botão Editar").toBeDefined();
    await act(async () => {
      editar?.click();
    });
  }

  it("a âncora: o cartão mostra os campos de CEP, número, complemento, referência, destinatário e apelido", async () => {
    await montar();
    for (const id of ["cep", ...CAMPOS_DO_CARTAO]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it("número, complemento, referência, destinatário e apelido têm 16 px no celular", async () => {
    await montar();
    const reprovados = CAMPOS_DO_CARTAO.filter(
      (id) => !naoDaZoomNoIphone(document.getElementById(id)),
    );
    expect(reprovados).toEqual([]);
  });

  it("o CEP continua grande (22 px) no celular E no desktop — o `md:` do campo comum não o encolhe", async () => {
    await montar();
    const cep = document.getElementById("cep");
    expect(cep).not.toBeNull();
    // 22 px passa dos 16 px do iPhone; e como o `tailwind-merge` só troca o
    // texto da MESMA largura, o `md:text-[15px]` do campo comum sobreviveria
    // e encolheria o CEP no desktop se o `md:text-[22px]` não estivesse lá.
    expect(cep?.classList.contains("text-[22px]")).toBe(true);
    expect(cep?.classList.contains("md:text-[22px]")).toBe(true);
    expect(cep?.classList.contains("md:text-[15px]")).toBe(false);
  });

  it("rua, bairro, cidade e UF (depois de 'Editar') têm 16 px no celular", async () => {
    await montar();
    await abrirOsCamposDoEndereco();
    for (const id of CAMPOS_DO_ENDERECO) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    const reprovados = CAMPOS_DO_ENDERECO.filter(
      (id) => !naoDaZoomNoIphone(document.getElementById(id)),
    );
    expect(reprovados).toEqual([]);
  });
});
