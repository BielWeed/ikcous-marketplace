// @vitest-environment jsdom
//
// Balcão — o primeiro toque no cliente da lista não pode se perder. A lojista
// digita o nome, espera a lista, e toca na pessoa. Ao tocar, o campo perde o
// foco, e o campo entrega o MESMO texto de novo ao sair. Antes, a tela refazia a
// busca do mesmo termo: a lista sumia no meio do toque e o clique não achava o
// botão — a lojista precisava tocar duas vezes. Agora repetir o termo que já
// está na tela não faz nada. Termo diferente, ou busca que falhou, continua
// buscando.
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
const despachar = vi.fn();

const MARIA: LinhaDeClienteEncontrado = {
  id: "u-maria",
  full_name: "Maria Souza",
  email: "maria@prova.teste",
  phone: "11999990000",
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <ClienteDaVenda
        cliente={{ tipo: "sem_cliente" }}
        despachar={despachar}
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
  vi.useRealTimers();
});

const campo = () => hospedeiro.querySelector("input")!;

/** Digita e ESPERA o atraso do campo: a busca sai pelo tempo, com o foco ainda
 * no campo — exatamente como a lojista que digita e espera a lista. */
async function digitarEEsperar(valor: string) {
  await act(async () => {
    campo().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo(), valor);
    campo().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

async function tirarOFoco() {
  await act(async () => {
    campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function botaoDaMaria(): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Maria Souza"),
  );
}

it("tocar na pessoa depois de a lista aparecer vincula no primeiro toque", async () => {
  buscar.mockResolvedValueOnce({ clientes: [MARIA], total: 1 });
  // Se a tela repetir a busca ao sair do campo, esta segunda resposta nunca
  // chega: é a janela em que a lista some e o clique morre.
  buscar.mockReturnValueOnce(new Promise(() => {}));

  await digitarEEsperar("maria");
  expect(botaoDaMaria()).toBeDefined();

  await tirarOFoco();
  // O campo entregou "maria" de novo: a lista continua inteira.
  expect(botaoDaMaria()).toBeDefined();

  await act(async () => {
    botaoDaMaria()!.click();
  });
  expect(despachar).toHaveBeenCalledWith({
    tipo: "cliente_definido",
    cliente: {
      tipo: "cadastrado",
      userId: "u-maria",
      nome: "Maria Souza",
      whatsapp: "11999990000",
    },
  });
  expect(buscar).toHaveBeenCalledTimes(1);
});

it("termo diferente continua buscando de novo", async () => {
  buscar.mockResolvedValueOnce({ clientes: [MARIA], total: 1 });
  buscar.mockResolvedValueOnce({ clientes: [], total: 0 });
  await digitarEEsperar("maria");
  await digitarEEsperar("maria silva");
  expect(buscar).toHaveBeenCalledTimes(2);
  expect(buscar).toHaveBeenLastCalledWith("maria silva");
  expect(botaoDaMaria()).toBeUndefined();
});

it("busca que falhou pode ser refeita com o mesmo termo", async () => {
  buscar.mockRejectedValueOnce(new Error("rede"));
  buscar.mockResolvedValueOnce({ clientes: [MARIA], total: 1 });
  await digitarEEsperar("maria");
  expect(hospedeiro.textContent).toContain("Não foi possível buscar");
  await tirarOFoco();
  expect(buscar).toHaveBeenCalledTimes(2);
  expect(botaoDaMaria()).toBeDefined();
});

it("apagar até menos de 2 letras e digitar o mesmo termo de novo busca de novo", async () => {
  buscar.mockResolvedValue({ clientes: [MARIA], total: 1 });
  await digitarEEsperar("maria");
  await digitarEEsperar("m");
  expect(botaoDaMaria()).toBeUndefined();
  await digitarEEsperar("maria");
  expect(buscar).toHaveBeenCalledTimes(2);
  expect(botaoDaMaria()).toBeDefined();
});
