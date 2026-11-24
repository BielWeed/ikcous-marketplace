// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026): como o sino da cliente TRADUZ a linha que o
// banco devolve para o aviso da tela. Nenhum teste prendia estes cantos:
//   - linha sem tipo vira aviso "system", sem mensagem vira texto vazio e
//     `lida` nulo é "não lida";
//   - o destino do toque vem de `acao.url`; só na falta dela vale
//     `dados.action_url`; o pedido vem de `dados.order_id`;
//   - a ordem é por data (mais nova primeiro), com desempate por id decrescente,
//     misturando avisos próprios e de campanha;
//   - o recado "só os 50 mais recentes" aparece com exatamente 50 próprios e
//     NÃO com 49 (campanha não entra nessa conta);
//   - "lida neste aparelho" vale SÓ para campanha (um aviso próprio com o mesmo
//     id guardado no aparelho continua não lido), e o aviso dispensado neste
//     aparelho some;
//   - campanha criada no mesmo instante da conta já vale para ela.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import type { Notification } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIA = 24 * 60 * 60 * 1000;
const atras = (dias: number) => new Date(Date.now() - dias * DIA).toISOString();

const usuario: {
  user: { id: string; created_at: string } | null;
  loading?: boolean;
} = {
  user: { id: "cliente-1", created_at: atras(90) },
};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => usuario }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

type Linha = Record<string, unknown>;
let fila: Linha[][] = [];

function builder(linhas: Linha[]) {
  const b = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(async () => ({ data: linhas, error: null })),
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => builder(fila.shift() ?? []),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const propria = (id: string, extra: Linha = {}): Linha => ({
  id,
  usuario_id: "cliente-1",
  titulo: `titulo ${id}`,
  mensagem: "texto",
  tipo: "aviso",
  lida: false,
  created_at: atras(1),
  ...extra,
});

const campanha = (id: string, extra: Linha = {}): Linha => ({
  id,
  usuario_id: null,
  titulo: `campanha ${id}`,
  mensagem: "texto",
  tipo: "aviso",
  lida: false,
  created_at: atras(1),
  ...extra,
});

interface Lido {
  lista: Notification[];
  listaCortada: boolean | undefined;
}

async function montar(): Promise<Lido> {
  let capturado: Lido | null = null;
  function Sonda() {
    const { notifications, listaCortada } = useNotificationCenter();
    useEffect(() => {
      capturado = { lista: notifications, listaCortada };
    }, [notifications, listaCortada]);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NotificationProvider>
        <Sonda />
      </NotificationProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const resultado = capturado as Lido | null;
  act(() => root.unmount());
  container.remove();
  if (!resultado) throw new Error("a sonda não leu nada");
  return resultado;
}

beforeEach(() => {
  usuario.user = { id: "cliente-1", created_at: atras(90) };
  usuario.loading = false;
  localStorage.clear();
});
afterEach(() => {
  fila = [];
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("sino da cliente — tradução da linha do banco", () => {
  it("sem tipo vira 'system', sem mensagem vira vazio, lida nula é não lida", async () => {
    fila = [[propria("a", { tipo: null, mensagem: null, lida: null })], []];
    const { lista } = await montar();
    expect(lista).toHaveLength(1);
    expect(lista[0].type).toBe("system");
    expect(lista[0].message).toBe("");
    expect(lista[0].read).toBe(false);
  });

  it("o destino vem de acao.url; só na falta dela vale dados.action_url", async () => {
    fila = [
      [
        propria("com-acao", {
          acao: { url: "/cart" },
          dados: { action_url: "/favorites" },
          created_at: atras(1),
        }),
        propria("so-dados", {
          dados: { action_url: "/favorites" },
          created_at: atras(2),
        }),
        propria("sem-destino", { created_at: atras(3) }),
      ],
      [],
    ];
    const { lista } = await montar();
    const porId = new Map(lista.map((n) => [n.id, n]));
    expect(porId.get("com-acao")?.action_url).toBe("/cart");
    expect(porId.get("so-dados")?.action_url).toBe("/favorites");
    expect(porId.get("sem-destino")?.action_url).toBeUndefined();
  });

  it("o pedido do aviso vem de dados.order_id", async () => {
    fila = [
      [
        propria("do-pedido", {
          dados: { order_id: "ped-7" },
          created_at: atras(1),
        }),
        propria("sem-pedido", { created_at: atras(2) }),
      ],
      [],
    ];
    const { lista } = await montar();
    const porId = new Map(lista.map((n) => [n.id, n]));
    expect(porId.get("do-pedido")?.order_id).toBe("ped-7");
    expect(porId.get("sem-pedido")?.order_id).toBeUndefined();
  });

  it("ordena por data (nova primeiro), misturando próprios e campanha, e desempata por id decrescente", async () => {
    const mesmoInstante = atras(2);
    fila = [
      [
        propria("p-antigo", { created_at: atras(5) }),
        propria("p-b", { created_at: mesmoInstante }),
        propria("p-a", { created_at: mesmoInstante }),
      ],
      [
        campanha("c-novo", { created_at: atras(1) }),
        campanha("c-c", { created_at: mesmoInstante }),
      ],
    ];
    const { lista } = await montar();
    expect(lista.map((n) => n.id)).toEqual([
      "c-novo",
      "p-b",
      "p-a",
      "c-c",
      "p-antigo",
    ]);
  });

  describe("recado dos 50 mais recentes", () => {
    const cheia = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        propria(`p-${String(i).padStart(3, "0")}`, {
          created_at: new Date(Date.now() - i * 1000).toISOString(),
        }),
      );

    it("com 49 avisos próprios a lista coube inteira", async () => {
      fila = [cheia(49), []];
      expect((await montar()).listaCortada).toBe(false);
    });

    it("com exatamente 50 avisos próprios a lista pode estar cortada", async () => {
      fila = [cheia(50), []];
      expect((await montar()).listaCortada).toBe(true);
    });

    it("campanha não entra na conta do corte: 10 próprios + 20 campanhas não cortam", async () => {
      fila = [
        cheia(10),
        Array.from({ length: 20 }, (_, i) =>
          campanha(`c-${i}`, { created_at: atras(1 + i / 100) }),
        ),
      ];
      expect((await montar()).listaCortada).toBe(false);
    });
  });

  describe("estado guardado neste aparelho", () => {
    const chave = "notificacoes-campanha-estado:cliente-1";

    it("campanha marcada como lida aqui volta lida; aviso próprio de mesmo id não", async () => {
      localStorage.setItem(
        chave,
        JSON.stringify({ lidas: ["mesmo-id", "so-campanha"], ocultas: [] }),
      );
      fila = [
        [propria("mesmo-id", { created_at: atras(1) })],
        [campanha("so-campanha", { created_at: atras(2) })],
      ];
      const { lista } = await montar();
      const porId = new Map(lista.map((n) => [n.id, n]));
      expect(porId.get("so-campanha")?.read).toBe(true);
      expect(porId.get("mesmo-id")?.read).toBe(false);
    });

    it("aviso dispensado neste aparelho não volta", async () => {
      localStorage.setItem(
        chave,
        JSON.stringify({ lidas: [], ocultas: ["dispensada"] }),
      );
      fila = [
        [propria("fica", { created_at: atras(1) })],
        [campanha("dispensada", { created_at: atras(2) })],
      ];
      const { lista } = await montar();
      expect(lista.map((n) => n.id)).toEqual(["fica"]);
    });

    it("campanha criada no mesmo instante da conta já vale para ela", async () => {
      const agora = new Date("2026-11-18T12:00:00.000Z").getTime();
      vi.spyOn(Date, "now").mockReturnValue(agora);
      const instante = new Date(agora - 3 * DIA).toISOString();
      usuario.user = { id: "cliente-1", created_at: instante };
      fila = [
        [],
        [
          campanha("no-instante", { created_at: instante }),
          campanha("um-ms-antes", {
            created_at: new Date(agora - 3 * DIA - 1).toISOString(),
          }),
        ],
      ];
      const { lista } = await montar();
      expect(lista.map((n) => n.id)).toEqual(["no-instante"]);
    });
  });
});
