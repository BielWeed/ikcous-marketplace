// @vitest-environment jsdom
//
// Financeiro — aba "Caixa", pela tela inteira: caixa fechado → "Abrir caixa"
// com o dinheiro contado (vai para a conta de sistema Caixa da loja) →
// esperado ao vivo → "Fechar caixa" com a prévia esperado × contado ×
// diferença → resultado do servidor. Também a costura com o roteador: folha
// aberta liga o Voltar do celular (`onSetBackOverride`) e o aviso de
// alterações não salvas (`onSetDirty`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso, servidor } = vi.hoisted(() => ({
  rpcFalso: vi.fn(),
  servidor: { caixa: null as Record<string, unknown> | null },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// O gráfico (recharts) não é assunto deste arquivo.
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA } from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const CONTAS = [
  {
    id: CONTA_CAIXA_DA_LOJA,
    nome: "Caixa da loja",
    tipo: "caixa",
    saldo_inicial: 0,
    saldo_inicial_em: "2026-01-01",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 150,
  },
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    saldo_inicial: 0,
    saldo_inicial_em: "2026-01-01",
    ativa: true,
    ordem: 2,
    sistema: true,
    saldo: 5000,
  },
];

const RESUMO = {
  periodo: { inicio: "2026-09-01", fim: "2026-09-30" },
  saldo_total: 5150,
  contas: [],
  entradas: 0,
  saidas: 0,
  resultado: 0,
  a_receber: null,
  a_pagar: null,
  por_forma: [],
  por_canal: { online: 0, presencial: 0 },
  serie: [],
  caixa_aberto: null,
};

const CAIXA_ABERTO = {
  id: "sessao-1",
  conta_id: CONTA_CAIXA_DA_LOJA,
  conta_nome: "Caixa da loja",
  aberto_em: "2026-09-26T12:00:00Z",
  valor_abertura: 150,
  vendas_dinheiro: 330.5,
  devolucoes_dinheiro: 0,
  entradas_manuais: 0,
  saidas_manuais: 0,
  esperado: 480.5,
  movimentos: [],
};

rpcFalso.mockImplementation(async (nome: string) => {
  switch (nome) {
    case "fin_contas_listar":
      return { data: CONTAS, error: null };
    case "fin_categorias_listar":
      return { data: [], error: null };
    case "fin_resumo":
      return { data: RESUMO, error: null };
    case "fin_caixa_atual":
      return { data: servidor.caixa, error: null };
    case "fin_caixa_historico":
      return { data: [], error: null };
    case "fin_caixa_abrir":
      servidor.caixa = CAIXA_ABERTO;
      return { data: { id: "sessao-1" }, error: null };
    case "fin_caixa_fechar":
      servidor.caixa = null;
      return {
        data: {
          id: "sessao-1",
          esperado: 480.5,
          contado: 470,
          diferenca: -10.5,
        },
        error: null,
      };
    default:
      return { data: null, error: null };
  }
});

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ");

function folha(): HTMLElement | null {
  return document.querySelector('[data-slot="sheet-content"]');
}

function botaoEm(raiz: ParentNode, rotulo: string): HTMLButtonElement {
  const achado = [...raiz.querySelectorAll("button")].find(
    (b) => normalizar(b.textContent).trim() === rotulo,
  );
  if (!achado) throw new Error(`botão "${rotulo}" não existe`);
  return achado as HTMLButtonElement;
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
    el.click();
  });
  await esperar();
}

async function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
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

describe("Financeiro — abrir e fechar o caixa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSetDirty: Mock<(dirty: boolean) => void>;
  let onSetBackOverride: Mock<(fn: (() => void) | null) => void>;

  beforeEach(async () => {
    servidor.caixa = null;
    rpcFalso.mockClear();
    onSetDirty = vi.fn<(dirty: boolean) => void>();
    onSetBackOverride = vi.fn<(fn: (() => void) | null) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          onSetDirty={onSetDirty}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperar();
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === "Caixa",
    ) as HTMLElement;
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("abre com o contado na conta Caixa da loja e fecha mostrando a quebra", async () => {
    expect(normalizar(hospedeiro.textContent)).toContain("Caixa fechado");

    await clicar(botaoEm(hospedeiro, "Abrir caixa"));
    const folhaAbrir = folha();
    expect(folhaAbrir).not.toBeNull();
    // Folha aberta: o Voltar do celular passa a fechar a folha.
    expect(typeof onSetBackOverride.mock.calls.at(-1)?.[0]).toBe("function");

    await digitar("fin-caixa-abertura", "15000");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
    await clicar(botaoEm(folhaAbrir as HTMLElement, "Abrir caixa"));

    expect(rpcFalso).toHaveBeenCalledWith("fin_caixa_abrir", {
      p_valor_abertura: 150,
      p_conta_id: CONTA_CAIXA_DA_LOJA,
    });
    expect(folha()).toBeNull();
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
    expect(onSetBackOverride).toHaveBeenLastCalledWith(null);

    // Depois da escrita a tela busca de novo: agora o caixa está aberto.
    const aberto = normalizar(hospedeiro.textContent);
    expect(aberto).toContain("Caixa aberto");
    expect(aberto).toContain("R$ 480,50");
    expect(aberto).toContain("+R$ 330,50");

    await clicar(botaoEm(hospedeiro, "Fechar caixa"));
    const folhaFechar = folha() as HTMLElement;
    expect(normalizar(folhaFechar.textContent)).toContain("Quebra de caixa");

    await digitar("fin-caixa-contado", "47000");
    const previa = normalizar(folhaFechar.textContent);
    expect(previa).toMatch(/Contado ?R\$ 470,00/);
    expect(previa).toMatch(/Quebra ?−R\$ 10,50/);

    await clicar(botaoEm(folhaFechar, "Fechar caixa"));

    expect(rpcFalso).toHaveBeenCalledWith("fin_caixa_fechar", {
      p_valor_contado: 470,
      p_observacao: null,
    });
    const resultado = normalizar(folha()?.textContent);
    expect(resultado).toContain("Fechamento registrado.");
    expect(resultado).toMatch(/Esperado ?R\$ 480,50/);
    expect(resultado).toMatch(/Quebra ?−R\$ 10,50/);
    // O resultado já não é formulário sujo, e a tela por baixo já sabe que fechou.
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
    expect(normalizar(hospedeiro.textContent)).toContain("Caixa fechado");

    await clicar(botaoEm(folha() as HTMLElement, "Concluir"));
    expect(folha()).toBeNull();
  });

  it("o Voltar do celular fecha a folha, e não a tela", async () => {
    await clicar(botaoEm(hospedeiro, "Abrir caixa"));
    expect(folha()).not.toBeNull();

    // O roteador guarda a função com setState: o argumento é o "updater"
    // que devolve a função de fechar.
    const atualizador = onSetBackOverride.mock.calls.at(
      -1,
    )?.[0] as unknown as () => () => void;
    await act(async () => {
      atualizador()();
    });
    await esperar();

    expect(folha()).toBeNull();
    expect(onSetBackOverride).toHaveBeenLastCalledWith(null);
    expect(normalizar(hospedeiro.textContent)).toContain("Caixa fechado");
  });

  it("abertura sem valor não vai ao banco", async () => {
    await clicar(botaoEm(hospedeiro, "Abrir caixa"));
    await clicar(botaoEm(folha() as HTMLElement, "Abrir caixa"));

    expect(rpcFalso).not.toHaveBeenCalledWith(
      "fin_caixa_abrir",
      expect.anything(),
    );
    expect(normalizar(folha()?.textContent)).toContain(
      "Conte o dinheiro da gaveta e informe o valor",
    );
  });
});
