// @vitest-environment jsdom
//
// "Editar vitrine" > Concluir: o painel só fecha quando o nome digitado ficou
// GRAVADO. Se a gravação falha, fechar jogaria fora o texto (ele só existe no
// campo): o painel fica aberto, avisa, e o toque seguinte tenta de novo o mesmo
// nome. Sem nome mexido, Concluir fecha na hora e não grava nada.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { FolhaEditarVitrine } = await import(
  "@/components/admin/vitrines/FolhaEditarVitrine"
);

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const aoFechar = vi.fn();

async function abrir(aoRenomear: (t: string) => Promise<boolean>) {
  aoFechar.mockReset();
  await act(async () => {
    raiz.render(
      createElement(FolhaEditarVitrine, {
        secao: { id: "custom_1", title: "Kits", active: true, productIds: [] },
        posicao: 1,
        produtos: [],
        idsEmExibicao: [],
        aoFechar,
        aoRenomear,
        aoMudarQuantidade: () => {},
        aoAlternarProduto: () => {},
        aoVoltarAoAutomatico: () => {},
        aoEscolherManualmente: () => {},
      } as never),
    );
  });
}

const campo = () =>
  document.querySelector<HTMLInputElement>(
    'input[name="title"]',
  ) as HTMLInputElement;
const concluir = () =>
  [...document.querySelectorAll("button")].find((b) =>
    ["Concluir", "Salvando…"].includes(b.textContent?.trim() ?? ""),
  ) as HTMLButtonElement;
const aviso = () => document.querySelector('[role="alert"]');

/** Digita e espera a pausa do campo: o nome SOBE para a folha, sem sair dele. */
async function digitar(texto: string) {
  await act(async () => {
    campo().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo(), texto);
    campo().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}
const tocarConcluir = () =>
  act(async () => {
    concluir().click();
    await new Promise((r) => setTimeout(r, 0));
  });

describe("Editar vitrine — Concluir e o nome", () => {
  it("nome que NÃO gravou: não fecha, avisa, e o toque seguinte tenta o mesmo nome e fecha", async () => {
    const aoRenomear = vi
      .fn<(t: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await abrir(aoRenomear);
    await digitar("Kits de verão");
    expect(aoRenomear).toHaveBeenCalledTimes(1);
    expect(aviso()?.textContent).toContain("Não deu para salvar o nome");

    await tocarConcluir();
    // O resultado da gravação que falhou vale: nada de gravar (e avisar) de novo.
    expect(aoRenomear).toHaveBeenCalledTimes(1);
    expect(aoFechar).not.toHaveBeenCalled();
    expect(aviso()).not.toBeNull();

    await tocarConcluir();
    expect(aoRenomear).toHaveBeenCalledTimes(2);
    expect(aoRenomear).toHaveBeenLastCalledWith("Kits de verão");
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
  });

  it("aoRenomear que explode conta como não gravou: painel aberto", async () => {
    const aoRenomear = vi
      .fn<(t: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("rede"));
    await abrir(aoRenomear);
    await digitar("Outro nome");
    await tocarConcluir();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Não deu para salvar o nome");
  });

  it("nome que gravou: Concluir fecha UMA vez, sem aviso", async () => {
    const aoRenomear = vi
      .fn<(t: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    await abrir(aoRenomear);
    await digitar("Novo nome");
    expect(aviso()).toBeNull();
    await tocarConcluir();
    expect(aoRenomear).toHaveBeenCalledTimes(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("sem mexer no nome: Concluir fecha na hora e não grava nada", async () => {
    const aoRenomear = vi
      .fn<(t: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    await abrir(aoRenomear);
    await tocarConcluir();
    expect(aoRenomear).not.toHaveBeenCalled();
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("depois de um fracasso, um nome NOVO que grava limpa o aviso", async () => {
    const aoRenomear = vi
      .fn<(t: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await abrir(aoRenomear);
    await digitar("Primeiro");
    expect(aviso()).not.toBeNull();
    await digitar("Segundo");
    expect(aoRenomear).toHaveBeenLastCalledWith("Segundo");
    expect(aviso()).toBeNull();
    await tocarConcluir();
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(aoRenomear).toHaveBeenCalledTimes(2);
  });
});
