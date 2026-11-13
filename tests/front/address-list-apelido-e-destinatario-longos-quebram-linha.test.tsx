// @vitest-environment jsdom
//
// Defeito: no cartão expandido do AddressList (checkout e Perfil), um apelido
// ou um destinatário longo e sem espaço (o formulário aceita 120 letras coladas)
// estourava o cartão e passava por cima dos botões de editar e apagar, porque o
// span do apelido e o <p> do destinatário não tinham `break-words`. O cartão
// compacto já protegia. O jsdom não calcula CSS: o teste lê as classes renderizadas.
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const APELIDO = "A".repeat(120);
const DESTINATARIO = "B".repeat(120);

const LONGO: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: APELIDO,
  recipient_name: DESTINATARIO,
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

describe("AddressList — apelido e destinatário longos quebram a linha no cartão expandido", () => {
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

  const elementoComTexto = (seletor: string, texto: string) =>
    [...hospedeiro.querySelectorAll(seletor)].find(
      (el) => el.textContent === texto,
    ) as HTMLElement;

  for (const [rotulo, props] of [
    ["checkout (selectable)", { selectable: true, onSelect: () => {} }],
    ["Perfil (sem selectable)", {}],
  ] as const) {
    it(`${rotulo}: apelido e destinatário de 120 letras têm break-words`, () => {
      act(() => raiz.render(<AddressList addresses={[LONGO]} {...props} />));

      const apelido = elementoComTexto("span", APELIDO);
      const destinatario = elementoComTexto("p", DESTINATARIO);
      expect(apelido, "span do apelido").toBeDefined();
      expect(destinatario, "parágrafo do destinatário").toBeDefined();
      expect(apelido.className).toContain("break-words");
      expect(destinatario.className).toContain("break-words");
    });
  }
});
