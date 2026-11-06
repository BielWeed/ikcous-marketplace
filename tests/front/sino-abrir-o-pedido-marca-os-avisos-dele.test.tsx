// @vitest-environment jsdom
//
// Abrir o pedido pelo aviso do celular (ou por "Meus pedidos") deixava o aviso
// DAQUELE pedido não lido no sino: a bolinha do topo só crescia, a cada mudança
// de status. A única porta de leitura era a tela de Notificações.
//
// O conserto: a tela do pedido (hook `useMarcarAvisosDoPedidoComoLidos`, usado
// por OrderDetailsView) marca como lidos os avisos próprios e não lidos daquele
// pedido, num UPDATE só (`markOrderAsRead` do contexto).
//
// Os CONTROLES estão aqui de propósito: sem eles, "marca tudo sempre" também
// passaria no caso feliz.
//   - aviso de OUTRO pedido não é marcado;
//   - pedido sem aviso não chama o banco;
//   - aviso já lido não chama o banco de novo;
//   - sem conta e sem internet não chama o banco;
//   - UPDATE que falha não vira laço de tentativas nem toast (ninguém tocou
//     em nada: a marcação é automática).
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USUARIA = { id: "cliente-1" };

interface Linha {
  id: string;
  usuario_id: string | null;
  titulo: string;
  mensagem: string;
  tipo: string;
  lida: boolean;
  created_at: string;
  acao: null;
  dados: { order_id: string } | null;
}

const { banco } = vi.hoisted(() => ({
  banco: {
    linhas: [] as unknown[],
    updates: [] as { patch: unknown; filtros: [string, unknown][] }[],
    falharUpdate: false,
  },
}));

const toastErro = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastErro, success: vi.fn() } }));

let usuarioLogado: { id: string } | null = USUARIA;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioLogado, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

function linhasDoBanco(): Linha[] {
  return banco.linhas as Linha[];
}

// Query builder de UPDATE que espelha a RLS (usuario_id = auth.uid()) e o
// filtro jsonb `contains`. Registra cada chamada para o teste contar.
function construirUpdate(patch: Record<string, unknown>) {
  const filtros: [string, unknown][] = [];
  let contido: Record<string, unknown> | null = null;
  const encadeamento: {
    eq: (coluna: string, valor: unknown) => typeof encadeamento;
    contains: (
      coluna: string,
      valor: Record<string, unknown>,
    ) => typeof encadeamento;
    then?: (
      resolve: (v: { error: unknown }) => void,
      reject?: (e: unknown) => void,
    ) => Promise<void>;
  } = {
    eq(coluna, valor) {
      filtros.push([coluna, valor]);
      return encadeamento;
    },
    contains(coluna, valor) {
      filtros.push([coluna, valor]);
      contido = valor;
      return encadeamento;
    },
  };
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  encadeamento.then = (resolve, reject) => {
    banco.updates.push({ patch, filtros: [...filtros] });
    if (banco.falharUpdate) {
      return Promise.resolve({ error: { message: "falhou" } }).then(
        resolve,
        reject,
      );
    }
    for (const linha of linhasDoBanco()) {
      const passa = filtros.every(([coluna, valor]) => {
        if (coluna === "usuario_id") return linha.usuario_id === valor;
        if (coluna === "lida") return linha.lida === valor;
        if (coluna === "dados") {
          return (
            contido !== null &&
            linha.dados !== null &&
            linha.dados.order_id === contido.order_id
          );
        }
        return false;
      });
      if (passa) Object.assign(linha, patch);
    }
    return Promise.resolve({ error: null }).then(resolve, reject);
  };
  return encadeamento;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const comOrdenacao = (proprias: boolean) => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: linhasDoBanco().filter((l) =>
                  proprias
                    ? l.usuario_id === USUARIA.id
                    : l.usuario_id === null,
                ),
                error: null,
              }),
          }),
        });
        return {
          eq: () => comOrdenacao(true),
          is: () => comOrdenacao(false),
        };
      },
      update: (patch: Record<string, unknown>) => construirUpdate(patch),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class BroadcastChannelStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aviso(
  id: string,
  pedido: string | null,
  lida = false,
  usuarioId: string | null = USUARIA.id,
): Linha {
  return {
    id,
    usuario_id: usuarioId,
    titulo: `Aviso ${id}`,
    mensagem: "Seu pedido mudou",
    tipo: "info",
    lida,
    created_at: new Date().toISOString(),
    acao: null,
    dados: pedido ? { order_id: pedido } : null,
  };
}

describe("sino da cliente — abrir o pedido marca os avisos DELE como lidos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    usuarioLogado = USUARIA;
    banco.updates = [];
    banco.falharUpdate = false;
    toastErro.mockClear();
    vi.stubGlobal("BroadcastChannel", BroadcastChannelStub);
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    // biome-ignore lint/performance/noDelete: restaura o getter do protótipo
    delete (navigator as unknown as Record<string, unknown>).onLine;
  });

  async function montar(pedidoAberto: string) {
    const { NotificationProvider } = await import(
      "@/contexts/NotificationContext"
    );
    const { useNotificationCenter } = await import(
      "@/contexts/NotificationContextCore"
    );
    const { useMarcarAvisosDoPedidoComoLidos } = await import(
      "@/hooks/useMarcarAvisosDoPedidoComoLidos"
    );
    function TelaDoPedido() {
      useMarcarAvisosDoPedidoComoLidos(pedidoAberto);
      const { notifications, unreadCount } = useNotificationCenter();
      return (
        <div>
          <span data-testid="nao-lidas">{unreadCount}</span>
          {notifications.map((n) => (
            <i key={n.id} data-testid={`aviso-${n.id}`} data-lida={n.read} />
          ))}
        </div>
      );
    }
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <TelaDoPedido />
        </NotificationProvider>,
      );
    });
    await act(async () => {
      await esperar(30);
    });
  }

  const lida = (id: string) =>
    hospedeiro
      .querySelector(`[data-testid="aviso-${id}"]`)
      ?.getAttribute("data-lida");
  const naoLidas = () =>
    hospedeiro.querySelector('[data-testid="nao-lidas"]')?.textContent;

  it("marca os avisos não lidos do pedido aberto, em UM update, e deixa os de outro pedido", async () => {
    banco.linhas = [
      aviso("a1", "pedido-A"),
      aviso("a2", "pedido-A"),
      aviso("b1", "pedido-B"),
      aviso("avulso", null),
    ];
    await montar("pedido-A");

    expect(lida("a1")).toBe("true");
    expect(lida("a2")).toBe("true");
    // Controle: o aviso de OUTRO pedido e o aviso sem pedido seguem não lidos.
    expect(lida("b1")).toBe("false");
    expect(lida("avulso")).toBe("false");
    expect(naoLidas()).toBe("2");

    // Sem chamada em laço: um UPDATE só, amarrado à dona e ao pedido.
    expect(banco.updates).toHaveLength(1);
    expect(banco.updates[0].filtros).toEqual([
      ["usuario_id", "cliente-1"],
      ["lida", false],
      ["dados", { order_id: "pedido-A" }],
    ]);
    // E no banco, não só na tela.
    const noBanco = (id: string) =>
      linhasDoBanco().find((l) => l.id === id)?.lida;
    expect(noBanco("a1")).toBe(true);
    expect(noBanco("a2")).toBe(true);
    expect(noBanco("b1")).toBe(false);
  });

  it("controle: pedido sem aviso nenhum não chama o banco", async () => {
    banco.linhas = [aviso("b1", "pedido-B")];
    await montar("pedido-C");

    expect(banco.updates).toHaveLength(0);
    expect(lida("b1")).toBe("false");
    expect(naoLidas()).toBe("1");
  });

  it("controle: aviso do pedido que já está lido não chama o banco de novo", async () => {
    banco.linhas = [aviso("a1", "pedido-A", true), aviso("b1", "pedido-B")];
    await montar("pedido-A");

    expect(banco.updates).toHaveLength(0);
    expect(naoLidas()).toBe("1");
  });

  it("controle: sem internet não chama o banco, e o aviso segue não lido", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    banco.linhas = [aviso("a1", "pedido-A")];
    await montar("pedido-A");

    expect(banco.updates).toHaveLength(0);
    expect(lida("a1")).toBe("false");
  });

  it("controle: sem conta não chama o banco", async () => {
    usuarioLogado = null;
    banco.linhas = [aviso("a1", "pedido-A")];
    await montar("pedido-A");

    expect(banco.updates).toHaveLength(0);
  });

  // A tela do pedido é pesada demais para montar aqui: este caso só segura a
  // ligação (o hook acima é quem tem o comportamento, e está medido).
  it("a tela do pedido (OrderDetailsView) usa o hook com o id do pedido aberto", () => {
    const fonte = readFileSync(
      "src/views/customer/OrderDetailsView.tsx",
      "utf8",
    );
    expect(fonte).toContain("useMarcarAvisosDoPedidoComoLidos(orderId);");
  });

  it("UPDATE que falha: uma tentativa só, sem toast, e o aviso segue não lido", async () => {
    banco.falharUpdate = true;
    banco.linhas = [aviso("a1", "pedido-A")];
    await montar("pedido-A");
    // Tempo de sobra para um eventual laço de tentativas aparecer.
    await act(async () => {
      await esperar(60);
    });

    expect(banco.updates).toHaveLength(1);
    expect(toastErro).not.toHaveBeenCalled();
    expect(lida("a1")).toBe("false");
  });
});
