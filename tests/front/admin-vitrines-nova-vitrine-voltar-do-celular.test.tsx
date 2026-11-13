// @vitest-environment jsdom
//
// Em Vitrines, "Nova vitrine" abre uma folha para digitar o nome. Ela não tinha
// entrada no histórico: o Voltar do celular saía da tela de Vitrines com a folha
// aberta. Agora usa `useVoltarFechaAFolha`: o Voltar fecha SÓ a folha e faz o
// mesmo que o botão Fechar (o nome digitado fica guardado na tela, como já
// ficava). A folha de EDITAR vitrine tem desvio próprio do Voltar e não é mexida.
// Histórico REAL do jsdom e um "App" simulado. Molde:
// barra-de-busca-voltar-do-celular.test.tsx.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const onNavigate = vi.fn();
const updateConfig = vi.fn(async () => true);
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      homeSections: [
        {
          id: "custom_1",
          title: "Presentes",
          active: true,
          isCustom: true,
          maxItems: 6,
          productIds: [],
        },
      ],
    },
    updateConfig,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

const esperar = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];

const tela = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;
const folha = () => document.querySelector('[role="dialog"]');
const campo = () =>
  document.querySelector<HTMLInputElement>("#titulo-da-nova-vitrine");

async function abrirNovaVitrine() {
  const botao = [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent?.trim() === "Nova vitrine");
  expect(botao).toBeDefined();
  await act(async () => {
    botao?.click();
    await esperar(0);
  });
}
async function digitar(texto: string) {
  const input = campo();
  expect(input).not.toBeNull();
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    definir?.call(input, texto);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar(0);
  });
}
async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  globalThis.history.replaceState({ view: "home" }, "", "/");
  globalThis.history.pushState(
    { view: "admin-carousels" },
    "",
    "/admin/carousels",
  );
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
  await act(async () => {
    raiz.render(createElement(AdminCarouselsView, { onNavigate }));
    await esperar(0);
  });
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  for (const o of ouvintes.splice(0)) {
    globalThis.removeEventListener("popstate", o);
  }
  vi.unstubAllGlobals();
});

it("aberta, a folha de nova vitrine ganha UMA entrada no histórico, na mesma tela", async () => {
  const antes = globalThis.history.length;
  await abrirNovaVitrine();

  expect(folha()).not.toBeNull();
  expect(globalThis.history.length).toBe(antes + 1);
  expect(globalThis.history.state?.folhaDePolitica).toBe(true);
  expect(globalThis.location.pathname).toBe("/admin/carousels");
});

it("o Voltar fecha SÓ a folha: a tela de Vitrines fica e nada é gravado", async () => {
  await abrirNovaVitrine();
  await apertarVoltar();

  expect(folha()).toBeNull();
  expect(navegacoesDoApp).toEqual([]);
  expect(onNavigate).not.toHaveBeenCalled();
  expect(updateConfig).not.toHaveBeenCalled();
  expect(globalThis.location.pathname).toBe("/admin/carousels");
  expect(globalThis.history.state?.view).toBe("admin-carousels");
});

it("o Voltar faz o mesmo que o botão Fechar com o nome já digitado", async () => {
  await abrirNovaVitrine();
  await digitar("Kits de Presente");
  await apertarVoltar();
  expect(folha()).toBeNull();

  await abrirNovaVitrine();
  const aposVoltar = campo()?.value;
  expect(aposVoltar).toBe("Kits de Presente");

  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
      ?.click();
    await esperar(200);
  });
  expect(folha()).toBeNull();
  await abrirNovaVitrine();

  expect(campo()?.value).toBe(aposVoltar);
});

it("fechar pelo botão devolve a entrada: o Voltar seguinte é do roteador", async () => {
  await abrirNovaVitrine();
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
      ?.click();
    await esperar(200);
  });

  expect(folha()).toBeNull();
  expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
  expect(navegacoesDoApp).toEqual([]);

  await apertarVoltar();
  expect(navegacoesDoApp).toEqual(["home|/"]);
});
