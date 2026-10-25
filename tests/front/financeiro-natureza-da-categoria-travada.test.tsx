// @vitest-environment jsdom
//
// Categoria financeira: trocar Receita↔Despesa de uma categoria que já tem
// lançamentos faria esses lançamentos sumirem da DRE. Por isso a natureza só
// é livre na CRIAÇÃO; depois de criada fica travada (as de sistema já eram).
import { type ReactElement, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CategoriaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import type { CategoriaFinanceira } from "@/types/financeiro";

const AJUDA = "Para mudar, crie uma categoria nova e desative esta.";

const DESPESA: CategoriaFinanceira = {
  id: "cat-aluguel",
  nome: "Aluguel",
  natureza: "despesa",
  grupoDre: "despesa_fixa",
  ativa: true,
  sistema: false,
};

const RECEITA: CategoriaFinanceira = {
  id: "cat-aluguel-de-sala",
  nome: "Aluguel de sala",
  natureza: "receita",
  grupoDre: "receita",
  ativa: true,
  sistema: false,
};

function folha(): HTMLElement {
  const elemento = document.querySelector<HTMLElement>(
    '[data-slot="sheet-content"]',
  );
  if (!elemento) throw new Error("Folha não abriu");
  return elemento;
}

function botaoDaNatureza(rotulo: "Despesa" | "Receita"): HTMLButtonElement {
  const grupo = folha().querySelector('[role="group"][aria-label="Natureza"]');
  const achado = [...(grupo?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === rotulo,
  );
  if (!achado) throw new Error(`botão de natureza "${rotulo}" não existe`);
  return achado;
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...folha().querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === rotulo,
  );
  if (!achado) throw new Error(`botão "${rotulo}" não existe`);
  return achado;
}

async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("Financeiro — natureza da categoria", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar(elemento: ReactElement) {
    await act(async () => raiz.render(elemento));
  }

  function categoriaFolha(categoria: CategoriaFinanceira | null) {
    return (
      <CategoriaFolha
        categoria={categoria}
        aoFechar={vi.fn()}
        aoSalvar={vi.fn()}
        aoMudarSujo={vi.fn()}
      />
    );
  }

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({ data: { ids: ["salvo"] }, error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("criar: a natureza é livre e o valor escolhido vai ao servidor", async () => {
    await montar(categoriaFolha(null));
    expect(botaoDaNatureza("Despesa").disabled).toBe(false);
    expect(botaoDaNatureza("Receita").disabled).toBe(false);
    expect(folha().textContent).not.toContain(AJUDA);

    await act(async () => botaoDaNatureza("Receita").click());
    expect(botaoDaNatureza("Receita").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await digitar("fin-categoria-nome", "Venda de sucata");
    await act(async () => botao("Salvar").click());

    expect(rpcFalso).toHaveBeenCalledExactlyOnceWith("fin_categoria_salvar", {
      p: {
        nome: "Venda de sucata",
        natureza: "receita",
        grupo_dre: "receita",
        ativa: true,
      },
    });
  });

  it.each([DESPESA, RECEITA])(
    "editar categoria de $natureza: natureza travada, ajuda visível e o original vai ao servidor",
    async (categoria) => {
      const outra = categoria.natureza === "despesa" ? "Receita" : "Despesa";
      const propria = categoria.natureza === "despesa" ? "Despesa" : "Receita";
      await montar(categoriaFolha(categoria));

      expect(botaoDaNatureza("Despesa").disabled).toBe(true);
      expect(botaoDaNatureza("Receita").disabled).toBe(true);
      expect(folha().textContent).toContain(AJUDA);

      // Mesmo forçando o clique, a natureza não muda.
      await act(async () => botaoDaNatureza(outra).click());
      expect(botaoDaNatureza(propria).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(botaoDaNatureza(outra).getAttribute("aria-pressed")).toBe("false");

      await digitar("fin-categoria-nome", `${categoria.nome} novo`);
      await act(async () => botao("Salvar").click());

      expect(rpcFalso).toHaveBeenCalledExactlyOnceWith("fin_categoria_salvar", {
        p: {
          id: categoria.id,
          nome: `${categoria.nome} novo`,
          natureza: categoria.natureza,
          grupo_dre: categoria.grupoDre,
          ativa: true,
        },
      });
    },
  );

  it("categoria do sistema continua travada, com o aviso próprio", async () => {
    await montar(categoriaFolha({ ...DESPESA, sistema: true }));
    expect(botaoDaNatureza("Despesa").disabled).toBe(true);
    expect(botaoDaNatureza("Receita").disabled).toBe(true);
    expect(folha().textContent).toContain("a natureza é fixa");
  });
});
