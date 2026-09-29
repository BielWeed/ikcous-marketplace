// @vitest-environment jsdom
//
// Tarefa C3.3 (plano §5.3 e §5.6) — a ÚNICA tarefa que registra `admin-pdv`
// nos 12 pontos do roteador manual (union `View`, `TELAS_DE_ENTRADA`,
// `scripts/hospedagem.mjs`, `VIEW_COMPONENTS`, `adminViews`, `subAdminViews`
// + reroute do popstate, `adminViewIndices`, `VIEW_PREFETCH_MAP`,
// `AdminArea.tsx` e `paiDaTelaDoAdmin`) e acrescenta, dentro da view já
// montada por C3.2, o Voltar por camada e o dirty enquanto há cupom.
//
// Padrão de Voltar MEDIDO em tests/front/admin-banners-voltar-fecha-so-o-
// dialogo.test.tsx (commit d10d635): aqui adaptado de "um diálogo" para
// "uma das três camadas do balcão" (escolha de variação, cliente,
// fechamento) — todas nascem de "cupom" e voltam pra "cupom" direto.
//
// Sem `@testing-library/react`: `createRoot` + `act` do React puro (molde:
// tests/front/leitor-de-codigo-componente.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `vi.hoisted` porque as fábricas de mock abaixo são IÇADAS para o topo do
// módulo pelo Vitest (mesmo motivo do molde de C3.2).
const { rpcMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mesmo dublê da tarefa C3.2: um botão "bipar" que chama `aoLer` com o
// código armado pelo teste — nenhum destes casos precisa de câmera.
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

import { TELAS_DE_ENTRADA } from "@/config/rotas";
import type {
  EstadoDaVenda,
  ItemDoCupom,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";
// Importado DEPOIS dos `vi.mock` acima — a view REAL, com a máquina de
// estados REAL (C3.1), é o que os casos 1-5 abaixo precisam para provar
// Voltar/pushState/dirty através de transições de verdade.
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

async function bipar(codigo: string): Promise<void> {
  codigoBipadoRef.atual = codigo;
  const botao = localizarBotaoPorTexto(document.body, "bipar")!;
  await act(async () => {
    botao.click();
  });
  await avancar();
}

describe("roteador — TELAS_DE_ENTRADA reconhece admin-pdv", () => {
  it("contém 'admin-pdv' (senão F5 em /admin-pdv cai em home)", () => {
    expect(TELAS_DE_ENTRADA).toContain("admin-pdv");
  });
});

describe("AdminPdvView — Voltar por camada e dirty (C3.3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Dublê do localStorage (ver o comentário no beforeEach).
  let armazem: Map<string, string>;

  // Mesmo contrato do molde de banners: em produção `onSetBackOverride` É
  // o `setBackOverride` de um `useState<(() => void) | null>` — o
  // componente chama `onSetBackOverride(() => fnReal)` no formato de
  // "updater" do useState, e o dublê replica esse contrato para não
  // capturar o WRAPPER em vez da função real.
  let overrideAtual: (() => void) | null = null;
  const onSetBackOverride = vi.fn((fn: unknown) => {
    overrideAtual =
      typeof fn === "function"
        ? (fn as () => (() => void) | null)()
        : (fn as (() => void) | null);
  });
  const onSetDirty = vi.fn();

  // B2 do item 2 da fila (19/09): o cliente que a RESPOSTA do banco devolve
  // para o recibo — os campos que `to_jsonb(o.*)` carrega de verdade na
  // linha de `marketplace_orders`. Default = venda sem cliente (o MESMO
  // literal que a migration 20261162000000:366-371 grava).
  let clienteNaResposta: {
    user_id: string | null;
    customer_name: string;
    customer_data: { whatsapp: string | null; canal: string };
  };

  beforeEach(() => {
    // Cupom novo a cada teste — sem isto o rascunho gravado por
    // `useVendaPresencial` (C3.1) no `localStorage` de um teste anterior
    // seria restaurado no próximo mount.
    // O localStorage global deste runner (Node >= 25 traz o experimental do
    // Node por cima do do jsdom) não tem clear/removeItem confiáveis —
    // dublê Map-based, o MESMO padrão dos outros testes da casa.
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
    overrideAtual = null;
    onSetBackOverride.mockClear();
    onSetDirty.mockClear();
    clienteNaResposta = {
      user_id: null,
      customer_name: "Venda no balcão",
      customer_data: { whatsapp: null, canal: "presencial" },
    };
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras") {
        if (params.p_codigo === PRODUTO_SIMPLES.codigo) {
          return { data: PRODUTO_SIMPLES, error: null };
        }
        return {
          data: {
            encontrado: false,
            origem: null,
            codigo: params.p_codigo,
            produto: null,
            variante: null,
            preco: null,
            estoque: null,
            variacoes: [],
          },
          error: null,
        };
      }
      if (nome === "get_admin_customers_paged") {
        return { data: { data: [] }, error: null };
      }
      if (nome === "get_admin_products_paged") {
        return { data: { data: [] }, error: null };
      }
      if (nome === "registrar_venda_presencial") {
        return {
          data: {
            ja_existia: false,
            order: {
              id: "pedido-balcao-teste",
              created_at: new Date().toISOString(),
              total: 39.9,
              subtotal: 39.9,
              discount: 0,
              payment_method: params.p_pagamento ?? "cash",
              // B2: a linha que `to_jsonb(o.*)` devolve carrega os campos de
              // cliente — o recibo monta o cliente DAQUI, não da tela.
              user_id: clienteNaResposta.user_id,
              customer_name: clienteNaResposta.customer_name,
              customer_data: clienteNaResposta.customer_data,
            },
            items: [
              {
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
      throw new Error(`RPC não mockada neste teste: ${nome}`);
    });

    // Base limpa do histórico, imitando a URL de `/admin-pdv` já carregada
    // (equivalente ao que `syncWithUrl` deixaria como `history.state`
    // antes de a camada abrir).
    window.history.replaceState({ view: "admin-pdv" }, "", "/admin-pdv");

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

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(
        <AdminPdvView
          onNavigate={vi.fn()}
          active
          onSetBackOverride={onSetBackOverride}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await avancar();
  }

  async function abrirCamadaDeCliente(): Promise<void> {
    const botao = localizarBotaoPorTexto(hospedeiro, "Cliente (opcional)")!;
    expect(botao).toBeDefined();
    await act(async () => {
      botao.click();
    });
    await avancar();
    // Camada realmente aberta — "Cliente da venda" só existe dentro dela.
    expect(hospedeiro.textContent).toContain("Cliente da venda");
  }

  // Preenche um <input> controlado do React pelo setter nativo + evento
  // `input`, e espera o flush do buffer do `LocalBufferedInput` (delay 200).
  async function preencherInputPorId(id: string, valor: string): Promise<void> {
    const input = hospedeiro.querySelector<HTMLInputElement>(`#${id}`)!;
    expect(input).toBeDefined();
    const definidor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      definidor.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await avancar(250);
  }

  it("caso 1 — TELAS_DE_ENTRADA importado por esta suíte contém o nome (redundante com o describe acima, prova que a MESMA view enxerga a mesma lista)", () => {
    expect(TELAS_DE_ENTRADA).toContain("admin-pdv");
  });

  it("a raiz da view carrega pb-admin — no navegador do celular o 'Registrar venda' não pode ficar por trás da barra de navegação fixa (relato do dono em teste real, 19/09)", async () => {
    await montar();
    // O respiro inferior é o MESMO das outras telas do admin (index.css
    // .pb-admin); sem ele a rolagem termina exatamente onde o último botão
    // encosta na barra fixa — inalcançável no dedo.
    const raizDaView = hospedeiro.firstElementChild as HTMLElement;
    expect(raizDaView?.className).toContain("pb-admin");
  });

  it("caso 4 — abrir a camada de cliente empurra pushState com {modal: 'pdv'}, na MESMA URL", async () => {
    await montar();
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    await abrirCamadaDeCliente();

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    const [estadoEmpurrado, , urlEmpurrada] = pushStateSpy.mock.calls[0];
    expect(estadoEmpurrado).toMatchObject({
      view: "admin-pdv",
      modal: "pdv",
    });
    expect(urlEmpurrada).toBe("/admin-pdv");
    expect(window.location.pathname).toBe("/admin-pdv");
    expect(overrideAtual).toBeInstanceOf(Function);
  });

  it("caso 2 — Voltar com a camada de cliente aberta fecha só a camada (etapa volta pra 'cupom') e a tela continua montada", async () => {
    await montar();
    await abrirCamadaDeCliente();

    expect(overrideAtual).toBeInstanceOf(Function);
    await act(async () => {
      overrideAtual?.();
    });

    // Saiu da camada de cliente...
    expect(hospedeiro.textContent).not.toContain("Cliente da venda");
    // ...mas a tela do balcão continua montada (o cupom, não a home).
    expect(hospedeiro.textContent).toContain("Bipe o primeiro produto");
  });

  it("caso 3 — chamar o override duas vezes seguidas fecha uma camada só (idempotência, mesmo caso de admin-banners-voltar-fecha-so-o-dialogo.test.tsx)", async () => {
    await montar();
    await abrirCamadaDeCliente();

    const backSpy = vi.spyOn(window.history, "back");
    const fecharPrimeiraVez = overrideAtual;

    await act(async () => {
      fecharPrimeiraVez?.();
    });
    expect(backSpy).toHaveBeenCalledTimes(1);

    // O botão Voltar do AdminLayout (chamada direta) e o popstate que o
    // `history.back()` acima pode disparar entregam a MESMA função de
    // fechamento uma segunda vez antes do efeito desregistrar.
    await act(async () => {
      fecharPrimeiraVez?.();
    });

    // Não consumiu outra entrada: a segunda chamada foi um no-op.
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("caso 5a — bipar um item liga o dirty (true)", async () => {
    await montar();
    expect(onSetDirty).toHaveBeenLastCalledWith(false);

    await bipar(PRODUTO_SIMPLES.codigo);

    expect(onSetDirty).toHaveBeenLastCalledWith(true);
  });

  it("caso 5b — esvaziar o cupom desliga o dirty (false)", async () => {
    await montar();
    await bipar(PRODUTO_SIMPLES.codigo);
    expect(onSetDirty).toHaveBeenLastCalledWith(true);

    const botaoRemover = hospedeiro.querySelector(
      'button[aria-label^="Remover"]',
    ) as HTMLButtonElement;
    expect(botaoRemover).toBeDefined();
    await act(async () => {
      botaoRemover.click();
    });
    await avancar();

    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });

  it("caso 5c — venda registrada com camada aberta consome a entrada de histórico com replaceState e NUNCA history.back (o popstate disparava o diálogo 'alterações não salvas' sobre o recibo — relato do dono, 19/09)", async () => {
    await montar();
    await bipar(PRODUTO_SIMPLES.codigo);
    await abrirCamadaDeCliente();

    const backSpy = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => {});
    const replaceSpy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});

    // Da camada de cliente até o recibo: voltar ao cupom, fechar a venda,
    // escolher o pagamento e registrar (o mock da RPC resolve com um pedido
    // gravado mínimo, no formato de `RespostaDoFechamento`).
    const voltarAoCupom = localizarBotaoPorTexto(
      hospedeiro,
      "Voltar ao cupom",
    )!;
    await act(async () => {
      voltarAoCupom.click();
    });
    await avancar();

    const fecharVenda = localizarBotaoPorTexto(hospedeiro, "Fechar venda")!;
    await act(async () => {
      fecharVenda.click();
    });
    await avancar();

    const dinheiro = localizarBotaoPorTexto(hospedeiro, "Dinheiro")!;
    await act(async () => {
      dinheiro.click();
    });
    await avancar();

    const registrar = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    // A volta ao cupom já consumiu a entrada da camada por back() — o que
    // este caso prova é o que acontece NA VIRADA PARA O RECIBO: aí não pode
    // existir navegação nenhuma.
    backSpy.mockClear();
    replaceSpy.mockClear();
    await act(async () => {
      registrar.click();
    });
    await avancar(100);

    // O recibo chegou (a venda existe)…
    expect(hospedeiro.textContent).toContain("Compra na loja");
    // …e o consumo da entrada de histórico da camada NÃO foi por back(): o
    // popstate dele corria antes do dirty cair no painel e abria o diálogo
    // "alterações não salvas" sobre o recibo de uma venda JÁ registrada.
    expect(backSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalled();
  });

  it("B2 — o cliente do recibo vem da RESPOSTA do banco, não do que está na tela (recarregar a página não pode apagar o cliente do recibo)", async () => {
    await montar();
    await bipar(PRODUTO_SIMPLES.codigo);
    await abrirCamadaDeCliente();

    // A tela cadastra um cliente AVULSO (nome + whatsapp digitados na hora)…
    const abaAvulso = localizarBotaoPorTexto(hospedeiro, "Cliente avulso")!;
    await act(async () => {
      abaAvulso.click();
    });
    await avancar();
    await preencherInputPorId(
      "nome-do-cliente-avulso",
      "Maria digitada na tela",
    );
    await preencherInputPorId("whatsapp-do-cliente-avulso", "11999999999");
    const confirmarAvulso = localizarBotaoPorTexto(
      hospedeiro,
      "Confirmar cliente avulso",
    ) as HTMLButtonElement;
    expect(confirmarAvulso.disabled).toBe(false);
    await act(async () => {
      confirmarAvulso.click();
    });
    await avancar();

    // …mas a RESPOSTA do banco conta outra história: é o que a RPC gravou
    // de verdade (a camada de cliente é interativa por baixo do
    // fechamento — e na retentativa pós-recarregamento, o que está na
    // tela é o rascunho, não a venda que o banco já tem).
    clienteNaResposta = {
      user_id: null,
      customer_name: "Maria gravada no banco",
      customer_data: { whatsapp: "11777777777", canal: "presencial" },
    };

    const fecharVenda = localizarBotaoPorTexto(hospedeiro, "Fechar venda")!;
    await act(async () => {
      fecharVenda.click();
    });
    await avancar();

    const dinheiro = localizarBotaoPorTexto(hospedeiro, "Dinheiro")!;
    await act(async () => {
      dinheiro.click();
    });
    await avancar();

    const registrar = localizarBotaoPorTexto(
      hospedeiro,
      "Registrar venda",
    ) as HTMLButtonElement;
    await act(async () => {
      registrar.click();
    });
    await avancar(100);

    // O recibo chegou…
    expect(hospedeiro.textContent).toContain("Compra na loja");
    // …com o cliente DA RESPOSTA do banco (nome E whatsapp)…
    expect(hospedeiro.textContent).toContain("Maria gravada no banco");
    expect(hospedeiro.textContent).toContain("11777777777");
    // …e NADA do cliente que ficou na tela.
    expect(hospedeiro.textContent).not.toContain("Maria digitada na tela");
  });

  it("caso 5c — desmontar com item ainda no cupom desliga o dirty (false) no unmount", async () => {
    await montar();
    await bipar(PRODUTO_SIMPLES.codigo);
    expect(onSetDirty).toHaveBeenLastCalledWith(true);

    // Desmonta com o ITEM AINDA NO CUPOM — sem o efeito de cleanup
    // dedicado ao unmount, o painel ficaria pedindo confirmação de
    // navegação para sempre depois que a pessoa sai desta tela.
    act(() => {
      raiz.unmount();
    });

    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });
});

describe("AdminPdvView — dirty cai com a venda registrada, mesmo com itens na lista (caso 6)", () => {
  it("etapa 'recibo' com recibo preenchido: onSetDirty recebe false", async () => {
    // C3.3 não chama `registrar_venda_presencial` (é C3.4, que ainda
    // aguarda a migration da RPC) nem edita `useVendaPresencial.ts` (fora
    // de `arquivos_permitidos`) — então este caso mocka o HOOK, não a
    // RPC, para exercitar a derivação de dirty da VIEW
    // (`itens.length > 0 && recibo === null`) num estado que só existe de
    // verdade depois que C3.4 ligar o fechamento.
    const itemVendido: ItemDoCupom = {
      chave: "produto-1::",
      productId: "produto-1",
      variantId: null,
      nome: "Camiseta Lisa",
      variacao: null,
      preco: 39.9,
      quantidade: 1,
      estoque: 10,
      imagem: "",
    };
    const reciboPreenchido: ReciboDaVendaRegistrada = {
      orderId: "pedido-1",
      numero: "PEDID1",
      criadoEm: new Date("2026-09-17T12:00:00Z").toISOString(),
      total: 39.9,
      subtotal: 39.9,
      desconto: 0,
      pagamento: "cash",
      cliente: { tipo: "sem_cliente" },
      itens: [itemVendido],
      jaExistia: false,
    };
    const estadoComRecibo: EstadoDaVenda = {
      etapa: "recibo",
      itens: [itemVendido],
      cliente: { tipo: "sem_cliente" },
      pagamento: "cash",
      desconto: 0,
      motivoDoDesconto: "",
      chaveDeIdempotencia: "chave-1",
      escolhaDeVariacao: null,
      ultimaEntrada: null,
      aviso: null,
      enviando: false,
      erro: null,
      recibo: reciboPreenchido,
    };

    vi.resetModules();
    vi.doMock("@/hooks/useVendaPresencial", () => ({
      useVendaPresencial: () => ({
        estado: estadoComRecibo,
        despachar: vi.fn(),
        subtotal: 39.9,
        total: 39.9,
        podeRegistrar: { ok: true },
        limparCupom: vi.fn(),
        restaurado: false,
      }),
    }));

    const { AdminPdvView: AdminPdvViewComRecibo } = await import(
      "@/views/admin/AdminPdvView"
    );

    const onSetDirtyLocal = vi.fn();
    const hospedeiroLocal = document.createElement("div");
    document.body.appendChild(hospedeiroLocal);
    const raizLocal = createRoot(hospedeiroLocal);

    await act(async () => {
      raizLocal.render(
        <AdminPdvViewComRecibo
          onNavigate={vi.fn()}
          active
          onSetDirty={onSetDirtyLocal}
        />,
      );
    });

    expect(hospedeiroLocal.textContent).toContain("Compra na loja");
    expect(onSetDirtyLocal).toHaveBeenLastCalledWith(false);

    act(() => {
      raizLocal.unmount();
    });
    hospedeiroLocal.remove();
    vi.doUnmock("@/hooks/useVendaPresencial");
    vi.resetModules();
  });
});
