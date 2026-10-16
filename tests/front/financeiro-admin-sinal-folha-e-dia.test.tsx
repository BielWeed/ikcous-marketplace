// @vitest-environment jsdom
// Mesmo harness dos testes de Financeiro: createRoot + act, RPC falsa e
// componentes reais. Nenhuma escrita sai do processo de teste.
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

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import { CONTA_BANCARIA, type ContaFinanceira } from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const HOJE = "2026-10-13";
const CONTA: ContaFinanceira = {
  id: CONTA_BANCARIA,
  nome: "Conta bancária",
  tipo: "banco",
  saldoInicial: -100,
  saldoInicialEm: HOJE,
  ativa: true,
  ordem: 1,
  sistema: true,
  saldo: -100,
};

function folha(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
  if (!el) throw new Error("folha não abriu");
  return el;
}

function botaoEm(raiz: ParentNode, rotulo: string): HTMLButtonElement {
  const el = [...raiz.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!el) throw new Error(`botão ${rotulo} não existe`);
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
  await act(async () => el.click());
  await esperar();
}

async function digitarSemSair(id: string, valor: string) {
  const el = campo(id);
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function digitar(id: string, valor: string) {
  await digitarSemSair(id, valor);
  await act(async () => {
    campo(id).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function escolherCategoria() {
  const el = document.getElementById("fin-lanc-categoria") as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(el, "cat-aluguel");
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function pendente() {
  let resolver!: (resposta: { data: unknown; error: null }) => void;
  const promessa = new Promise<{ data: unknown; error: null }>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("Financeiro — sinal, envio da folha e virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSetBackOverride = vi.fn<(fn: (() => void) | null) => void>();
  const onSetDirty = vi.fn<(sujo: boolean) => void>();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T02:59:50Z"));
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
              saldo_inicial: -100,
              saldo_inicial_em: HOJE,
              ativa: true,
              sistema: true,
              saldo: -100,
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
      if (nome === "fin_resumo") {
        return { data: { saldo_total: -100 }, error: null };
      }
      return { data: [], error: null };
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  async function montarPainel() {
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
  }

  async function abrirLancamentoValido() {
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    await digitar("fin-lanc-valor", "10000");
    await digitar("fin-lanc-descricao", "Lançamento A");
    await escolherCategoria();
  }

  it.each(["salvo", "digitado"])(
    "preserva saldo negativo %s na exibição, no blur e no payload numérico",
    async (origem) => {
      await act(async () => {
        raiz.render(
          <ContaFolha
            conta={origem === "salvo" ? CONTA : null}
            hoje={HOJE}
            aoFechar={vi.fn()}
            aoSalvar={vi.fn()}
            aoMudarSujo={vi.fn()}
          />,
        );
      });
      if (origem === "digitado") {
        await digitar("fin-conta-nome", "Banco negativo");
        await digitar("fin-conta-saldo", "-100,00");
      }
      expect(campo("fin-conta-saldo").value).toBe("-100,00");
      await act(async () => {
        campo("fin-conta-saldo").focus();
        campo("fin-conta-saldo").dispatchEvent(
          new FocusEvent("focusout", { bubbles: true }),
        );
      });
      expect(campo("fin-conta-saldo").value).toBe("-100,00");
      await clicar(botaoEm(folha(), "Salvar"));
      expect(rpcFalso).toHaveBeenCalledWith("fin_conta_salvar", {
        p: expect.objectContaining({ saldo_inicial: -100 }),
      });
    },
  );

  it("mantém a máscara sem negativos nos consumidores que não optaram por eles", async () => {
    const onFlush = vi.fn();
    await act(async () => {
      raiz.render(
        <LocalBufferedInput
          id="moeda"
          value="-100.00"
          mask="currency"
          onFlush={onFlush}
        />,
      );
    });
    expect(campo("moeda").value).toBe("100,00");
    await digitar("moeda", "-100,00");
    expect(campo("moeda").value).toBe("100,00");
    expect(onFlush).toHaveBeenLastCalledWith("100.00");
  });

  it("preserva o sinal digitado sozinho e os centavos negativos também no debounce", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const onFlush = vi.fn();
    await act(async () => {
      raiz.render(
        <LocalBufferedInput
          id="moeda"
          value=""
          mask="currency"
          permiteNegativo
          onFlush={onFlush}
        />,
      );
    });
    await digitarSemSair("moeda", "-");
    expect(campo("moeda").value).toBe("-");
    await digitarSemSair("moeda", "-0,01");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(campo("moeda").value).toBe("-0,01");
    expect(onFlush).toHaveBeenLastCalledWith("-0.01");
    await digitar("moeda", "0,01");
    expect(campo("moeda").value).toBe("0,01");
    expect(onFlush).toHaveBeenLastCalledWith("0.01");
  });

  it("bloqueia Cancelar, X, Esc, véu, Voltar e nova abertura durante o envio", async () => {
    const envio = pendente();
    await montarPainel();
    rpcFalso.mockImplementation((nome: string) => {
      if (nome === "fin_lancamento_salvar") return envio.promessa;
      return Promise.resolve({ data: [], error: null });
    });
    await abrirLancamentoValido();
    const atual = folha();
    await clicar(botaoEm(atual, "Salvar lançamento"));
    expect(botaoEm(atual, "Cancelar").disabled).toBe(true);
    await clicar(botaoEm(atual, "Cancelar"));
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    await clicar(
      atual.querySelector<HTMLButtonElement>('[aria-label="Fechar"]')!,
    );
    await act(async () => {
      atual.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
      overlay.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    // Gesto novo dentro da folha desarma o guardião do clique pós-fecho.
    await act(async () => {
      atual.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    // O roteador usa o argumento como updater de setState, que devolve o handler.
    const atualizarVoltar = onSetBackOverride.mock.calls.at(
      -1,
    )?.[0] as unknown as () => () => void;
    await act(async () => atualizarVoltar()());
    expect(folha()).toBe(atual);
    expect(campo("fin-lanc-descricao").value).toBe("Lançamento A");
    await act(async () => {
      document
        .getElementById("fin-novo-lancamento")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(
      rpcFalso.mock.calls.filter(([nome]) => nome === "fin_lancamento_salvar"),
    ).toHaveLength(1);
    await act(async () =>
      envio.resolver({ data: { ids: ["a"] }, error: null }),
    );
    await esperar();
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    expect(campo("fin-lanc-descricao").value).toBe("");
  });

  it("resposta de uma geração anterior não fecha nem limpa a folha nova", async () => {
    const envio = pendente();
    await montarPainel();
    const aba = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((el) => el.textContent?.startsWith("Contas e categorias"))!;
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
    await clicar(botaoEm(hospedeiro, "Nova conta"));
    await digitar("fin-conta-nome", "Conta A");
    rpcFalso.mockImplementation((nome: string) => {
      if (nome === "fin_conta_salvar") return envio.promessa;
      return Promise.resolve({ data: [], error: null });
    });
    await clicar(botaoEm(folha(), "Salvar"));
    expect(rpcFalso).toHaveBeenCalledWith(
      "fin_conta_salvar",
      expect.anything(),
    );
    // Outro cadastro ainda pode sair enquanto espera: exercita a defesa da
    // view contra resposta antiga, independentemente da trava do lançamento.
    await clicar(botaoEm(folha(), "Cancelar"));
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    await digitar("fin-lanc-descricao", "Lançamento B");
    const nova = folha();
    await act(async () => envio.resolver({ data: null, error: null }));
    await esperar();
    expect(folha()).toBe(nova);
    expect(campo("fin-lanc-descricao").value).toBe("Lançamento B");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
  });

  it("libera o cancelamento depois de uma falha de gravação", async () => {
    await montarPainel();
    await abrirLancamentoValido();
    rpcFalso.mockRejectedValueOnce(new Error("Falha na conexão"));
    await clicar(botaoEm(folha(), "Salvar lançamento"));
    expect(botaoEm(folha(), "Cancelar").disabled).toBe(false);
    await clicar(botaoEm(folha(), "Cancelar"));
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("atualiza o período e o hoje da folha ao voltar visível depois da meia-noite de São Paulo", async () => {
    await montarPainel();
    await clicar(botaoEm(hospedeiro, "30 dias"));
    const ultimoPeriodo = () =>
      rpcFalso.mock.calls.filter(([nome]) => nome === "fin_resumo").at(-1)?.[1];
    expect(ultimoPeriodo()).toEqual({ p_inicio: "2026-09-14", p_fim: HOJE });
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    expect(campo("fin-lanc-realizacao").max).toBe(HOJE);
    await act(async () => {
      vi.setSystemTime(new Date("2026-10-14T03:00:10Z"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esperar();
    expect(ultimoPeriodo()).toEqual({
      p_inicio: "2026-09-15",
      p_fim: "2026-10-14",
    });
    expect(campo("fin-lanc-realizacao").max).toBe("2026-10-14");
    // A virada não sobrescreve a data que já estava sendo editada.
    expect(campo("fin-lanc-realizacao").value).toBe(HOJE);
  });
});
