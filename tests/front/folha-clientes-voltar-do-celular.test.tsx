// @vitest-environment jsdom
//
// No painel de Clientes, "Gestão de Cliente" (e o guia da base) abre uma folha
// de baixo. Ela não tinha entrada no histórico: o Voltar do celular saía da
// tela de Clientes com a folha aberta e a lojista perdia o lugar. Agora usa
// `useVoltarFechaAFolha`: o Voltar fecha SÓ a folha e a tela fica. Fechar pelo
// botão ou pelo Esc devolve a entrada, para o Voltar seguinte não pedir dois
// toques. Histórico REAL do jsdom e um "App" simulado. Molde:
// admin-order-card-voltar-do-celular.test.tsx.
import { FolhaClientes } from "@/components/admin/users/FolhaClientes";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];

const tela = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

function Tela() {
  const [aberta, setAberta] = useState(false);
  return (
    <FolhaClientes
      aberta={aberta}
      aoMudar={setAberta}
      titulo="Gestão de Cliente"
      gatilho={<button type="button">Abrir gestão</button>}
    >
      <p>Conteúdo da folha</p>
    </FolhaClientes>
  );
}

beforeEach(() => {
  globalThis.history.replaceState({ view: "home" }, "", "/");
  globalThis.history.pushState({ view: "admin-customers" }, "", "/clientes");
  navegacoesDoApp = [];
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

const janela = () => document.querySelector('[role="dialog"]');
const botaoDe = (texto: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === texto,
  );

async function abrirFolha() {
  await act(async () => {
    raiz.render(<Tela />);
    await esperar(0);
  });
  await act(async () => {
    botaoDe("Abrir gestão")?.click();
    await esperar(0);
  });
}
async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar();
  });
}

describe("FolhaClientes — a folha e o Voltar do celular", () => {
  it("aberta, a folha ganha UMA entrada no histórico, na mesma tela", async () => {
    const antes = globalThis.history.length;
    await abrirFolha();

    expect(janela()?.textContent).toContain("Conteúdo da folha");
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);
    expect(globalThis.location.pathname).toBe("/clientes");
  });

  it("o Voltar fecha SÓ a folha: a tela de Clientes fica", async () => {
    await abrirFolha();
    await apertarVoltar();

    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.location.pathname).toBe("/clientes");
    expect(globalThis.history.state?.view).toBe("admin-customers");
    expect(document.body.classList.contains("admin-modal-open")).toBe(false);
  });

  it("fechar pelo botão devolve a entrada: o Voltar seguinte é do roteador", async () => {
    await abrirFolha();
    await act(async () => {
      botaoDe("Fechar")?.click();
      await esperar(200);
    });

    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);

    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("fechar pelo Esc também devolve a entrada", async () => {
    await abrirFolha();
    await act(async () => {
      janela()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperar(200);
    });

    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);

    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });
});
