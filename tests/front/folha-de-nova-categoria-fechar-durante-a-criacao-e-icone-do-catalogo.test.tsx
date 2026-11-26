// @vitest-environment jsdom
//
// "Nova categoria" (folha do formulário de produto) — duas bordas do fechar:
//
// 1. Com a criação em andamento NADA fecha a folha: nem Esc, nem toque fora,
//    nem o X, nem Cancelar. Fechar no meio largaria a categoria criada sem
//    ninguém para escolhê-la no formulário (e a pergunta de descarte seria
//    mentira: o que foi digitado já está indo para o banco).
// 2. Um ícone escolhido SOZINHO (sem nome digitado) já é trabalho a perder, e
//    o ícone do CATÁLOGO (que guarda só a "forma") conta igual ao clássico
//    (que guarda só a chave): Cancelar pergunta antes de descartar.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CATALOGO: { chave: string; nome: string; grupo: string; d: string }[] =
  JSON.parse(
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
    dismiss: vi.fn(),
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

function montar() {
  return act(async () => {
    raiz.render(
      <FolhaDeNovaCategoria
        categoriasDaLoja={[]}
        adicionar={adicionar}
        atualizarIcone={vi.fn()}
        aoCriada={vi.fn()}
        aoFechar={aoFechar}
      />,
    );
  });
}

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

async function digitarENaoSair(valor: string) {
  await act(async () => {
    const el = document.getElementById("cat-name") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // O campo entrega o texto à folha 150 ms depois.
  await esperar(220);
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement;
const clicar = (botao: HTMLElement | null | undefined) =>
  act(async () => botao?.click());
const apertarEsc = () =>
  act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
const pergunta = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]');

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
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Nova categoria — fechar com a criação em andamento", () => {
  it("Esc, o X e Cancelar não fecham nem perguntam; quando a criação termina a folha fecha UMA vez", async () => {
    let terminar: (criada: { id: string }) => void = () => {};
    adicionar.mockReturnValueOnce(
      new Promise((resolve) => {
        terminar = resolve;
      }),
    );
    await montar();
    await digitarENaoSair("Camisetas");
    await clicar(botaoPorTexto("Criar categoria"));
    expect(adicionar).toHaveBeenCalledTimes(1);

    await apertarEsc();
    await clicar(
      document.querySelector('button[aria-label="Fechar"]') as HTMLElement,
    );
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()).toBeNull();

    await act(async () => {
      terminar({ id: "cat-1" });
      await esperar(0);
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});

describe("Nova categoria — ícone sozinho já é trabalho a perder", () => {
  it("ícone do catálogo (só a forma), sem nome: Cancelar pergunta antes de descartar", async () => {
    await montar();
    await esperar(50);
    const primeiro = CATALOGO[0];
    const peca = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Ícone ${primeiro?.nome} para nova categoria"]`,
    );
    expect(peca).not.toBeNull();
    await clicar(peca);
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
  });

  it("ícone clássico (só a chave), sem nome: Cancelar pergunta também", async () => {
    await montar();
    await esperar(50);
    const classico = document.querySelector<HTMLButtonElement>(
      'fieldset button[aria-label^="Ícone "][aria-label$=" para nova categoria"]',
    );
    expect(classico).not.toBeNull();
    await clicar(classico);
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
  });

  it("controle: nada escolhido nem digitado, Cancelar fecha direto", async () => {
    await montar();
    await clicar(botaoPorTexto("Cancelar"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(pergunta()).toBeNull();
  });
});
