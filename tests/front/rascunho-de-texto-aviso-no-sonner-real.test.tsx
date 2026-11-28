// @vitest-environment jsdom
//
// O aviso "Rascunho não salvo encontrado" com o Sonner DE VERDADE (sem dublê).
//
// O defeito (revisão do PR #2050): no Sonner 2.0.8 o botão "Descartar" (o
// `cancel` do aviso) sai sem fazer nada quando o aviso não é `dismissible`.
// Com `dismissible: false` + `duration: Infinity`, tocar "Descartar" não
// apagava o rascunho nem fechava o aviso, que ficava eterno. Os testes com o
// `toast` dublado chamavam o `onClick` direto e não viam isso.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { useRascunhoDeTexto } from "@/hooks/useRascunhoDeTexto";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "ikcous_rascunho_de_texto_sobre-a-loja:admin-1";
const RASCUNHO = JSON.stringify({
  texto: "Meu rascunho",
  base: "Texto salvo",
  salvoEm: Date.now(),
});

beforeAll(() => {
  // jsdom não traz matchMedia; o Sonner e o next-themes perguntam por ele.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

function Tela() {
  const [texto, setTexto] = useState("Texto salvo");
  useRascunhoDeTexto({
    nome: "sobre-a-loja",
    userId: "admin-1",
    texto,
    salvo: "Texto salvo",
    pronto: true,
    aoRestaurar: setTexto,
  });
  return <p data-texto>{texto}</p>;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  localStorage.setItem(CHAVE, RASCUNHO);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
});

async function montar() {
  await act(async () => {
    raiz.render(
      <>
        <Tela />
        <Toaster />
      </>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

const botao = (rotulo: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      "[data-sonner-toast] button",
    ),
  ].find((b) => b.textContent?.trim() === rotulo);

// O aviso de rascunho ainda na tela (o Sonner tira o nó só depois da animação
// de saída; até lá ele fica com `data-removed`).
const avisoDoRascunhoNaTela = () =>
  [...document.querySelectorAll("[data-sonner-toast]")].some((aviso) =>
    aviso.textContent?.includes("Rascunho não salvo encontrado"),
  );

async function tocar(rotulo: string) {
  const alvo = botao(rotulo);
  expect(alvo).toBeDefined();
  await act(async () => {
    alvo?.click();
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("aviso de rascunho de texto no Sonner real", () => {
  it("o aviso não fecha por gesto (arrastar deixaria a pendência presa)", async () => {
    await montar();
    const aviso = document.querySelector("[data-sonner-toast]");
    expect(aviso).not.toBeNull();
    expect(aviso?.getAttribute("data-dismissible")).toBe("false");
  });

  it("Descartar apaga o rascunho do aparelho", async () => {
    await montar();
    expect(botao("Descartar")).toBeDefined();
    await tocar("Descartar");
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(hospedeiro.querySelector("[data-texto]")?.textContent).toBe(
      "Texto salvo",
    );
    // E o aviso fecha: sem o `toast.dismiss`, ele ficaria eterno na tela.
    // Cada volta espera DENTRO do act, onde o React aplica a saída do aviso.
    await vi.waitFor(
      async () => {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
        expect(avisoDoRascunhoNaTela()).toBe(false);
      },
      { interval: 1 },
    );
  });

  it("controle: Restaurar devolve o texto do rascunho", async () => {
    await montar();
    await tocar("Restaurar");
    expect(hospedeiro.querySelector("[data-texto]")?.textContent).toBe(
      "Meu rascunho",
    );
  });
});
