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

it("Seções apresenta os seis destinos e mantém a seleção do Financeiro", async () => {
  await act(async () =>
    root.render(<AdminFinanceiroView onNavigate={vi.fn()} />),
  );
  const abrir = host.querySelector<HTMLButtonElement>(
    '[aria-label="Seções do Financeiro"]',
  );
  expect(abrir).not.toBeNull();
  await act(async () => abrir?.click());
  const menu = document.querySelector('[aria-label="Escolha a seção"]');
  const opcoes = [...(menu?.querySelectorAll("button") ?? [])];
  expect(opcoes.map((b) => b.dataset.secao)).toEqual([
    "visao",
    "extrato",
    "previstos",
    "caixa",
    "dre",
    "contas",
  ]);
  await act(async () => opcoes[2].click());
  expect(host.textContent).toContain("Todos os vencimentos");
  expect(
    host.querySelector('[role="tab"][data-state="active"]')?.textContent,
  ).toBe("A pagar e receber");
});

it("Visão apresenta A pagar antes de A receber e antes dos movimentos do período", async () => {
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
  const movimentos = host.querySelector('[aria-label="Movimentos do período"]');
  expect(movimentos).not.toBeNull();
  expect(
    receber!.compareDocumentPosition(movimentos!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(host.textContent).toContain("Nenhuma conta ainda");
  expect(host.textContent).toContain("Cadastre onde o dinheiro da loja mora");
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
