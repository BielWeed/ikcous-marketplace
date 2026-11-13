// @vitest-environment jsdom
//
// Balcão — a dúvida "esta venda pode já ter sido registrada" sobrevive a uma
// SEGUNDA falha. A tela real (AdminPdvView) com a máquina de estados real.
//
// O cenário que custava caro: venda de 2 peças gravada no banco, resposta
// perdida (a tela diz certo: "Não sabemos se a venda foi registrada"); a
// lojista tenta de novo (mesma chave) e o banco responde algo passageiro
// (53300, conexões esgotadas). Antes a tela passava a afirmar "a venda não foi
// registrada… o estoque não foi descontado", o F5 apagava a dúvida e o Cancelar
// dizia "Nada é registrado": refazer com chave nova duplicava a venda.
//
// Molde de montagem: balcao-cancelar-venda-limpa-o-cupom.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, codigoBipadoRef, tentativasRef } = vi.hoisted(
  () => ({
    rpcMock: vi.fn(),
    invokeMock: vi.fn(),
    codigoBipadoRef: { atual: "" },
    // Uma resposta por clique em "Registrar venda", na ordem.
    tentativasRef: {
      fila: [] as Array<() => Promise<{ data: unknown; error: unknown }>>,
      chaves: [] as string[],
    },
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock } },
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

vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({ codigo: codigoBipadoRef.atual, formato: "ean_13" })
        }
      >
        bipar
      </button>
    ) : null,
}));

import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import {
  type EstadoDaVenda,
  estadoInicialDaVenda,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft:lojista-1";

const CANECA = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-1",
    nome: "Caneca Azul",
    ativo: true,
    preco_venda: 50,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 50,
  estoque: 10,
  variacoes: [],
};

const TITULO_DA_DUVIDA = "Não sabemos se a venda foi registrada";
const TITULO_DA_RECUSA = "Não foi possível registrar a venda";

const perdeuARede = () => Promise.reject(new TypeError("Failed to fetch"));
const conexoesEsgotadas = () =>
  Promise.resolve({
    data: null,
    error: { code: "53300", message: "too many connections for role" },
  });
const semEstoque = () =>
  Promise.resolve({
    data: null,
    error: {
      code: "22023",
      message: "Estoque insuficiente para o produto Caneca Azul",
    },
  });
const sessaoNegada = () =>
  Promise.resolve({
    data: null,
    error: { code: "42501", message: "Acesso negado: só a loja registra." },
  });
const vendaJaExistia = () =>
  Promise.resolve({
    data: {
      ja_existia: true,
      order: {
        id: "11111111-1111-1111-1111-111111111111",
        created_at: "2026-11-13T12:00:00.000Z",
        total: 100,
        subtotal: 100,
        discount: 0,
        payment_method: "cash",
        user_id: null,
        customer_name: "Venda no balcão",
        customer_data: {},
      },
      items: [
        {
          product_id: "produto-1",
          variant_id: null,
          quantity: 1,
          price: 50,
          product_name: "Caneca Azul",
        },
      ],
    },
    error: null,
  });

function botao(
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

describe("Balcão — a dúvida da venda sobrevive à 2ª falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.useFakeTimers();
    tentativasRef.fila = [];
    tentativasRef.chaves = [];
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras") {
        return { data: CANECA, error: null };
      }
      if (nome === "registrar_venda_presencial") {
        tentativasRef.chaves.push(params.p_idempotency_key);
        const proxima = tentativasRef.fila.shift();
        if (!proxima) throw new Error("tentativa sem resposta combinada");
        return proxima();
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    codigoBipadoRef.atual = CANECA.codigo;

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function clicar(texto: string): Promise<void> {
    const alvo = botao(hospedeiro, texto);
    expect(alvo, `botão "${texto}" ausente`).toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  }

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
  }

  /** F5 / fechar e abrir o app: a tela é desmontada e montada de novo. */
  async function recarregar(): Promise<void> {
    await avancar(400);
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await montar();
  }

  /** Bipa a caneca, vai ao fechamento, escolhe Dinheiro e registra com a 1ª
   * resposta combinada. */
  async function registrarComAPrimeiraResposta(): Promise<void> {
    await montar();
    await clicar("bipar");
    await clicar("Fechar venda");
    await clicar("Dinheiro");
    await clicar("Registrar venda");
  }

  const registrarDeNovo = () => clicar("Registrar venda");

  it("resposta perdida e depois 53300: a tela NÃO passa a afirmar que a venda não foi registrada", async () => {
    tentativasRef.fila = [perdeuARede, conexoesEsgotadas];
    await registrarComAPrimeiraResposta();
    expect(hospedeiro.textContent).toContain(TITULO_DA_DUVIDA);

    await registrarDeNovo();

    expect(tentativasRef.chaves).toHaveLength(2);
    expect(tentativasRef.chaves[1]).toBe(tentativasRef.chaves[0]);
    expect(hospedeiro.textContent).toContain(TITULO_DA_DUVIDA);
    expect(hospedeiro.textContent).not.toContain(TITULO_DA_RECUSA);
    expect(hospedeiro.textContent).not.toContain("a venda não foi registrada");
    expect(hospedeiro.textContent).not.toContain(
      "o estoque não foi descontado",
    );
    expect(hospedeiro.textContent).toContain(
      "recibo aparece ao tentar de novo",
    );
    // e a lojista pode tentar de novo (a chave é a mesma)
    expect(botao(hospedeiro, "Registrar venda")!.disabled).toBe(false);
  });

  it("depois do F5 a dúvida continua: o Cancelar não jura 'nada registrado'", async () => {
    tentativasRef.fila = [perdeuARede, conexoesEsgotadas];
    await registrarComAPrimeiraResposta();
    await registrarDeNovo();
    await avancar(400);
    expect(armazem.get(CHAVE_DO_RASCUNHO)).toContain("talvezGravada");

    await recarregar();

    expect(hospedeiro.textContent).toContain("Caneca Azul");
    expect(hospedeiro.textContent).toContain(TITULO_DA_DUVIDA);
    await clicar("Cancelar venda");
    expect(hospedeiro.textContent).toContain(
      "Se a venda chegou a ser gravada, ela está em Pedidos.",
    );
    expect(hospedeiro.textContent).not.toContain("Nada é registrado");
  });

  it("depois do F5, mais uma falha passageira ainda não apaga a dúvida (e a chave é a mesma)", async () => {
    tentativasRef.fila = [perdeuARede, conexoesEsgotadas, conexoesEsgotadas];
    await registrarComAPrimeiraResposta();
    await registrarDeNovo();
    await recarregar();

    await registrarDeNovo();

    expect(tentativasRef.chaves).toHaveLength(3);
    expect(new Set(tentativasRef.chaves).size).toBe(1);
    expect(hospedeiro.textContent).toContain(TITULO_DA_DUVIDA);
    await avancar(400);
    expect(armazem.get(CHAVE_DO_RASCUNHO)).toContain("talvezGravada");
  });

  it("(b) o recibo da venda que já existia fecha a dúvida: mostra o recibo e apaga o rascunho", async () => {
    tentativasRef.fila = [perdeuARede, conexoesEsgotadas, vendaJaExistia];
    await registrarComAPrimeiraResposta();
    await registrarDeNovo();
    await registrarDeNovo();

    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(hospedeiro.textContent).not.toContain(TITULO_DA_DUVIDA);
    await avancar(400);
    expect(armazem.has(CHAVE_DO_RASCUNHO)).toBe(false);
  });

  it("(b) recusa de negócio com a mesma chave fecha a dúvida: o F5 volta sem aviso e o Cancelar diz 'Nada é registrado'", async () => {
    tentativasRef.fila = [perdeuARede, conexoesEsgotadas, semEstoque];
    await registrarComAPrimeiraResposta();
    await registrarDeNovo();
    await registrarDeNovo();

    expect(hospedeiro.textContent).toContain(TITULO_DA_RECUSA);
    expect(hospedeiro.textContent).not.toContain(TITULO_DA_DUVIDA);
    await avancar(400);
    expect(armazem.get(CHAVE_DO_RASCUNHO)).not.toContain("talvezGravada");

    await recarregar();
    await clicar("Cancelar venda");
    expect(hospedeiro.textContent).toContain("Nada é registrado");
  });

  it("(c) controle: 53300 SEM resposta perdida antes continua dizendo que não foi registrada", async () => {
    tentativasRef.fila = [conexoesEsgotadas];
    await registrarComAPrimeiraResposta();

    expect(hospedeiro.textContent).toContain(TITULO_DA_RECUSA);
    expect(hospedeiro.textContent).not.toContain(TITULO_DA_DUVIDA);
    expect(hospedeiro.textContent).toContain("a venda não foi registrada");
    expect(hospedeiro.textContent).toContain("o estoque não foi descontado");
    await avancar(400);
    expect(armazem.get(CHAVE_DO_RASCUNHO)).not.toContain("talvezGravada");

    await recarregar();
    await clicar("Cancelar venda");
    expect(hospedeiro.textContent).toContain("Nada é registrado");
  });

  it("'Começar uma venda nova' avisa que a venda pode já existir quando há dúvida", async () => {
    tentativasRef.fila = [perdeuARede, sessaoNegada];
    await registrarComAPrimeiraResposta();
    await registrarDeNovo();

    // 42501 não convida a repetir: a saída é a venda nova — mas a dúvida segue
    expect(hospedeiro.textContent).toContain(TITULO_DA_DUVIDA);
    await clicar("Começar uma venda nova");
    const janela = document.querySelector<HTMLElement>(
      '[data-testid="confirmar-acao"]',
    );
    expect(janela?.textContent).toContain("Ela pode já ter sido registrada");
    expect(janela?.textContent).toContain("confira em Pedidos");
  });

  it("(c) controle: 'Começar uma venda nova' SEM dúvida não ganha o aviso", async () => {
    tentativasRef.fila = [sessaoNegada];
    await registrarComAPrimeiraResposta();
    await clicar("Começar uma venda nova");
    const janela = document.querySelector<HTMLElement>(
      '[data-testid="confirmar-acao"]',
    );
    expect(janela?.textContent).toContain("apaga a venda em andamento");
    expect(janela?.textContent).not.toContain("pode já ter sido registrada");
  });
});

describe("Cancelar venda — a pergunta olha a dúvida, não só o texto do erro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function perguntarSeCancela(
    parcial: Partial<EstadoDaVenda>,
  ): Promise<string> {
    const estado: EstadoDaVenda = {
      ...estadoInicialDaVenda(() => "chave-1"),
      itens: [
        {
          chave: "produto-1::",
          productId: "produto-1",
          variantId: null,
          nome: "Caneca Azul",
          variacao: null,
          preco: 50,
          quantidade: 2,
          estoque: 10,
          imagem: "",
        },
      ],
      ...parcial,
    };
    await act(async () => {
      raiz.render(
        <CupomDaVenda
          estado={estado}
          despachar={vi.fn()}
          subtotal={100}
          onNavigate={vi.fn()}
          limparCupom={vi.fn()}
          feedback={null}
        />,
      );
    });
    await act(async () => {
      botao(hospedeiro, "Cancelar venda")!.click();
    });
    return hospedeiro.textContent ?? "";
  }

  it("com a dúvida aberta e SEM texto de erro (envio no ar), não jura 'nada registrado'", async () => {
    const texto = await perguntarSeCancela({
      talvezGravada: true,
      erro: null,
    });
    expect(texto).toContain("Se a venda chegou a ser gravada");
    expect(texto).not.toContain("Nada é registrado");
  });

  it("controle: sem dúvida e sem erro, diz 'Nada é registrado'", async () => {
    const texto = await perguntarSeCancela({
      talvezGravada: false,
      erro: null,
    });
    expect(texto).toContain("Nada é registrado");
  });
});
