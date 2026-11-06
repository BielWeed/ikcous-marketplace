// @vitest-environment jsdom
//
// "Nova categoria" do formulario de produto, tres bordas:
//  1. a categoria que a lojista tenta recriar existe mas esta ESCONDIDA da loja (ela nao aparece
//     na escolha do produto): o aviso diz que esta escondida e onde mostrar, nao so "ja existe";
//  2. nome so de emoji ou simbolo (sem letra nem numero) e' recusado ANTES de criar, com a mesma
//     frase do "renomear";
//  3. nome acima do limite e' recusado, e o campo ja trava no limite.
// A folha e' a REAL; so o Supabase (addCategory) e' um duble.
import { LIMITE_DO_NOME_DA_CATEGORIA } from "@/lib/gestao-de-categorias";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(() => "toast-1"),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOJA = [
  { name: "Geral", slug: "geral", isActive: true },
  { name: "Vestuário", slug: "vestuario", isActive: true },
  { name: "Outono", slug: "outono", isActive: false },
];

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarNome(valor: string) {
  await act(async () => {
    digitar("cat-name", valor);
    // O campo só entrega o valor à folha depois de uma pausa.
    await new Promise((r) => setTimeout(r, 300));
  });
}

const botaoCriar = () =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Criar categoria",
  ) as HTMLButtonElement | undefined;

describe("FolhaDeNovaCategoria — categoria escondida e nome inválido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const adicionar = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    adicionar.mockResolvedValue({ id: "cat-novo" });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { FolhaDeNovaCategoria } = await import(
      "@/components/admin/products/FolhaDeNovaCategoria"
    );
    await act(async () => {
      raiz.render(
        <FolhaDeNovaCategoria
          categoriasDaLoja={LOJA}
          adicionar={adicionar}
          atualizarIcone={vi.fn()}
          aoCriada={vi.fn()}
          aoFechar={vi.fn()}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("recriar uma categoria ESCONDIDA diz que ela está escondida e como mostrar, sem criar", async () => {
    await digitarNome("OUTONO");
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(adicionar).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    const frase = String(toastError.mock.calls[0][0]);
    expect(frase).toContain("Outono");
    expect(frase).toMatch(/escondida/);
    expect(frase).toContain("Organizar categorias");
    expect(frase).toContain("Mostrar");
  });

  it("recriar uma categoria que aparece na loja mantém o aviso de sempre", async () => {
    await digitarNome("vestuario");
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(adicionar).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0][0])).toBe(
      "Já existe uma categoria parecida: Vestuário",
    );
  });

  it.each(["🔥", "!!!", "  ☆ ★  "])(
    "o nome %j (sem letra nem número) é recusado antes de criar",
    async (nome) => {
      await digitarNome(nome);
      await act(async () => {
        botaoCriar()?.click();
      });

      expect(adicionar).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(String(toastError.mock.calls[0][0])).toBe(
        "O nome da categoria precisa ter pelo menos uma letra ou um número.",
      );
      // A folha segue aberta com o que ela digitou.
      expect(botaoCriar()).toBeDefined();
    },
  );

  it("nome com emoji MAS com letra continua valendo", async () => {
    await digitarNome("🔥 Promoção");
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(adicionar).toHaveBeenCalledTimes(1);
  });

  it("nome acima do limite é recusado, e o campo já trava no limite", async () => {
    const campo = document.getElementById("cat-name") as HTMLInputElement;
    expect(campo.maxLength).toBe(LIMITE_DO_NOME_DA_CATEGORIA);

    await digitarNome("a".repeat(LIMITE_DO_NOME_DA_CATEGORIA + 1));
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(adicionar).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0][0])).toBe(
      "O nome da categoria pode ter no máximo 80 letras.",
    );
  });

  it("nome com exatamente o limite cria", async () => {
    await digitarNome("a".repeat(LIMITE_DO_NOME_DA_CATEGORIA));
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(adicionar).toHaveBeenCalledTimes(1);
  });
});
