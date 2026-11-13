// @vitest-environment jsdom
//
// No Perfil, a lixeira de um endereço abre "Apagar este endereço?". A pergunta
// não tinha entrada no histórico: o Voltar do celular saía do Perfil com ela
// aberta. Agora usa `useVoltarFechaAFolha`: o Voltar cancela SÓ a pergunta (nada
// é apagado) e o Perfil fica. Histórico REAL do jsdom e um "App" simulado que só
// navega quando a tela do histórico muda. Molde:
// barra-de-busca-voltar-do-celular.test.tsx.
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

const esperar = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

const CASA: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Maria de Lourdes",
  cep: "38600-123",
  street: "Rua das Acácias",
  number: "120",
  complement: "Apto 301",
  neighborhood: "Jardim Primavera",
  city: "Paracatu",
  state: "MG",
  reference: null,
  is_default: true,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];
const onDelete = vi.fn();

const tela = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

beforeEach(() => {
  globalThis.history.replaceState({ view: "home" }, "", "/");
  globalThis.history.pushState({ view: "profile" }, "", "/perfil");
  navegacoesDoApp = [];
  onDelete.mockClear();
  let mostrada = tela();
  const ouvinte = () => {
    const alvo = tela();
    if (alvo === mostrada) return;
    mostrada = alvo;
    navegacoesDoApp.push(alvo);
  };
  ouvintes.push(ouvinte);
  globalThis.addEventListener("popstate", ouvinte);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  for (const o of ouvintes.splice(0)) {
    globalThis.removeEventListener("popstate", o);
  }
});

const pergunta = () => document.querySelector('[role="alertdialog"]');
const botao = (texto: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === texto,
  );

async function abrirPergunta(compacto: boolean, apagar = onDelete) {
  await act(async () => {
    raiz.render(
      <AddressList addresses={[CASA]} compact={compacto} onDelete={apagar} />,
    );
    await esperar(0);
  });
  await act(async () => {
    hospedeiro
      .querySelector<HTMLButtonElement>('button[aria-label^="Excluir"]')
      ?.click();
    await esperar(0);
  });
}

async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar();
  });
}

describe.each([
  ["compacto", true],
  ["expandido", false],
])(
  "AddressList (%s) — a pergunta de apagar e o Voltar do celular",
  (_n, compacto) => {
    it("aberta, a pergunta ganha UMA entrada no histórico, na mesma tela", async () => {
      await abrirPergunta(compacto);
      expect(pergunta()).not.toBeNull();
      expect(globalThis.history.state?.folhaDePolitica).toBe(true);
      expect(globalThis.location.pathname).toBe("/perfil");
    });

    it("o Voltar cancela SÓ a pergunta: o Perfil não troca e nada é apagado", async () => {
      await abrirPergunta(compacto);
      await apertarVoltar();

      expect(pergunta()).toBeNull();
      expect(onDelete).not.toHaveBeenCalled();
      expect(navegacoesDoApp).toEqual([]);
      expect(globalThis.location.pathname).toBe("/perfil");
      expect(globalThis.history.state?.view).toBe("profile");
    });

    it("Cancelar devolve a entrada: o Voltar seguinte é do roteador", async () => {
      await abrirPergunta(compacto);
      await act(async () => {
        botao("Cancelar")?.click();
        await esperar(200);
      });

      expect(pergunta()).toBeNull();
      expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
      expect(navegacoesDoApp).toEqual([]);

      await apertarVoltar();
      expect(navegacoesDoApp).toEqual(["home|/"]);
    });
  },
);

// Fica DEPOIS dos demais: o histórico do jsdom é um só no arquivo, e o Voltar
// recusado empurra a entrada de novo, e isso contaminava o teste seguinte (medido).
describe("AddressList — exclusão em andamento", () => {
  it("com a exclusão em andamento o Voltar não fecha a pergunta (como o Esc)", async () => {
    let resolver!: (valor: boolean) => void;
    const excluir = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolver = resolve;
        }),
    );
    await abrirPergunta(true, excluir);
    await act(async () => {
      botao("Apagar")?.click();
      await esperar(0);
    });
    expect(botao("Excluindo...")).toBeDefined();

    await apertarVoltar();
    expect(pergunta()).not.toBeNull();
    expect(navegacoesDoApp).toEqual([]);

    await act(async () => {
      resolver(true);
      await esperar(200);
    });
    expect(pergunta()).toBeNull();
  });
});
