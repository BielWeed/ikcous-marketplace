// @vitest-environment jsdom
//
// "Nova categoria" perdia o nome e o ícone digitados ao tocar fora, Esc ou
// Cancelar, sem avisar. Agora, se há algo digitado, a folha pergunta antes de
// descartar (a mesma pergunta da folha de Responder pergunta); sem nada
// digitado, fecha direto. A folha é a REAL; só o Supabase é dublê.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  simularSaidaAnimada,
  terminarSaida,
} from "./duble-saida-animada-da-folha";

const CATALOGO = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, não entrada de usuário
  readFileSync(
    join(__dirname, "..", "..", "public", "icons", "categorias.json"),
    "utf8",
  ),
);

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-1"),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { FolhaDeNovaCategoria } = await import(
  "@/components/admin/products/FolhaDeNovaCategoria"
);

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoFechar = vi.fn();
const adicionar = vi.fn();

function montar(aberta?: boolean) {
  return act(async () => {
    raiz.render(
      <FolhaDeNovaCategoria
        categoriasDaLoja={[]}
        adicionar={adicionar}
        atualizarIcone={vi.fn()}
        aoCriada={vi.fn()}
        aoFechar={aoFechar}
        {...(aberta === undefined ? {} : { aberta })}
      />,
    );
  });
}

/** Digita no campo, SEM esperar o campo entregar o texto à folha (150 ms). */
async function digitarSemEsperar(valor: string) {
  await act(async () => {
    const el = document.getElementById("cat-name") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const esperar = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const apertarEsc = () =>
  act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
const clicar = (botao: HTMLElement | null | undefined) =>
  act(async () => botao?.click());
const pergunta = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]');
const textoDaPergunta = "Descartar o que você escreveu?";

beforeEach(() => {
  vi.clearAllMocks();
  esquecerOCatalogoCarregado();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => CATALOGO })),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Nova categoria — descartar o que foi digitado", () => {
  it("sem nada digitado, Cancelar, o X e Esc fecham direto", async () => {
    await montar();
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();

    await clicar(
      document.querySelector('button[aria-label="Fechar"]') as HTMLElement,
    );
    expect(aoFechar).toHaveBeenCalledTimes(2);

    await apertarEsc();
    expect(aoFechar).toHaveBeenCalledTimes(3);
    expect(pergunta()).toBeNull();
  });

  it("só espaços no nome não conta como digitado", async () => {
    await montar();
    await digitarSemEsperar("   ");
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();
  });

  it("com nome digitado, Cancelar pergunta antes (mesmo antes de o campo entregar o texto)", async () => {
    await montar();
    await digitarSemEsperar("Calçados");
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()?.textContent).toContain(textoDaPergunta);
  });

  it("com nome digitado, Esc e o X também perguntam", async () => {
    await montar();
    await digitarSemEsperar("Calçados");
    await apertarEsc();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();

    await clicar(botaoPorTexto("Continuar editando"));
    expect(pergunta()).toBeNull();

    await clicar(
      document.querySelector('button[aria-label="Fechar"]') as HTMLElement,
    );
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
  });

  it("só o ícone escolhido (sem nome) também pergunta", async () => {
    await montar();
    await esperar(50);
    await clicar(
      document.querySelector<HTMLElement>(
        'button[aria-label="Ícone Casa para nova categoria"]',
      ),
    );
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
  });

  it("Continuar editando mantém o nome digitado; Esc com a pergunta na tela também continua editando", async () => {
    await montar();
    await digitarSemEsperar("Calçados");
    await esperar(300);
    await clicar(botaoPorTexto("Cancelar"));
    expect(pergunta()).not.toBeNull();

    await apertarEsc();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()).toBeNull();
    expect(
      (document.getElementById("cat-name") as HTMLInputElement).value,
    ).toBe("Calçados");
  });

  it("Descartar fecha, e o corpo fica inerte enquanto a pergunta está na tela", async () => {
    await montar();
    await digitarSemEsperar("Calçados");
    await clicar(botaoPorTexto("Cancelar"));
    const corpo = document.getElementById("cat-name")?.closest("[inert]");
    expect(corpo).not.toBeNull();

    await clicar(botaoPorTexto("Descartar"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("criar com sucesso fecha direto, sem perguntar", async () => {
    adicionar.mockResolvedValue({ id: "cat-novo" });
    await montar();
    await digitarSemEsperar("Calçados");
    await esperar(300);
    await clicar(botaoPorTexto("Criar categoria"));
    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();
  });
});

describe("Nova categoria — a saída anima", () => {
  it("com aberta=false a folha segue na tela fechando, até a animação terminar", async () => {
    simularSaidaAnimada();
    await montar(true);
    const dialogo = () =>
      document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialogo()?.getAttribute("data-state")).toBe("open");

    await montar(false);
    expect(dialogo()?.getAttribute("data-state")).toBe("closed");

    await act(async () => terminarSaida(dialogo() as HTMLElement));
    expect(dialogo()).toBeNull();
  });
});
