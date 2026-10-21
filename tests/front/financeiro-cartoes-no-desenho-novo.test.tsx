// @vitest-environment jsdom
//
// Financeiro v8: superfícies escuras, borda discreta, texto legível,
// valores sem corte e ícones com matiz por função. Dourado fica nas ações
// principais e seleções. jsdom confere classes, sem alegar medição de pixels.
//
// SÓ CASCA: o texto visível, as props e o "ocultar valores" não mudam (os
// outros testes do financeiro seguem travando isso). Aqui só se confere a
// classe, porque o jsdom não mede pixel.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
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

import { ArrowDownLeft } from "lucide-react";

import { AbaContasECategorias } from "@/components/admin/financeiro/AbaContasECategorias";
import {
  BlocoKpi,
  EsqueletoDeKpis,
} from "@/components/admin/financeiro/partes";
import {
  CONTA_BANCARIA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const CASCA_DO_CARTAO = [
  "rounded-2xl",
  "border-admin-border",
  "bg-admin-raised",
];

const CASCA_DA_LINHA_BOTAO = [
  "rounded-2xl",
  "border-admin-border",
  "bg-admin-surface",
];

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

function classes(el: Element | null | undefined): string[] {
  return [...(el?.classList ?? [])];
}

/** O rótulo antigo (caixa-alta miúda em cinza 500) não pode sobrar. */
function rotuloNoDesenhoNovo(el: Element | null | undefined, onde: string) {
  const c = classes(el);
  expect(c, onde).toEqual(
    expect.arrayContaining(["text-xs", "font-semibold", "text-zinc-300"]),
  );
  for (const velha of [
    "uppercase",
    "font-black",
    "text-[11px]",
    "text-zinc-500",
    "tracking-[0.2em]",
  ]) {
    expect(c, `${onde}: sobrou ${velha}`).not.toContain(velha);
  }
}

function comACasca(
  el: Element | null | undefined,
  casca: string[],
  onde: string,
) {
  expect(classes(el), onde).toEqual(expect.arrayContaining(casca));
}

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const RESUMO = {
  periodo: { inicio: "2026-09-01", fim: "2026-09-30" },
  saldo_total: 6050,
  contas: [
    { id: "c1", nome: "Conta bancária", tipo: "banco", saldo: 5000 },
    { id: "c2", nome: "Caixa da loja", tipo: "caixa", saldo: 1050 },
  ],
  entradas: 3000,
  saidas: 1200,
  resultado: 1800,
  a_receber: { total: 900, vencido: 100, proximos_7_dias: 300 },
  a_pagar: { total: 700, vencido: 0, proximos_7_dias: 200 },
  por_forma: [],
  por_canal: { online: 0, presencial: 0 },
  serie: [],
  caixa_aberto: null,
};

const EXTRATO = [
  {
    id: "m1",
    origem: "manual",
    tipo: "saida",
    status: "realizado",
    valor: 80,
    data: "2026-09-20",
    conta_id: CONTA_BANCARIA,
    conta_nome: "Conta bancária",
    categoria_nome: "Internet",
    descricao: "Internet de setembro",
    editavel: true,
  },
];

const HISTORICO = [
  {
    id: "s1",
    conta_nome: "Caixa da loja",
    aberto_em: "2026-09-20T12:00:00Z",
    fechado_em: "2026-09-20T22:00:00Z",
    valor_abertura: 150,
    esperado: 480.5,
    contado: 470,
    diferenca: -10.5,
    status: "fechado",
  },
];

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

describe("Financeiro — cartões e linhas-botão no desenho novo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      switch (nome) {
        case "fin_resumo":
          return { data: RESUMO, error: null };
        case "fin_extrato":
          return { data: EXTRATO, error: null };
        case "fin_caixa_historico":
          return { data: HISTORICO, error: null };
        case "fin_caixa_atual":
          return { data: null, error: null };
        default:
          return { data: [], error: null };
      }
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

  async function abrirAba(rotulo: string) {
    const aba = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((a) => normalizar(a.textContent).startsWith(rotulo));
    if (!aba) throw new Error(`aba ${rotulo} não existe`);
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
  }

  const dt = (rotulo: string): HTMLElement => {
    const achado = [...hospedeiro.querySelectorAll<HTMLElement>("dt")].find(
      (el) => normalizar(el.textContent) === rotulo,
    );
    if (!achado) throw new Error(`dt "${rotulo}" não existe`);
    return achado;
  };

  it("BlocoKpi: casca nova, rótulo em frase, valor grande e ícone em selo", async () => {
    await montar(
      <BlocoKpi
        rotulo="Entradas"
        icone={ArrowDownLeft}
        destaque="text-emerald-400"
        detalhe="no período"
      >
        <span>R$ 10,00</span>
      </BlocoKpi>,
    );

    const rotulo = hospedeiro.querySelector("[data-rotulo-do-kpi]");
    const cartao = rotulo?.closest("div.relative") as HTMLElement;
    comACasca(cartao, CASCA_DO_CARTAO, "BlocoKpi");
    expect(classes(cartao)).not.toContain("border-white/[0.04]");

    // O contrato antigo do rótulo segue (travado por financeiro-fala-a-lingua).
    expect(classes(rotulo)).toEqual(
      expect.arrayContaining(["break-words", "min-h-[2.5em]"]),
    );
    expect(classes(rotulo)).not.toContain("truncate");
    expect(classes(rotulo)).not.toContain("line-clamp-2");
    rotuloNoDesenhoNovo(rotulo, "BlocoKpi");

    // O ícone ganha selo e reserva a faixa dele no rótulo.
    const selo = hospedeiro.querySelector("svg")?.parentElement;
    comACasca(
      selo,
      ["size-8", "rounded-xl", "border-admin-border", "bg-white/[0.06]"],
      "selo do ícone",
    );
    expect(classes(rotulo)).toContain("pr-9");

    const valor = [...hospedeiro.querySelectorAll("div")].find(
      (el) => normalizar(el.textContent) === "R$ 10,00",
    );
    expect(classes(valor)).toEqual(
      expect.arrayContaining(["font-black", "tabular-nums", "text-white"]),
    );
    // O valor usa 24px e pode quebrar linha, sem reticências.
    expect(classes(valor)).toEqual(
      expect.arrayContaining(["text-2xl", "break-words", "min-w-0"]),
    );
    expect(classes(valor)).not.toContain("text-lg");
    expect(classes(valor)).not.toContain("text-xl");
    // O cartão tem 16px de respiro e intervalo próprio entre as informações.
    expect(classes(cartao)).toEqual(expect.arrayContaining(["p-4", "gap-3"]));
    expect(classes(cartao)).not.toContain("px-3");

    const detalhe = [...hospedeiro.querySelectorAll("div")].find(
      (el) => normalizar(el.textContent) === "no período",
    );
    expect(classes(detalhe)).toEqual(
      expect.arrayContaining(["text-xs", "font-medium", "text-zinc-400"]),
    );
    expect(classes(detalhe)).not.toContain("text-[11px]");
  });

  it("BlocoKpi sem ícone não reserva a faixa do selo", async () => {
    await montar(
      <BlocoKpi rotulo="Sobra depois dos custos da venda">
        <span>R$ 10,00</span>
      </BlocoKpi>,
    );
    const rotulo = hospedeiro.querySelector("[data-rotulo-do-kpi]");
    expect(classes(rotulo)).not.toContain("pr-9");
    expect(hospedeiro.querySelector("svg")).toBeNull();
  });

  it("o esqueleto dos KPIs tem a mesma altura mínima do cartão", async () => {
    await montar(
      <>
        <BlocoKpi rotulo="Receita líquida">
          <span>R$ 1,00</span>
        </BlocoKpi>
        <EsqueletoDeKpis quantos={2} />
      </>,
    );
    const cartao = hospedeiro
      .querySelector("[data-rotulo-do-kpi]")
      ?.closest("div.relative");
    expect(classes(cartao)).toContain("min-h-[100px]");

    const esqueletos = hospedeiro.querySelectorAll('[aria-busy="true"] > div');
    expect(esqueletos).toHaveLength(2);
    for (const esqueleto of esqueletos) {
      expect(classes(esqueleto)).toContain("min-h-[100px]");
      expect(classes(esqueleto)).not.toContain("h-[92px]");
      expect(classes(esqueleto)).toContain("rounded-2xl");
    }
  });

  it("Visão: forma online desconhecida tem rótulo neutro, separada do PIX", async () => {
    rpcFalso.mockImplementation(async (nome: string) => ({
      data:
        nome === "fin_resumo"
          ? {
              ...RESUMO,
              por_forma: [
                { forma: "online_desconhecido", valor: 80 },
                { forma: "pix", valor: 20 },
              ],
            }
          : [],
      error: null,
    }));
    await montar(<AdminFinanceiroView active={true} onNavigate={vi.fn()} />);
    expect(hospedeiro.textContent).toContain(
      "Pagamento online (forma não identificada)",
    );
    expect(hospedeiro.textContent).toContain("PIX");
    expect(hospedeiro.textContent).not.toContain("online_desconhecido");
  });

  it("Visão: mini-cartões de vencido, próximos 7 dias e saldo por conta", async () => {
    await montar(<AdminFinanceiroView onNavigate={vi.fn()} active />);

    for (const rotulo of ["Vencido", "Próximos 7 dias"]) {
      const r = dt(rotulo);
      expect(classes(r.parentElement?.parentElement), rotulo).toContain(
        "text-xs",
      );
      expect(classes(r.parentElement), rotulo).toContain("flex-wrap");
      const caixa = r.parentElement;
      expect(classes(caixa), rotulo).toContain("items-baseline");
      expect(classes(caixa), rotulo).not.toContain("rounded-xl");
    }
    // Sem vencido (a pagar), o indicador permanece neutro.
    const vencidoDoAPagar = [...hospedeiro.querySelectorAll("dt")].filter(
      (el) => normalizar(el.textContent) === "Vencido",
    )[0];
    comACasca(
      vencidoDoAPagar?.parentElement,
      ["text-zinc-400"],
      "Vencido neutro",
    );
    // Com vencido a cor de estado (vermelho) fica, só a casca muda.
    const vencidoDoAReceber = hospedeiro.querySelector(
      '[aria-label="A receber"] dt',
    );
    expect(classes(vencidoDoAReceber?.parentElement)).toEqual(
      expect.arrayContaining(["text-red-400", "flex-wrap"]),
    );

    const conta = hospedeiro.querySelector(
      'ul[aria-label="Saldo por conta"] li',
    );
    comACasca(conta, CASCA_DO_CARTAO, "saldo por conta");
    const nome = conta?.querySelector("span");
    expect(classes(nome)).toEqual(
      expect.arrayContaining(["text-xs", "font-semibold", "text-zinc-300"]),
    );
    expect(classes(nome)).not.toContain("text-[11px]");
  });

  it("Extrato: Entrou, Saiu e Resultado no cartão novo", async () => {
    await montar(<AdminFinanceiroView onNavigate={vi.fn()} active />);
    await abrirAba("Extrato");

    for (const rotulo of ["Entrou", "Saiu", "Resultado"]) {
      const r = dt(rotulo);
      rotuloNoDesenhoNovo(r, rotulo);
      comACasca(r.parentElement?.parentElement, CASCA_DO_CARTAO, rotulo);
    }
    // Os totais ficam em linhas próprias no mesmo cartão.
    expect(classes(dt("Saiu").parentElement?.parentElement)).toEqual(
      expect.arrayContaining(["flex", "flex-col"]),
    );
    expect(classes(dt("Saiu").parentElement?.parentElement)).not.toContain(
      "grid-cols-3",
    );
    expect(classes(dt("Saiu").parentElement?.parentElement)).toContain("p-4");
    expect(classes(dt("Saiu").nextElementSibling)).toEqual(
      expect.arrayContaining(["text-sm", "font-bold"]),
    );
    // O valor não perde a cor de sinal.
    expect(classes(dt("Entrou").nextElementSibling)).toContain(
      "text-emerald-300",
    );
    expect(classes(dt("Saiu").nextElementSibling)).toContain("text-red-300");
  });

  it("Caixa: a sessão do histórico usa o cartão novo e o rótulo legível", async () => {
    await montar(<AdminFinanceiroView onNavigate={vi.fn()} active />);
    await abrirAba("Caixa");

    const li = [...hospedeiro.querySelectorAll("li")].find((el) =>
      normalizar(el.textContent).includes("Esperado"),
    );
    comACasca(li, CASCA_DO_CARTAO, "sessão do histórico");
    for (const rotulo of ["Esperado", "Contado", "Diferença"]) {
      const r = [...(li?.querySelectorAll("dt") ?? [])].find(
        (el) => normalizar(el.textContent) === rotulo,
      );
      expect(classes(r), rotulo).toEqual(
        expect.arrayContaining(["text-xs", "font-semibold", "text-zinc-300"]),
      );
      expect(classes(r), rotulo).not.toContain("text-zinc-500");
    }
    // A cor de estado da diferença (quebra) fica.
    const diferenca = [...(li?.querySelectorAll("dt") ?? [])].find(
      (el) => normalizar(el.textContent) === "Diferença",
    );
    expect(classes(diferenca?.nextElementSibling)).toContain("text-red-300");
  });

  it("Contas e categorias: cada linha é um botão-linha com selo e seta", async () => {
    await montar(
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
      />,
    );

    const linhas = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>("ul button"),
    ];
    expect(linhas).toHaveLength(2);
    for (const linha of linhas) {
      comACasca(linha, CASCA_DA_LINHA_BOTAO, normalizar(linha.textContent));
      // Alvo de toque de pelo menos 44px (a conta tem 56px, com o selo).
      expect(classes(linha).some((c) => /^min-h-(11|14)$/.test(c))).toBe(true);
      expect(classes(linha)).toContain("hover:bg-admin-raised");
      // "Editar" continua no nome acessível do botão.
      expect(normalizar(linha.textContent)).toContain("Editar");
      const seta = linha.querySelector("svg.lucide-chevron-right");
      expect(seta, normalizar(linha.textContent)).not.toBeNull();
      expect(classes(seta)).toEqual(
        expect.arrayContaining(["size-5", "text-zinc-400"]),
      );
      expect(classes(seta)).toContain("group-hover:text-white");
      expect(classes(linha)).toContain("group");
    }
    // Conta bancária usa o selo azul da função.
    const selo = linhas[0]?.querySelector("span.size-10");
    comACasca(selo, ["rounded-xl", "border"], "selo da conta");
    expect((selo as HTMLElement).style.color).toBe("rgb(122, 162, 255)");
    // O nome segue em branco e negrito.
    const nome = [...(linhas[0]?.querySelectorAll("span") ?? [])].find(
      (el) => normalizar(el.textContent) === "Conta bancária",
    );
    expect(classes(nome)).toEqual(
      expect.arrayContaining(["text-[15px]", "font-bold", "text-white"]),
    );
  });
});
