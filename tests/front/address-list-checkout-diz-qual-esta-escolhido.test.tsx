// @vitest-environment jsdom
//
// Acessibilidade da lista de endereços do checkout (lote r64-a): o cartão
// escolhido era marcado só por borda e ícone — o leitor de tela dizia apenas
// "Casa, botão", sem "selecionado", e os botões Editar/Excluir de todos os
// cartões se chamavam igual ("Editar", "Editar"...). Agora o cartão diz se
// está escolhido (aria-pressed + texto só para leitor de tela) e cada
// Editar/Excluir leva o nome do endereço. O desenho não muda (travado por
// address-list-checkout-e-carrinho-nao-mudam.test.tsx).
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const base: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Maria Teste",
  cep: "38400-000",
  street: "Rua Teste",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Cidade Teste",
  state: "MG",
  reference: null,
  is_default: false,
};
const CASA: Address = { ...base, is_default: true };
const TRABALHO: Address = {
  ...base,
  id: "addr-2",
  name: "Trabalho",
  street: "Avenida Outra",
  number: "500",
};

describe("AddressList (checkout e carrinho) — diz qual endereço está escolhido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  const renderizar = (el: React.ReactElement) => act(() => raiz.render(el));
  const cartoes = () => [
    ...hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
  ];
  const doCartao = (nome: string) =>
    cartoes().find((c) => c.textContent?.includes(nome)) as HTMLElement;

  for (const compact of [false, true]) {
    const modo = compact ? "compacto (carrinho)" : "completo (checkout)";

    it(`${modo}: só o escolhido está 'pressionado'; o outro não`, () => {
      renderizar(
        <AddressList
          addresses={[CASA, TRABALHO]}
          selectable
          compact={compact}
          selectedId="addr-2"
          onSelect={() => {}}
        />,
      );
      expect(doCartao("Casa").getAttribute("aria-pressed")).toBe("false");
      expect(doCartao("Trabalho").getAttribute("aria-pressed")).toBe("true");
    });

    it(`${modo}: nenhum escolhido -> nenhum 'pressionado' (a palavra 'Selecionado' também não aparece)`, () => {
      renderizar(
        <AddressList
          addresses={[CASA, TRABALHO]}
          selectable
          compact={compact}
          onSelect={() => {}}
        />,
      );
      for (const c of cartoes())
        expect(c.getAttribute("aria-pressed")).toBe("false");
      expect(hospedeiro.textContent).not.toContain("Selecionado");
    });
  }

  it("completo: o escolhido ganha o texto 'Selecionado' para o leitor de tela (invisível na tela), o outro não", () => {
    renderizar(
      <AddressList
        addresses={[CASA, TRABALHO]}
        selectable
        selectedId="addr-2"
        onSelect={() => {}}
      />,
    );
    const selo = doCartao("Trabalho").querySelector(".sr-only");
    expect(selo?.textContent).toBe("Selecionado");
    expect(doCartao("Casa").querySelector(".sr-only")).toBeNull();
  });

  it("completo: Editar e Excluir dizem de QUAL endereço são", () => {
    renderizar(
      <AddressList
        addresses={[CASA, TRABALHO]}
        selectable
        selectedId="addr-1"
        onSelect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    const rotulos = [...hospedeiro.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(rotulos).toEqual([
      "Editar endereço Casa",
      "Excluir endereço Casa",
      "Editar endereço Trabalho",
      "Excluir endereço Trabalho",
    ]);
  });

  it("limite: lista sem seleção (Perfil, não selecionável) não vira botão nem ganha aria-pressed", () => {
    renderizar(
      <AddressList
        addresses={[CASA, TRABALHO]}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(cartoes()).toHaveLength(0);
    expect(hospedeiro.querySelector("[aria-pressed]")).toBeNull();
  });

  it("limite: tocar em outro cartão continua escolhendo ele (nada do clique mudou)", () => {
    const onSelect = vi.fn();
    renderizar(
      <AddressList
        addresses={[CASA, TRABALHO]}
        selectable
        selectedId="addr-1"
        onSelect={onSelect}
      />,
    );
    act(() => doCartao("Trabalho").click());
    expect(onSelect).toHaveBeenCalledWith(TRABALHO);
  });
});
