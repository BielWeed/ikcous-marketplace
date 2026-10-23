// @vitest-environment jsdom
//
// O redesenho do Perfil mexeu no AddressList, que o checkout e o carrinho
// também usam (`selectable`). Estas travas congelam, byte a byte, o que o
// modo `selectable` desenhava ANTES (commit 383fbcd0): classes, tamanho e nome
// acessível do Editar/Excluir, o selo e os textos do cartão expandido e o
// estado vazio. Sem elas, o furo passou despercebido: o botão Editar do
// checkout virou círculo transparente de 44 px chamado "Editar endereço Casa".
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

// Textos de classe EXATOS da base 383fbcd0.
const EDITAR_BASE =
  "relative flex size-8 items-center justify-center rounded-lg bg-white text-zinc-400 shadow-sm transition-all after:absolute after:-inset-1.5 after:content-[''] hover:bg-zinc-900 hover:text-white";
const EXCLUIR_BASE =
  "relative flex size-8 items-center justify-center rounded-lg bg-white text-red-400 shadow-sm transition-all after:absolute after:-inset-1.5 after:content-[''] hover:bg-red-50 hover:text-red-500";
const VAZIO_BASE =
  "rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center";

describe("AddressList — checkout e carrinho (selectable) desenham como antes", () => {
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

  it("expandido com selectable: Editar e Excluir ficam como na base (classes, tamanho e nome acessível)", () => {
    renderizar(
      <AddressList
        addresses={[CASA]}
        selectable
        onSelect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    const botoes = [...hospedeiro.querySelectorAll("button")];
    const editar = botoes.find(
      (b) => b.getAttribute("aria-label") === "Editar",
    );
    const excluir = botoes.find(
      (b) => b.getAttribute("aria-label") === "Excluir",
    );
    expect(editar?.className).toBe(EDITAR_BASE);
    expect(excluir?.className).toBe(EXCLUIR_BASE);
    expect(editar?.querySelector("svg")?.getAttribute("class")).toContain(
      "size-3.5",
    );
    expect(excluir?.querySelector("svg")?.getAttribute("class")).toContain(
      "size-3.5",
    );
    // o bloco dos dois botões: mesmo espaçamento de antes
    expect(editar?.parentElement?.className).toBe(
      "flex shrink-0 items-center gap-2",
    );
  });

  it("expandido com selectable: selo, detalhes e CEP mantêm texto e classes da base", () => {
    renderizar(
      <AddressList addresses={[CASA]} selectable onSelect={() => {}} />,
    );
    const selo = [...hospedeiro.querySelectorAll("span")].find((s) =>
      s.textContent?.includes("Endereço Principal"),
    );
    expect(selo?.textContent).toBe("Endereço Principal");
    expect(selo?.className).toBe(
      "mt-1 block text-[11px] font-bold uppercase tracking-widest text-emerald-500",
    );
    const detalhes = [...hospedeiro.querySelectorAll("div")].find(
      (d) =>
        d.className.includes("pl-11") && d.textContent?.includes("CEP: 38400"),
    );
    expect(detalhes?.className).toBe(
      "space-y-1 pl-11 text-[11px] font-medium text-zinc-500",
    );
    const cep = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("CEP:"),
    );
    expect(cep?.className).toBe("mt-1 text-[11px] font-bold text-zinc-400");
  });

  it("estado vazio sem onAdd (checkout e carrinho): classes e texto da base, sem botão", () => {
    renderizar(<AddressList addresses={[]} selectable onSelect={() => {}} />);
    const vazio = hospedeiro.firstElementChild;
    expect(vazio?.className).toBe(VAZIO_BASE);
    expect(vazio?.querySelector("p")?.className).toBe("text-sm text-gray-500");
    expect(vazio?.textContent).toBe("Nenhum endereço cadastrado");
    expect(vazio?.querySelector("button")).toBeNull();
  });

  it("compacto com selectable (carrinho): sem botões de editar/apagar, mesmo com os handlers passados", () => {
    renderizar(
      <AddressList
        addresses={[CASA]}
        selectable
        compact
        onSelect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(hospedeiro.querySelector("button")).toBeNull();
  });

  it("controle: sem selectable (Perfil) o desenho novo continua valendo", () => {
    renderizar(
      <AddressList addresses={[CASA]} onEdit={() => {}} onDelete={() => {}} />,
    );
    const editar = hospedeiro.querySelector(
      'button[aria-label="Editar endereço Casa"]',
    );
    expect(editar?.className).toContain("size-11");
  });
});
