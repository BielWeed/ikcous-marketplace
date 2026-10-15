// @vitest-environment jsdom
//
// Venda de balcão com a rede PENDURADA (wifi "conectado sem dados"): a sonda
// de conexão agora diz "lenta" em vez de "sem internet" e deixa o botão
// habilitado — então a chamada `registrar_venda_presencial` precisa de PRAZO
// PRÓPRIO, senão o clique gira por minutos. Ao estourar o prazo:
//   - a MESMA frase de rede de sempre ("Não consegui falar com o servidor…
//     cupom salvo"), botão de volta, cupom e chave de idempotência mantidos;
//   - prazo estourado NÃO prova que a venda não chegou ao servidor: a chave
//     de idempotência é quem impede a venda dupla (2º clique devolve
//     `ja_existia`, sem debitar estoque duas vezes).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, registrarImplRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  registrarImplRef: {
    atual: null as
      | ((params: any) => Promise<{ data: unknown; error: unknown }>)
      | null,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock } },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
        onClick={() => aoLer({ codigo: "78912345", formato: "ean_13" })}
      >
        bipar
      </button>
    ) : null,
}));

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const PRODUTO_SIMPLES = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-1",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

const ID_DO_PEDIDO = "44444444-4444-4444-4444-444444444444";

function respostaDaVenda(jaExistia: boolean) {
  return {
    data: {
      ja_existia: jaExistia,
      order: {
        id: ID_DO_PEDIDO,
        created_at: "2026-10-14T12:00:00.000Z",
        total: 39.9,
        subtotal: 39.9,
        discount: 0,
        payment_method: "cash" as const,
      },
      items: [
        {
          id: "item-1",
          product_id: "produto-1",
          variant_id: null,
          quantity: 1,
          price: 39.9,
          product_name: "Camiseta Lisa",
        },
      ],
    },
    error: null,
  };
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

describe("AdminPdvView — o registro da venda tem prazo próprio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras") {
        return { data: PRODUTO_SIMPLES, error: null };
      }
      if (nome === "registrar_venda_presencial") {
        return (
          registrarImplRef.atual as NonNullable<typeof registrarImplRef.atual>
        )(params);
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    registrarImplRef.atual = null;
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

  async function montarAtePagamentoEscolhido(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await act(async () => {
      botaoPorTexto(hospedeiro, "bipar")!.click();
    });
    await avancar();
    await act(async () => {
      botaoPorTexto(hospedeiro, "Fechar venda")!.click();
    });
    await avancar();
    await act(async () => {
      botaoPorTexto(hospedeiro, "Dinheiro")!.click();
    });
    await avancar();
  }

  function chamadasDeRegistro(): any[][] {
    return rpcMock.mock.calls.filter(
      ([nome]) => nome === "registrar_venda_presencial",
    );
  }

  it("rede pendurada: o clique NÃO gira para sempre — em 20 s volta a frase de rede, o botão e o cupom", async () => {
    registrarImplRef.atual = () => new Promise(() => {}); // nunca responde
    await montarAtePagamentoEscolhido();

    await act(async () => {
      botaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar(19000);
    // Ainda dentro do prazo: segue esperando, sem erro.
    expect(hospedeiro.textContent).not.toContain(
      "Não consegui falar com o servidor",
    );

    await avancar(1500);

    expect(hospedeiro.textContent).toContain(
      "Não consegui falar com o servidor",
    );
    expect(hospedeiro.textContent).toContain("cupom está salvo");
    const botao = botaoPorTexto(hospedeiro, "Registrar venda");
    expect(botao?.disabled).toBe(false);
    // Cupom e rascunho intactos.
    expect(hospedeiro.textContent).toContain("39,90");
    expect(localStorage.getItem("admin_pdv_venda_draft:lojista-1")).not.toBe(
      null,
    );
  });

  it("a venda CHEGOU ao servidor e só a resposta se perdeu: o 2º clique usa a MESMA chave, devolve ja_existia e não duplica", async () => {
    // Servidor de mentira: grava por chave; a 1ª resposta fica pendurada.
    const vendasPorChave = new Map<string, number>();
    let chamada = 0;
    let soltarPrimeiraResposta: (() => void) | null = null;
    registrarImplRef.atual = (params) => {
      chamada += 1;
      const chave = params.p_idempotency_key as string;
      const jaExistia = vendasPorChave.has(chave);
      if (!jaExistia) vendasPorChave.set(chave, 1);
      if (chamada === 1) {
        return new Promise((resolve) => {
          soltarPrimeiraResposta = () => resolve(respostaDaVenda(false));
        });
      }
      return Promise.resolve(respostaDaVenda(jaExistia));
    };
    await montarAtePagamentoEscolhido();

    await act(async () => {
      botaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar(20500);
    expect(hospedeiro.textContent).toContain(
      "Não consegui falar com o servidor",
    );

    await act(async () => {
      botaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    const chamadas = chamadasDeRegistro();
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1][1].p_idempotency_key).toBe(
      chamadas[0][1].p_idempotency_key,
    );
    // Uma venda só no servidor; a tela mostra o recibo da que já existia.
    expect(vendasPorChave.size).toBe(1);
    expect(hospedeiro.textContent).toContain("Compra na loja");

    // A resposta ANTIGA aparece depois do prazo: é descartada, sem segundo
    // recibo nem segundo e-mail de confirmação.
    await act(async () => {
      soltarPrimeiraResposta?.();
    });
    await avancar();
    const emails = invokeMock.mock.calls.filter(
      ([nome]) => nome === "send-order-confirmation",
    );
    expect(emails).toHaveLength(1);
  });
});
