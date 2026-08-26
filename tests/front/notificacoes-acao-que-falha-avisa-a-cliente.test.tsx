// @vitest-environment jsdom
//
// Ação que falha não pode falhar calada.
//
// Achado 4 da auditoria rodada 2 (26/08/2026). Os três `catch` das ações de
// `NotificationContext` — marcar uma como lida (:159), marcar todas (:192) e
// apagar (:219) — só faziam `console.error`. Com a rede caída, a cliente toca
// no lixinho e NADA acontece: sem erro, sem explicação, sem retorno nenhum.
// Ela toca de novo, e de novo.
//
// A favor do código de antes, e por isso este achado não é dos piores: as três
// NÃO mentiam — `setNotifications` só roda depois do `if (error) throw error`,
// então a tela nunca fingiu que tinha apagado. O defeito é o silêncio.
//
// O que este teste prende: com a consulta devolvendo `error`, cada uma das três
// ações precisa chamar `toast.error`. Contra o HEAD (843ca0a) as três asserções
// reprovam — o `toast` sequer estava importado no arquivo.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

// A cliente está logada — as três ações retornam cedo sem `user`.
// Os valores são IDENTIDADES ESTÁVEIS de propósito: devolver um objeto novo a
// cada render faz o `useCallback([user])` do provider mudar todo render, o
// efeito que depende dele re-disparar, e o teste travar em laço infinito
// dentro do `act`. Custou uma rodada vermelha por timeout para descobrir.
const usuarioDeTeste = { user: { id: "cliente-1" } };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => usuarioDeTeste,
}));

// Sem eleição de líder o provider não dispara o realtime no teste.
const semLideranca = { isLeader: false };
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => semLideranca,
}));

const erroDeRede = { message: "network error", code: "" };

// O fetch inicial precisa devolver uma notificação REAL (usuario_id da
// cliente, não campanha) — senão as ações caem no ramo local de campanha, que
// nunca toca o banco e não é o caminho sob teste.
const linhaDaCliente = {
  id: "notif-1",
  usuario_id: "cliente-1",
  titulo: "Aviso",
  mensagem: "Mensagem.",
  tipo: "system",
  lida: false,
  created_at: new Date(0).toISOString(),
};

// Encadeamento do Postgrest. O `update` precisa servir os DOIS chamadores:
// `markAsRead` faz um `.eq()` só e aguarda o resultado; `markAllAsRead`
// encadeia dois. Por isso o primeiro `.eq()` devolve uma Promise DE VERDADE
// com um `.eq` pendurado — em vez de um objeto com propriedade `then`, que
// seria um thenable caseiro (e que o Biome recusa, com razão:
// lint/suspicious/noThenProperty).
const respostaComErro = { data: null, error: erroDeRede };

function fabricarFrom() {
  return {
    select: () => ({
      or: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [linhaDaCliente], error: null }),
        }),
      }),
    }),
    update: () => ({
      eq: () =>
        Object.assign(Promise.resolve(respostaComErro), {
          eq: () => Promise.resolve(respostaComErro),
        }),
    }),
    delete: () => ({
      eq: () => Promise.resolve(respostaComErro),
    }),
  };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => fabricarFrom(),
    channel: () => ({
      on: function () {
        return this;
      },
      subscribe: function () {
        return this;
      },
    }),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let acoes: ReturnType<typeof useNotificationCenter> | null = null;

// A sonda PUBLICA por callback em vez de escrever direto numa variável de
// fora: o react-compiler reprova (como erro, e a catraca cobra) reatribuir
// variável externa de dentro do corpo de um componente.
function Sonda({
  publicar,
}: {
  readonly publicar: (v: ReturnType<typeof useNotificationCenter>) => void;
}) {
  const valor = useNotificationCenter();
  useEffect(() => {
    publicar(valor);
  });
  return null;
}

describe("NotificationContext — ação que falha avisa a cliente", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    toastError.mockClear();
    acoes = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <NotificationProvider>
          <Sonda
            publicar={(v) => {
              acoes = v;
            }}
          />
        </NotificationProvider>,
      );
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("marcar UMA como lida: falha no banco vira aviso na tela", async () => {
    await act(async () => {
      await acoes?.markAsRead("notif-1");
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/marcar|lida/i);
  });

  it("marcar TODAS como lidas: falha no banco vira aviso na tela", async () => {
    await act(async () => {
      await acoes?.markAllAsRead();
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/marcar|lida/i);
  });

  it("apagar um aviso: falha no banco vira aviso na tela", async () => {
    await act(async () => {
      await acoes?.deleteNotification("notif-1");
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/apagar|remover/i);
  });
});
