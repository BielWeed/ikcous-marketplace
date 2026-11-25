// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), `usePainelInicio` (os números do Início:
// retentativa, "uma busca por vez" e tempo real). Os nove testes vizinhos
// provam o fluxo; ficavam soltos os NÚMEROS e alguns encadeamentos (defeitos
// de UMA linha):
//  - a abertura sai 200 ms depois de a tela ficar ativa (nem antes, nem
//    depois), e uma rajada de eventos de pedido vira UMA recarga após 1,5 s;
//  - o retrato vale 30 s: aos 29,999 s voltar à tela NÃO busca; aos 30 s busca;
//  - aquecer (prefetch) com retrato fresco não busca de novo;
//  - busca que saiu antes de a lojista sair do Início e voltar não é reaproveitada
//    (entra uma busca nova depois dela); e o pedido de recarga forçada feito
//    com uma busca em voo não herda o pedido anterior já atendido;
//  - a assinatura lida antes continua na tela se a leitura nova dela falha;
//  - depois da queda do canal, a releitura é SILENCIOSA (falha não vira faixa
//    vermelha) e "Ao vivo" só volta quando a leitura da queda ATUAL termina;
//  - "chegou pedido com a tela escondida" vale uma recarga só: a marca é
//    zerada quando a tela volta;
//  - tela inativa não finge "carregando"; a assinatura de ontem não some junto
//    com os números de ontem; fechar a tela larga o canal em tempo real.
// Dados inventados; nenhuma chamada de rede.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Estado {
  painel: unknown;
  assinatura: unknown;
  erro: string | null;
  erroAssinatura: string | null;
  releituraFalhou: boolean;
  desatualizado: boolean;
  carregando: boolean;
  atualizar: () => Promise<void>;
}

const h = vi.hoisted(() => ({
  chamadasPainel: 0,
  instantes: [] as number[],
  portoes: [] as Array<Promise<void>>,
  respostaPainel: undefined as undefined | { data: unknown; error: unknown },
  respostaAssinatura: undefined as
    | undefined
    | { data: unknown; error: unknown },
  status: null as ((status: string) => void) | null,
  evento: null as (() => void) | null,
  canal: null as unknown,
  removeChannel: vi.fn(),
  estado: null as unknown,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "admin-fixture" } } }),
}));
vi.mock("@/lib/crm", () => ({
  lerPainelInicio: (d: unknown) => d,
  lerAssinaturaDaLoja: (d: unknown) => d,
  mensagemDeErroDoPainel: () => "Falha de leitura",
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome === "painel_inicio") {
        h.chamadasPainel += 1;
        h.instantes.push(Date.now());
        const portao = h.portoes.shift() ?? Promise.resolve();
        const numero = h.chamadasPainel;
        return portao.then(
          () => h.respostaPainel ?? { data: { total: numero }, error: null },
        );
      }
      return Promise.resolve(
        h.respostaAssinatura ?? { data: { plano: "Plano A" }, error: null },
      );
    },
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, evento: () => void) => {
          h.evento = evento;
          return canal;
        },
        subscribe: (status: (status: string) => void) => {
          h.status = status;
          return canal;
        },
      };
      h.canal = canal;
      return canal;
    },
    removeChannel: (...args: unknown[]) => h.removeChannel(...args),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const estado = () => h.estado as Estado;

describe("usePainelInicio: buracos de mutação", () => {
  let raiz: Root;
  let div: HTMLDivElement;
  let prefetchPainelInicio: () => void;
  let Sonda: (props: { ativo: boolean }) => null;

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  async function emitir(status: string) {
    await act(async () => h.status?.(status));
  }
  async function montar(ativo = true) {
    await act(async () => raiz.render(<Sonda ativo={ativo} />));
  }
  async function fechar(deferida: () => void) {
    await act(async () => {
      deferida();
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  function definirVisibilidade(valor: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: valor,
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T15:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.chamadasPainel = 0;
    h.instantes = [];
    h.portoes = [];
    h.respostaPainel = undefined;
    h.respostaAssinatura = undefined;
    h.status = null;
    h.evento = null;
    h.canal = null;
    h.removeChannel.mockReset();
    h.estado = null;
    definirVisibilidade("visible");
    div = document.createElement("div");
    document.body.appendChild(div);
    raiz = createRoot(div);
    const modulo = await import("@/hooks/usePainelInicio");
    prefetchPainelInicio = modulo.prefetchPainelInicio;
    Sonda = function SondaDoPainel({ ativo }: { ativo: boolean }) {
      const atual = modulo.usePainelInicio(ativo);
      useEffect(() => {
        h.estado = atual;
      });
      return null;
    };
  });

  afterEach(() => {
    act(() => raiz.unmount());
    div.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("os números de tempo", () => {
    it("a abertura sai aos 200 ms: nem 1 ms antes", async () => {
      await montar();
      await passar(199);
      expect(h.chamadasPainel).toBe(0);
      await passar(1);
      expect(h.chamadasPainel).toBe(1);
    });

    it("fechar a tela antes dos 200 ms cancela a abertura: nada é buscado depois", async () => {
      await montar();
      await passar(100);
      await act(async () => raiz.unmount());
      raiz = createRoot(div);
      await passar(1000);
      expect(h.chamadasPainel).toBe(0);
    });

    it("pedido novo vira UMA recarga aos 1,5 s: nem 1 ms antes", async () => {
      await montar();
      await passar(250);
      expect(h.chamadasPainel).toBe(1);

      await act(async () => h.evento?.());
      await passar(1499);
      expect(h.chamadasPainel).toBe(1);
      await passar(1);
      expect(h.chamadasPainel).toBe(2);
    });

    it("o retrato vale 30 s: aos 29,999 s voltar à tela não busca; aos 30 s busca", async () => {
      await montar();
      await passar(250);
      expect(h.chamadasPainel).toBe(1);
      const lidoEm = h.instantes[0];

      vi.setSystemTime(lidoEm + 29_999);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(h.chamadasPainel).toBe(1);

      vi.setSystemTime(lidoEm + 30_000);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(h.chamadasPainel).toBe(2);
    });

    it("aquecer com o retrato fresco não busca de novo", async () => {
      await montar();
      await passar(250);
      expect(h.chamadasPainel).toBe(1);

      await act(async () => {
        prefetchPainelInicio();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(h.chamadasPainel).toBe(1);
    });
  });

  describe("uma busca por vez", () => {
    it("busca que saiu antes de a lojista sair do Início e voltar não é reaproveitada: entra uma nova depois", async () => {
      let soltar!: () => void;
      h.portoes = [
        new Promise<void>((resolve) => {
          soltar = resolve;
        }),
      ];
      await montar(true);
      await passar(250);
      expect(h.chamadasPainel).toBe(1);

      // Sai do Início e volta: a geração do painel mudou.
      await montar(false);
      await montar(true);
      await passar(250);
      expect(h.chamadasPainel).toBe(1);

      await fechar(soltar);
      expect(h.chamadasPainel).toBe(2);
    });

    it("recarga forçada feita com uma busca em voo não herda o pedido anterior já atendido", async () => {
      let soltar1!: () => void;
      let soltar2!: () => void;
      h.portoes = [
        new Promise<void>((resolve) => {
          soltar1 = resolve;
        }),
        new Promise<void>((resolve) => {
          soltar2 = resolve;
        }),
      ];
      await montar(true);
      await passar(250);
      expect(h.chamadasPainel).toBe(1);

      // A: forçada com a busca 1 em voo -> entra UMA busca depois dela.
      act(() => {
        void estado().atualizar();
      });
      await fechar(soltar1);
      expect(h.chamadasPainel).toBe(2);

      // B: forçada com a busca 2 em voo -> precisa de uma 3ª, não da fila de A.
      act(() => {
        void estado().atualizar();
      });
      await fechar(soltar2);
      expect(h.chamadasPainel).toBe(3);
    });
  });

  describe("assinatura", () => {
    it("leitura nova da assinatura falha: a anterior continua na tela, com o erro dela", async () => {
      await montar();
      await passar(250);
      expect(estado().assinatura).toEqual({ plano: "Plano A" });

      h.respostaAssinatura = { data: null, error: { message: "falha" } };
      await act(async () => {
        await estado().atualizar();
      });

      expect(estado().assinatura).toEqual({ plano: "Plano A" });
      expect(estado().erroAssinatura).toBe("Falha de leitura");
    });

    it("no dia seguinte, enquanto a recarga não chega: os números de ontem somem, a assinatura não", async () => {
      await montar();
      await passar(250);
      expect(estado().painel).not.toBeNull();

      vi.setSystemTime(new Date("2026-11-26T15:00:00Z"));
      await montar(false);

      expect(estado().painel).toBeNull();
      expect(estado().assinatura).toEqual({ plano: "Plano A" });
    });
  });

  describe("canal em tempo real", () => {
    it("depois da queda, a releitura é silenciosa: falha mantém os números, sem faixa vermelha", async () => {
      await montar();
      await passar(250);
      await emitir("SUBSCRIBED");
      await passar(1600);
      expect(h.chamadasPainel).toBe(2);
      const numeros = estado().painel;

      await emitir("CLOSED");
      h.respostaPainel = { data: null, error: { message: "sem rede" } };
      await emitir("SUBSCRIBED");
      await passar(1600);

      expect(h.chamadasPainel).toBe(3);
      expect(estado().erro).toBeNull();
      expect(estado().releituraFalhou).toBe(true);
      expect(estado().painel).toBe(numeros);
    });

    it("duas quedas seguidas: 'Ao vivo' só volta quando termina a leitura da queda ATUAL", async () => {
      await montar();
      await passar(250);
      await emitir("SUBSCRIBED");
      await passar(1600);
      expect(estado().desatualizado).toBe(false);

      let soltar!: () => void;
      h.portoes = [
        new Promise<void>((resolve) => {
          soltar = resolve;
        }),
      ];
      await emitir("CLOSED");
      await emitir("SUBSCRIBED");
      await passar(1500);
      // A leitura da primeira queda saiu e está esperando a resposta.
      expect(h.chamadasPainel).toBe(3);

      // Cai de novo e reconecta antes de ela voltar.
      await emitir("CLOSED");
      await emitir("SUBSCRIBED");
      await fechar(soltar);

      expect(estado().desatualizado).toBe(true);
    });

    it("pedido com a tela escondida vale UMA recarga: ao voltar de novo sem pedido, não recarrega", async () => {
      await montar();
      await passar(250);
      expect(h.chamadasPainel).toBe(1);

      definirVisibilidade("hidden");
      await act(async () => h.evento?.());
      await passar(2000);
      expect(h.chamadasPainel).toBe(1);

      definirVisibilidade("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await passar(1600);
      expect(h.chamadasPainel).toBe(2);

      // Esconde e volta sem nenhum pedido novo: o retrato é fresco.
      definirVisibilidade("hidden");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      definirVisibilidade("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await passar(1600);
      expect(h.chamadasPainel).toBe(2);
    });

    it("fechar a tela larga o canal em tempo real", async () => {
      await montar();
      await passar(250);
      expect(h.canal).not.toBeNull();
      expect(h.removeChannel).not.toHaveBeenCalled();

      await act(async () => raiz.unmount());
      raiz = createRoot(div);

      expect(h.removeChannel).toHaveBeenCalledWith(h.canal);
    });
  });

  describe("tela inativa", () => {
    it("não finge 'carregando' quem nem está ativo", async () => {
      await montar(false);
      expect(estado().carregando).toBe(false);
      expect(h.chamadasPainel).toBe(0);
    });
  });
});
