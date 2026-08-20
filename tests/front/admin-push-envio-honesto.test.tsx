// @vitest-environment jsdom
//
// Fecha os achados 8 e 11 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-config.md), que juntos formam um só
// mecanismo: o envio de push falha em silêncio para 15 dos 16 clientes
// (achado 8) e o histórico carimba "ENVIADA" mesmo quando ninguém recebeu
// (achado 11). O terceiro pedaço — "clientes" em vez de "aparelhos" no
// histórico — é o mesmo defeito do achado 12, já corrigido no resto da
// tela, mas esquecido aqui.
//
// Este arquivo é irmão de `admin-push-view-contadores.test.tsx` (mesmo
// andaime de mocks) e cobre o ENVIO e o HISTÓRICO, não os contadores de
// segmento.
//
// Sobre "cliente sem aparelho" e "segmento vazio": o botão "Enviar
// Notificação Agora" fica desabilitado quando o alcance MEDIDO
// (`predictedReach`) é zero — e React suprime o `onClick` de um botão
// `disabled`, mesmo via `dispatchEvent` (não é só o `.click()` nativo que é
// suprimido; o plugin de eventos do React também checa `target.disabled`).
// Isso é comportamento PRÉ-EXISTENTE, fora do escopo desta tarefa. Para
// exercitar o `handleSend`, os dois testes simulam a mesma corrida que
// justifica o achado 8 na prática: a tela mede o alcance uma vez
// (habilitando o botão) e o `handleSend` mede de novo, na hora do clique,
// com a `mesma RPC` — se o aparelho sumiu nesse intervalo, a medição nova
// é zero mesmo com o botão mostrando a medição antiga.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    // Segmentos usados pelos botões "Clientes Frequentes / Sem comprar há
    // 30d / Novos Clientes" — não é o que este arquivo mede, mas o
    // componente busca os três ao montar.
    porSegmento: {
      vip: [] as unknown[],
      inactive: [] as unknown[],
      new: [] as unknown[],
    } as Record<string, unknown[] | null>,
    // RPC `get_segmented_push_targets` para um `p_segment` que É um UUID —
    // o caso "Mensagem para Cliente Específico".
    alvosDoClienteEspecifico: [] as { user_id: string; endpoint: string; p256dh: string; auth: string }[],
    nomeDoClienteEspecifico: "Cliente de Teste",
    // Resultado do RPC para o segmento "all" — a lista de destinatários
    // que o `handleSend` usa de verdade para montar os tokens do push.
    alvosDoSegmentoTodos: [
      { user_id: "u1", endpoint: "https://push.example/1", p256dh: "p1", auth: "a1" },
    ] as { user_id: string; endpoint: string; p256dh: string; auth: string }[],
    respostaDoEnvio: { enviados: 1, falharam: 0, falhas: [] as unknown[] },
    historico: [] as Record<string, unknown>[],
  },
}));

const inserts = vi.hoisted(() => ({
  notificacoes: [] as Record<string, unknown>[],
  pushLog: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const invokeSendPush = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
        };
      }
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { full_name: estadoDoBanco.nomeDoClienteEspecifico },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: estadoDoBanco.historico, error: null }),
            }),
          }),
          insert: (linha: Record<string, unknown>) => {
            const registrado = { id: `log-${inserts.pushLog.length + 1}`, ...linha };
            inserts.pushLog.push(registrado);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: registrado.id }, error: null }),
              }),
            };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_coluna: string, id: string) => {
              const linha = inserts.pushLog.find((l) => l.id === id);
              if (linha) Object.assign(linha, patch);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (tabela === "notificacoes") {
        return {
          insert: (linhaOuLinhas: Record<string, unknown> | Record<string, unknown>[]) => {
            const linhas = Array.isArray(linhaOuLinhas)
              ? linhaOuLinhas
              : [linhaOuLinhas];
            inserts.notificacoes.push(...linhas);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
        }),
      };
    },
    rpc: (nome: string, args: { p_segment: string }) => {
      if (nome !== "get_segmented_push_targets") {
        return Promise.resolve({ data: null, error: new Error("rpc desconhecida") });
      }
      const seg = args.p_segment;
      if (seg === "vip" || seg === "inactive" || seg === "new") {
        // Indexar por `args.p_segment` (MemberExpression), não por `seg`
        // (Identifier isolado): mesmo padrão do arquivo irmão
        // (`admin-push-view-contadores.test.tsx:100`), que não dispara
        // `security/detect-object-injection` — a regra só olha a FORMA da
        // expressão, não o tipo já estreitado pelo `if` acima.
        return Promise.resolve({
          data: estadoDoBanco.porSegmento[args.p_segment] ?? [],
          error: null,
        });
      }
      if (seg === "all") {
        return Promise.resolve({ data: estadoDoBanco.alvosDoSegmentoTodos, error: null });
      }
      // Qualquer outro valor é tratado, no banco real, como UUID de cliente
      // específico (`get_segmented_push_targets`, caso 1).
      return Promise.resolve({ data: estadoDoBanco.alvosDoClienteEspecifico, error: null });
    },
    functions: { invoke: invokeSendPush },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — o envio não engole o aviso do app, e o histórico não mente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeSendPush.mockResolvedValue({ data: estadoDoBanco.respostaDoEnvio, error: null });
    estadoDoBanco.subCount = 8;
    estadoDoBanco.porSegmento = { vip: [], inactive: [], new: [] };
    estadoDoBanco.alvosDoClienteEspecifico = [];
    estadoDoBanco.nomeDoClienteEspecifico = "Cliente de Teste";
    estadoDoBanco.alvosDoSegmentoTodos = [
      { user_id: "u1", endpoint: "https://push.example/1", p256dh: "p1", auth: "a1" },
    ];
    estadoDoBanco.respostaDoEnvio = { enviados: 1, falharam: 0, falhas: [] };
    estadoDoBanco.historico = [];
    inserts.notificacoes = [];
    inserts.pushLog = [];

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
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela(targetUserId?: string) {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId={targetUserId} />,
      );
    });
    await act(async () => {
      await esperar(80);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  function digitar(elemento: HTMLInputElement | HTMLTextAreaElement, valor: string) {
    const prototipo =
      elemento instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
    setter?.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function preencherMensagem(titulo: string, corpo: string) {
    const campoTitulo = hospedeiro.querySelector<HTMLInputElement>("#push-title");
    const campoCorpo = hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");
    expect(campoTitulo).toBeTruthy();
    expect(campoCorpo).toBeTruthy();
    await act(async () => {
      digitar(campoTitulo!, titulo);
      digitar(campoCorpo!, corpo);
    });
    // `LocalBufferedInput`/`LocalBufferedTextarea` só chamam `onFlush` depois
    // do debounce (200ms) — esperar até o estado do componente refletir o
    // que foi digitado.
    await act(async () => {
      await esperar(260);
    });
  }

  function botaoEnviar(): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Enviar Notificação Agora"),
    ) as HTMLButtonElement | undefined;
  }

  async function clicarEnviar() {
    const botao = botaoEnviar();
    expect(botao).toBeTruthy();
    expect(botao!.disabled).toBe(false);
    await act(async () => {
      botao!.click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  it("cliente específico SEM aparelho: o aviso é gravado no app, e o toast conta a verdade — não fica mudo", async () => {
    // No instante em que a tela mede o alcance, o cliente TEM um aparelho —
    // é isso que habilita o botão. No instante do clique, o `handleSend`
    // faz uma consulta NOVA (mesma RPC) e não acha mais nenhum — o mesmo
    // efeito de "1 dos 16 tem aparelho" da auditoria, só que capturado no
    // meio da corrida em vez de num cliente já sem aparelho desde sempre.
    estadoDoBanco.alvosDoClienteEspecifico = [
      { user_id: "cliente-sem-aparelho", endpoint: "e1", p256dh: "p1", auth: "a1" },
    ];
    await abrirTela("cliente-sem-aparelho");
    await preencherMensagem("Oferta especial", "Corre que acaba hoje!");

    estadoDoBanco.alvosDoClienteEspecifico = [];

    await clicarEnviar();

    expect(inserts.notificacoes).toHaveLength(1);
    expect(inserts.notificacoes[0]).toMatchObject({
      usuario_id: "cliente-sem-aparelho",
      titulo: "Oferta especial",
      mensagem: "Corre que acaba hoje!",
    });

    // A parte de PUSH não tinha para quem enviar — nada de log de envio nem
    // chamada à função de disparo.
    expect(inserts.pushLog).toHaveLength(0);
    expect(invokeSendPush).not.toHaveBeenCalled();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalled();
    const chamada = (toast.error as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => /aparelho/i.test(call[0]),
    );
    expect(chamada).toBeTruthy();
  });

  it("cliente específico COM aparelho: continua criando o log de envio e o aviso no app (sem regressão)", async () => {
    estadoDoBanco.alvosDoClienteEspecifico = [
      { user_id: "cliente-com-aparelho", endpoint: "https://push.example/2", p256dh: "p2", auth: "a2" },
    ];
    await abrirTela("cliente-com-aparelho");
    await preencherMensagem("Chegou novidade", "Confere lá na loja!");

    await clicarEnviar();

    expect(inserts.pushLog).toHaveLength(1);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(inserts.notificacoes).toHaveLength(1);
    expect(inserts.notificacoes[0]).toMatchObject({
      usuario_id: "cliente-com-aparelho",
    });
  });

  it("segmento vazio (sem cliente específico): continua parando sem criar aviso no app — a trava da decisão 3", async () => {
    // Mesma corrida do primeiro teste: o segmento "Sem comprar há 30d"
    // tem 1 aparelho no instante em que é selecionado (habilita o botão),
    // e 0 no instante em que o `handleSend` mede de novo.
    estadoDoBanco.porSegmento.inactive = [
      { user_id: "alguem", endpoint: "e", p256dh: "p", auth: "a" },
    ];
    await abrirTela();
    await preencherMensagem("Promoção geral", "Só até domingo!");

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem comprar há 30d"),
    );
    expect(botaoInativo).toBeTruthy();
    await act(async () => {
      botaoInativo!.click();
    });
    await act(async () => {
      await esperar(80);
    });

    estadoDoBanco.porSegmento.inactive = [];

    await clicarEnviar();

    expect(inserts.notificacoes).toHaveLength(0);
    expect(inserts.pushLog).toHaveLength(0);
    expect(invokeSendPush).not.toHaveBeenCalled();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      "Nenhum destinatário encontrado para este segmento",
    );
  });

  it("histórico com recipient_count 0 não diz 'ENVIADA'", async () => {
    estadoDoBanco.historico = [
      {
        id: "h1",
        title: "Campanha antiga",
        body: "Ninguém recebeu",
        url: "/",
        recipient_count: 0,
        sent_at: new Date().toISOString(),
      },
    ];
    await abrirTela();

    // `\b` importa aqui: o cabeçalho fixo da seção diz "Histórico de
    // Mensagens Enviadas" (plural), que contém "Enviada" como substring —
    // sem a fronteira de palavra o teste acusaria um selo que não existe.
    expect(texto()).not.toMatch(/\bENVIADA\b/i);
    expect(texto()).toContain("Não confirmada");
  });

  it("histórico com recipient_count > 0 continua dizendo que chegou, e conta 'aparelhos' (singular certo)", async () => {
    estadoDoBanco.historico = [
      {
        id: "h2",
        title: "Campanha ok",
        body: "Um aparelho recebeu",
        url: "/",
        recipient_count: 1,
        sent_at: new Date().toISOString(),
      },
    ];
    await abrirTela();

    expect(texto()).toContain("1 aparelho");
    expect(texto()).not.toContain("1 clientes");
    expect(texto()).not.toContain("1 aparelhos");
    expect(texto()).not.toContain("Não confirmada");
  });
});
