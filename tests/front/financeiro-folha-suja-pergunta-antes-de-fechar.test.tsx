// @vitest-environment jsdom
// Folha do Financeiro com algo escrito não some sem perguntar: X, toque no véu,
// Esc e o Voltar do celular abrem "Descartar o que você escreveu?". Sem nada
// alterado a folha fecha direto, e salvar nunca pergunta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { CONTA_BANCARIA } from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const PERGUNTA = "Descartar o que você escreveu?";

function folhaAberta(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
}

function pergunta(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function botaoEm(raiz: ParentNode, rotulo: string): HTMLButtonElement {
  const el = [...raiz.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!el) throw new Error(`botão ${rotulo} não existe`);
  return el;
}

function botaoX(): HTMLButtonElement {
  const el = folhaAberta()?.querySelector<HTMLButtonElement>(
    '[aria-label="Fechar"]',
  );
  if (!el) throw new Error("botão X da folha não existe");
  return el;
}

function campo(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`campo ${id} não existe`);
  }
  return el;
}

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function clicar(el: HTMLElement) {
  // Um toque de verdade começa por um pointerdown, que desarma o guardião do
  // clique pós-fecho deixado pelo toque no véu de um teste anterior.
  await act(async () => {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  await act(async () => el.click());
  await esperar();
}

async function digitar(id: string, valor: string) {
  const el = campo(id);
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("Financeiro — folha com algo escrito pergunta antes de fechar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSetBackOverride = vi.fn<(fn: (() => void) | null) => void>();
  const onSetDirty = vi.fn<(sujo: boolean) => void>();

  beforeEach(() => {
    onSetBackOverride.mockClear();
    onSetDirty.mockClear();
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_contas_listar") {
        return {
          data: [
            {
              id: CONTA_BANCARIA,
              nome: "Conta bancária",
              tipo: "banco",
              saldo_inicial: 0,
              saldo_inicial_em: "2026-10-13",
              ativa: true,
              sistema: true,
              saldo: 0,
            },
          ],
          error: null,
        };
      }
      if (nome === "fin_categorias_listar") {
        return {
          data: [
            {
              id: "cat-aluguel",
              nome: "Aluguel",
              natureza: "despesa",
              grupo_dre: "despesa_fixa",
              ativa: true,
            },
          ],
          error: null,
        };
      }
      if (nome === "fin_resumo")
        return { data: { saldo_total: 0 }, error: null };
      return { data: [], error: null };
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrirNovoLancamento(escrever: boolean) {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          onSetBackOverride={onSetBackOverride}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await esperar();
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    if (escrever) await digitar("fin-lanc-descricao", "Aluguel de outubro");
  }

  async function voltarDoCelular() {
    // O roteador usa o argumento como updater de setState, que devolve o handler.
    const atualizar = onSetBackOverride.mock.calls.at(
      -1,
    )?.[0] as unknown as () => () => void;
    await act(async () => atualizar()());
    await esperar();
  }

  async function esc() {
    await act(async () => {
      folhaAberta()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await esperar();
  }

  async function tocarNoVeu() {
    await act(async () => {
      document
        .querySelector('[data-slot="sheet-overlay"]')
        ?.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
        );
    });
    await esperar();
  }

  it.each([
    ["o X", () => clicar(botaoX())],
    ["o Esc", () => esc()],
    ["o toque no véu", () => tocarNoVeu()],
    ["o Voltar do celular", () => voltarDoCelular()],
  ])(
    "com texto digitado, %s pergunta e a folha continua",
    async (_nome, fechar) => {
      await abrirNovoLancamento(true);
      await fechar();
      expect(pergunta()?.textContent).toContain(PERGUNTA);
      expect(folhaAberta()).not.toBeNull();
      expect(campo("fin-lanc-descricao").value).toBe("Aluguel de outubro");
    },
  );

  it("'Continuar escrevendo' mantém o que estava escrito e 'Descartar' fecha", async () => {
    await abrirNovoLancamento(true);
    await clicar(botaoX());
    await clicar(botaoEm(pergunta() as HTMLElement, "Continuar escrevendo"));
    expect(pergunta()).toBeNull();
    expect(campo("fin-lanc-descricao").value).toBe("Aluguel de outubro");

    await clicar(botaoX());
    await clicar(botaoEm(pergunta() as HTMLElement, "Descartar"));
    expect(pergunta()).toBeNull();
    expect(folhaAberta()).toBeNull();
    expect(onSetDirty).toHaveBeenLastCalledWith(false);

    // A folha seguinte nasce limpa: o que foi descartado não volta.
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    expect(campo("fin-lanc-descricao").value).toBe("");
  });

  it("Esc ou Voltar com a pergunta aberta valem 'continuar escrevendo'", async () => {
    await abrirNovoLancamento(true);
    await clicar(botaoX());
    expect(pergunta()).not.toBeNull();
    await esc();
    expect(pergunta()).toBeNull();
    expect(campo("fin-lanc-descricao").value).toBe("Aluguel de outubro");
    await voltarDoCelular();
    expect(pergunta()).not.toBeNull();
    await voltarDoCelular();
    expect(pergunta()).toBeNull();
    expect(folhaAberta()).not.toBeNull();
  });

  it("sem nada alterado a folha fecha direto, sem pergunta", async () => {
    await abrirNovoLancamento(false);
    await clicar(botaoX());
    expect(pergunta()).toBeNull();
    expect(folhaAberta()).toBeNull();

    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    await voltarDoCelular();
    expect(pergunta()).toBeNull();
    expect(folhaAberta()).toBeNull();
  });

  it("desfazer à mão o que escreveu também fecha direto", async () => {
    await abrirNovoLancamento(true);
    await digitar("fin-lanc-descricao", "");
    await clicar(botaoX());
    expect(pergunta()).toBeNull();
    expect(folhaAberta()).toBeNull();
  });

  it("salvar não pergunta nada: a folha preenchida fecha quando o banco confirma", async () => {
    await abrirNovoLancamento(true);
    await digitar("fin-lanc-valor", "10000");
    const categoria = document.getElementById(
      "fin-lanc-categoria",
    ) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set?.call(categoria, "cat-aluguel");
      categoria.dispatchEvent(new Event("change", { bubbles: true }));
    });
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_lancamento_salvar")
        return { data: { ids: ["a"] }, error: null };
      return { data: [], error: null };
    });
    await clicar(botaoEm(folhaAberta() as HTMLElement, "Salvar lançamento"));
    expect(
      rpcFalso.mock.calls.some(([nome]) => nome === "fin_lancamento_salvar"),
    ).toBe(true);
    expect(pergunta()).toBeNull();
    expect(folhaAberta()).toBeNull();
  });

  it("uma folha de cadastro (Nova conta) com nome digitado também pergunta", async () => {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          onSetBackOverride={onSetBackOverride}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await esperar();
    await clicar(botaoEm(hospedeiro, "Contas"));
    await clicar(botaoEm(hospedeiro, "Nova conta"));
    await digitar("fin-conta-nome", "Banco novo");
    await clicar(botaoX());
    expect(pergunta()?.textContent).toContain(PERGUNTA);
    await clicar(botaoEm(pergunta() as HTMLElement, "Descartar"));
    expect(folhaAberta()).toBeNull();
  });

  // A folha aberta tem uma entrada própria no histórico; ao fechar, ela é
  // devolvida com `history.back()`. O popstate dessa devolução chega depois do
  // commit, então o desvio do Voltar não pode ficar `null` nesse intervalo (o App
  // leria "sem desvio" e, com o formulário ainda marcado como sujo, abriria o
  // aviso de alterações não salvas): fica um desvio de uso único, que só engole
  // esse popstate e se desfaz. O teste com popstate de verdade, no App, está em
  // financeiro-folha-suja-voltar-do-aparelho.test.tsx.
  it("ao fechar, o desvio do Voltar vira de uso único e se desfaz quando o popstate chega", async () => {
    await abrirNovoLancamento(true);
    await clicar(botaoX());
    await clicar(botaoEm(pergunta() as HTMLElement, "Descartar"));
    expect(folhaAberta()).toBeNull();

    const desvio = onSetBackOverride.mock.calls.at(-1)?.[0];
    expect(desvio).toBeTypeOf("function");
    await act(async () => (desvio as unknown as () => () => void)()());
    expect(onSetBackOverride).toHaveBeenLastCalledWith(null);
    expect(folhaAberta()).toBeNull();
    expect(pergunta()).toBeNull();
  });

  it("se o popstate da devolução nunca chegar, o desvio de uso único se desfaz sozinho", async () => {
    const voltar = vi
      .spyOn(globalThis.history, "back")
      .mockImplementation(() => {});
    try {
      await abrirNovoLancamento(true);
      await clicar(botaoX());
      await clicar(botaoEm(pergunta() as HTMLElement, "Descartar"));
      expect(voltar).toHaveBeenCalledTimes(1);
      expect(onSetBackOverride.mock.calls.at(-1)?.[0]).toBeTypeOf("function");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1700));
      });

      expect(onSetBackOverride).toHaveBeenLastCalledWith(null);
    } finally {
      voltar.mockRestore();
    }
  });
});
