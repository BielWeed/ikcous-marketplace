// @vitest-environment jsdom
//
// Financeiro — a aba Impostos registrada no FIM da fila (Gestão Fiscal, Tarefa 23).
// O que prova:
//   1  a fila é Visão, Caixa, Extrato, Pagar e receber, Resultado, Impostos (Impostos
//      por último; nenhuma outra aba mudou de lugar nem de nome)
//   2  `abaInicial="impostos"` abre nela, com o texto do topo "Seu regime e suas guias"
//      (e sem o seletor de período, que ela não usa); valor desconhecido (inclusive
//      "IMPOSTOS" e "impostos ") continua abrindo na Visão
//   3  a aba pesada vem fora do pacote inicial (`React.lazy`): com ela fechada o módulo
//      NÃO é baixado, nenhuma tabela fiscal é lida e nenhuma função do banco é chamada
//      por ela; ao abrir, ela recebe `ativo`, `hoje`, `versao`, `abrirFolha` e o atalho
//      para Minha loja; ao sair dela, `ativo` deixa de valer
//   4  tela inativa (guardada em memória) abrindo em Impostos: `ativo` chega falso
//   5  o atalho "Preencher em Minha loja" leva a `admin-about-store`
//
// O módulo da aba é embrulhado, não trocado: o componente de verdade roda, e o embrulho
// só anota quando foi baixado e com que props. Supabase falso, fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso, tabelasLidas, dadosDoBanco, modulo, propsRecebidas } =
  vi.hoisted(() => ({
    rpcFalso: vi.fn(),
    tabelasLidas: [] as string[],
    dadosDoBanco: new Map<string, unknown[]>(),
    modulo: { baixado: 0 },
    propsRecebidas: [] as Array<Record<string, unknown>>,
  }));

vi.mock("@/lib/supabase", () => {
  const construtor = (tabela: string) => {
    let uma = false;
    const c: Record<string, unknown> = Object.fromEntries(
      ["select", "eq", "neq", "gte", "lte", "order", "limit"].map((metodo) => [
        metodo,
        () => c,
      ]),
    );
    c.maybeSingle = () => {
      uma = true;
      return c;
    };
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
    c.then = (
      resolver: (v: unknown) => unknown,
      rejeitar?: (e: unknown) => unknown,
    ) => {
      const linhas = dadosDoBanco.get(tabela) ?? [];
      return Promise.resolve({
        data: uma ? (linhas[0] ?? null) : linhas,
        error: null,
      }).then(resolver, rejeitar);
    };
    return c;
  };
  return {
    supabase: {
      rpc: rpcFalso,
      from: (tabela: string) => {
        tabelasLidas.push(tabela);
        return construtor(tabela);
      },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => ({
    souODono: false,
    carregando: false,
    donoId: null,
    leituraFalhou: false,
  }),
  limparDonoDaLoja: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeLegalDocument: null } }),
}));
vi.mock(
  "@/components/admin/financeiro/impostos/AbaImpostos",
  async (importarOriginal) => {
    const original =
      await importarOriginal<
        typeof import("@/components/admin/financeiro/impostos/AbaImpostos")
      >();
    modulo.baixado += 1;
    return {
      ...original,
      AbaImpostos: (props: Parameters<typeof original.AbaImpostos>[0]) => {
        propsRecebidas.push({ ...props });
        return <original.AbaImpostos {...props} />;
      },
    };
  },
);

import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

const RESUMO = {
  periodo: { inicio: "2026-11-01", fim: "2026-11-30" },
  saldo_total: 0,
  contas: [],
  entradas: 0,
  saidas: 0,
  resultado: 0,
  a_receber: { total: 0, vencido: 0, proximos_7_dias: 0 },
  a_pagar: { total: 0, vencido: 0, proximos_7_dias: 0 },
  por_forma: [],
  por_canal: { online: 0, presencial: 0 },
  serie: [],
  caixa_aberto: null,
};

async function esperar() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }
}

describe("Financeiro — aba Impostos no fim da fila", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    tabelasLidas.length = 0;
    propsRecebidas.length = 0;
    dadosDoBanco.clear();
    onNavigate.mockReset();
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_resumo") return { data: RESUMO, error: null };
      if (nome === "fin_caixa_atual")
        return { data: { sessao: null }, error: null };
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
    localStorage.clear();
  });

  // O módulo da aba é baixado sob demanda (`import()` de verdade): a primeira vez leva
  // bem mais que um ciclo de microtarefas, então se espera pela CONDIÇÃO, com teto.
  async function esperarAte(condicao: () => boolean, teto = 20_000) {
    const limite = Date.now() + teto;
    while (!condicao() && Date.now() < limite) {
      await act(async () => {
        await new Promise((resolver) => setTimeout(resolver, 25));
      });
    }
  }

  async function montar(abaInicial?: string | null, ativa = true) {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={onNavigate}
          active={ativa}
          abaInicial={abaInicial}
        />,
      );
    });
    await esperar();
    if (abaInicial === "impostos") {
      await esperarAte(() => propsRecebidas.length > 0);
      await esperar();
    }
  }

  const abas = () => [
    ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
  ];
  const abaAtiva = () =>
    normalizar(
      hospedeiro.querySelector('[role="tab"][data-state="active"]')
        ?.textContent,
    );
  const secao = (rotulo: string) =>
    hospedeiro.querySelector<HTMLElement>(`section[aria-label="${rotulo}"]`);

  async function abrirAba(rotulo: string) {
    const aba = abas().find((a) => normalizar(a.textContent) === rotulo);
    if (!aba) throw new Error(`aba não achada: ${rotulo}`);
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
  }

  // ESTE TESTE TEM DE SER O PRIMEIRO DO ARQUIVO: o registro de módulos do Vitest vale
  // para o arquivo inteiro, então só antes de qualquer abertura da aba dá para provar
  // que o módulo ainda NÃO foi baixado (com `import` estático ele já teria sido).
  it("com a aba fechada o módulo não é baixado nem lê nada; ao abrir, baixa, recebe as props e lê o cadastro", async () => {
    expect(modulo.baixado).toBe(0);
    await montar();
    expect(modulo.baixado).toBe(0);
    expect(propsRecebidas).toHaveLength(0);
    expect(tabelasLidas.filter((t) => t.startsWith("fiscal_"))).toEqual([]);
    expect(tabelasLidas).not.toContain("fin_lancamentos");
    // a Visão lê o que é dela; a receita mês a mês e o extrato do arquivo, não
    const nomes = rpcFalso.mock.calls.map(([nome]) => String(nome));
    expect(nomes).not.toContain("fin_dre");
    expect(nomes).not.toContain("fin_extrato");

    await abrirAba("Impostos");
    await esperarAte(() => propsRecebidas.length > 0);
    await esperar();
    expect(modulo.baixado).toBe(1);
    expect(abaAtiva()).toBe("Impostos");
    const props = propsRecebidas.at(-1);
    expect(props?.ativo).toBe(true);
    expect(props?.versao).toBe(0);
    expect(props?.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof props?.abrirFolha).toBe("function");
    expect(typeof props?.aoIrParaMinhaLoja).toBe("function");
    expect(tabelasLidas).toContain("fiscal_cadastro");
    expect(tabelasLidas).toContain("fin_lancamentos");
  });

  it("a fila é Visão, Caixa, Extrato, Pagar e receber, Resultado, Impostos", async () => {
    await montar();
    expect(abas().map((a) => normalizar(a.textContent))).toEqual([
      "Visão",
      "Caixa",
      "Extrato",
      "Pagar e receber",
      "Resultado",
      "Impostos",
    ]);
    expect(abaAtiva()).toBe("Visão");
  });

  it("abaInicial=impostos abre em Impostos, com o texto do topo e sem o seletor de período", async () => {
    await montar("impostos");
    expect(abaAtiva()).toBe("Impostos");
    expect(normalizar(hospedeiro.textContent)).toContain(
      "Seu regime e suas guias",
    );
    expect(normalizar(hospedeiro.textContent)).not.toContain(
      "Cadastros da loja",
    );
    // a aba montada de verdade (carregada sob demanda)
    expect(secao("Arquivo para o contador")).not.toBeNull();
    expect(secao("Caderno das guias")).not.toBeNull();
  });

  it.each([
    undefined,
    null,
    "",
    "contas",
    "IMPOSTOS",
    "impostos ",
    "imposto",
    "lixo",
    "../impostos",
  ])("abaInicial=%j é ignorado e abre na Visão", async (valor) => {
    await montar(valor);
    expect(abaAtiva()).toBe("Visão");
    expect(propsRecebidas).toHaveLength(0);
  });

  describe("a aba pesada fica fora do pacote inicial", () => {
    it("voltar para outra aba: a aba some e deixa de ler (nada fica vivo por baixo)", async () => {
      await montar("impostos");
      expect(secao("Caderno das guias")).not.toBeNull();
      await abrirAba("Visão");
      expect(abaAtiva()).toBe("Visão");
      expect(secao("Caderno das guias")).toBeNull();
      const leiturasAntes = tabelasLidas.length;
      await esperar();
      expect(tabelasLidas).toHaveLength(leiturasAntes);
    });

    it("tela inativa (guardada em memória) abrindo em Impostos: a aba chega com ativo falso", async () => {
      await montar("impostos", false);
      const props = propsRecebidas.at(-1);
      expect(props?.ativo).toBe(false);
      expect(tabelasLidas.filter((t) => t.startsWith("fiscal_"))).toEqual([]);
      expect(tabelasLidas).not.toContain("fin_lancamentos");
    });
  });

  it("'Preencher em Minha loja' leva a admin-about-store", async () => {
    dadosDoBanco.set("fiscal_cadastro", [
      {
        id: true,
        regime: "mei",
        atividade: "comercio",
        aberta_em: null,
        vende_no_app_desde: null,
        atualizado_em: null,
        atualizado_por: null,
      },
    ]);
    await montar("impostos");
    const botao = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => normalizar(b.textContent) === "Preencher em Minha loja");
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });
});
