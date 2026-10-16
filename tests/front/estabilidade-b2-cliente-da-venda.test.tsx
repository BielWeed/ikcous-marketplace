// @vitest-environment jsdom
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

it.each(["", "a"])(
  "apagar a busca para '%s' invalida a resposta pendente",
  async (termo) => {
    let resolver!: (r: LinhaDeClienteEncontrado[]) => void;
    buscar.mockReturnValueOnce(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await digitar("ab");
    expect(buscar).toHaveBeenCalledWith("ab");
    await digitar(termo);
    expect(hospedeiro.textContent).not.toContain("Buscando…");
    await act(async () => {
      resolver([
        { id: "1", full_name: "Cliente antigo", email: null, whatsapp: null },
      ]);
    });
    expect(hospedeiro.textContent).not.toContain("Cliente antigo");
    expect(hospedeiro.querySelector("ul")).toBeNull();
  },
);

it("erro da busca mostra aviso e uma nova tentativa limpa o aviso", async () => {
  buscar.mockRejectedValueOnce(new Error("rede"));
  await digitar("ab");
  expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
    "Não foi possível buscar. Tente de novo.",
  );
  buscar.mockResolvedValueOnce([
    { id: "2", full_name: "Cliente atual", email: null, whatsapp: null },
  ]);
  await digitar("abc");
  expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  expect(hospedeiro.textContent).toContain("Cliente atual");
});
