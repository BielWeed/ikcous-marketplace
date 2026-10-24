// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  ContextoValoresOcultos,
  EstadoDeErro,
  ReciboFinanceiro,
  Segmentado,
} from "@/components/admin/financeiro/partes";
import { CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA } from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  rpc.mockReset().mockImplementation(async (nome: string) => ({
    data:
      nome === "fin_resumo"
        ? { saldo_total: 120, a_pagar: { total: 20 }, a_receber: { total: 40 } }
        : // Sem caixa aberto o servidor devolve nulo (não uma lista).
          nome === "fin_caixa_atual"
          ? null
          : [],
    error: null,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("a barra de abas apresenta os cinco destinos só com texto e mantém a seleção do Financeiro", async () => {
  await act(async () =>
    root.render(<AdminFinanceiroView onNavigate={vi.fn()} />),
  );
  expect(host.querySelector('[aria-label="Seções do Financeiro"]')).toBeNull();
  const menu = host.querySelector(
    '[role="tablist"][aria-label="Abas do Financeiro"]',
  );
  expect(menu).not.toBeNull();
  expect(host.querySelectorAll('[role="tablist"]')).toHaveLength(1);
  const opcoes = [...menu!.querySelectorAll<HTMLElement>('[role="tab"]')];
  // Desenho de 22/10/2026: "Contas e categorias" saiu da fila (vira o chip
  // "Contas" do cabeçalho) e "A pagar e receber" virou "Pagar e receber".
  expect(opcoes.map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual(
    ["Visão", "Caixa", "Extrato", "Pagar e receber", "Resultado"],
  );
  expect(menu!.classList.contains("hidden")).toBe(false);
  for (const opcao of opcoes) {
    expect(opcao.classList.contains("min-h-11")).toBe(true);
    // Só texto: nada de ícone colorido dentro da aba.
    expect(opcao.querySelector("svg")).toBeNull();
    expect(opcao.classList.contains("truncate")).toBe(false);
    // Ativa = traço fino neutro embaixo; nada de dourado nem de fundo.
    expect(opcao.className).toContain("data-[state=active]:border-foreground");
    expect(opcao.className).not.toContain("admin-gold");
  }
  expect(menu!.parentElement!.classList.contains("sticky")).toBe(true);
  expect(menu!.parentElement!.classList.contains("top-0")).toBe(true);
  expect(opcoes[0].getAttribute("aria-selected")).toBe("true");
  await act(async () =>
    opcoes[3].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
  expect(host.textContent).toContain("Todos os vencimentos");
  expect(opcoes[0].getAttribute("aria-selected")).toBe("false");
  expect(opcoes[3].getAttribute("aria-selected")).toBe("true");
  expect(
    host.querySelector('[role="tab"][data-state="active"]')?.textContent,
  ).toBe("Pagar e receber");
  expect(document.querySelector('[aria-label="Escolha a seção"]')).toBeNull();
});

it("revela a aba ativa ao selecionar e leva ao chip Contas pelo atalho do conteúdo", async () => {
  await act(async () =>
    root.render(<AdminFinanceiroView onNavigate={vi.fn()} />),
  );
  const abas = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  const revelarExtrato = vi.fn();
  Object.defineProperty(abas[2], "scrollIntoView", { value: revelarExtrato });
  await act(async () =>
    abas[2].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
  expect(revelarExtrato).toHaveBeenCalledWith({
    block: "nearest",
    inline: "nearest",
  });
  await act(async () =>
    abas[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
  const atalho = [
    ...host.querySelectorAll<HTMLButtonElement>('button:not([role="tab"])'),
  ].find((b) => b.textContent?.trim() === "Contas e categorias");
  expect(atalho).toBeDefined();
  const chip = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Contas",
  )!;
  expect(chip.getAttribute("aria-pressed")).toBe("false");
  await act(async () => atalho!.click());
  // Aberta a visão Contas: o chip fica selecionado e nenhuma aba fica ativa.
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[role="tab"][data-state="active"]')).toBeNull();
  expect(host.textContent).toContain("Cadastros da loja");
  // O chip também fecha a visão e devolve para a Visão.
  await act(async () => chip.click());
  expect(chip.getAttribute("aria-pressed")).toBe("false");
  expect(
    host.querySelector('[role="tab"][data-state="active"]')?.textContent,
  ).toBe("Visão");
});

it.each(["carregando", "erro", "vazio"])(
  "as abas continuam acessíveis com o conteúdo %s",
  async (estado) => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "fin_resumo") {
        if (estado === "carregando") return new Promise(() => {});
        return Promise.resolve({
          data: estado === "vazio" ? { saldo_total: 0, contas: [] } : null,
          error: estado === "erro" ? { message: "Failed to fetch" } : null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    await act(async () =>
      root.render(<AdminFinanceiroView onNavigate={vi.fn()} />),
    );
    if (estado === "erro") {
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
    }
    if (estado === "vazio") {
      expect(host.textContent).toContain("Nenhuma conta ainda");
    }
    const abas = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(abas).toHaveLength(5);
    await act(async () =>
      abas[2].dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(abas[2].getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("Nenhum lançamento no período");
    expect(host.querySelector('[aria-label="Novo lançamento"]')).not.toBeNull();
  },
);

it("Visão apresenta os movimentos do período, depois A pagar antes de A receber", async () => {
  await act(async () =>
    root.render(<AdminFinanceiroView onNavigate={vi.fn()} />),
  );
  const pagar = host.querySelector('[aria-label="A pagar"]');
  const receber = host.querySelector('[aria-label="A receber"]');
  expect(pagar).not.toBeNull();
  expect(receber).not.toBeNull();
  expect(
    pagar!.compareDocumentPosition(receber!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // Desenho de 22/10/2026: Entradas | Saídas vêm logo depois do saldo, antes
  // de A pagar | A receber.
  const movimentos = host.querySelector('[aria-label="Movimentos do período"]');
  expect(movimentos).not.toBeNull();
  expect(
    movimentos!.compareDocumentPosition(pagar!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(host.textContent).toContain("Nenhuma conta ainda");
  expect(host.textContent).toContain("Cadastre onde o dinheiro da loja mora");
});

it("Novo lançamento é um botão redondo de 56px com +, fixo acima da barra de baixo e neutro", async () => {
  await act(async () =>
    root.render(<AdminFinanceiroView onNavigate={vi.fn()} />),
  );
  const novo = host.querySelector<HTMLElement>(
    '[aria-label="Novo lançamento"]',
  )!;
  expect(novo).not.toBeNull();
  // Variante local do Financeiro: não vai para a pílula/prateleira nem fica
  // no rodapé inline das outras telas.
  expect(novo.closest(".admin-acao-inline")).toBeNull();
  expect(novo.closest(".admin-acoes-da-barra")).toBeNull();
  const c = [...novo.classList];
  expect(c).toEqual(
    expect.arrayContaining(["fixed", "right-5", "size-14", "rounded-full"]),
  );
  // Acima da pílula e da área segura: a reserva do painel (`--admin-tab-pb`).
  expect(novo.className).toContain("var(--admin-tab-pb,6.25rem)");
  // Neutro de alto contraste, nunca o dourado.
  expect(c).toEqual(
    expect.arrayContaining(["bg-foreground", "text-background"]),
  );
  expect(novo.className).not.toContain("admin-gold");
  expect(novo.className).not.toContain("F9D65B");
  // O "+" é desenhado; o nome acessível vem do aria-label.
  expect(novo.querySelector("svg")).not.toBeNull();
  // O conteúdo ganha folga para o botão nunca cobrir o último item.
  const raiz = novo.closest("div.bg-admin-bg") as HTMLElement;
  expect(raiz.className).toContain("pb-[calc(var(--admin-tab-pb,6.25rem)");
});

it("a confirmação identifica uma operação e também respeita Ocultar valores", async () => {
  const fechar = vi.fn();
  await act(async () =>
    root.render(
      <ContextoValoresOcultos.Provider value={true}>
        <ReciboFinanceiro
          confirmacao={{
            titulo: "Pagamento registrado.",
            descricao: "Energia elétrica",
            valor: 220,
            sentido: -1,
            linhas: [{ rotulo: "Saiu de", texto: "Banco" }],
          }}
          aoFechar={fechar}
        />
      </ContextoValoresOcultos.Provider>,
    ),
  );
  const recibo = host.querySelector('[role="status"]');
  expect(recibo?.textContent).toContain("Pagamento registrado.");
  expect(recibo?.textContent).toContain("Energia elétrica");
  expect(recibo?.textContent).toContain("Banco");
  expect(recibo?.textContent).toContain("Valor oculto");
  expect(recibo?.textContent).not.toContain("220,00");
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Fechar confirmação"]')
      ?.click(),
  );
  expect(fechar).toHaveBeenCalledOnce();
});

it("transferência permite conferir valor, origem e destino sem enviar", async () => {
  const contas = [
    { id: CONTA_CAIXA_DA_LOJA, nome: "Gaveta", tipo: "caixa" as const },
    { id: CONTA_BANCARIA, nome: "Banco", tipo: "banco" as const },
  ].map((c) => ({
    ...c,
    saldoInicial: 0,
    saldoInicialEm: "2026-10-17",
    ativa: true,
    sistema: true,
    ordem: 0,
    saldo: 0,
  }));
  await act(async () =>
    root.render(
      <NovoLancamentoFolha
        hoje="2026-10-17"
        contas={contas}
        categorias={[]}
        inicial={{
          tipo: "transferencia",
          valor: "500.00",
          descricao: "Depósito",
          contaId: CONTA_CAIXA_DA_LOJA,
          contaDestinoId: CONTA_BANCARIA,
        }}
        aoFechar={vi.fn()}
        aoSalvar={vi.fn()}
        aoMudarSujo={vi.fn()}
      />,
    ),
  );
  const resumo = document.querySelector(
    '[aria-label="Confira antes de salvar"]',
  );
  expect(resumo?.textContent).toContain("Gaveta");
  expect(resumo?.textContent).toContain("Banco");
  expect(resumo?.textContent?.replace(/\s/g, " ")).toContain("R$ 500,00");
  expect(document.body.textContent).toContain("fora do resultado");
  expect(document.getElementById("fin-lanc-categoria")).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it("seleções têm alvos de 44px e a causa do erro continua acessível", async () => {
  const repetir = vi.fn();
  await act(async () =>
    root.render(
      <>
        <Segmentado
          rotulo="Mostrar"
          opcoes={[{ valor: "tudo", rotulo: "Tudo" }]}
          valor="tudo"
          aoMudar={vi.fn()}
        />
        <EstadoDeErro
          mensagem="Confira a conexão e tente de novo."
          aoTentarDeNovo={repetir}
        />
      </>,
    ),
  );
  expect(host.querySelector('[aria-pressed="true"]')?.className).toContain(
    "min-h-11",
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Confira a conexão",
  );
  const tentar = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Tentar de novo"),
  );
  await act(async () => tentar?.click());
  expect(repetir).toHaveBeenCalledOnce();
});

it.each(["fechado", "carregando", "erro"])(
  "Caixa %s mantém Novo lançamento acessível",
  async (estado) => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "fin_caixa_atual") {
        if (estado === "carregando") return new Promise(() => {});
        return Promise.resolve({
          data: null,
          error: estado === "erro" ? { message: "Failed to fetch" } : null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    const novo = vi.fn();
    await act(async () =>
      root.render(
        <AbaCaixa
          ativo
          versao={0}
          abrirFolha={vi.fn()}
          aoNovoLancamento={novo}
          mostrarAcaoFixa
        />,
      ),
    );
    const botao = host.querySelector<HTMLButtonElement>(
      '[aria-label="Novo lançamento"]',
    );
    expect(botao).not.toBeNull();
    await act(async () => botao?.click());
    expect(novo).toHaveBeenCalledOnce();
    expect(
      rpc.mock.calls.some(([nome]) => nome === "fin_lancamento_salvar"),
    ).toBe(false);
  },
);

it("o interruptor ampliado posiciona o indicador no extremo ligado", async () => {
  await act(async () =>
    root.render(
      <ContaFolha
        conta={null}
        hoje="2026-10-17"
        aoFechar={vi.fn()}
        aoSalvar={vi.fn()}
        aoMudarSujo={vi.fn()}
      />,
    ),
  );
  const interruptor = document.querySelector('[role="switch"]');
  expect(interruptor?.getAttribute("aria-checked")).toBe("true");
  expect(interruptor?.className).toContain("h-11");
  expect(interruptor?.className).toContain("w-14");
  expect(interruptor?.className).toContain("[&>span]:size-6");
  expect(interruptor?.className).toContain(
    "[&>span[data-state=checked]]:translate-x-5",
  );
});

it.each([
  [
    "O Financeiro ainda não foi instalado no banco desta loja.",
    "Instalação ausente",
  ],
  [
    "Só o administrador da loja mexe no Financeiro. Entre de novo com a conta de administrador.",
    "Acesso restrito",
  ],
  [
    "O servidor respondeu num formato que esta versão do app não entende. Atualize o app.",
    "Atualização necessária",
  ],
])(
  "erro que exige outra ação conserva a orientação: %s",
  async (mensagem, titulo) => {
    const repetir = vi.fn();
    await act(async () =>
      root.render(
        <EstadoDeErro mensagem={mensagem} aoTentarDeNovo={repetir} />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      mensagem,
    );
    expect(host.querySelector("h3")?.textContent).toBe(titulo);
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Tentar de novo"),
      ),
    ).toBe(false);
    expect(repetir).not.toHaveBeenCalled();
  },
);
