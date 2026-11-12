// @vitest-environment jsdom
//
// Defeito: no cartão expandido do AddressList (checkout e Perfil), rua,
// complemento e bairro longos e sem espaço (um complemento colado, um nome de
// condomínio) passavam da largura do cartão em tela estreita, porque as
// linhas dos detalhes não tinham `break-words`. Os cartões compactos já tinham.
// O jsdom não calcula CSS: o teste lê as classes que as linhas renderizam.
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

const COMPLEMENTO = "Bloco-C-Apartamento-1204-Condominio-Residencial-Jardins";
const BAIRRO = "Jardim-Residencial-Nossa-Senhora-Aparecida-do-Vale";

const LONGO: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Maria Teste",
  cep: "38400-000",
  street: "Avenida-Presidente-Juscelino-Kubitschek-de-Oliveira",
  number: "10",
  complement: COMPLEMENTO,
  neighborhood: BAIRRO,
  city: "Cidade Teste",
  state: "MG",
  reference: null,
  is_default: false,
};

describe("AddressList — endereço longo quebra a linha no cartão expandido", () => {
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

  const linhaCom = (texto: string) =>
    [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes(texto),
    ) as HTMLElement;

  for (const [rotulo, props] of [
    ["checkout (selectable)", { selectable: true, onSelect: () => {} }],
    ["Perfil (sem selectable)", {}],
  ] as const) {
    it(`${rotulo}: rua com complemento e bairro têm break-words`, () => {
      act(() => raiz.render(<AddressList addresses={[LONGO]} {...props} />));

      const rua = linhaCom(COMPLEMENTO);
      const bairro = linhaCom(BAIRRO);
      expect(rua, "linha da rua com o complemento").toBeDefined();
      expect(bairro, "linha do bairro").toBeDefined();
      expect(rua.className).toContain("break-words");
      expect(bairro.className).toContain("break-words");
      // O texto da linha não pode perder o espaço depois da vírgula.
      expect(bairro.textContent).toBe(`${BAIRRO}, Cidade Teste - MG`);
    });
  }
});
