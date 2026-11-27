// @vitest-environment jsdom
//
// Decisão de produto (sócio, 27/11/2026): no balcão, com a forma "Dinheiro" e o
// caixa FECHADO, aparece um aviso que NÃO bloqueia a venda — "Caixa fechado:
// abra o caixa antes de finalizar para esta venda entrar no relatório de hoje."
// — com um botão "Abrir caixa" que leva à aba Caixa do Financeiro.
//
// Regras cobertas aqui:
// - só em loja que JÁ abriu caixa alguma vez (a que nunca usa não vê nada);
// - a consulta é feita NO MOMENTO da escolha de Dinheiro (outro aparelho pode
//   ter aberto o caixa depois de a tela carregar);
// - consulta que falha = nenhum aviso (errar para o lado calado);
// - Pix e cartão não consultam nem avisam.
//
// Três camadas: a consulta (`consultarSituacaoDoCaixa`, RPCs dubladas), a seção
// `FechamentoDaVenda` (consulta injetada) e a view real (a fiação até o
// `onNavigate`). Montado como `admin-pdv-troco-no-dinheiro.test.tsx`.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

// `useOnlineStatus` devolve `true` quando está OFFLINE (armadilha de nome).
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import type { FormaDePagamentoDoBalcao } from "@/hooks/useVendaPresencial";
import {
  estadoInicialDaVenda,
  serializarRascunho,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";
import { consultarSituacaoDoCaixa } from "@/lib/situacao-do-caixa";
import type { SituacaoDoCaixa } from "@/types/financeiro";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

const AVISO =
  "Caixa fechado: abra o caixa antes de finalizar para esta venda entrar no relatório de hoje.";

const ITEM = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta",
  variacao: null,
  preco: 29.95,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

const SESSAO_FECHADA = {
  id: "sessao-1",
  conta_nome: "Caixa da loja",
  aberto_em: "2026-11-26T12:00:00.000Z",
  fechado_em: "2026-11-26T21:00:00.000Z",
  valor_abertura: 100,
  esperado: 100,
  contado: 100,
  diferenca: 0,
  status: "fechado",
};

const CAIXA_ABERTO = {
  id: "sessao-2",
  conta_id: "conta-caixa",
  conta_nome: "Caixa da loja",
  aberto_em: "2026-11-27T12:00:00.000Z",
  valor_abertura: 100,
  vendas_dinheiro: 0,
  devolucoes_dinheiro: 0,
  estornos_externos_dinheiro: 0,
  entradas_manuais: 0,
  saidas_manuais: 0,
  esperado: 100,
  movimentos: [],
};

/** A RPC dublada responde como o banco: `fin_caixa_atual` é a sessão aberta
 * (ou null) e `fin_caixa_historico` a lista das sessões, a mais nova antes. */
function responderComo(situacao: SituacaoDoCaixa): void {
  rpcMock.mockImplementation(async (nome: string) => {
    if (nome === "fin_caixa_atual") {
      return {
        data: situacao === "aberto" ? CAIXA_ABERTO : null,
        error: null,
      };
    }
    if (nome === "fin_caixa_historico") {
      return {
        data: situacao === "nunca_aberto" ? [] : [SESSAO_FECHADA],
        error: null,
      };
    }
    throw new Error(`RPC inesperada: ${nome}`);
  });
}

function botaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function criarArmazenamentoEmMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  rpcMock.mockReset();
  invokeMock.mockReset();
  fromMock.mockReset();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function aviso(): HTMLElement | null {
  return (
    [...hospedeiro.querySelectorAll<HTMLElement>('[role="status"]')].find(
      (el) => el.textContent?.includes(AVISO),
    ) ?? null
  );
}

describe("consultarSituacaoDoCaixa — a mesma leitura do Financeiro", () => {
  it("caixa com sessão aberta → aberto", async () => {
    responderComo("aberto");
    await expect(consultarSituacaoDoCaixa()).resolves.toBe("aberto");
  });

  it("sem sessão aberta e com sessão antiga → fechado", async () => {
    responderComo("fechado");
    await expect(consultarSituacaoDoCaixa()).resolves.toBe("fechado");
  });

  it("sem sessão nenhuma, nunca → nunca_aberto", async () => {
    responderComo("nunca_aberto");
    await expect(consultarSituacaoDoCaixa()).resolves.toBe("nunca_aberto");
  });

  it("erro do banco rejeita (quem chama decide ficar calado)", async () => {
    rpcMock.mockImplementation(async () => ({
      data: null,
      error: { message: "Acesso negado.", code: "42501" },
    }));
    await expect(consultarSituacaoDoCaixa()).rejects.toBeTruthy();
  });
});

const despacharRef: {
  atual: ReturnType<typeof useVendaPresencial>["despachar"] | null;
} = { atual: null };

function Hospedeiro({
  consultarCaixa,
  aoAbrirCaixa,
}: {
  consultarCaixa: () => Promise<SituacaoDoCaixa>;
  aoAbrirCaixa: () => void;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento: criarArmazenamentoEmMemoria(),
  });
  useEffect(() => {
    despacharRef.atual = despachar;
  }, [despachar]);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={vi.fn().mockResolvedValue(undefined)}
      limparCupom={limparCupom}
      consultarCaixa={consultarCaixa}
      aoAbrirCaixa={aoAbrirCaixa}
    />
  );
}

describe("FechamentoDaVenda — aviso de caixa fechado no Dinheiro", () => {
  async function montar(
    consultarCaixa: () => Promise<SituacaoDoCaixa>,
    aoAbrirCaixa: () => void = vi.fn(),
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <Hospedeiro
          consultarCaixa={consultarCaixa}
          aoAbrirCaixa={aoAbrirCaixa}
        />,
      );
    });
    await act(async () => {
      despacharRef.atual?.({
        tipo: "item_adicionado_manualmente",
        item: ITEM,
        em: Date.now(),
      });
    });
    await avancar();
  }

  async function escolher(forma: FormaDePagamentoDoBalcao): Promise<void> {
    await act(async () => {
      despacharRef.atual?.({ tipo: "pagamento_escolhido", pagamento: forma });
    });
    await avancar();
  }

  it("caixa fechado + Dinheiro → aviso visível, falado uma vez e com botão Abrir caixa que funciona", async () => {
    const aoAbrirCaixa = vi.fn();
    await montar(vi.fn().mockResolvedValue("fechado"), aoAbrirCaixa);
    await escolher("cash");

    const el = aviso();
    expect(el, "o aviso de caixa fechado não apareceu").not.toBeNull();
    const botao = botaoPorTexto(el!, "Abrir caixa");
    expect(botao, "o botão Abrir caixa não está no aviso").toBeDefined();
    expect(botao!.tagName).toBe("BUTTON");
    expect(botao!.tabIndex).not.toBe(-1);
    await act(async () => {
      botao!.click();
    });
    expect(aoAbrirCaixa).toHaveBeenCalledTimes(1);

    // Não bloqueia: Registrar venda continua habilitado.
    expect(botaoPorTexto(hospedeiro, "Registrar venda")!.disabled).toBe(false);
  });

  it("caixa aberto + Dinheiro → nenhum aviso", async () => {
    await montar(vi.fn().mockResolvedValue("aberto"));
    await escolher("cash");
    expect(aviso()).toBeNull();
  });

  it("loja que nunca abriu caixa + Dinheiro → nenhum aviso", async () => {
    await montar(vi.fn().mockResolvedValue("nunca_aberto"));
    await escolher("cash");
    expect(aviso()).toBeNull();
  });

  it("Pix e cartão → nenhum aviso e nenhuma consulta", async () => {
    const consultar = vi.fn().mockResolvedValue("fechado");
    await montar(consultar);
    await escolher("pix");
    expect(aviso()).toBeNull();
    await escolher("card");
    expect(aviso()).toBeNull();
    expect(consultar).not.toHaveBeenCalled();
  });

  it("consulta falhando (sem internet) → nenhum aviso", async () => {
    await montar(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await escolher("cash");
    expect(aviso()).toBeNull();
  });

  it("caixa aberto noutro aparelho entre o carregamento e a escolha → nenhum aviso", async () => {
    // Na hora em que a tela carregou o caixa estava fechado; quando ela toca em
    // Dinheiro, outro aparelho já o abriu. Só a consulta NA ESCOLHA sabe disso.
    let situacao: SituacaoDoCaixa = "fechado";
    const consultar = vi.fn(async () => situacao);
    await montar(consultar);
    situacao = "aberto";
    await escolher("cash");
    expect(aviso()).toBeNull();
    expect(consultar).toHaveBeenCalled();
  });

  it("trocar para Pix e voltar a Dinheiro consulta de novo (o aviso some quando o caixa abriu)", async () => {
    let situacao: SituacaoDoCaixa = "fechado";
    const consultar = vi.fn(async () => situacao);
    await montar(consultar);
    await escolher("cash");
    expect(aviso()).not.toBeNull();
    await escolher("pix");
    expect(aviso()).toBeNull();
    situacao = "aberto";
    await escolher("cash");
    expect(aviso()).toBeNull();
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it("resposta atrasada de uma escolha antiga não acende o aviso, nem depois de voltar a Dinheiro com a consulta falhando", async () => {
    let soltar: (s: SituacaoDoCaixa) => void = () => {};
    const consultar = vi
      .fn<() => Promise<SituacaoDoCaixa>>()
      .mockImplementationOnce(
        () =>
          new Promise<SituacaoDoCaixa>((resolver) => {
            soltar = resolver;
          }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await montar(consultar);
    await escolher("cash");
    await escolher("pix");
    // A 1ª consulta (de quando era Dinheiro) só responde agora: "fechado".
    await act(async () => {
      soltar("fechado");
    });
    await avancar();
    expect(aviso()).toBeNull();
    // De volta a Dinheiro, a consulta nova falha: a resposta velha não vale.
    await escolher("cash");
    expect(aviso()).toBeNull();
    expect(consultar).toHaveBeenCalledTimes(2);
  });
});

describe("AdminPdvView — a fiação do aviso até o Financeiro", () => {
  async function montarNoFechamentoEmDinheiro(
    onNavigate: (view: string, id?: string) => void,
  ): Promise<void> {
    localStorage.setItem(
      "admin_pdv_venda_draft:lojista-1",
      serializarRascunho({
        ...estadoInicialDaVenda(() => "chave-da-venda-teste"),
        etapa: "fechamento",
        itens: [ITEM],
        pagamento: "cash",
      }),
    );
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={onNavigate} />);
    });
    await avancar();
  }

  it("caixa fechado: a view consulta o banco e o botão leva à aba Caixa do Financeiro", async () => {
    responderComo("fechado");
    const onNavigate = vi.fn();
    await montarNoFechamentoEmDinheiro(onNavigate);

    const el = aviso();
    expect(el, "a view não ligou a consulta do caixa").not.toBeNull();
    await act(async () => {
      botaoPorTexto(el!, "Abrir caixa")!.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-financeiro", "caixa");
  });

  it("banco recusando a leitura (sem permissão): nada aparece", async () => {
    rpcMock.mockImplementation(async () => ({
      data: null,
      error: { message: "Acesso negado.", code: "42501" },
    }));
    await montarNoFechamentoEmDinheiro(vi.fn());
    expect(aviso()).toBeNull();
  });
});
