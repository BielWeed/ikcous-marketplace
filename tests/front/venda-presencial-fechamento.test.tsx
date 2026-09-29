// @vitest-environment jsdom
//
// Tarefa C3.4 (plano §5.3) — o fechamento de VERDADE: `AdminPdvView` chama
// `registrar_venda_presencial` por nome, com idempotência, e traduz o erro
// para português via `mensagemDaFalhaDaVenda` (src/lib/erro-da-venda-
// presencial.ts). Este arquivo cobre os DOIS: a integração (a view + as
// seções reais, com `useVendaPresencial` de verdade) e a função pura de
// tradução de erro, isolada, sem montar componente nenhum.
//
// Sem `@testing-library/react`: `createRoot` + `act` do React puro (molde:
// tests/front/leitor-de-codigo-componente.test.tsx e
// tests/front/admin-pdv-registro-no-roteador.test.tsx, que já bipa através
// da view real do mesmo jeito).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `vi.hoisted` porque as fábricas de mock abaixo são IÇADAS para o topo do
// módulo pelo Vitest — `registrarImplRef` é o que cada teste troca para
// decidir o que a RPC de fechamento devolve (sucesso, `ja_existia`, ou uma
// rejeição crua, como uma retentativa de rede faria).
const { rpcMock, invokeMock, codigoBipadoRef, registrarImplRef } = vi.hoisted(
  () => ({
    rpcMock: vi.fn(),
    invokeMock: vi.fn(),
    codigoBipadoRef: { atual: "" },
    registrarImplRef: {
      atual: null as
        | ((params: any) => Promise<{ data: unknown; error: unknown }>)
        | null,
    },
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// O mesmo dublê pedido pela tarefa C3.2 e reaproveitado por C3.3: um botão
// "bipar" que chama `aoLer` com o código que o teste armou — nenhum destes
// casos precisa de câmera.
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

// Importado DEPOIS dos `vi.mock` acima — a view REAL, com a máquina de
// estados REAL (C3.1) e as seções reais (C3.2/C3.3), é o que estes casos
// precisam para provar a chamada de verdade da RPC de fechamento.
import { mensagemDaFalhaDaVenda } from "@/lib/erro-da-venda-presencial";
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

function pedidoDeExemplo(id: string) {
  return {
    id,
    created_at: "2026-09-17T12:00:00.000Z",
    total: 39.9,
    subtotal: 39.9,
    discount: 0,
    payment_method: "cash" as const,
  };
}

function localizarBotaoPorTexto(
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

describe("mensagemDaFalhaDaVenda (função pura, C3.4)", () => {
  it("42501 repassa a frase do banco e não convida a tentar de novo", () => {
    expect(
      mensagemDaFalhaDaVenda({
        code: "42501",
        message: "Acesso negado: só a loja registra venda no balcão.",
      }),
    ).toEqual({
      mensagem: "Acesso negado: só a loja registra venda no balcão.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: true,
    });
  });

  it("22023 de estoque é a ÚNICA recusa de validação que convida a tentar de novo", () => {
    const r = mensagemDaFalhaDaVenda({
      code: "22023",
      message:
        "Estoque insuficiente para o produto Camiseta Lisa (Disponível: 1, Solicitado: 2)",
    });
    expect(r).toEqual({
      mensagem:
        "Estoque insuficiente para o produto Camiseta Lisa (Disponível: 1, Solicitado: 2)",
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
  });

  it("22023 de outra recusa (ex.: motivo do desconto) NÃO convida a tentar de novo", () => {
    expect(
      mensagemDaFalhaDaVenda({
        code: "22023",
        message: "Informe o motivo do desconto.",
      }),
    ).toEqual({
      mensagem: "Informe o motivo do desconto.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: false,
    });
  });

  it("23505 vira 'chave já usada por outro pedido', não uma frase de rede", () => {
    expect(
      mensagemDaFalhaDaVenda({
        code: "23505",
        message: "duplicate key value violates unique constraint",
      }),
    ).toEqual({
      mensagem: "Esta chave de venda já foi usada por outro pedido.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: false,
    });
  });

  it("PGRST202 diz que o balcão não está liberado neste servidor", () => {
    expect(
      mensagemDaFalhaDaVenda({ code: "PGRST202", message: "schema cache" }),
    ).toEqual({
      mensagem:
        "O balcão ainda não está liberado neste servidor. Avise quem cuida do app.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: false,
    });
  });

  it("erro sem `code` (rede caindo) vira a frase honesta do D3 e convida a tentar de novo", () => {
    expect(mensagemDaFalhaDaVenda(new TypeError("Failed to fetch"))).toEqual({
      mensagem:
        "Não consegui falar com o servidor. O cupom está salvo aqui; tente de novo quando a conexão voltar.",
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
  });

  it("DOMException nunca aparece crua na tela", () => {
    const dom = new DOMException("The operation was aborted.", "AbortError");
    const r = mensagemDaFalhaDaVenda(dom);
    expect(r.mensagem).not.toContain("AbortError");
    expect(r.mensagem).not.toContain("DOMException");
    expect(r.mensagem).not.toContain("operation was aborted");
    expect(r.podeTentarDeNovo).toBe(true);
  });
});

describe("AdminPdvView — fechamento de verdade (C3.4)", () => {
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
        if (!registrarImplRef.atual) {
          throw new Error(
            "teste esqueceu de armar registrarImplRef.atual antes de clicar em Registrar venda",
          );
        }
        return registrarImplRef.atual(params);
      }
      throw new Error(`RPC inesperada no teste de fechamento: ${nome}`);
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

  // Bipa o produto simples, avança para "fechamento" e escolhe "Dinheiro" —
  // o ponto de partida comum de quase todo caso deste arquivo.
  async function montarAtePagamentoEscolhido(): Promise<void> {
    codigoBipadoRef.atual = PRODUTO_SIMPLES.codigo;
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "bipar")!.click();
    });
    await avancar();

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Fechar venda")!.click();
    });
    await avancar();

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Dinheiro")!.click();
    });
    await avancar();
  }

  function chamadasDeRegistro(): any[][] {
    return rpcMock.mock.calls.filter(
      ([nome]) => nome === "registrar_venda_presencial",
    );
  }

  it("caso 1 — sucesso: os 8 parâmetros por nome, `p_itens` com 3 chaves, recibo, rascunho apagado, e-mail disparado, sem aviso ao lojista", async () => {
    registrarImplRef.atual = async () => ({
      data: {
        ja_existia: false,
        order: pedidoDeExemplo("11111111-1111-1111-1111-111111111111"),
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
    });

    await montarAtePagamentoEscolhido();

    const botao = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);

    await act(async () => {
      botao.click();
    });
    await avancar();

    const chamadas = chamadasDeRegistro();
    expect(chamadas).toHaveLength(1);
    const params = chamadas[0][1];

    // Os 8 parâmetros, POR NOME — nenhum a mais, nenhum a menos.
    expect(Object.keys(params).sort()).toEqual(
      [
        "p_cliente_nome",
        "p_cliente_user_id",
        "p_cliente_whatsapp",
        "p_desconto",
        "p_idempotency_key",
        "p_itens",
        "p_observacao",
        "p_pagamento",
      ].sort(),
    );
    // `p_itens` com EXATAMENTE as três chaves que a RPC lê — nunca preço
    // nem nome (contexto da tarefa, fato 3).
    expect(params.p_itens).toEqual([
      { product_id: "produto-1", variant_id: null, quantity: 1 },
    ]);
    expect(params.p_pagamento).toBe("cash");
    expect(params.p_cliente_user_id).toBeNull();
    expect(params.p_cliente_nome).toBeNull();
    expect(params.p_cliente_whatsapp).toBeNull();
    expect(params.p_desconto).toBe(0);
    expect(typeof params.p_idempotency_key).toBe("string");

    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(localStorage.getItem("admin_pdv_venda_draft")).toBeNull();

    expect(invokeMock).toHaveBeenCalledWith("send-order-confirmation", {
      body: { orderId: "11111111-1111-1111-1111-111111111111" },
    });
    expect(
      invokeMock.mock.calls.some(([nome]) => nome === "notify-new-order"),
    ).toBe(false);
  });

  it("caso 2 — `ja_existia: true` mostra o MESMO recibo, sem nenhum aviso de erro", async () => {
    registrarImplRef.atual = async () => ({
      data: {
        ja_existia: true,
        order: pedidoDeExemplo("22222222-2222-2222-2222-222222222222"),
        items: [],
      },
      error: null,
    });

    await montarAtePagamentoEscolhido();

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("caso 3 — retentativa: a primeira rejeita por rede, a segunda registra — as DUAS com o MESMO `p_idempotency_key`", async () => {
    let numeroDaChamada = 0;
    registrarImplRef.atual = async () => {
      numeroDaChamada += 1;
      if (numeroDaChamada === 1) {
        throw new TypeError("Failed to fetch");
      }
      return {
        data: {
          ja_existia: false,
          order: pedidoDeExemplo("33333333-3333-3333-3333-333333333333"),
          items: [],
        },
        error: null,
      };
    };

    await montarAtePagamentoEscolhido();
    const botao = () =>
      localizarBotaoPorTexto(hospedeiro, "Registrar venda") as
        | HTMLButtonElement
        | undefined;

    await act(async () => {
      botao()!.click();
    });
    await avancar();
    expect(hospedeiro.textContent).toContain(
      "Não consegui falar com o servidor",
    );

    await act(async () => {
      botao()!.click();
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Compra na loja");

    const chamadas = chamadasDeRegistro();
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0][1].p_idempotency_key).toBe(
      chamadas[1][1].p_idempotency_key,
    );
  });

  it("caso 5 — falha 22023 preserva itens na tela e no rascunho, e não muda a chave de idempotência", async () => {
    registrarImplRef.atual = async () => ({
      data: null,
      error: {
        code: "22023",
        message:
          "Estoque insuficiente para o produto Camiseta Lisa (Disponível: 1, Solicitado: 1)",
      },
    });

    await montarAtePagamentoEscolhido();

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    // Tempo para o debounce de gravação do rascunho (atrasoDeGravacaoMs
    // padrão de 300ms em useVendaPresencial.ts) correr de verdade.
    await avancar(400);

    expect(hospedeiro.textContent).toContain(
      "Estoque insuficiente para o produto Camiseta Lisa",
    );
    // O item continua na tela: `CupomDaVenda` segue montado sob o
    // fechamento enquanto a etapa não é "recibo" (AdminPdvView.tsx).
    expect(hospedeiro.textContent).toContain("Camiseta Lisa");

    const bruto = localStorage.getItem("admin_pdv_venda_draft");
    expect(bruto).toBeTruthy();
    const rascunho = JSON.parse(bruto as string);
    expect(rascunho.itens).toHaveLength(1);
    const chaveAntes = rascunho.chaveDeIdempotencia as string;
    expect(typeof chaveAntes).toBe("string");

    // Retentativa: a MESMA chave é reenviada — é a prova, dentro do mesmo
    // caso, de que a falha não girou a chave (o pior defeito possível,
    // listado nos riscos da tarefa).
    registrarImplRef.atual = async (params: any) => {
      expect(params.p_idempotency_key).toBe(chaveAntes);
      return {
        data: {
          ja_existia: false,
          order: pedidoDeExemplo("44444444-4444-4444-4444-444444444444"),
          items: [],
        },
        error: null,
      };
    };
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Compra na loja");
  });

  it("caso 6 — 'Nova venda' gera uma chave de idempotência NOVA para a venda seguinte", async () => {
    const chavesRecebidas: string[] = [];
    registrarImplRef.atual = async (params: any) => {
      chavesRecebidas.push(params.p_idempotency_key);
      return {
        data: {
          ja_existia: false,
          order: pedidoDeExemplo(`pedido-${chavesRecebidas.length}`),
          items: [],
        },
        error: null,
      };
    };

    await montarAtePagamentoEscolhido();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Compra na loja");

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Nova venda")!.click();
    });
    await avancar();

    // Venda NOVA, do zero: bipa de novo, fecha, escolhe pagamento, registra.
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "bipar")!.click();
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Fechar venda")!.click();
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Dinheiro")!.click();
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    expect(chavesRecebidas).toHaveLength(2);
    expect(chavesRecebidas[0]).not.toBe(chavesRecebidas[1]);
  });

  it("caso 7 — o recibo mostra os itens que a RPC gravou (`data.items`), não os da TELA no momento do clique", async () => {
    // Reprodução do achado BLOQUEIA da revisão: o balconista bipa 1x, mas
    // ANTES de clicar em "Registrar venda" (ou entre uma tentativa que já
    // commitou no servidor e uma retentativa) mexe na quantidade pelo `+`
    // do cupom — que continua clicável sob a folha de fechamento, porque
    // `CupomDaVenda` renderiza sempre que `etapa !== "recibo"`. A RPC devolve
    // `ja_existia: true` com o pedido de 1 unidade que REALMENTE foi
    // gravado. O recibo tem de mostrar 1x, não 2x: os itens vêm de
    // `resposta.items` (o que o BANCO gravou), e `estado.itens` só serve
    // para achar a imagem/variação por `product_id`+`variant_id` — nunca
    // para quantidade ou preço.
    registrarImplRef.atual = async () => ({
      data: {
        ja_existia: true,
        order: pedidoDeExemplo("55555555-5555-5555-5555-555555555555"),
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
    });

    await montarAtePagamentoEscolhido();

    // O `+` do item, ainda visível e clicável por baixo do fechamento —
    // sobe a quantidade da TELA para 2 sem que nenhuma venda nova tenha
    // sido registrada.
    await act(async () => {
      (
        hospedeiro.querySelector(
          '[aria-label="Aumentar quantidade de Camiseta Lisa"]',
        ) as HTMLButtonElement
      ).click();
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("2");

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("Compra na loja");
    // O recibo mostra o que o BANCO gravou (1x), nunca o que a tela tinha
    // no momento do clique (2x) — senão o balconista cobra R$ 79,80 e o
    // pedido registrado (e o estoque baixado) são de R$ 39,90.
    expect(hospedeiro.textContent).toContain("1x Camiseta Lisa");
    expect(hospedeiro.textContent).not.toContain("2x Camiseta Lisa");
  });

  it("caso 8 — `jaExistia: true` acende um aviso visível no recibo (a tela não fica muda sobre o duplo toque)", async () => {
    registrarImplRef.atual = async () => ({
      data: {
        ja_existia: true,
        order: pedidoDeExemplo("66666666-6666-6666-6666-666666666666"),
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
    });

    await montarAtePagamentoEscolhido();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    expect(hospedeiro.textContent).toContain("já tinha sido registrada");
  });

  it("caso 9 — 23505 (chave queimada) desabilita 'Registrar venda' e oferece 'Começar uma venda nova' com chave nova", async () => {
    registrarImplRef.atual = async () => ({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });

    await montarAtePagamentoEscolhido();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar(400);

    expect(hospedeiro.textContent).toContain(
      "Esta chave de venda já foi usada por outro pedido.",
    );
    const botaoRegistrar = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botaoRegistrar.disabled).toBe(true);

    const chaveQueimada = JSON.parse(
      localStorage.getItem("admin_pdv_venda_draft") as string,
    ).chaveDeIdempotencia as string;

    const botaoNovaVenda = localizarBotaoPorTexto(
      hospedeiro,
      "Começar uma venda nova",
    ) as HTMLButtonElement;
    expect(botaoNovaVenda).toBeTruthy();

    registrarImplRef.atual = async (params: any) => {
      expect(params.p_idempotency_key).not.toBe(chaveQueimada);
      return {
        data: {
          ja_existia: false,
          order: pedidoDeExemplo("77777777-7777-7777-7777-777777777777"),
          items: [],
        },
        error: null,
      };
    };

    await act(async () => {
      botaoNovaVenda.click();
    });
    await avancar();

    // Venda nova, do zero, com a chave nova.
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "bipar")!.click();
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Fechar venda")!.click();
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Dinheiro")!.click();
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Compra na loja");
  });

  it("caso 10 — 42501 convida a entrar de novo na conta", async () => {
    registrarImplRef.atual = async () => ({
      data: null,
      error: {
        code: "42501",
        message: "Acesso negado: só a loja registra venda no balcão.",
      },
    });

    await montarAtePagamentoEscolhido();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar(400);

    expect(hospedeiro.textContent).toContain(
      "Acesso negado: só a loja registra venda no balcão.",
    );
    expect(hospedeiro.textContent).toContain("entre de novo na conta");
    const botaoRegistrar = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    expect(botaoRegistrar.disabled).toBe(true);
  });
});
