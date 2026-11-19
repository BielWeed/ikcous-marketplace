// @vitest-environment jsdom
// Filtro de pagamento "aguardando" ligado: um pedido que passa a "pago" em
// tempo real sumia da página (corte no front) mas o total, o "1–12 de 15" e o
// CSV ficavam como antes, e o próximo pedido não entrava na vaga. A lista
// precisa ser relida (mesmo debounce do caso "pago" que entra) quando um
// pedido deixa o filtro de pagamento, inclusive em outra página.
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { useOrders } from "@/hooks/useOrders";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let evento: ((payload: unknown) => Promise<void>) | undefined;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, handler: typeof evento) => {
          evento = handler;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-filtro-pago" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, payment_status = "pago", status = "pending") {
  return {
    id,
    payment_status,
    status,
    customer_name: "Cliente Teste",
    canal: "online",
    created_at: "2026-10-16T10:00:00Z",
    updated_at: "2026-10-16T11:00:00Z",
    items: [],
  };
}

const itensPorPagina = 12;
const diaDaLoja = {
  inicio: "2026-10-16T00:00:00.000-03:00",
  fim: "2026-10-16T23:59:59.999-03:00",
};
const primeiraPagina = () =>
  Array.from({ length: itensPorPagina }, (_, i) =>
    linha(`pedido-${i + 1}`, "aguardando"),
  );

let atuais: ReturnType<typeof useOrders>;
let linhas: ReturnType<typeof linha>[];
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return (
    <PaginacaoAdmin
      pagina={0}
      totalPaginas={Math.ceil(retorno.totalOrders / itensPorPagina)}
      totalItens={retorno.totalOrders}
      itensPorPagina={itensPorPagina}
      aoMudar={() => {}}
    />
  );
}

async function emitir(
  nova: Partial<ReturnType<typeof linha>> & { id: string },
  anterior: Partial<ReturnType<typeof linha>> = {},
) {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({ eventType: "UPDATE", new: nova, old: anterior });
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Pedidos — com filtro de pagamento ligado, quem muda de pagamento sai da lista e o total acompanha", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    evento = undefined;
    linhas = [];
    rpc.mockReset();
    rpc.mockImplementation(
      (nome: string, args: { p_page: number; p_page_size: number }) => {
        if (nome !== "get_admin_orders_paged") {
          throw new Error(`RPC inesperada: ${nome}`);
        }
        const inicio = args.p_page * args.p_page_size;
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: linhas.slice(inicio, inicio + args.p_page_size),
                total_count: linhas.length,
              },
              error: null,
            }),
        };
      },
    );
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      // Libera o canal compartilhado antes do próximo teste.
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function carregar(
    status = "all",
    pagamento = "pago",
    recorte: { inicio?: string; fim?: string; canal?: string } = {},
  ) {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(
        0,
        itensPorPagina,
        status,
        "",
        recorte.inicio,
        recorte.fim,
        false,
        pagamento,
        recorte.canal,
      );
    });
    rpc.mockClear();
  }

  it("filtro 'aguardando': pedido da lista passa a 'pago' -> relê a lista uma vez e o total acompanha", async () => {
    linhas = [
      linha("sai-do-filtro", "aguardando"),
      linha("fica", "aguardando"),
    ];
    await carregar("all", "aguardando");
    expect(atuais.orders.map((p) => p.id)).toEqual(["sai-do-filtro", "fica"]);
    expect(atuais.totalOrders).toBe(2);

    // O servidor, agora, só devolve quem segue aguardando.
    linhas = [linha("fica", "aguardando")];
    await emitir(
      linha("sai-do-filtro", "pago"),
      linha("sai-do-filtro", "aguardando"),
    );
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_admin_orders_paged",
      expect.objectContaining({
        p_status: "all",
        p_payment_status: "aguardando",
      }),
    );
    expect(atuais.orders.map((p) => p.id)).toEqual(["fica"]);
    expect(atuais.totalOrders).toBe(1);
  });

  it("vale também sem a imagem anterior da linha (evento só com a versão nova)", async () => {
    linhas = [linha("sai-do-filtro", "aguardando")];
    await carregar("all", "aguardando");
    linhas = [];
    await emitir(linha("sai-do-filtro", "pago"));
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(atuais.totalOrders).toBe(0);
  });

  it("não relê quando o pedido segue no filtro (mudou só o status do pedido)", async () => {
    linhas = [linha("fica", "aguardando")];
    await carregar("all", "aguardando");
    await emitir(
      linha("fica", "aguardando", "processing"),
      linha("fica", "aguardando", "pending"),
    );
    await emitir(linha("fica", "aguardando", "processing"));
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["all", true],
    ["all", false],
    ["open", true],
    ["open", false],
  ] as const)(
    "status %s: pagamento do 13º pedido tira a segunda página (com estado anterior: %s)",
    async (status, comPagamentoAnterior) => {
      const decimoTerceiro = {
        ...linha("outra-pagina", "aguardando"),
        // Ainda é dia 16 na loja, embora a data em UTC seja dia 17.
        created_at: "2026-10-17T02:30:00Z",
      };
      linhas = [...primeiraPagina(), decimoTerceiro];
      await carregar(status, "aguardando", { ...diaDaLoja, canal: "online" });
      expect(atuais.orders).toHaveLength(12);
      expect(atuais.orders.some((p) => p.id === decimoTerceiro.id)).toBe(false);
      expect(atuais.totalOrders).toBe(13);
      expect(host.textContent).toContain("Exibindo 1 - 12 de 13");
      expect(host.textContent).toContain("Próximo");

      linhas = primeiraPagina();
      await emitir(
        { ...decimoTerceiro, payment_status: "pago" },
        comPagamentoAnterior ? decimoTerceiro : { id: decimoTerceiro.id },
      );
      await avancar(399);
      expect(rpc).not.toHaveBeenCalled();
      await avancar(1);
      expect(atuais.totalOrders).toBe(12);
      expect(host.textContent).toContain("Exibindo 1 - 12 de 12");
      expect(host.textContent).not.toContain("Próximo");
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        "get_admin_orders_paged",
        expect.objectContaining({
          p_page: 0,
          p_status: status,
          p_payment_status: "aguardando",
          p_start_date: diaDaLoja.inicio,
          p_end_date: diaDaLoja.fim,
          p_canal: "online",
        }),
      );
    },
  );

  it("não relê quando um pedido de fora nunca pertenceu ao filtro, mesmo havendo outra página", async () => {
    linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
    await carregar("all", "aguardando");
    await emitir(linha("de-fora", "pago"), linha("de-fora", "recusado"));
    await emitir(
      linha("de-fora", "pago", "processing"),
      linha("de-fora", "pago"),
    );
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
    expect(atuais.totalOrders).toBe(13);
  });

  it.each(["2026-09-16T10:00:00Z", "2026-10-17T03:00:00Z"])(
    "não relê se o PIX confirmado é de um pedido criado fora do período (%s)",
    async (created_at) => {
      linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
      await carregar("all", "aguardando", diaDaLoja);

      const pedidoDeFora = { ...linha("de-fora", "aguardando"), created_at };
      await emitir({ ...pedidoDeFora, payment_status: "pago" }, pedidoDeFora);
      await avancar(400);
      expect(rpc).not.toHaveBeenCalled();
      expect(atuais.totalOrders).toBe(13);
    },
  );

  it("old vazio: não relê por novo rastreio de pedido já pago e fora do período", async () => {
    linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
    await carregar("all", "aguardando", diaDaLoja);

    const pedidoDeFora = {
      ...linha("de-fora", "pago"),
      created_at: "2026-09-16T10:00:00Z",
      tracking_code: "RASTREIO-NOVO",
    };
    await emitir(pedidoDeFora);
    await avancar(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(atuais.totalOrders).toBe(13);
  });

  it("não relê os pedidos online quando o pagamento muda em outro canal", async () => {
    linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
    await carregar("all", "aguardando", { ...diaDaLoja, canal: "online" });

    const pedidoDeFora = {
      ...linha("balcao", "aguardando"),
      canal: "presencial",
    };
    await emitir({ ...pedidoDeFora, payment_status: "pago" }, pedidoDeFora);
    await avancar(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(atuais.totalOrders).toBe(13);
  });

  it.each([
    { recorte: "período", created_at: "2026-10-15T10:00:00Z" },
    { recorte: "canal", canal: "presencial" },
  ])("Em aberto: PIX confirmado fora do $recorte não relê", async (caso) => {
    linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
    await carregar("open", "aguardando", { ...diaDaLoja, canal: "online" });

    const pedidoDeFora = {
      ...linha("de-fora", "aguardando"),
      created_at: caso.created_at ?? "2026-10-16T10:00:00Z",
      canal: caso.canal ?? "online",
    };
    // Continua pendente. O ramo de status sozinho já provocava a releitura.
    await emitir({ ...pedidoDeFora, payment_status: "pago" }, pedidoDeFora);
    await avancar(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(atuais.totalOrders).toBe(13);
  });

  it.each([undefined, "data-ilegível"])(
    "relê se a data de criação não é confiável (%s) e falta o canal",
    async (created_at) => {
      linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
      await carregar("all", "aguardando", { ...diaDaLoja, canal: "online" });

      linhas = primeiraPagina();
      await emitir({ id: "outra-pagina", payment_status: "pago", created_at });
      await avancar(400);
      expect(atuais.totalOrders).toBe(12);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("não relê quando o pedido já estava finalizado, fora de Em aberto", async () => {
    linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
    await carregar("open", "aguardando");

    const finalizado = linha("de-fora", "aguardando", "delivered");
    await emitir({ ...finalizado, payment_status: "pago" }, finalizado);
    await avancar(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não relê por evento que não traz o novo estado do pagamento", async () => {
    linhas = [...primeiraPagina(), linha("outra-pagina", "aguardando")];
    await carregar("all", "aguardando");

    await emitir({ id: "outra-pagina", status: "processing" });
    await avancar(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("corrige o total quando o pagamento chega durante uma leitura que ainda pode trazer outra página", async () => {
    linhas = primeiraPagina();
    await carregar("all", "aguardando");
    expect(atuais.totalOrders).toBe(12);

    const respostaAntiga = {
      data: { data: linhas, total_count: 13 },
      error: null,
    };
    let responder = () => {};
    const emVoo = new Promise<typeof respostaAntiga>((resolve) => {
      responder = () => resolve(respostaAntiga);
    });
    rpc.mockImplementationOnce(() => ({ abortSignal: () => emVoo }));
    await act(async () => {
      void atuais.loadOrders(
        0,
        itensPorPagina,
        "all",
        "",
        undefined,
        undefined,
        false,
        "aguardando",
      );
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockClear();

    await emitir(linha("outra-pagina", "pago"));
    await act(async () => {
      responder();
      await emVoo;
    });
    expect(atuais.totalOrders).toBe(13);
    await avancar(400);
    expect(atuais.totalOrders).toBe(12);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("sem o pagamento anterior, não relê por pedido de fora se todos os resultados já estão na página", async () => {
    linhas = primeiraPagina();
    await carregar("all", "aguardando");
    expect(atuais.orders).toHaveLength(12);
    expect(atuais.totalOrders).toBe(12);
    await emitir(linha("de-fora", "pago"), { id: "de-fora" });
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem filtro de pagamento, mudar o pagamento não relê (a lista inteira continua valendo)", async () => {
    linhas = [linha("a", "aguardando")];
    await carregar("all", "all");
    await emitir(linha("a", "pago"), linha("a", "aguardando"));
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });
});
