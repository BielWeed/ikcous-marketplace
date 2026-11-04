// @vitest-environment jsdom
//
// Financeiro — quando a releitura do caixa FALHA com um valor antigo na tela:
// a aba Caixa e o cartão "Caixa de hoje" avisam (com "Tentar de novo"), marcam o
// "esperado na gaveta" como possivelmente desatualizado, e a folha de Sangria
// não bloqueia nem libera com base nesse valor velho (o servidor confere o
// dinheiro de verdade ao registrar). Só muda o que a tela mostra e permite
// quando a leitura falhou: nenhum cálculo de saldo mudou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { CaixaDeHoje } from "@/components/admin/financeiro/CaixaDeHoje";
import { MovimentarCaixaFolha } from "@/components/admin/financeiro/FolhasDoCaixa";
import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CaixaAtual,
  type ContaFinanceira,
} from "@/types/financeiro";

const SESSAO: CaixaAtual = {
  id: "sessao-1",
  contaId: CONTA_CAIXA_DA_LOJA,
  contaNome: "Caixa da loja",
  abertoEm: "2026-10-23T11:12:00Z",
  valorAbertura: 100,
  vendasDinheiro: 0,
  devolucoesDinheiro: 0,
  estornosExternosDinheiro: 0,
  entradasManuais: 0,
  saidasManuais: 0,
  esperado: 100,
  movimentos: [],
};

type ConsultaDoCaixa = ConsultaFinanceira<{
  readonly sessao: CaixaAtual | null;
}>;

function consulta(
  sessao: CaixaAtual | null,
  erro: string | null,
  recarregar = vi.fn(),
): ConsultaDoCaixa {
  return { dados: { sessao }, carregando: false, erro, recarregar };
}

const CONTAS: ContaFinanceira[] = [CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA].map(
  (id, i) => ({
    id,
    nome: id === CONTA_BANCARIA ? "Banco" : "Caixa",
    tipo: id === CONTA_BANCARIA ? ("banco" as const) : ("caixa" as const),
    saldoInicial: 0,
    saldoInicialEm: "2026-10-16",
    ativa: true,
    ordem: i + 1,
    sistema: true,
    saldo: 100,
  }),
);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  rpc.mockReset().mockImplementation(async (nome: string) => {
    if (nome === "fin_caixa_historico") return { data: [], error: null };
    return { data: [], error: null };
  });
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();
const botao = (rotulo: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => normalizar(b.textContent) === rotulo,
  );
const alerta = () => document.querySelector('[role="alert"]');

async function montarAba(caixaDaTela: ConsultaDoCaixa, abrirFolha = vi.fn()) {
  await act(async () =>
    root.render(
      <AbaCaixa
        ativo
        versao={0}
        abrirFolha={abrirFolha}
        caixaDaTela={caixaDaTela}
      />,
    ),
  );
  for (let i = 0; i < 4; i += 1) await act(async () => Promise.resolve());
  return abrirFolha;
}

describe("aba Caixa — a leitura falhou com valor antigo na tela", () => {
  it("mostra o erro com 'Tentar de novo' e marca o esperado como desatualizado", async () => {
    const recarregar = vi.fn();
    await montarAba(
      consulta(SESSAO, "Sem conexão com a internet.", recarregar),
    );

    expect(alerta()?.textContent).toContain("Sem conexão com a internet.");
    const tentar = botao("Tentar de novo");
    expect(tentar).toBeDefined();
    await act(async () => tentar!.click());
    expect(recarregar).toHaveBeenCalledOnce();

    const cartao = document.querySelector<HTMLElement>(
      'section[aria-label="Esperado na gaveta"]',
    )!;
    expect(cartao.dataset.valorDesatualizado).toBe("true");
    expect(normalizar(cartao.textContent)).toMatch(/desatualizado/i);
  });

  it("a Sangria abre SEM o esperado velho (null); o Suprimento não depende dele", async () => {
    const abrirFolha = await montarAba(consulta(SESSAO, "Falhou."));
    await act(async () => botao("Sangria")!.click());
    expect(abrirFolha).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tipo: "caixa-movimentar",
        movimento: "sangria",
        esperado: null,
      }),
    );
  });

  it("sem erro, nada muda: sem alerta, sem marca, Sangria leva o esperado", async () => {
    const abrirFolha = await montarAba(consulta(SESSAO, null));
    expect(alerta()).toBeNull();
    const cartao = document.querySelector<HTMLElement>(
      'section[aria-label="Esperado na gaveta"]',
    )!;
    expect(cartao.dataset.valorDesatualizado).toBeUndefined();
    expect(normalizar(cartao.textContent)).not.toMatch(/desatualizado/i);
    await act(async () => botao("Sangria")!.click());
    expect(abrirFolha).toHaveBeenLastCalledWith(
      expect.objectContaining({ esperado: 100 }),
    );
  });

  it("caixa fechado + erro com dados antigos: também avisa (pode estar aberto agora)", async () => {
    await montarAba(consulta(null, "Sem conexão com a internet."));
    expect(alerta()?.textContent).toContain("Sem conexão com a internet.");
    expect(botao("Tentar de novo")).toBeDefined();
  });
});

describe("cartão Caixa de hoje — a leitura falhou com valor antigo na tela", () => {
  async function montarCartao(c: ConsultaDoCaixa) {
    await act(async () =>
      root.render(
        <CaixaDeHoje consulta={c} abrirFolha={vi.fn()} irParaAba={vi.fn()} />,
      ),
    );
  }

  it("mostra o erro com 'Tentar de novo' e marca o valor como desatualizado", async () => {
    const recarregar = vi.fn();
    await montarCartao(
      consulta(SESSAO, "Sem conexão com a internet.", recarregar),
    );
    expect(alerta()?.textContent).toContain("Sem conexão com a internet.");
    await act(async () => botao("Tentar de novo")!.click());
    expect(recarregar).toHaveBeenCalledOnce();
    const cartao = document.querySelector<HTMLElement>(
      'section[aria-label="Caixa"]',
    )!;
    expect(cartao.dataset.valorDesatualizado).toBe("true");
    expect(normalizar(cartao.textContent)).toMatch(/desatualizado/i);
  });

  it("sem erro, o cartão segue igual: sem alerta e sem marca", async () => {
    await montarCartao(consulta(SESSAO, null));
    expect(alerta()).toBeNull();
    const cartao = document.querySelector<HTMLElement>(
      'section[aria-label="Caixa"]',
    )!;
    expect(cartao.dataset.valorDesatualizado).toBeUndefined();
    expect(normalizar(cartao.textContent)).not.toMatch(/desatualizado/i);
  });
});

describe("folha de Sangria — esperado de leitura que falhou", () => {
  async function digitarValor(valor: string) {
    const campo = document.getElementById(
      "fin-caixa-mov-valor",
    ) as HTMLInputElement;
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
      await new Promise((r) => setTimeout(r, 200));
    });
  }

  async function montarFolha(esperado: number | null) {
    await act(async () =>
      root.render(
        <MovimentarCaixaFolha
          autorId="autor-1"
          aoReconciliar={vi.fn(async () => {})}
          aoMudarEnviando={vi.fn()}
          sessaoId="sessao-1"
          movimento="sangria"
          esperado={esperado}
          contas={CONTAS}
          contaDoCaixa={CONTA_CAIXA_DA_LOJA}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />,
      ),
    );
  }

  it("controle: com esperado conhecido, sangria maior que ele continua bloqueada", async () => {
    await montarFolha(100);
    await digitarValor("150,00");
    expect(botao("Registrar sangria")!.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/mais do que o esperado/);
  });

  it("esperado desconhecido: avisa, não mostra valor velho e não bloqueia", async () => {
    await montarFolha(null);
    await digitarValor("150,00");
    expect(botao("Registrar sangria")!.disabled).toBe(false);
    const texto = normalizar(document.body.textContent);
    expect(texto).toMatch(/desatualizado/i);
    expect(texto).not.toMatch(/mais do que o esperado/);
    expect(texto).not.toMatch(/R\$\s*100,00/);
  });

  it("esperado desconhecido: o toque em Registrar chega ao servidor (que confere o dinheiro real)", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    await montarFolha(null);
    await digitarValor("150,00");
    await act(async () => botao("Registrar sangria")!.click());
    const chamadas = rpc.mock.calls.filter(
      ([nome]) => nome === "fin_caixa_movimentar_com_chave",
    );
    expect(chamadas).toHaveLength(1);
  });
});
