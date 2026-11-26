// @vitest-environment jsdom
//
// No computador (>= 1024px, `useTelaDeComputador`) a lista abre num Radix
// Popover colado embaixo do campo: z-[135], cantos de 20px, largura do campo,
// altura de 8 linhas limitada ao espaço disponível, a dica de teclado, foco na
// busca (ou no listbox, sem busca), Esc fecha e devolve o foco.
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

class ResizeObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverFalso);
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: consulta.includes("min-width: 1024px"),
    media: consulta,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

const PARCELAS: OpcaoDaLista[] = Array.from({ length: 12 }, (_, i) => ({
  valor: String(i + 1),
  rotulo: `${i + 1}x`,
}));

function montar(opcoes: readonly OpcaoDaLista[] = PARCELAS, valor = "12") {
  const aoMudar = vi.fn();
  act(() => {
    raiz.render(
      <CampoDeEscolha
        id="parcelas"
        rotulo="Parcelar em até"
        opcoes={opcoes}
        valor={valor}
        aoMudar={aoMudar}
      />,
    );
  });
  return aoMudar;
}

const botao = () => document.getElementById("parcelas") as HTMLButtonElement;
const popover = () =>
  document.querySelector<HTMLElement>('[data-lista-de-escolha="popover"]');
const opcao = (valor: string) =>
  document.querySelector<HTMLElement>(
    `[role="option"][data-valor="${valor}"]`,
  ) as HTMLElement;

// O Radix devolve o foco num `setTimeout(0)` depois de desmontar a lista.
const proximoTique = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function abrir() {
  await act(async () => botao().click());
  expect(popover()).not.toBeNull();
}

describe("lista de escolha — popover do computador", () => {
  it("abre o popover e não a folha", async () => {
    montar();
    await abrir();
    expect(
      document.querySelector('[data-lista-de-escolha="folha"]'),
    ).toBeNull();
    expect(botao().getAttribute("aria-expanded")).toBe("true");
  });

  it("camada 135, cantos de 20px e a largura do campo (só sintaxe Tailwind 3)", async () => {
    montar();
    await abrir();
    const classes = popover()?.className ?? "";
    expect(classes).toContain("z-[135]");
    expect(classes).toContain("w-[var(--radix-popover-trigger-width)]");
    expect(classes).toContain(
      "max-h-[var(--radix-popover-content-available-height)]",
    );
    expect(popover()?.querySelector(".rounded-\\[20px\\]")).not.toBeNull();
    // Tailwind 4 (`max-h-(--x)`, `outline-hidden`) não existe no 3.4 do app.
    expect(popover()?.outerHTML).not.toMatch(/-\(--|outline-hidden/);
  });

  it("8 linhas visíveis: a lista rola acima disso", async () => {
    montar();
    await abrir();
    const lista = popover()?.querySelector('[role="listbox"]');
    expect(lista?.className).toContain("max-h-[23rem]");
    expect(lista?.className).toContain("overflow-y-auto");
  });

  it("mostra a dica de teclado", async () => {
    montar();
    await abrir();
    expect(popover()?.textContent).toContain(
      "↑ ↓ para andar · Enter escolhe · Esc fecha",
    );
  });

  it("com busca, o foco vai para a busca", async () => {
    montar();
    await abrir();
    expect(document.activeElement?.getAttribute("role")).toBe("combobox");
  });

  it("sem busca, o foco vai para o listbox", async () => {
    montar(PARCELAS.slice(0, 4), "2");
    await abrir();
    expect(document.activeElement?.getAttribute("role")).toBe("listbox");
  });

  it("Esc fecha e devolve o foco ao campo", async () => {
    const aoMudar = montar();
    await abrir();
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(popover()).toBeNull();
    await proximoTique();
    expect(document.activeElement).toBe(botao());
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("escolher chama aoMudar uma vez, fecha e devolve o foco", async () => {
    const aoMudar = montar();
    await abrir();
    await act(async () => opcao("6").click());
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledWith("6");
    expect(popover()).toBeNull();
    await proximoTique();
    expect(document.activeElement).toBe(botao());
  });

  it("Enter na busca escolhe a ativa", async () => {
    const aoMudar = montar();
    await abrir();
    const busca = document.activeElement as HTMLElement;
    await act(async () => {
      busca.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    await act(async () => {
      busca.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(aoMudar).toHaveBeenCalledWith("11");
    expect(popover()).toBeNull();
  });

  it("clicar no campo com a lista aberta fecha (não reabre)", async () => {
    montar();
    await abrir();
    // O Radix só passa a ouvir o toque de fora no tique seguinte à abertura.
    await proximoTique();
    await act(async () => {
      botao().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      botao().click();
    });
    expect(popover()).toBeNull();
    expect(botao().getAttribute("aria-expanded")).toBe("false");
  });
});
