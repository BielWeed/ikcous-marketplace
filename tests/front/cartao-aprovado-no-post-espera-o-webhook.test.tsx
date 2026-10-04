// @vitest-environment jsdom
//
// MEDIÇÃO LOCAL (T0-LOCAL, 04/10/2026, sobre a prévia cccee4b8) — o que a tela
// do cartão faz HOJE depois que o POST de criação já volta APROVADO
// (`statusPagamento: "pago"`), quando o webhook não chega ou chega atrasado.
//
// Estes testes são DOCUMENTAÇÃO do comportamento atual (por ordem do dono,
// antes de decidir o desenho "cartão aprovado já no POST: a criação confirma
// pela prova do GET"). Eles medem, com asserção:
//   a. quantas vezes a tela chama o `verificar` da edge na etapa `aprovado`;
//   b. que o pedido continua `aguardando` no banco falso enquanto ninguém
//      (webhook, cron) o confirma;
//   c. que a tela fica em "Pagamento aprovado! Confirmando seu pedido…", e o
//      texto "pode levar alguns minutos" só aparece aos 60 s (relógio falso);
//   d. que a confirmação só chega pelo banco (realtime ou leitura periódica)
//      DEPOIS que alguém grava `pago` — webhook atrasado ou o cron.
//
// Andaime: o CheckoutView, o PagamentoOnline, o PagamentoComCartao e o hook
// `useOrders` DE VERDADE (sem dublê do useOrders — `criarPagamento` do hook
// real chama `supabase.functions.invoke("criar-pagamento")`). Só o SDK do
// Mercado Pago e o cliente do Supabase (a edge e o "banco": UMA linha) são
// dublês. Nada sai para a rede.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: undefined,
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
const mockUser = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: () => {},
      addToCart: () => {},
      selectedShippingOption: null,
      shippingCep: null,
    })),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
// `useLeaderElection` (BroadcastChannel entre abas) não é o hook do pedido:
// uma aba só, líder.
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
  CLAIM_DELAY_WINDOW_MS: 100,
}));
const CREDITO_1X = { credito: true, debito: false, parcelasMax: 1 };
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(CREDITO_1X) };
});
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// O "banco" (UMA linha), a "edge" e o realtime — o cliente do Supabase.
type CorpoDaEdge = { metodo?: string; orderId?: string };
let linha: Record<string, unknown> = {};
const chamadasDaEdge: Array<{ nome: string; corpo: CorpoDaEdge }> = [];
let leiturasDaLinhaPeloCliente = 0;
let aoPostar: ((corpo: CorpoDaEdge) => unknown) | null = null;
let entregaRealtime: ((payload: unknown) => Promise<void>) | null = null;

function consulta(tabela = ""): unknown {
  // RPC (ex.: `get_my_cpf`) sem retorno: `null`, nunca uma lista.
  const resolvido = {
    data: tabela === "rpc" ? null : [],
    error: null,
    count: 0,
  };
  // Só a tabela de pedidos devolve a linha; as outras leituras (perfil, CPF
  // da conta, endereços) voltam vazias.
  const daLinha = tabela === "marketplace_orders";
  const alvo: unknown = new Proxy(() => {}, {
    get(_destino, propriedade) {
      if (propriedade === "then") {
        return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(resolvido).then(res, rej);
      }
      if (propriedade === "maybeSingle") {
        return () =>
          Promise.resolve({ data: daLinha ? { ...linha } : null, error: null });
      }
      if (propriedade === "single") {
        return () => {
          if (daLinha) leiturasDaLinhaPeloCliente += 1;
          return Promise.resolve({
            data: daLinha ? { ...linha } : null,
            error: null,
          });
        };
      }
      return () => alvo;
    },
  });
  return alvo;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => consulta(tabela),
    rpc: () => consulta("rpc"),
    functions: {
      invoke: async (nome: string, opcoes: { body: CorpoDaEdge }) => {
        chamadasDaEdge.push({ nome, corpo: opcoes.body });
        if (!aoPostar) throw new Error("edge sem roteiro neste teste");
        return { data: aoPostar(opcoes.body), error: null };
      },
    },
    channel: () => {
      const canal = {
        on(_tipo: string, _filtro: unknown, retorno: unknown) {
          entregaRealtime = retorno as (payload: unknown) => Promise<void>;
          return canal;
        },
        subscribe(retorno?: (status: string) => void) {
          retorno?.("SUBSCRIBED");
          return canal;
        },
        unsubscribe: () => Promise.resolve("ok"),
        send: () => Promise.resolve("ok"),
      };
      return canal;
    },
    removeChannel: () => Promise.resolve("ok"),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "ped-t0-local";
const ORDER = "ORD01T0LOCALAPROVADA";
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
const APROVADO = "Pagamento aprovado! Confirmando seu pedido…";
const AVISO_DEMORA = "pode levar alguns minutos";
const CONFIRMADO = "Pagamento Confirmado!";

function instalarSdkFalso() {
  const create = vi.fn(
    async (_brick: string, _container: string, _config: any) => ({
      unmount: vi.fn(),
    }),
  );
  // @ts-expect-error stub do SDK
  globalThis.MercadoPago = vi.fn(function MercadoPagoStub() {
    return { bricks: () => ({ create }) };
  });
  return create;
}

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

describe("T0-LOCAL — cartão aprovado já no POST: a tela espera o banco, e o banco só muda quando o webhook/cron escreve", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    onNavigate.mockClear();
    chamadasDaEdge.length = 0;
    leiturasDaLinhaPeloCliente = 0;
    // O servidor aprova na hora: grava a order na vaga ANTES de responder
    // "pago", e NÃO toca `payment_status` neste cenário (a confirmação
    // imediata em segundo plano não aconteceu — GET falho, ou o isolado
    // morreu — e o webhook/cron ainda não chegaram). A tela não tem como
    // saber o motivo: é o PISO que estes testes medem.
    aoPostar = (corpo) => {
      if (corpo.metodo !== "cartao") {
        throw new Error(`chamada inesperada à edge: ${corpo.metodo}`);
      }
      linha = { ...linha, gateway_payment_id: ORDER };
      return {
        paymentId: ORDER,
        statusPagamento: "pago",
        expiraEm: PRAZO_FUTURO,
      };
    };
    // Retomada de cartão conhecido, vaga vazia: abre o formulário direto.
    linha = {
      id: PEDIDO,
      total: 120,
      status: "pending",
      payment_status: "aguardando",
      gateway_payment_id: null,
      metodo_online: "credito",
      tentativas_de_pagamento: 0,
      expires_at: PRAZO_FUTURO,
    };
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    // Relógio falso DESDE O INÍCIO: o intervalo de 10 s do CheckoutView e o
    // aviso de 60 s da tela do cartão nascem nele.
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    create = instalarSdkFalso();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    act(() => {
      raiz.unmount();
    });
    // O canal de realtime compartilhado só se desfaz 4 s depois do desmonte:
    // sem isto o próximo teste reaproveitaria o canal (e o callback) deste.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    entregaRealtime = null;
    hospedeiro.remove();
    vi.useRealTimers();
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function esvaziar(vezes = 4) {
    for (let i = 0; i < vezes; i++) await avancar(0);
  }

  /** Formulário → o cliente toca "Pagar" → o POST volta aprovado. */
  async function pagarEChegarNoAprovado(
    ate: "aprovado" | "desafio" = "aprovado",
  ) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
          retomarPedidoId={PEDIDO}
        />,
      );
    });
    await esvaziar();
    const chamada = create.mock.calls.at(-1);
    if (!chamada) throw new Error("O formulário do cartão não foi criado.");
    const { callbacks } = chamada[2];
    await act(async () => {
      callbacks.onReady();
    });
    await act(async () => {
      try {
        await callbacks.onSubmit(
          {
            token: "tok-teste",
            issuer_id: "25",
            payment_method_id: "master",
            transaction_amount: 120,
            installments: 1,
            payer: {
              email: "cliente@exemplo.com",
              identification: { type: "CPF", number: "11144477735" },
            },
          },
          { paymentTypeId: "credit_card" },
        );
      } catch {
        // O Brick recebe o relançamento; o que importa é a tela.
      }
    });
    await esvaziar();
    if (ate === "desafio") {
      expect(hospedeiro.querySelector("iframe")).not.toBeNull();
      return;
    }
    expect(hospedeiro.textContent).toContain(APROVADO);
  }

  const chamadasPorMetodo = (metodo: string) =>
    chamadasDaEdge.filter(
      (c) => c.nome === "criar-pagamento" && c.corpo.metodo === metodo,
    ).length;

  it("(a)+(b)+(c) webhook AUSENTE: depois do POST aprovado a tela chama o `verificar` ZERO vezes, o pedido segue 'aguardando' e a tela fica em 'Confirmando seu pedido…'; o aviso 'pode levar alguns minutos' só aparece aos 60 s", async () => {
    await pagarEChegarNoAprovado();

    // O POST de criação foi a ÚNICA chamada à edge até aqui.
    expect(chamadasDaEdge).toHaveLength(1);
    expect(chamadasPorMetodo("cartao")).toBe(1);
    expect(chamadasPorMetodo("verificar")).toBe(0);
    expect(hospedeiro.textContent).not.toContain(AVISO_DEMORA);

    // 59 s: ainda sem aviso; a tela segue aprovada-e-esperando.
    await avancar(59_000);
    expect(hospedeiro.textContent).toContain(APROVADO);
    expect(hospedeiro.textContent).not.toContain(AVISO_DEMORA);

    // 61 s: o aviso de demora aparece (ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS).
    await avancar(2_000);
    expect(hospedeiro.textContent).toContain(AVISO_DEMORA);
    expect(hospedeiro.textContent).toContain(APROVADO);

    // 10 minutos inteiros sem webhook nem cron: nada muda.
    await avancar(10 * 60_000);
    expect(hospedeiro.textContent).toContain(APROVADO);
    expect(hospedeiro.textContent).not.toContain(CONFIRMADO);
    expect(linha.payment_status).toBe("aguardando");

    // (a) em TODO esse tempo: nenhuma chamada ao `verificar`, nenhum 2o POST.
    expect(chamadasPorMetodo("verificar")).toBe(0);
    expect(chamadasPorMetodo("cartao")).toBe(1);
    expect(chamadasDaEdge).toHaveLength(1);
    // O que a tela FEZ foi ler o BANCO a cada 10 s (verificação periódica do
    // CheckoutView), à espera de alguém escrever 'pago'.
    expect(leiturasDaLinhaPeloCliente).toBeGreaterThanOrEqual(60);
  });

  it("(d) webhook ATRASADO (ou o cron): a tela só sai de 'Confirmando…' quando o banco passa a dizer 'pago' — pela leitura periódica de 10 s", async () => {
    await pagarEChegarNoAprovado();

    // 3 minutos de espera: nada acontece.
    await avancar(3 * 60_000);
    expect(hospedeiro.textContent).toContain(APROVADO);
    expect(chamadasPorMetodo("verificar")).toBe(0);

    // O webhook (ou o cron) escreve 'pago' no banco. Até a próxima leitura
    // periódica a tela não sabe.
    linha = { ...linha, payment_status: "pago" };
    await esvaziar();
    expect(hospedeiro.textContent).not.toContain(CONFIRMADO);

    await avancar(10_000);
    expect(hospedeiro.textContent).toContain(CONFIRMADO);
    expect(chamadasPorMetodo("verificar")).toBe(0);
    expect(chamadasDaEdge).toHaveLength(1);
  });

  it("(d) webhook ATRASADO com o realtime de pé: o evento UPDATE 'pago' troca a tela na hora, sem nenhuma chamada ao `verificar`", async () => {
    await pagarEChegarNoAprovado();
    await avancar(2 * 60_000);
    expect(hospedeiro.textContent).toContain(APROVADO);
    expect(entregaRealtime, "o CheckoutView assina o realtime").not.toBeNull();

    linha = { ...linha, payment_status: "pago" };
    await act(async () => {
      await entregaRealtime?.({
        eventType: "UPDATE",
        new: { ...linha },
        old: {},
      });
    });
    await esvaziar();

    expect(hospedeiro.textContent).toContain(CONFIRMADO);
    expect(chamadasPorMetodo("verificar")).toBe(0);
  });

  it("CONTROLE do instrumento: depois do 3DS (etapa 'Confirmando com o banco…') a MESMA tela chama o `verificar` — o contador enxerga a chamada quando ela existe", async () => {
    const URL_DO_DESAFIO =
      "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";
    aoPostar = (corpo) => {
      if (corpo.metodo === "verificar") {
        return {
          verificacao: "desafio3ds",
          paymentId: ORDER,
          desafio3ds: { url: URL_DO_DESAFIO },
          expiraEm: PRAZO_FUTURO,
        };
      }
      linha = { ...linha, gateway_payment_id: ORDER };
      return {
        paymentId: ORDER,
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
        desafio3ds: { url: URL_DO_DESAFIO },
      };
    };
    await pagarEChegarNoAprovado("desafio");
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    await esvaziar();
    expect(hospedeiro.textContent).toContain("Confirmando com o banco…");
    expect(chamadasPorMetodo("verificar")).toBe(0);

    await avancar(3_100);
    expect(chamadasPorMetodo("verificar")).toBe(1);
  });
});
