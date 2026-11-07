// @vitest-environment jsdom
//
// Cupom "Clientes escolhidos" — a busca de cliente mostra no máximo 8 pessoas
// (as contas mais novas). Com nome comum há mais gente do que cabe, e a lista
// terminava ali sem dizer nada: a lojista liberava o cupom para a pessoa errada
// ou concluía que a cliente "não tem conta". Agora a tela diz "Mostrando 8 de
// 143" e orienta a digitar o nome completo, o e-mail ou o WhatsApp.
import { QuemPodeUsarOCupom } from "@/components/admin/coupons/QuemPodeUsarOCupom";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
const buscarClientes = vi.fn();

function marias(quantas: number) {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `m${i}`,
    full_name: `Maria ${i}`,
    email: `maria${i}@prova.teste`,
  }));
}

const campoDeBusca = () =>
  hospedeiro.querySelector("#coupon-clientes-busca") as HTMLInputElement;

async function digitar(valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campoDeBusca(), valor);
    campoDeBusca().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  buscarClientes.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <QuemPodeUsarOCupom
        alcance="exclusivo"
        onAlcance={vi.fn()}
        clientes={[]}
        onClientes={vi.fn()}
        carregandoClientes={false}
        buscarClientes={buscarClientes}
        semLimiteNemValidade={false}
        desabilitado={false}
      />,
    );
  });
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

it("com mais gente do que cabe na tela, diz quantos há e como achar a pessoa", async () => {
  buscarClientes.mockResolvedValueOnce({ clientes: marias(8), total: 143 });
  await digitar("maria");
  expect(hospedeiro.textContent).toContain("Mostrando 8 de 143");
  expect(hospedeiro.textContent).toContain("nome completo");
  expect(hospedeiro.textContent).toContain("WhatsApp");
});

it("sem corte (todos cabem), não avisa nada", async () => {
  buscarClientes.mockResolvedValueOnce({ clientes: marias(3), total: 3 });
  await digitar("maria");
  expect(hospedeiro.textContent).toContain("Maria 2");
  expect(hospedeiro.textContent).not.toContain("Mostrando");
});

it("o aviso some quando a lojista apaga o termo", async () => {
  buscarClientes.mockResolvedValueOnce({ clientes: marias(8), total: 143 });
  await digitar("maria");
  expect(hospedeiro.textContent).toContain("Mostrando 8 de 143");
  await digitar("");
  expect(hospedeiro.textContent).not.toContain("Mostrando");
});

it("busca que dá erro não deixa o aviso da busca anterior na tela", async () => {
  buscarClientes.mockResolvedValueOnce({ clientes: marias(8), total: 143 });
  await digitar("maria");
  buscarClientes.mockRejectedValueOnce(new Error("rede"));
  await digitar("maria silva");
  expect(hospedeiro.textContent).toContain("Não foi possível buscar clientes");
  expect(hospedeiro.textContent).not.toContain("Mostrando");
});
