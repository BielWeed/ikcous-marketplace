// @vitest-environment jsdom
// Financeiro: a folha que fecha devolve a entrada do histórico e arma um relógio
// de segurança de 1,5 s para o caso de o popstate nunca chegar. Fechar, reabrir e
// fechar de novo dentro desse prazo não pode deixar o relógio da primeira vez
// vivo: ele dispararia depois (até com a tela já fechada) e mexeria no botão
// Voltar de quem está na tela seguinte.
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

import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const RELOGIO_DA_ENTRADA_MS = 1500;

function botaoEm(raiz: ParentNode, rotulo: string): HTMLButtonElement {
  const el = [...raiz.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!el) throw new Error(`botão ${rotulo} não existe`);
  return el;
}

function botaoX(): HTMLButtonElement {
  const el = document
    .querySelector<HTMLElement>('[data-slot="sheet-content"]')
    ?.querySelector<HTMLButtonElement>('[aria-label="Fechar"]');
  if (!el) throw new Error("botão X da folha não existe");
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
  await act(async () => {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  await act(async () => el.click());
  await esperar();
}

describe("Financeiro — relógio da entrada do histórico não vaza", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSetBackOverride = vi.fn<(fn: (() => void) | null) => void>();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    globalThis.history.replaceState(null, "");
    onSetBackOverride.mockClear();
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Relógios de 1,5 s armados e ainda vivos (nem disparados nem cancelados).
  // `vi.getTimerCount()` conta também os das outras peças da tela.
  const vivos = new Set<number>();
  function vigiarRelogiosDe1500() {
    const armar = window.setTimeout.bind(window);
    const cancelar = window.clearTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      if (ms !== RELOGIO_DA_ENTRADA_MS) return armar(fn, ms);
      const id: number = armar(() => {
        vivos.delete(id);
        fn();
      }, ms);
      vivos.add(id);
      return id;
    }) as typeof window.setTimeout);
    vi.spyOn(window, "clearTimeout").mockImplementation(((id?: number) => {
      vivos.delete(id as number);
      cancelar(id);
    }) as typeof window.clearTimeout);
  }

  const vezesSemDesvio = () =>
    onSetBackOverride.mock.calls.filter(([fn]) => fn === null).length;

  async function montar() {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          onSetBackOverride={onSetBackOverride}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await esperar();
  }

  // O popstate nunca chega (o App de verdade é quem o entregaria): a entrada
  // fica no histórico e só o relógio de segurança pode soltar o desvio.
  async function abrirEFechar() {
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    await clicar(botaoX());
  }

  it("fechar, reabrir e fechar de novo: o relógio da primeira vez não dispara cedo", async () => {
    await montar();
    await abrirEFechar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await abrirEFechar();
    const antes = vezesSemDesvio();

    // 1,6 s depois do primeiro fechar, mas só 0,6 s depois do segundo: quem
    // manda é o relógio do segundo, ainda não venceu.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(vezesSemDesvio()).toBe(antes);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOGIO_DA_ENTRADA_MS * 2);
    });
    expect(vezesSemDesvio()).toBe(antes + 1);
  });

  it("fechar, reabrir, fechar e sair da tela: nenhum relógio fica vivo", async () => {
    vivos.clear();
    vigiarRelogiosDe1500();
    await montar();
    await abrirEFechar();
    await abrirEFechar();
    expect(vivos.size).toBeGreaterThan(0);

    act(() => raiz.unmount());
    expect(vivos.size).toBe(0);
    // Remonta para o afterEach ter o que desmontar.
    raiz = createRoot(hospedeiro);
  });
});
