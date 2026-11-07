// @vitest-environment jsdom
//
// "Marcar como lidas" (e abrir um pedido) gravava `lida = true` em TODA linha
// não lida da cliente que existisse no banco quando o pedido de gravar
// CHEGAVA ao servidor: o aviso que nasceu durante o toque (rede lenta) e os
// avisos mais antigos que a lista de 50 nunca mostrou viravam "lidos" sem a
// cliente os ter visto. O comentário do código dizia que continuavam não
// lidos, mas isso só valia para a tela, nunca para o banco.
//
// O conserto filtra o UPDATE pelos ids que a cliente tinha na mão (em lotes
// de até 100, para a URL do pedido não estourar).
//
// POR QUE O DUBLÊ É UM BANCO EM MEMÓRIA: o mock antigo (`update: () => ...`)
// aceitava qualquer filtro e nunca aplicava nada, então só provava o estado
// local da tela. Aqui o UPDATE é APLICADO só quando o pedido "chega" (depois
// de um portão que o teste abre), respeitando `.eq`, `.in` e `.contains`, e a
// consulta respeita `.limit` — como o PostgREST de verdade.
import { act, useEffect } from "react";
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
    // Enquanto houver portão, o UPDATE "viaja": só é aplicado quando ele abre.
    portao: null as Promise<void> | null,
    // 1-based: qual UPDATE devolve erro (0 = nenhum).
    falharNoUpdateNumero: 0,
    ignorarLimite: false,
  },
}));

const toastErro = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastErro, success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIA, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

function linhasDoBanco(): Linha[] {
  return banco.linhas as Linha[];
}

function construirUpdate(patch: Record<string, unknown>) {
  const filtros: [string, unknown][] = [];
  const encadeamento: {
    eq: (coluna: string, valor: unknown) => typeof encadeamento;
    in: (coluna: string, valores: unknown[]) => typeof encadeamento;
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
    in(coluna, valores) {
      filtros.push([`${coluna} in`, valores]);
      return encadeamento;
    },
    contains(coluna, valor) {
      filtros.push([`${coluna} contains`, valor]);
      return encadeamento;
    },
  };
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  encadeamento.then = (resolve, reject) => {
    banco.updates.push({ patch, filtros: [...filtros] });
    const numero = banco.updates.length;
    const espera = banco.portao ?? Promise.resolve();
    return espera
      .then(() => {
        if (banco.falharNoUpdateNumero === numero) {
          return { error: { message: "falhou" } };
        }
        for (const linha of linhasDoBanco()) {
          const passa = filtros.every(([coluna, valor]) => {
            if (coluna === "usuario_id") return linha.usuario_id === valor;
            if (coluna === "lida") return linha.lida === valor;
            if (coluna === "id in") {
              return (valor as string[]).includes(linha.id);
            }
            if (coluna === "dados contains") {
              return (
                linha.dados !== null &&
                linha.dados.order_id ===
                  (valor as { order_id: string }).order_id
              );
            }
            return false;
          });
          if (passa) Object.assign(linha, patch);
        }
        return { error: null };
      })
      .then(resolve, reject);
  };
  return encadeamento;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const comOrdenacao = (proprias: boolean) => ({
          order: () => ({
            limit: (n: number) => {
              const doFiltro = linhasDoBanco()
                .filter((l) =>
                  proprias
                    ? l.usuario_id === USUARIA.id
                    : l.usuario_id === null,
                )
                .sort(
                  (a, b) =>
                    new Date(b.created_at).getTime() -
                    new Date(a.created_at).getTime(),
                );
              return Promise.resolve({
                data: banco.ignorarLimite ? doFiltro : doFiltro.slice(0, n),
                error: null,
              });
            },
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

function portao() {
  let abrir!: () => void;
  const promessa = new Promise<void>((resolve) => {
    abrir = resolve;
  });
  return { promessa, abrir };
}

// `indice` maior = mais antigo (a consulta ordena por created_at desc).
function aviso(
  id: string,
  opcoes: {
    indice?: number;
    pedido?: string | null;
    lida?: boolean;
    usuarioId?: string | null;
  } = {},
): Linha {
  const { indice = 0, pedido = null, lida = false } = opcoes;
  return {
    id,
    usuario_id: opcoes.usuarioId === undefined ? USUARIA.id : opcoes.usuarioId,
    titulo: `Aviso ${id}`,
    mensagem: "Seu pedido mudou",
    tipo: "info",
    lida,
    created_at: new Date(Date.now() - 60_000 - indice * 1000).toISOString(),
    acao: null,
    dados: pedido ? { order_id: pedido } : null,
  };
}

function doBanco(id: string): Linha {
  const linha = linhasDoBanco().find((l) => l.id === id);
  if (!linha) throw new Error(`linha ausente no banco: ${id}`);
  return linha;
}

describe("sino da cliente — marcar como lidas só alcança o que ela viu", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let centro: ReturnType<
    typeof import("@/contexts/NotificationContextCore").useNotificationCenter
  >;

  beforeEach(() => {
    banco.linhas = [];
    banco.updates = [];
    banco.portao = null;
    banco.falharNoUpdateNumero = 0;
    banco.ignorarLimite = false;
    toastErro.mockClear();
    localStorage.clear();
    vi.stubGlobal("BroadcastChannel", BroadcastChannelStub);
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
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { NotificationProvider } = await import(
      "@/contexts/NotificationContext"
    );
    const { useNotificationCenter } = await import(
      "@/contexts/NotificationContextCore"
    );
    function Sonda() {
      const contexto = useNotificationCenter();
      // Publicado no efeito: reatribuir variável de fora durante o render é
      // recusado pelo react-compiler.
      useEffect(() => {
        centro = contexto;
      });
      return (
        <div>
          <span data-testid="nao-lidas">
            {contexto.notifications.filter((n) => !n.read).length}
          </span>
          <span data-testid="cortada">{String(contexto.listaCortada)}</span>
        </div>
      );
    }
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <Sonda />
        </NotificationProvider>,
      );
    });
    await act(async () => {
      await esperar(30);
    });
  }

  const naoLidasNaTela = () =>
    hospedeiro.querySelector('[data-testid="nao-lidas"]')?.textContent;
  const cortadaNaTela = () =>
    hospedeiro.querySelector('[data-testid="cortada"]')?.textContent;

  it("o aviso que nasce durante o toque continua não lido NO BANCO", async () => {
    banco.linhas = [aviso("a1", { indice: 1 }), aviso("a2", { indice: 2 })];
    await montar();
    expect(naoLidasNaTela()).toBe("2");

    const viagem = portao();
    banco.portao = viagem.promessa;
    let acao: Promise<void> | undefined;
    await act(async () => {
      acao = centro.markAllAsRead();
      await esperar(0);
    });
    // O aviso novo é gravado ENQUANTO o pedido de marcar ainda viaja.
    banco.linhas.push(aviso("novo", { indice: 0 }));
    await act(async () => {
      viagem.abrir();
      await acao;
    });

    expect(doBanco("a1").lida).toBe(true);
    expect(doBanco("a2").lida).toBe(true);
    expect(doBanco("novo").lida).toBe(false);
  });

  it("não marca no banco os avisos mais antigos que a lista de 50 nunca mostrou", async () => {
    banco.linhas = Array.from({ length: 60 }, (_, i) =>
      aviso(`n${i}`, { indice: i }),
    );
    await montar();
    expect(naoLidasNaTela()).toBe("50");

    await act(async () => {
      await centro.markAllAsRead();
    });

    // Os 50 que ela viu (n0..n49) foram lidos; os 10 mais antigos, não.
    for (let i = 0; i < 50; i++) expect(doBanco(`n${i}`).lida).toBe(true);
    for (let i = 50; i < 60; i++) expect(doBanco(`n${i}`).lida).toBe(false);
  });

  it("só campanha não lida: não chama o banco, e a campanha vira lida neste aparelho", async () => {
    banco.linhas = [
      aviso("camp", { usuarioId: null, indice: 0 }),
      aviso("propria-lida", { lida: true, indice: 1 }),
    ];
    await montar();
    expect(naoLidasNaTela()).toBe("1");

    await act(async () => {
      await centro.markAllAsRead();
    });

    expect(banco.updates).toHaveLength(0);
    expect(naoLidasNaTela()).toBe("0");
  });

  it("lista grande: o UPDATE sai em lotes de até 100 ids, e nenhum aviso fica de fora", async () => {
    banco.ignorarLimite = true;
    banco.linhas = Array.from({ length: 230 }, (_, i) =>
      aviso(`n${i}`, { indice: i }),
    );
    await montar();

    await act(async () => {
      await centro.markAllAsRead();
    });

    expect(banco.updates).toHaveLength(3);
    const vistos = new Set<string>();
    for (const u of banco.updates) {
      const ids = u.filtros.find(([c]) => c === "id in")?.[1] as string[];
      expect(ids.length).toBeLessThanOrEqual(100);
      for (const id of ids) vistos.add(id);
    }
    expect(vistos.size).toBe(230);
    expect(linhasDoBanco().every((l) => l.lida)).toBe(true);
    expect(naoLidasNaTela()).toBe("0");
  });

  it("lote que falha: avisa a cliente e a tela NÃO finge que marcou tudo", async () => {
    banco.ignorarLimite = true;
    banco.linhas = Array.from({ length: 230 }, (_, i) =>
      aviso(`n${i}`, { indice: i }),
    );
    await montar();
    banco.falharNoUpdateNumero = 2;

    await act(async () => {
      await centro.markAllAsRead();
    });

    expect(toastErro).toHaveBeenCalledTimes(1);
    // O primeiro lote chegou a gravar; o terceiro nem foi tentado.
    expect(banco.updates).toHaveLength(2);
    expect(naoLidasNaTela()).toBe("230");
  });

  it("abrir o pedido: o aviso do MESMO pedido que chega durante o UPDATE continua não lido no banco", async () => {
    banco.linhas = [
      aviso("a1", { pedido: "pedido-A", indice: 1 }),
      aviso("a2", { pedido: "pedido-A", indice: 2 }),
      aviso("b1", { pedido: "pedido-B", indice: 3 }),
    ];
    await montar();

    const viagem = portao();
    banco.portao = viagem.promessa;
    let acao: Promise<void> | undefined;
    await act(async () => {
      acao = centro.markOrderAsRead?.("pedido-A");
      await esperar(0);
    });
    banco.linhas.push(aviso("a3", { pedido: "pedido-A", indice: 0 }));
    await act(async () => {
      viagem.abrir();
      await acao;
    });

    expect(doBanco("a1").lida).toBe(true);
    expect(doBanco("a2").lida).toBe(true);
    expect(doBanco("a3").lida).toBe(false);
    expect(doBanco("b1").lida).toBe(false);
  });

  it("a lista avisa que foi cortada só quando veio cheia (50)", async () => {
    banco.linhas = Array.from({ length: 50 }, (_, i) =>
      aviso(`n${i}`, { indice: i }),
    );
    await montar();
    expect(cortadaNaTela()).toBe("true");

    banco.linhas = Array.from({ length: 49 }, (_, i) =>
      aviso(`m${i}`, { indice: i }),
    );
    await act(async () => {
      await centro.refresh();
    });
    expect(cortadaNaTela()).toBe("false");
  });
});
