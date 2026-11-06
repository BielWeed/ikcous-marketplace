// @vitest-environment jsdom
//
// No checkout o cartão do endereço é um "botão" (role=button) e o Editar é um
// botão DENTRO dele. O Enter/Espaço no Editar subia até o cartão, que escolhia
// o endereço e chamava preventDefault: o clique nativo do Editar nunca
// acontecia e quem usa só o teclado não conseguia editar. Agora o cartão só
// reage à tecla quando o foco está no próprio cartão.
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

const CASA: Address = {
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
  is_default: true,
};

describe("AddressList — teclado no cartão selecionável", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSelect = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  const montar = (compact = false) =>
    act(() =>
      raiz.render(
        <AddressList
          addresses={[CASA]}
          selectable
          compact={compact}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
        />,
      ),
    );

  const cartao = () =>
    hospedeiro.querySelector<HTMLElement>('[role="button"]') as HTMLElement;
  const botao = (nome: string) =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === nome,
    ) as HTMLButtonElement;

  // Devolve se o navegador ainda faria a ação padrão (o clique do botão).
  function apertar(el: HTMLElement, tecla: string): boolean {
    const evento = new KeyboardEvent("keydown", {
      key: tecla,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      el.dispatchEvent(evento);
    });
    return !evento.defaultPrevented;
  }

  it("Enter e Espaço no Editar não escolhem o endereço e deixam o clique nativo acontecer", () => {
    montar();
    for (const tecla of ["Enter", " "]) {
      const acaoPadraoPreservada = apertar(botao("Editar"), tecla);
      expect(acaoPadraoPreservada).toBe(true);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter e Espaço no Excluir também não escolhem o endereço", () => {
    montar();
    for (const tecla of ["Enter", " "]) {
      expect(apertar(botao("Excluir"), tecla)).toBe(true);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("o clique no Editar continua editando sem escolher", () => {
    montar();
    act(() => botao("Editar").click());
    expect(onEdit).toHaveBeenCalledWith(CASA);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter e Espaço no próprio cartão continuam escolhendo o endereço", () => {
    montar();
    expect(apertar(cartao(), "Enter")).toBe(false);
    expect(apertar(cartao(), " ")).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(CASA);
  });

  it("modo compacto: Enter e Espaço no cartão escolhem; tecla vinda de dentro não", () => {
    montar(true);
    expect(apertar(cartao(), "Enter")).toBe(false);
    expect(apertar(cartao(), " ")).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(2);

    onSelect.mockClear();
    const filho = cartao().querySelector<HTMLElement>("span") as HTMLElement;
    expect(apertar(filho, "Enter")).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
