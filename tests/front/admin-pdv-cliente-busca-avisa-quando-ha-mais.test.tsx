// @vitest-environment jsdom
//
// Balcão — a busca de cliente mostra no máximo 8 pessoas (as contas mais novas).
// Com nome comum (Maria, Silva) há mais gente que casa do que cabe na tela, e a
// lista terminava ali sem dizer nada: a lojista achava que só existiam 8 e
// vendia sem vincular a cliente certa (ou vinculava a homônima errada). Agora a
// tela diz "Mostrando 8 de 143" e orienta a digitar o nome completo, o e-mail ou
// o WhatsApp. Sem corte, nenhum aviso.
import {
  ClienteDaVenda,
  type LinhaDeClienteEncontrado,
} from "@/components/admin/pdv/ClienteDaVenda";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let hospedeiro: HTMLDivElement;
const buscar = vi.fn();

function marias(quantas: number): LinhaDeClienteEncontrado[] {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `m${i}`,
    full_name: `Maria ${i}`,
    email: `maria${i}@prova.teste`,
    phone: null,
  }));
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <ClienteDaVenda
        cliente={{ tipo: "sem_cliente" }}
        despachar={vi.fn()}
        buscarClientes={buscar}
      />,
    );
  });
  await act(async () => {
    Array.from(hospedeiro.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Buscar cliente"))!
      .click();
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});
async function digitar(valor: string) {
  const campo = hospedeiro.querySelector("input")!;
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

it("com mais gente do que cabe na tela, diz quantos há e como achar a pessoa", async () => {
  buscar.mockResolvedValueOnce({ clientes: marias(8), total: 143 });
  await digitar("maria");
  expect(hospedeiro.textContent).toContain("Mostrando 8 de 143");
  expect(hospedeiro.textContent).toContain("nome completo");
  expect(hospedeiro.textContent).toContain("WhatsApp");
});

it("sem corte (todos cabem), não avisa nada", async () => {
  buscar.mockResolvedValueOnce({ clientes: marias(3), total: 3 });
  await digitar("maria");
  expect(hospedeiro.textContent).toContain("Maria 2");
  expect(hospedeiro.textContent).not.toContain("Mostrando");
});

it("o aviso some assim que a lojista digita de novo (busca nova, resposta nova)", async () => {
  buscar.mockResolvedValueOnce({ clientes: marias(8), total: 143 });
  await digitar("maria");
  expect(hospedeiro.textContent).toContain("Mostrando 8 de 143");
  buscar.mockReturnValueOnce(new Promise(() => {}));
  await digitar("maria silva");
  expect(hospedeiro.textContent).toContain("Buscando…");
  expect(hospedeiro.textContent).not.toContain("Mostrando");
});

it("busca que dá erro não deixa o aviso da busca anterior na tela", async () => {
  buscar.mockResolvedValueOnce({ clientes: marias(8), total: 143 });
  await digitar("maria");
  buscar.mockRejectedValueOnce(new Error("rede"));
  await digitar("maria silva");
  expect(hospedeiro.textContent).toContain("Não foi possível buscar");
  expect(hospedeiro.textContent).not.toContain("Mostrando");
});
