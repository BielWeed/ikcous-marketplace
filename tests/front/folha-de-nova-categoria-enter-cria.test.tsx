// @vitest-environment jsdom
import { FolhaDeNovaCategoria } from "@/components/admin/products/FolhaDeNovaCategoria";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  adicionar: vi.fn(),
  criada: vi.fn(),
  fechar: vi.fn(),
  erro: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "criando"),
    dismiss: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: h.erro,
  },
}));

describe("Nova categoria — Concluído do teclado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let responder: (valor: { id: string }) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.adicionar.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        responder = resolve;
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <FolhaDeNovaCategoria
          categoriasDaLoja={[{ name: "Vestuário", slug: "vestuario" }]}
          adicionar={h.adicionar}
          atualizarIcone={vi.fn()}
          aoCriada={h.criada}
          aoFechar={h.fechar}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      responder({ id: "nova" });
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const campo = () => document.getElementById("cat-name") as HTMLInputElement;
  const botao = () => {
    const encontrado = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Criar categoria",
    );
    if (!encontrado) throw new Error("Botão Criar categoria ausente");
    return encontrado;
  };
  async function digitar(nome: string) {
    await act(async () => {
      campo().focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo(), nome);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Sem blur e sem avançar o relógio: o nome ainda está no buffer real.
    expect(document.activeElement).toBe(campo());
    expect(botao().getAttribute("aria-disabled")).toBe("true");
  }
  function enter(isComposing = false) {
    campo().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing,
      }),
    );
  }

  it("Enter cria com o nome do campo antes de blur ou debounce", async () => {
    await digitar("  Calçados  ");
    await act(async () => enter());
    expect(h.adicionar).toHaveBeenCalledExactlyOnceWith(
      { name: "Calçados", description: "", isActive: true },
      true,
    );
    await act(async () => responder({ id: "nova" }));
    expect(h.criada).toHaveBeenCalledExactlyOnceWith("Calçados");
    expect(h.fechar).toHaveBeenCalledTimes(1);
  });

  it.each(["", "   "])(
    "Enter com nome vazio %j não cria nem avisa erro",
    async (nome) => {
      await digitar(nome);
      await act(async () => enter());
      expect(h.adicionar).not.toHaveBeenCalled();
      expect(h.erro).not.toHaveBeenCalled();
    },
  );

  it("Enter durante composição IME não cria", async () => {
    await digitar("Calçados");
    await act(async () => enter(true));
    expect(h.adicionar).not.toHaveBeenCalled();
    expect(h.erro).not.toHaveBeenCalled();
    // A confirmação seguinte, fora da composição, continua funcionando.
    await act(async () => enter());
    expect(h.adicionar).toHaveBeenCalledTimes(1);
  });

  it("dois Enter no mesmo instante criam uma vez", async () => {
    await digitar("Calçados");
    await act(async () => {
      enter();
      enter();
    });
    expect(h.adicionar).toHaveBeenCalledTimes(1);
  });

  it("Enter e clique no mesmo instante criam uma vez", async () => {
    await digitar("Calçados");
    await act(async () => {
      enter();
      botao().click();
    });
    expect(h.adicionar).toHaveBeenCalledTimes(1);
  });

  it("Enter enquanto criando não inicia outra criação", async () => {
    await digitar("Calçados");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await act(async () => {
      botao().click();
    });
    expect(h.adicionar).toHaveBeenCalledTimes(1);
    expect(campo().readOnly).toBe(true);
    await act(async () => enter());
    expect(h.adicionar).toHaveBeenCalledTimes(1);
  });

  it.each(["VESTUARIO", "!!!"])(
    "Enter mantém a recusa de nome duplicado ou inválido: %s",
    async (nome) => {
      await digitar(nome);
      await act(async () => enter());
      expect(h.adicionar).not.toHaveBeenCalled();
      expect(h.erro).toHaveBeenCalledTimes(1);
    },
  );
});
