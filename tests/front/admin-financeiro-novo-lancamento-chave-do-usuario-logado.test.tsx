// @vitest-environment jsdom
// Financeiro, pela TELA de verdade: a chave anti-repetição que o "Novo
// lançamento" guarda quando o envio fica sem resposta é da conta LOGADA. Os
// testes da folha passam o `autorId` à mão; só este prova que a tela liga o
// usuário de `useAuth` à folha (com `autorId={null}` nada se guardaria, com um
// valor fixo todas as contas da aba dividiriam a mesma chave). E se a conta da
// aba troca com a folha aberta (outra aba entrou), a folha recomeça.
//
// Harness: o mesmo de financeiro-admin-sinal-folha-e-dia.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso, conta } = vi.hoisted(() => ({
  rpcFalso: vi.fn(),
  conta: { id: null as string | null },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.id ? { id: conta.id } : null }),
}));

import { CONTA_BANCARIA } from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";
import { escolherNaLista } from "./helpers/lista-de-escolha";

const HOJE = "2026-10-13";
const ARMAZEM = "fin-lancamento-tentativas-em-aberto";
const DONA = "8a1f0c2e-2222-4222-8222-000000000002";
const FUNCIONARIA = "8a1f0c2e-1111-4111-8111-000000000001";

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
    campo(id).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function chavesGuardadas(): Record<
  string,
  { chave: string; em: number; dono: string }
> {
  return JSON.parse(sessionStorage.getItem(ARMAZEM) ?? "{}");
}

function enviosDoLancamento() {
  return rpcFalso.mock.calls.filter(
    ([nome]) => nome === "fin_lancamento_salvar",
  );
}

describe("Financeiro — a chave em aberto do Novo lançamento é da conta logada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
    sessionStorage.removeItem(ARMAZEM);
    conta.id = DONA;
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_lancamento_salvar") return new Promise(() => {});
      if (nome === "fin_contas_listar") {
        return {
          data: [
            {
              id: CONTA_BANCARIA,
              nome: "Conta bancária",
              tipo: "banco",
              saldo_inicial: 0,
              saldo_inicial_em: HOJE,
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
      if (nome === "fin_resumo") {
        return { data: { saldo_total: 0 }, error: null };
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
    sessionStorage.removeItem(ARMAZEM);
    vi.useRealTimers();
  });

  async function montarPainel() {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          onSetBackOverride={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await esperar();
  }

  async function preencherLancamento() {
    await clicar(botaoEm(hospedeiro, "Novo lançamento"));
    await digitar("fin-lanc-valor", "10000");
    await digitar("fin-lanc-descricao", "Aluguel de outubro");
    await act(async () => {
      escolherNaLista("fin-lanc-categoria", "cat-aluguel");
    });
  }

  it("o envio guarda a chave no nome de quem está logado, com a mesma chave que vai ao banco", async () => {
    await montarPainel();
    await preencherLancamento();
    const salvar = document.querySelector<HTMLButtonElement>(
      'button[form="fin-novo-lancamento"]',
    );
    if (!salvar) throw new Error("botão de salvar do lançamento não existe");
    await clicar(salvar);

    const envios = enviosDoLancamento();
    expect(envios).toHaveLength(1);
    const enviada = envios[0]?.[1].p.chave_idempotencia;
    const guardadas = Object.values(chavesGuardadas());
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]?.dono).toBe(DONA);
    expect(guardadas[0]?.chave).toBe(enviada);
  });

  it("a conta da aba troca com a folha aberta: a folha recomeça vazia", async () => {
    await montarPainel();
    await preencherLancamento();
    expect(campo("fin-lanc-descricao").value).toBe("Aluguel de outubro");

    // Outra aba entrou com a conta da funcionária (sem passar pelo Sair).
    conta.id = FUNCIONARIA;
    await montarPainel();

    expect(campo("fin-lanc-descricao").value).toBe("");
    expect(campo("fin-lanc-valor").value).toBe("");
  });
});
