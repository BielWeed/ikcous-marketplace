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
  servidor: {
    caixa: null as Record<string, unknown> | null,
    contas: null as Record<string, unknown>[] | null,
    falhasMovimento: [] as unknown[],
    falhasFechamento: [] as unknown[],
    falhasLeituraCaixa: [] as unknown[],
    historico: [] as Record<string, unknown>[],
    falhasLeituraHistorico: [] as unknown[],
    statusMovimento: "realizado",
    replay: false,
    autorId: "autor-1" as string | null,
    emVoo: null as Promise<void> | null,
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: servidor.autorId ? { id: servidor.autorId } : null }),
}));
// O gráfico (recharts) não é assunto deste arquivo.
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { toast } from "sonner";

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
      return { data: servidor.contas ?? CONTAS, error: null };
    case "fin_categorias_listar":
      return { data: [], error: null };
    case "fin_resumo":
      return { data: RESUMO, error: null };
    case "fin_caixa_atual":
      return {
        data: servidor.caixa,
        error: servidor.falhasLeituraCaixa.shift() ?? null,
      };
    case "fin_caixa_historico":
      return {
        data: servidor.historico,
        error: servidor.falhasLeituraHistorico.shift() ?? null,
      };
    case "fin_caixa_abrir":
      servidor.caixa = CAIXA_ABERTO;
      return { data: { id: "sessao-1" }, error: null };
    case "fin_caixa_movimentar_com_chave": {
      await servidor.emVoo;
      const error = servidor.falhasMovimento.shift() ?? null;
      return {
        data: error
          ? null
          : {
              id: "movimento-1",
              replay: servidor.replay,
              status: servidor.statusMovimento,
            },
        error,
      };
    }
    case "fin_caixa_fechar_sessao": {
      await servidor.emVoo;
      const error = servidor.falhasFechamento.shift();
      if (error) return { data: null, error };
      servidor.caixa = null;
      return {
        data: {
          id: "sessao-1",
          esperado: 480.5,
          contado: 470,
          diferenca: -10.5,
          replay: servidor.replay,
        },
        error: null,
      };
    }
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

  const guardado = new Map<string, string>();
  let armazenamento: Storage;

  beforeEach(async () => {
    guardado.clear();
    armazenamento = {
      getItem: vi.fn((chave: string) => guardado.get(chave) ?? null),
      setItem: vi.fn((chave: string, valor: string) => {
        guardado.set(chave, valor);
      }),
      removeItem: vi.fn((chave: string) => {
        guardado.delete(chave);
      }),
      key: vi.fn((indice: number) => [...guardado.keys()].at(indice) ?? null),
      get length() {
        return guardado.size;
      },
      clear: vi.fn(() => guardado.clear()),
    };
    vi.stubGlobal("localStorage", armazenamento);
    servidor.caixa = null;
    servidor.contas = null;
    servidor.falhasMovimento = [];
    servidor.falhasFechamento = [];
    servidor.falhasLeituraCaixa = [];
    servidor.historico = [];
    servidor.falhasLeituraHistorico = [];
    servidor.statusMovimento = "realizado";
    servidor.replay = false;
    servidor.autorId = "autor-1";
    servidor.emVoo = null;
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.success).mockClear();
    rpcFalso.mockClear();
    onSetDirty = vi.fn<(dirty: boolean) => void>();
    onSetBackOverride = vi.fn<(fn: (() => void) | null) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await montar();
  });

  async function montar(raizDaAba = raiz, hospedeiroDaAba = hospedeiro) {
    await act(async () => {
      raizDaAba.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          onSetDirty={onSetDirty}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperar();
    const aba = [...hospedeiroDaAba.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === "Caixa",
    ) as HTMLElement;
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
  }

  async function remontar() {
    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();
  }

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("explica o estorno externo em dinheiro sem descontar novamente do esperado", async () => {
    servidor.caixa = {
      ...CAIXA_ABERTO,
      valor_abertura: 100,
      vendas_dinheiro: 200,
      estornos_externos_dinheiro: 200,
      esperado: 100,
    };
    await remontar();
    const composicao = hospedeiro.querySelector("#fin-composicao-do-caixa");
    expect(normalizar(composicao?.textContent)).toContain(
      "Estornos em dinheiro−R$ 200,00",
    );
    expect(normalizar(composicao?.textContent)).toContain("EsperadoR$ 100,00");
  });

  it.each([
    { entra: false, tipo: "entrada", sinal: "−", cor: "text-red-300" },
    { entra: true, tipo: "saida", sinal: "+", cor: "text-emerald-300" },
    { entra: undefined, tipo: "saida", sinal: "−", cor: "text-red-300" },
    { entra: undefined, tipo: "entrada", sinal: "+", cor: "text-emerald-300" },
  ])(
    "movimento respeita entra=$entra e mantém fallback tipo=$tipo",
    async ({ entra, tipo, sinal, cor }) => {
      servidor.caixa = {
        ...CAIXA_ABERTO,
        movimentos: [
          {
            id: "transferencia-1",
            tipo,
            entra,
            origem: "manual",
            descricao: "Transferência entre contas",
            valor: 100,
          },
        ],
      };
      await remontar();
      const movimento = [...hospedeiro.querySelectorAll("li")].find((el) =>
        el.textContent?.includes("Transferência entre contas"),
      );
      expect(normalizar(movimento?.textContent)).toContain(`${sinal}R$ 100,00`);
      expect(movimento?.querySelector(`span.${cor}`)).not.toBeNull();
      expect(
        movimento?.querySelector("svg")?.parentElement?.classList.contains(cor),
      ).toBe(true);
    },
  );

  it.each([true, false])(
    "abre somente a conta de sistema mesmo com caixa personalizado (sistema listado: %s)",
    async (comSistema) => {
      const personalizadas = [
        {
          ...CONTAS[0],
          id: "f1000000-0000-4000-8000-000000000099",
          nome: "Caixa reserva",
          sistema: false,
        },
        ...(comSistema ? CONTAS : []),
      ];
      servidor.contas = personalizadas;
      await remontar();
      await clicar(botaoEm(hospedeiro, "Abrir caixa"));
      const abertura = folha() as HTMLElement;
      expect(abertura.querySelector("#fin-caixa-conta")).toBeNull();
      expect(abertura.textContent).not.toContain("Caixa reserva");
      await digitar("fin-caixa-abertura", "15000");
      await clicar(botaoEm(abertura, "Abrir caixa"));
      expect(rpcFalso).toHaveBeenCalledWith("fin_caixa_abrir", {
        p_valor_abertura: 150,
        p_conta_id: CONTA_CAIXA_DA_LOJA,
      });
    },
  );

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
    const quebra = [...folhaFechar.querySelectorAll("dt")].find(
      (el) => el.textContent === "Quebra",
    );
    expect(quebra?.nextElementSibling?.classList.contains("text-red-400")).toBe(
      true,
    );
    expect(quebra?.parentElement?.className).not.toMatch(/bg-red-|border-red-/);

    await clicar(botaoEm(folhaFechar, "Fechar caixa"));

    expect(rpcFalso).toHaveBeenCalledWith("fin_caixa_fechar_sessao", {
      p_sessao_id: CAIXA_ABERTO.id,
      p_valor_contado: 470,
      p_observacao: undefined,
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

  it("aviso de sangria acima do esperado usa âmbar sem bloco pintado", async () => {
    await abrirSessao();
    await clicar(botaoEm(hospedeiro, "Sangria"));
    await digitar("fin-caixa-mov-valor", "50000");
    const aviso = [...folha()!.querySelectorAll("p")].find((el) =>
      el.textContent?.includes("É mais do que o esperado"),
    )!;
    expect.soft(aviso.classList.contains("text-amber-400")).toBe(true);
    expect.soft(aviso.className).not.toMatch(/bg-orange-|border-orange-/);
  });

  it.each([
    { valor: "49050", rotulo: "Sobra", cor: "text-amber-400" },
    { valor: "48050", rotulo: "Bateu", cor: "text-zinc-400" },
  ])("prévia $rotulo usa $cor", async ({ valor, rotulo, cor }) => {
    await abrirSessao();
    await clicar(botaoEm(hospedeiro, "Fechar caixa"));
    await digitar("fin-caixa-contado", valor);
    const dt = [...folha()!.querySelectorAll("dt")].find(
      (el) => el.textContent === rotulo,
    )!;
    expect(dt.nextElementSibling?.classList.contains(cor)).toBe(true);
  });

  async function abrirSessao() {
    await clicar(botaoEm(hospedeiro, "Abrir caixa"));
    await digitar("fin-caixa-abertura", "15000");
    await clicar(botaoEm(folha() as HTMLElement, "Abrir caixa"));
  }

  async function prepararMovimento(movimento = "Sangria") {
    await abrirSessao();
    await clicar(botaoEm(hospedeiro, movimento));
    await digitar("fin-caixa-mov-valor", "5000");
    await digitar("fin-caixa-mov-descricao", "  Guardar no cofre  ");
    await escolherConta(CONTA_BANCARIA);
  }

  async function escolherConta(id: string) {
    const select = document.getElementById(
      "fin-caixa-mov-conta",
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function movimentos() {
    return rpcFalso.mock.calls
      .filter(([nome]) => nome === "fin_caixa_movimentar_com_chave")
      .map(([, args]) => args);
  }

  function semRpcAntiga() {
    expect(
      rpcFalso.mock.calls.some(
        ([nome]) =>
          nome === "fin_caixa_movimentar" || nome === "fin_caixa_fechar",
      ),
    ).toBe(false);
  }

  it.each(["Sangria", "Suprimento"])(
    "envia sessão exibida e UUID v4 na %s",
    async (movimento) => {
      await prepararMovimento(movimento);
      await clicar(
        botaoEm(folha() as HTMLElement, `Registrar ${movimento.toLowerCase()}`),
      );
      expect(movimentos()).toEqual([
        {
          p_sessao_id: CAIXA_ABERTO.id,
          p_chave: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
          p_tipo: movimento.toLowerCase(),
          p_valor: 50,
          p_descricao: "Guardar no cofre",
          p_conta_contrapartida: CONTA_BANCARIA,
        },
      ]);
      semRpcAntiga();
      expect(folha()).toBeNull();
    },
  );

  it("resposta perdida e retry preservam chave e todos os dados congelados", async () => {
    servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
    await prepararMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()).toHaveLength(1);
    const primeira = { ...movimentos()[0] };
    expect(normalizar(folha()?.textContent)).toContain("Confira a conexão");
    // Sem recarga: o ID pertence ao estado da folha que já estava aberta.
    servidor.replay = true;
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()).toEqual([primeira, primeira]);
    expect(primeira.p_sessao_id).toBe("sessao-1");
    semRpcAntiga();
  });

  it.each(["valor", "descricao", "conta", "editar e voltar"])(
    "edição de %s depois da falha conserva a identidade da intenção",
    async (campo) => {
      servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
      await prepararMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toHaveLength(1);
      const primeira = { ...movimentos()[0] };
      if (campo === "valor") await digitar("fin-caixa-mov-valor", "6000");
      if (campo === "descricao")
        await digitar("fin-caixa-mov-descricao", "Outro destino");
      if (campo === "conta") await escolherConta("");
      if (campo === "editar e voltar") {
        await digitar("fin-caixa-mov-descricao", "Outro destino");
        await digitar("fin-caixa-mov-descricao", "  Guardar no cofre  ");
      }
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toHaveLength(2);
      expect(movimentos()[1].p_chave).toBe(primeira.p_chave);
      expect(movimentos()[1]).toMatchObject({
        p_sessao_id: primeira.p_sessao_id,
        p_tipo: primeira.p_tipo,
        p_valor: campo === "valor" ? 60 : 50,
        p_descricao:
          campo === "descricao" ? "Outro destino" : "Guardar no cofre",
        p_conta_contrapartida: campo === "conta" ? undefined : CONTA_BANCARIA,
      });
    },
  );

  it("divergência reconcilia: avisa, recarrega o original, fecha e apaga a chave sem reenviar", async () => {
    servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
    await prepararMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    const primeira = { ...movimentos()[0] };
    servidor.falhasMovimento.push({
      code: "22023",
      details: "tentativa_divergente",
      message: "conflito técnico",
    });
    servidor.caixa = {
      ...CAIXA_ABERTO,
      movimentos: [
        {
          id: "original-1",
          tipo: "sangria",
          valor: 50,
          descricao: "Original do servidor",
        },
      ],
    };
    const leiturasAntes = rpcFalso.mock.calls.filter(
      ([nome]) => nome === "fin_caixa_atual",
    ).length;
    await digitar("fin-caixa-mov-valor", "6000");
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()).toHaveLength(2);
    expect(movimentos()[1].p_chave).toBe(primeira.p_chave);
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("Confira o histórico antes de tentar de novo"),
    );
    expect(folha()).toBeNull();
    expect(guardado.size).toBe(0);
    expect(
      rpcFalso.mock.calls.filter(([nome]) => nome === "fin_caixa_atual").length,
    ).toBeGreaterThan(leiturasAntes);
    expect(normalizar(hospedeiro.textContent)).toContain(
      "Original do servidor",
    );
    await reabrirMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()[2].p_chave).not.toBe(primeira.p_chave);
    semRpcAntiga();
  });

  it.each([
    { code: "PGRST202", message: "Could not find the function" },
    { code: "42883", message: "function does not exist" },
    {
      message:
        "Could not find the function public.fin_caixa_movimentar_com_chave",
    },
  ])(
    "RPC ausente recusa sem fallback e preserva a tentativa (%j)",
    async (falha) => {
      servidor.falhasMovimento.push(falha);
      await prepararMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toHaveLength(1);
      expect(normalizar(folha()?.textContent)).toContain(
        "O Financeiro ainda não foi instalado no banco desta loja",
      );
      expect(vi.mocked(toast.success)).not.toHaveBeenCalledWith(
        "Sangria registrada.",
      );
      const primeira = { ...movimentos()[0] };
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toEqual([primeira, primeira]);
      semRpcAntiga();
    },
  );

  it("fechamento com RPC ausente preserva a sessão da folha sem usar a antiga", async () => {
    const falha = { code: "PGRST202", message: "Could not find the function" };
    await abrirSessao();
    await clicar(botaoEm(hospedeiro, "Fechar caixa"));
    await digitar("fin-caixa-contado", "47000");
    servidor.falhasFechamento.push(falha);
    await clicar(botaoEm(folha() as HTMLElement, "Fechar caixa"));
    const texto = normalizar(folha()?.textContent);
    expect(texto).toContain("O Financeiro ainda não foi instalado");
    // A sessão é a capturada pela folha; não simulamos recarga neste caso.
    servidor.replay = true;
    await clicar(botaoEm(folha() as HTMLElement, "Fechar caixa"));
    const chamadas = rpcFalso.mock.calls.filter(
      ([nome]) => nome === "fin_caixa_fechar_sessao",
    );
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0][1]).toEqual({
      p_sessao_id: "sessao-1",
      p_valor_contado: 470,
      p_observacao: undefined,
    });
    expect(chamadas[1][1]).toEqual(chamadas[0][1]);
    expect(normalizar(folha()?.textContent)).toContain(
      "Fechamento registrado.",
    );
    semRpcAntiga();
  });

  async function reabrirMovimento(movimento = "Sangria") {
    await clicar(botaoEm(hospedeiro, movimento));
    await digitar("fin-caixa-mov-valor", "5000");
  }

  it.each([false, true])(
    "falha + fechar + reabrir conserva chave (remonta tela: %s)",
    async (remonta) => {
      servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
      await prepararMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      const primeira = { ...movimentos()[0] };
      expect([...guardado.values()]).toEqual([primeira.p_chave]);
      const nome = [...guardado.keys()][0];
      expect(nome).toContain("autor-1");
      expect(nome).toContain("sessao-1");
      expect(nome).toContain("sangria");
      await clicar(botaoEm(folha() as HTMLElement, "Voltar"));
      if (remonta) await remontar();
      await reabrirMovimento();
      await digitar("fin-caixa-mov-valor", "6000");
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toHaveLength(2);
      expect(movimentos()[1].p_chave).toBe(primeira.p_chave);
      expect(movimentos()[1].p_valor).toBe(60);
    },
  );

  it.each([false, true])(
    "confirmação/replay limpa a chave e próxima intenção é nova (replay: %s)",
    async (replay) => {
      servidor.replay = replay;
      await prepararMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      const primeira = { ...movimentos()[0] };
      expect(guardado.size).toBe(0);
      await reabrirMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()[1].p_chave).not.toBe(primeira.p_chave);
    },
  );

  it.each(["Sangria", "Suprimento"])(
    "replay realizado de %s informa que nada novo foi gravado; próxima intenção igual é nova",
    async (movimento) => {
      servidor.replay = true;
      await prepararMovimento(movimento);
      vi.mocked(toast.success).mockClear();
      vi.mocked(toast.info).mockClear();
      const registrar = `Registrar ${movimento.toLowerCase()}`;
      const sucesso =
        movimento === "Sangria"
          ? "Sangria registrada."
          : "Suprimento registrado.";
      const aviso =
        movimento === "Sangria"
          ? "Esta sangria já estava registrada por uma tentativa anterior; nada novo foi gravado. Se esta é outra sangria, registre de novo."
          : "Este suprimento já estava registrado por uma tentativa anterior; nada novo foi gravado. Se este é outro suprimento, registre de novo.";
      const leiturasAntes = rpcFalso.mock.calls.filter(
        ([nome]) => nome === "fin_caixa_atual",
      ).length;
      await clicar(botaoEm(folha() as HTMLElement, registrar));
      expect(toast.info).toHaveBeenCalledWith(aviso);
      expect(toast.success).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain(sucesso);
      expect(document.body.textContent).not.toContain("Saiu de");
      expect(guardado.size).toBe(0);
      expect(folha()).toBeNull();
      expect(
        rpcFalso.mock.calls.filter(([nome]) => nome === "fin_caixa_atual")
          .length,
      ).toBeGreaterThan(leiturasAntes);
      const primeira = { ...movimentos()[0] };

      servidor.replay = false;
      await reabrirMovimento(movimento);
      await digitar("fin-caixa-mov-descricao", "  Guardar no cofre  ");
      await escolherConta(CONTA_BANCARIA);
      await clicar(botaoEm(folha() as HTMLElement, registrar));
      expect(movimentos()).toHaveLength(2);
      expect(movimentos()[1].p_chave).not.toBe(primeira.p_chave);
      expect({ ...movimentos()[1], p_chave: primeira.p_chave }).toEqual(
        primeira,
      );
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(sucesso);
      expect(guardado.size).toBe(0);
    },
  );

  it("duas abas: abrir folha com leitura velha S1 não apaga a chave pendente de S2", async () => {
    // A aba B fica com S1 em memória; o mesmo localStorage atende às duas raízes.
    await abrirSessao();
    servidor.caixa = { ...CAIXA_ABERTO, id: "sessao-2" };
    const hospedeiroA = document.createElement("div");
    document.body.appendChild(hospedeiroA);
    const raizA = createRoot(hospedeiroA);
    try {
      await montar(raizA, hospedeiroA);
      servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
      await clicar(botaoEm(hospedeiroA, "Sangria"));
      await digitar("fin-caixa-mov-valor", "5000");
      await digitar("fin-caixa-mov-descricao", "Guardar no cofre");
      await escolherConta(CONTA_BANCARIA);
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      const primeira = { ...movimentos()[0] };
      expect(primeira.p_sessao_id).toBe("sessao-2");
      const enderecoS2 = [...guardado.keys()].find((nome) =>
        nome.includes("sessao-2"),
      ) as string;
      expect(guardado.get(enderecoS2)).toBe(primeira.p_chave);
      await clicar(botaoEm(folha() as HTMLElement, "Voltar"));
      const leituras = rpcFalso.mock.calls.filter(([nome]) =>
        ["fin_caixa_atual", "fin_caixa_historico"].includes(nome),
      ).length;

      await clicar(botaoEm(hospedeiro, "Sangria"));
      expect(
        rpcFalso.mock.calls.filter(([nome]) =>
          ["fin_caixa_atual", "fin_caixa_historico"].includes(nome),
        ),
      ).toHaveLength(leituras);
      expect(guardado.get(enderecoS2)).toBe(primeira.p_chave);
      await clicar(botaoEm(folha() as HTMLElement, "Voltar"));

      // Reabrir A usa a mesma identidade; não libera uma segunda transferência.
      await clicar(botaoEm(hospedeiroA, "Sangria"));
      await digitar("fin-caixa-mov-valor", "5000");
      await digitar("fin-caixa-mov-descricao", "Guardar no cofre");
      await escolherConta(CONTA_BANCARIA);
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toHaveLength(2);
      expect(movimentos()[1]).toEqual(primeira);
    } finally {
      await act(async () => raizA.unmount());
      hospedeiroA.remove();
    }
  });

  it("não expira identidade pelo relógio", async () => {
    servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
    await prepararMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    const primeira = { ...movimentos()[0] };
    await clicar(botaoEm(folha() as HTMLElement, "Voltar"));
    const futuro = Date.now() + 365 * 86400000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(futuro);
    expect(Date.now()).toBe(futuro);
    expect(new Date().getTime()).toBe(futuro);
    await remontar();
    await reabrirMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()[1].p_chave).toBe(primeira.p_chave);
  });

  it.each(["sessao-2", null])(
    "leitura nova comprova sessão anterior fechada (atual: %s): elimina a chave",
    async (id) => {
      servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
      await prepararMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      const primeira = { ...movimentos()[0] };
      expect(guardado.size).toBe(1);
      servidor.caixa = id ? { ...CAIXA_ABERTO, id } : null;
      servidor.historico = [
        {
          ...CAIXA_ABERTO,
          status: "fechado",
          fechado_em: "2026-09-26T13:00:00Z",
        },
      ];
      await remontar();
      expect(guardado.size).toBe(0);
      if (!id) await abrirSessao();
      await reabrirMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()[1].p_chave).not.toBe(primeira.p_chave);
      expect(movimentos()[1].p_sessao_id).toBe(id ?? "sessao-1");
    },
  );

  it.each(["ausente", "aberta", "sem data", "erro"])(
    "leitura nova sem prova de fechamento (%s) conserva a chave de sessão desconhecida",
    async (caso) => {
      servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
      await prepararMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      const primeira = { ...movimentos()[0] };
      servidor.caixa = { ...CAIXA_ABERTO, id: "sessao-2" };
      if (caso !== "ausente") {
        servidor.historico = [
          {
            ...CAIXA_ABERTO,
            status: caso === "aberta" ? "aberto" : "fechado",
            fechado_em: caso === "sem data" ? null : "2026-09-26T13:00:00Z",
          },
        ];
      }
      if (caso === "erro")
        servidor.falhasLeituraHistorico.push(new TypeError("Failed to fetch"));
      await remontar();
      expect([...guardado.values()]).toEqual([primeira.p_chave]);
    },
  );

  it("outro autor e outro tipo não herdam a chave pendente", async () => {
    servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
    await prepararMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    const primeira = { ...movimentos()[0] };
    await clicar(botaoEm(folha() as HTMLElement, "Voltar"));
    await reabrirMovimento("Suprimento");
    await clicar(botaoEm(folha() as HTMLElement, "Registrar suprimento"));
    expect(movimentos()[1].p_chave).not.toBe(primeira.p_chave);
    servidor.autorId = "autor-2";
    await remontar();
    await reabrirMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()[2].p_chave).not.toBe(primeira.p_chave);
  });

  it.each(["leitura", "escrita", "remoção", "acesso"])(
    "armazenamento bloqueado na %s mantém chave em memória e tela utilizável",
    async (etapa) => {
      if (etapa === "acesso")
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          get: () => {
            throw new Error("blocked");
          },
        });
      if (etapa === "leitura")
        vi.mocked(armazenamento.getItem).mockImplementation(() => {
          throw new Error("blocked");
        });
      if (etapa === "escrita")
        vi.mocked(armazenamento.setItem).mockImplementation(() => {
          throw new Error("quota");
        });
      if (etapa === "remoção")
        vi.mocked(armazenamento.removeItem).mockImplementation(() => {
          throw new Error("blocked");
        });
      servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
      await prepararMovimento();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      await digitar("fin-caixa-mov-valor", "6000");
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toHaveLength(2);
      expect(movimentos()[1].p_chave).toBe(movimentos()[0].p_chave);
      expect(folha()).toBeNull();
    },
  );

  it("sem autor usa memória e não grava UUID no armazenamento", async () => {
    servidor.autorId = null;
    await remontar();
    servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
    await prepararMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    await digitar("fin-caixa-mov-valor", "6000");
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()).toHaveLength(2);
    expect(movimentos()[1].p_chave).toBe(movimentos()[0].p_chave);
    expect(guardado.size).toBe(0);
  });

  it("HTTP local sem randomUUID gera UUID v4 com getRandomValues", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    });
    await prepararMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()).toHaveLength(1);
    expect(movimentos()[0].p_chave).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it.each(["movimento", "fechamento"])(
    "Voltar e fechar ficam bloqueados durante envio do %s",
    async (tipo) => {
      if (tipo === "movimento") await prepararMovimento();
      else {
        await abrirSessao();
        await clicar(botaoEm(hospedeiro, "Fechar caixa"));
        await digitar("fin-caixa-contado", "47000");
      }
      let liberar!: () => void;
      servidor.emVoo = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      const painel = folha() as HTMLElement;
      await clicar(
        botaoEm(
          painel,
          tipo === "movimento" ? "Registrar sangria" : "Fechar caixa",
        ),
      );
      await clicar(botaoEm(painel, "Voltar"));
      expect(folha()).toBe(painel);
      const atualizador = onSetBackOverride.mock.calls.at(
        -1,
      )?.[0] as unknown as () => () => void;
      await act(async () => atualizador()());
      expect(folha()).toBe(painel);
      await clicar(botaoEm(painel, "Close"));
      expect(folha()).toBe(painel);
      await act(async () => liberar());
      await esperar();
      expect(
        tipo === "movimento"
          ? folha() === null
          : normalizar(folha()?.textContent).includes("Fechamento registrado."),
      ).toBe(true);
    },
  );

  it("divergência do fechamento avisa, fecha e recarrega sem reenvio automático", async () => {
    await abrirSessao();
    await clicar(botaoEm(hospedeiro, "Fechar caixa"));
    await digitar("fin-caixa-contado", "47000");
    servidor.falhasFechamento.push({
      code: "22023",
      details: "fechamento_divergente",
      message: "conflito técnico",
    });
    servidor.caixa = null;
    const antes = rpcFalso.mock.calls.filter(
      ([nome]) => nome === "fin_caixa_atual",
    ).length;
    await clicar(botaoEm(folha() as HTMLElement, "Fechar caixa"));
    expect(folha()).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("Confira o histórico antes de tentar de novo"),
    );
    expect(normalizar(hospedeiro.textContent)).toContain("Caixa fechado");
    expect(
      rpcFalso.mock.calls.filter(([nome]) => nome === "fin_caixa_atual").length,
    ).toBeGreaterThan(antes);
    expect(
      rpcFalso.mock.calls.filter(
        ([nome]) => nome === "fin_caixa_fechar_sessao",
      ),
    ).toHaveLength(1);
    semRpcAntiga();
  });

  it("divergência sem recarga confiável não apaga a identidade nem libera outra transferência", async () => {
    servidor.falhasMovimento.push(new TypeError("Failed to fetch"));
    await prepararMovimento();
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    const primeira = { ...movimentos()[0] };
    servidor.falhasMovimento.push({
      code: "22023",
      details: "tentativa_divergente",
      message: "conflito técnico",
    });
    servidor.falhasLeituraCaixa.push(new TypeError("Failed to fetch"));
    await digitar("fin-caixa-mov-valor", "6000");
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()[1].p_chave).toBe(primeira.p_chave);
    expect([...guardado.values()]).toEqual([primeira.p_chave]);
    expect(folha()).not.toBeNull();
    expect(normalizar(folha()?.textContent)).toContain(
      "Confira o histórico antes de tentar de novo",
    );
    expect(movimentos()).toHaveLength(2);
  });

  it("limita a descrição a 140 caracteres", async () => {
    await prepararMovimento();
    expect(
      (document.getElementById("fin-caixa-mov-descricao") as HTMLInputElement)
        .maxLength,
    ).toBe(140);
    await digitar("fin-caixa-mov-descricao", "a".repeat(140));
    await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
    expect(movimentos()[0].p_descricao).toHaveLength(140);
  });

  it.each(["cancelado", "previsto", "desconhecido"])(
    "replay com status %s não anuncia movimento realizado",
    async (status) => {
      servidor.replay = true;
      servidor.statusMovimento = status;
      await prepararMovimento();
      vi.mocked(toast.success).mockClear();
      await clicar(botaoEm(folha() as HTMLElement, "Registrar sangria"));
      expect(movimentos()).toHaveLength(1);
      expect(toast.info).toHaveBeenCalledWith(
        "Operação localizada no histórico. Confira a situação do lançamento antes de tentar de novo.",
      );
      expect(toast.success).not.toHaveBeenCalledWith("Sangria registrada.");
      expect(document.body.textContent).not.toContain("Saiu de");
    },
  );

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
