import { rotuloDoStatusParaACliente } from "@/lib/mensagem-do-status-no-whatsapp";
// @vitest-environment jsdom
//
// A lojista muda o status de um pedido SEM internet ("Saiu para entrega",
// "Pronto para retirar", "Entregue", cancelar): o hook guarda na fila offline
// e a ficha (AdminOrdersView.handleStatusChange) sai antes do aviso, porque
// nada foi gravado ainda. Quando a internet volta, a fila grava o status —
// mas ninguém mandava o push "Seu pedido #N agora está: …" para a cliente.
//
// Agora a própria passada da fila dispara o MESMO aviso da ficha
// (`avisarOClienteDoStatus`, src/lib/aviso-de-status-ao-cliente.ts) só quando
// a gravação foi aceita pelo banco, uma vez por mudança, e mesmo com a tela de
// pedidos fechada (a passada vive no hook, não na tela).
//
// Cada teste abre uma CÓPIA nova do módulo (`vi.resetModules`), para nenhuma
// lembrança de aviso de um teste vazar para o outro.
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const servidor = vi.hoisted(() => ({
  status: "pending",
  userId: "cliente-1" as string | null,
  enderecoDeRetirada: null as string | null,
  /** Banco "degenerado" que aceita a gravação sem conferir a etapa. */
  aceitarSempre: false,
  /** Outro aparelho muda a etapa ENTRE a releitura e a gravação. */
  etapaMudaAntesDaGravacao: null as string | null,
  /** A próxima gravação falha de forma passageira (servidor 500). */
  falharProximaGravacao: false,
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  invoke: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: { user: { id: "lojista-1" }, access_token: "tk-teste" },
        },
      }),
    },
    // Releitura da etapa antes da gravação (como o banco real).
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              status: servidor.status,
              user_id: servidor.userId,
              endereco_de_retirada: servidor.enderecoDeRetirada,
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      servidor.rpcs.push({ nome, args });
      if (servidor.falharProximaGravacao) {
        servidor.falharProximaGravacao = false;
        return {
          data: null,
          error: { status: 500, message: "Internal Server Error" },
        };
      }
      if (servidor.etapaMudaAntesDaGravacao !== null) {
        servidor.status = servidor.etapaMudaAntesDaGravacao;
        servidor.etapaMudaAntesDaGravacao = null;
      }
      if (
        !servidor.aceitarSempre &&
        args.p_status_esperado !== servidor.status
      ) {
        return {
          data: null,
          error: { code: "P0001", message: "pedido_status_mudou" },
        };
      }
      servidor.status =
        nome === "cancelar_pedido_do_painel"
          ? "cancelled"
          : String(args.p_new_status);
      return { data: null, error: null };
    },
    functions: { invoke: servidor.invoke },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "sync"),
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const DONO = "lojista-1";
const CHAVE = `orders_offline_updates_queue:${DONO}`;
const PEDIDO = "0b7c2a4e-1111-4222-8333-9a8b7c6d5e4f";
// Item datado de agora: a fila descarta o que tem mais de 72 h. O MESMO carimbo
// em todas as cópias do item é o que faz delas "a mesma mudança".
const GUARDADO_EM = Date.now();

type Item = {
  orderId: string;
  status: string;
  statusEsperado?: string;
  silent?: boolean;
  timestamp?: number;
};

function guardar(...itens: Item[]) {
  localStorage.setItem(CHAVE, JSON.stringify(itens));
}

const avanco = (extra: Partial<Item> = {}): Item => ({
  orderId: PEDIDO,
  status: "shipping",
  statusEsperado: "pending",
  silent: false,
  timestamp: GUARDADO_EM,
  ...extra,
});

async function abrirAba() {
  vi.resetModules();
  const modulo = await import("@/hooks/useOrders");
  return modulo._syncOfflineOrderUpdatesParaTeste;
}

/** O aviso sai sem ser esperado pela passada (como na ficha): deixa a fila
 *  de microtarefas andar antes de afirmar que NADA saiu. */
async function deixarOAvisoSair() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

function chamadasDoPush() {
  return servidor.invoke.mock.calls.filter(([nome]) => nome === "send-push");
}

describe("fila offline de pedidos — a cliente é avisada quando a mudança sincroniza", () => {
  beforeEach(() => {
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) =>
        armazenamento.set(chave, valor),
      removeItem: (chave: string) => armazenamento.delete(chave),
      clear: () => armazenamento.clear(),
    });
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    servidor.status = "pending";
    servidor.userId = "cliente-1";
    servidor.enderecoDeRetirada = null;
    servidor.aceitarSempre = false;
    servidor.etapaMudaAntesDaGravacao = null;
    servidor.falharProximaGravacao = false;
    servidor.rpcs = [];
    servidor.invoke.mockReset();
    servidor.invoke.mockResolvedValue({
      data: { enviados: 1, total: 1 },
      error: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("avanço guardado offline grava ao reconectar e manda UM push, com o mesmo texto da ficha", async () => {
    const sincronizar = await abrirAba();
    guardar(avanco());

    expect(await sincronizar(DONO)).toBe(true);
    await vi.waitFor(() => expect(chamadasDoPush()).toHaveLength(1));

    expect(servidor.status).toBe("shipping");
    const [, opcoes] = chamadasDoPush()[0] as [
      string,
      { body: Record<string, unknown>; headers: Record<string, string> },
    ];
    expect(opcoes.body).toMatchObject({
      targetUserId: "cliente-1",
      title: "Status do Pedido Atualizado",
      body: `Seu pedido #${numeroDoPedido(PEDIDO)} agora está: ${rotuloDoStatusParaACliente("shipping", false)}`,
      url: expect.stringContaining(PEDIDO),
      data: expect.objectContaining({
        orderId: PEDIDO,
        type: "order_status",
      }),
    });
    expect(opcoes.headers).toEqual({ Authorization: "Bearer tk-teste" });
    await deixarOAvisoSair();
    expect(chamadasDoPush()).toHaveLength(1);
  });

  it("pedido de retirada: o push diz o rótulo da retirada, como a ficha", async () => {
    const sincronizar = await abrirAba();
    servidor.enderecoDeRetirada = "  Rua da Loja, 10  ";
    guardar(avanco());

    await sincronizar(DONO);
    await vi.waitFor(() => expect(chamadasDoPush()).toHaveLength(1));

    const [, opcoes] = chamadasDoPush()[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(opcoes.body.body).toBe(
      `Seu pedido #${numeroDoPedido(PEDIDO)} agora está: ${rotuloDoStatusParaACliente("shipping", true)}`,
    );
  });

  it("cancelamento guardado offline também avisa a cliente quando grava", async () => {
    const sincronizar = await abrirAba();
    guardar(avanco({ status: "cancelled", statusEsperado: "pending" }));

    await sincronizar(DONO);
    await vi.waitFor(() => expect(chamadasDoPush()).toHaveLength(1));

    expect(servidor.rpcs[0]?.nome).toBe("cancelar_pedido_do_painel");
    const [, opcoes] = chamadasDoPush()[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(opcoes.body.body).toBe(
      `Seu pedido #${numeroDoPedido(PEDIDO)} agora está: Cancelado`,
    );
  });

  it("o banco recusa porque o pedido mudou em outro aparelho: nenhum push", async () => {
    const sincronizar = await abrirAba();
    guardar(avanco());
    // A releitura vê "pending" (passa); na hora de gravar, outro aparelho já
    // cancelou: a RPC recusa com `pedido_status_mudou`.
    servidor.etapaMudaAntesDaGravacao = "cancelled";

    await sincronizar(DONO);
    await deixarOAvisoSair();

    expect(servidor.rpcs).toHaveLength(1);
    expect(servidor.status).toBe("cancelled");
    expect(chamadasDoPush()).toHaveLength(0);
  });

  it("a releitura mostra que o pedido já está em outra etapa: descarta e não avisa", async () => {
    const sincronizar = await abrirAba();
    servidor.status = "cancelled";
    guardar(avanco());

    await sincronizar(DONO);
    await deixarOAvisoSair();

    expect(servidor.rpcs).toHaveLength(0);
    expect(chamadasDoPush()).toHaveLength(0);
  });

  it("a mesma mudança drenada de novo (cópia velha da fila regravada) não avisa duas vezes", async () => {
    const sincronizar = await abrirAba();
    guardar(avanco());
    await sincronizar(DONO);
    await vi.waitFor(() => expect(chamadasDoPush()).toHaveLength(1));

    // Outra aba regrava a cópia velha da fila com o MESMO item.
    guardar(avanco());
    await sincronizar(DONO);
    await deixarOAvisoSair();

    expect(chamadasDoPush()).toHaveLength(1);
  });

  it("mesmo se o banco aceitasse a mesma mudança duas vezes, o aviso daquele item sai uma vez só", async () => {
    const sincronizar = await abrirAba();
    servidor.aceitarSempre = true;
    // Etapa esperada igual à atual nas duas passadas (a releitura não barra).
    guardar(avanco({ status: "shipping", statusEsperado: "pending" }));
    await sincronizar(DONO);
    await vi.waitFor(() => expect(chamadasDoPush()).toHaveLength(1));

    servidor.status = "pending";
    guardar(avanco({ status: "shipping", statusEsperado: "pending" }));
    await sincronizar(DONO);
    await deixarOAvisoSair();

    expect(servidor.rpcs).toHaveLength(2);
    expect(chamadasDoPush()).toHaveLength(1);
  });

  it("duas reconexões ao mesmo tempo na mesma aba: um envio, um push", async () => {
    const sincronizar = await abrirAba();
    guardar(avanco());

    await Promise.all([sincronizar(DONO), sincronizar(DONO)]);
    await vi.waitFor(() => expect(chamadasDoPush()).toHaveLength(1));
    await deixarOAvisoSair();

    expect(servidor.rpcs).toHaveLength(1);
    expect(chamadasDoPush()).toHaveLength(1);
  });

  it("mudança silenciosa não avisa (a ficha também não avisa no silencioso)", async () => {
    const sincronizar = await abrirAba();
    guardar(avanco({ silent: true }));

    await sincronizar(DONO);
    await deixarOAvisoSair();

    expect(servidor.rpcs).toHaveLength(1);
    expect(chamadasDoPush()).toHaveLength(0);
  });

  it("pedido de convidado (sem conta) grava e não manda push para ninguém", async () => {
    const sincronizar = await abrirAba();
    servidor.userId = null;
    guardar(avanco());

    await sincronizar(DONO);
    await deixarOAvisoSair();

    expect(servidor.rpcs).toHaveLength(1);
    expect(chamadasDoPush()).toHaveLength(0);
  });

  it("push que falha na passada da fila: o aviso amarelo diz de qual pedido é", async () => {
    // A passada roda em qualquer tela do painel, um aviso por item: sem o
    // número, avisos iguais se empilhavam e a lojista não sabia a quem
    // mandar WhatsApp.
    const { toast } = await import("sonner");
    vi.spyOn(console, "error").mockImplementation(() => {});
    servidor.invoke.mockRejectedValue(new Error("sem rede"));
    const sincronizar = await abrirAba();
    guardar(avanco());

    await sincronizar(DONO);
    await vi.waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Status do pedido #6D5E4F atualizado, mas o push falhou",
        expect.objectContaining({
          description: "O cliente não foi notificado da mudança.",
        }),
      ),
    );
  });

  it("falha passageira na gravação: nada de push; quando grava na próxima, um push", async () => {
    const sincronizar = await abrirAba();
    guardar(avanco());
    servidor.falharProximaGravacao = true;

    await sincronizar(DONO);
    await deixarOAvisoSair();
    expect(chamadasDoPush()).toHaveLength(0);
    expect(servidor.status).toBe("pending");

    await sincronizar(DONO);
    await vi.waitFor(() => expect(chamadasDoPush()).toHaveLength(1));
    expect(servidor.rpcs).toHaveLength(2);
    expect(servidor.status).toBe("shipping");
  });
});
