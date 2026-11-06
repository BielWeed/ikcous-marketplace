// @vitest-environment jsdom
//
// Balcão — busca de cliente que termina sem achar ninguém não pode ficar muda:
// diz "Nenhum cliente encontrado" (só da rodada atual; nunca durante a
// digitação, durante a espera nem quando a busca deu erro).
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
const FRASE = "Nenhum cliente encontrado";

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

it("busca que volta vazia mostra 'Nenhum cliente encontrado' e aponta o cliente avulso", async () => {
  buscar.mockResolvedValueOnce([]);
  await digitar("Zuleica");
  expect(buscar).toHaveBeenCalledWith("Zuleica");
  expect(hospedeiro.textContent).toContain(FRASE);
  expect(hospedeiro.textContent).toContain("Cliente avulso");
});

it("não aparece enquanto a busca está esperando a resposta", async () => {
  buscar.mockReturnValueOnce(new Promise(() => {}));
  await digitar("Zuleica");
  expect(hospedeiro.textContent).toContain("Buscando…");
  expect(hospedeiro.textContent).not.toContain(FRASE);
});

it("não aparece quando a busca deu erro", async () => {
  buscar.mockRejectedValueOnce(new Error("rede"));
  await digitar("Zuleica");
  expect(hospedeiro.textContent).toContain("Não foi possível buscar");
  expect(hospedeiro.textContent).not.toContain(FRASE);
});

it("não aparece com menos de 2 letras", async () => {
  await digitar("z");
  expect(buscar).not.toHaveBeenCalled();
  expect(hospedeiro.textContent).not.toContain(FRASE);
});

it("some quando a busca seguinte acha alguém", async () => {
  buscar.mockResolvedValueOnce([]);
  await digitar("Zuleica");
  expect(hospedeiro.textContent).toContain(FRASE);
  const achada: LinhaDeClienteEncontrado = {
    id: "1",
    full_name: "Maria",
    email: null,
    phone: "11999999999",
  };
  buscar.mockResolvedValueOnce([achada]);
  await digitar("Maria");
  expect(hospedeiro.textContent).not.toContain(FRASE);
  expect(hospedeiro.textContent).toContain("Maria");
});

it("a resposta vazia de uma rodada velha não mostra a frase por engano", async () => {
  let resolver!: (r: LinhaDeClienteEncontrado[]) => void;
  buscar.mockReturnValueOnce(
    new Promise((resolve) => {
      resolver = resolve;
    }),
  );
  await digitar("Zu");
  await digitar("");
  await act(async () => {
    resolver([]);
  });
  expect(hospedeiro.textContent).not.toContain(FRASE);
});
