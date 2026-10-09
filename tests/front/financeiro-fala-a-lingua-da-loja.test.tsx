// @vitest-environment jsdom
//
// Financeiro na língua da loja (painel simples, G2): a aba "DRE" vira
// "Resultado", "Competência" vira "Mês de referência", "Margem de
// contribuição" vira "Sobra depois dos custos da venda" e "Contas e
// categorias" fica no fim com o selo "Avançado" (é configuração).
//
// SÓ TEXTO: o valor da aba continua `dre` (é ele que busca `fin_dre`), o
// campo do formulário continua `dataCompetencia` e o corpo do salvar continua
// com `data_competencia` — este teste trava as duas pontas.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa (ver
// tests/front/admin-financeiro-novo-lancamento.test.tsx).
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

import { AbaContasECategorias } from "@/components/admin/financeiro/AbaContasECategorias";
import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import { CategoriaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import { CancelarLancamentoDialogo } from "@/components/admin/financeiro/FolhasDeLancamento";
import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  cascataDaDre,
  formularioInicialDoLancamento,
  parseDre,
  rotuloDoGrupoDre,
  validarLancamento,
} from "@/lib/financeiro";
import { padroesProibidosDoPainel } from "@/lib/glossario-do-painel";
import {
  CONTA_BANCARIA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const HOJE = "2026-09-26";

const DRE = {
  receita_bruta: 10000,
  receita_online: 6000,
  receita_balcao: 4000,
  deducoes: 500,
  receita_liquida: 9500,
  cmv: 3800,
  cmv_estimado: false,
  lucro_bruto: 5700,
  custos_variaveis: 950,
  margem_contribuicao: 4750,
  despesas_fixas: 2850,
  resultado_operacional: 1900,
  resultado_financeiro: -95,
  lucro_liquido: 1805,
  linhas: [{ grupo: "despesa_fixa", categoria: "Aluguel", valor: 2000 }],
};

const CONTAS: ContaFinanceira[] = [
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 5000,
  },
];

const CATEGORIAS: CategoriaFinanceira[] = [
  {
    id: "cat-aluguel",
    nome: "Aluguel",
    natureza: "despesa",
    grupoDre: "despesa_fixa",
    ativa: true,
    sistema: false,
  },
];

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

/** Termos do glossário que sobraram num texto de tela (vazio = limpo). */
function jargaoEm(texto: string): string[] {
  return padroesProibidosDoPainel().flatMap((padrao) => {
    const achado = texto.match(padrao);
    return achado ? [achado[0]] : [];
  });
}

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Digita num LocalBufferedInput e sai do campo (o blur descarrega o valor). */
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

async function escolher(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function mudarData(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Financeiro fala a língua da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_dre") return { data: DRE, error: null };
      return { data: [], error: null };
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(no: React.ReactNode) {
    await act(async () => {
      raiz.render(no);
    });
    await esperar();
  }

  const abas = () =>
    [...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]')].map((aba) =>
      normalizar(aba.textContent),
    );

  it("a aba se chama Resultado (não DRE) e continua abrindo o fin_dre", async () => {
    await montar(<AdminFinanceiroView onNavigate={vi.fn()} active />);

    expect(abas()).toContain("Resultado");
    expect(abas().some((rotulo) => /\bDRE\b/.test(rotulo))).toBe(false);

    const resultado = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((aba) => normalizar(aba.textContent) === "Resultado");
    rpcFalso.mockClear();
    await act(async () => {
      resultado?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();

    expect(resultado?.getAttribute("aria-selected")).toBe("true");
    expect(rpcFalso).toHaveBeenCalledWith("fin_dre", expect.any(Object));
  });

  it("Contas e categorias é a última aba e leva o selo Avançado", async () => {
    await montar(<AdminFinanceiroView onNavigate={vi.fn()} active />);

    const todas = abas();
    expect(todas.at(-1)).toBe("Contas e categorias Avançado");
    const ultima = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].at(-1);
    const selo = ultima?.querySelector("[data-selo-avancado]");
    expect(normalizar(selo?.textContent)).toBe("Avançado");
    // Só ela é avançada.
    expect(hospedeiro.querySelectorAll("[data-selo-avancado]")).toHaveLength(1);
  });

  it("o Resultado mostra a sobra depois dos custos da venda, sem jargão", async () => {
    await montar(
      <AbaDre
        ativo
        intervalo={{ inicio: "2026-07-01", fim: "2026-09-30" }}
        versao={0}
        rotuloDoPeriodo="Julho a setembro"
      />,
    );

    const texto = normalizar(hospedeiro.textContent);
    expect(texto).toContain("Sobra depois dos custos da venda");
    expect(
      normalizar(
        hospedeiro.querySelector('[data-linha-dre="margem_contribuicao"]')
          ?.textContent,
      ),
    ).toContain("Sobra depois dos custos da venda");
    expect(texto).toContain("pelo mês de referência");
    expect(texto).toContain("ficam fora do resultado");
    expect(
      hospedeiro.querySelector('[aria-label="Visão do resultado"]'),
    ).not.toBeNull();
    expect(jargaoEm(texto)).toEqual([]);
    expect(texto).not.toMatch(/compet[êe]ncia/i);
  });

  it("o lançamento pede o Mês de referência e o salvar segue com data_competencia", async () => {
    rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });
    await montar(
      <NovoLancamentoFolha
        hoje={HOJE}
        contas={CONTAS}
        categorias={CATEGORIAS}
        aoFechar={vi.fn()}
        aoSalvar={vi.fn()}
        aoMudarSujo={vi.fn()}
      />,
    );

    const folha = document.querySelector(
      '[data-slot="sheet-content"]',
    ) as HTMLElement;
    const rotulo = folha.querySelector('label[for="fin-lanc-competencia"]');
    expect(normalizar(rotulo?.textContent)).toBe("Mês de referência");
    const texto = normalizar(folha.textContent);
    expect(texto).toContain("Mês de referência é o mês a que o valor pertence");
    expect(jargaoEm(texto)).toEqual([]);
    expect(texto).not.toMatch(/compet[êe]ncia/i);

    // Mesmo corpo de `admin-financeiro-novo-lancamento` (despesa paga hoje):
    // a palavra mudou na tela, o campo do contrato não.
    await digitar("fin-lanc-valor", "5000");
    await digitar("fin-lanc-descricao", "Aluguel de setembro");
    await escolher("fin-lanc-categoria", "cat-aluguel");
    await mudarData("fin-lanc-competencia", "2026-09-01");
    const salvar = [...folha.querySelectorAll("button")].find(
      (b) => normalizar(b.textContent) === "Salvar lançamento",
    ) as HTMLButtonElement;
    await act(async () => {
      salvar.click();
    });
    await esperar();

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_salvar", {
      p: {
        tipo: "saida",
        valor: 50,
        conta_id: CONTA_BANCARIA,
        categoria_id: "cat-aluguel",
        descricao: "Aluguel de setembro",
        data_competencia: "2026-09-01",
        status: "realizado",
        data_realizacao: HOJE,
      },
    });
  });

  it("categoria e cancelamento falam de resultado, não de DRE", async () => {
    await montar(
      <>
        <AbaContasECategorias
          contas={{
            dados: CONTAS,
            carregando: false,
            erro: null,
            recarregar: vi.fn(),
          }}
          categorias={{
            dados: CATEGORIAS,
            carregando: false,
            erro: null,
            recarregar: vi.fn(),
          }}
          abrirFolha={vi.fn()}
        />
        <CategoriaFolha
          categoria={null}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />
        <CancelarLancamentoDialogo
          alvo={{ id: "l1", descricao: "Aluguel", valor: 2000 }}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />
      </>,
    );

    const texto = normalizar(document.body.textContent);
    expect(texto).toContain("Cada categoria cai numa linha do resultado");
    expect(texto).toContain("Linha do resultado");
    expect(texto).toContain("no saldo e no resultado");
    expect(jargaoEm(texto)).toEqual([]);
  });

  it("a lib dá os rótulos novos e não mexe em chave nem valor", () => {
    const cascata = cascataDaDre(parseDre(DRE));
    const margem = cascata.find((l) => l.chave === "margem_contribuicao");
    expect(margem?.rotulo).toBe("(=) Sobra depois dos custos da venda");
    expect(margem?.valor).toBe(4750);
    expect(cascata.find((l) => l.chave === "cmv")?.rotulo).toBe(
      "(−) Custo das mercadorias vendidas",
    );
    expect(rotuloDoGrupoDre("fora_dre")).toBe("Fora do resultado");
    expect(jargaoEm(cascata.map((l) => l.rotulo).join(" "))).toEqual([]);

    const vazio = validarLancamento(
      { ...formularioInicialDoLancamento(HOJE), dataCompetencia: "" },
      HOJE,
    );
    expect(vazio.ok).toBe(false);
    if (vazio.ok) return;
    expect(vazio.erros.dataCompetencia).toBe("Informe o mês de referência.");
    expect(vazio.erros.categoriaId).toBe(
      "Escolha a categoria (é ela que monta o resultado).",
    );
  });
});
