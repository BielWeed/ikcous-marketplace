// @vitest-environment jsdom
//
// O sino de avisos tem dois encargos que nenhum teste vizinho afirmava:
//  1. Ao sair da conta (ou desmontar), o canal ao vivo `notificacoes:<id>` é
//     ENCERRADO. Sem isso o canal da conta anterior segue ligado e cada evento
//     dispara releitura com a função da conta antiga.
//  2. Só a aba LÍDER assina o tempo real; as outras abas do aparelho só sabem
//     de aviso novo pelo BroadcastChannel (líder posta `notification_update`,
//     secundária relê). Sem esse recado, o contador da aba secundária fica
//     velho por tempo indeterminado.
// Os vizinhos deixam `removeChannel` como `vi.fn()` nunca afirmado e o
// BroadcastChannel mudo; aqui o canal é afirmado pelo OBJETO e o
// BroadcastChannel entrega mensagem entre instâncias de mesmo nome.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const rede = vi.hoisted(() => ({
  user: { id: "cliente-a" } as { id: string } | null,
  souLider: true,
  consultasDosProprios: 0,
  dados: [] as Linha[],
  canais: [] as { nome: string; canal: unknown }[],
  aoMudar: null as null | (() => void),
  removeChannel: null as null | ((canal: unknown) => unknown),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: rede.user }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: rede.souLider }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/supabase", () => {
  rede.removeChannel = vi.fn();
  return {
    supabase: {
      from: () => {
        let campanha = false;
        const consulta = {
          eq: () => {
            rede.consultasDosProprios++;
            return consulta;
          },
          is: () => {
            campanha = true;
            return consulta;
          },
          order: () => consulta,
          limit: () =>
            Promise.resolve({ data: campanha ? [] : rede.dados, error: null }),
        };
        return { select: () => consulta };
      },
      channel: (nome: string) => {
        const canal: Record<string, unknown> = {};
        canal.on = (_e: string, _o: unknown, cb: () => void) => {
          rede.aoMudar = cb;
          return canal;
        };
        canal.subscribe = () => canal;
        rede.canais.push({ nome, canal });
        return canal;
      },
      removeChannel: (canal: unknown) => rede.removeChannel?.(canal),
    },
  };
});

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// BroadcastChannel que entrega a mensagem às OUTRAS instâncias de mesmo nome
// (a real não devolve a mensagem a quem a enviou) e registra o que cada uma
// postou.
class CanalDeAbasFalso {
  static todas: CanalDeAbasFalso[] = [];
  onmessage: ((evento: { data: unknown }) => void) | null = null;
  postadas: unknown[] = [];
  fechado = false;
  name: string;
  constructor(nome: string) {
    this.name = nome;
    CanalDeAbasFalso.todas.push(this);
  }
  postMessage(data: unknown) {
    this.postadas.push(data);
    for (const outra of CanalDeAbasFalso.todas) {
      if (outra !== this && outra.name === this.name && !outra.fechado) {
        outra.onmessage?.({ data });
      }
    }
  }
  close() {
    this.fechado = true;
  }
}

const AGORA = Date.now();
function aviso(id: string, lida = false): Linha {
  return {
    id,
    usuario_id: "cliente-a",
    titulo: id,
    mensagem: "Seu pedido foi atualizado.",
    tipo: "system",
    lida,
    created_at: new Date(AGORA - 60_000).toISOString(),
    dados: null,
  };
}

const espelho: { atual: ReturnType<typeof useNotificationCenter> | null } = {
  atual: null,
};
function Sonda() {
  const contexto = useNotificationCenter();
  useEffect(() => {
    espelho.atual = contexto;
  });
  return null;
}

describe("sino de avisos — fecha o canal ao sair e avisa as outras abas", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  async function renderizar() {
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <Sonda />
        </NotificationProvider>,
      );
    });
  }

  /** Passa a junção de 500 ms e deixa as consultas resolverem. */
  async function passarOTempo() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    CanalDeAbasFalso.todas = [];
    vi.stubGlobal("BroadcastChannel", CanalDeAbasFalso);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rede.user = { id: "cliente-a" };
    rede.souLider = true;
    rede.consultasDosProprios = 0;
    rede.dados = [aviso("aviso-1", true)];
    rede.canais = [];
    rede.aoMudar = null;
    (rede.removeChannel as ReturnType<typeof vi.fn>).mockClear();
    espelho.atual = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("desmontar o provedor encerra o canal ao vivo que ele abriu (o MESMO objeto)", async () => {
    await renderizar();
    await passarOTempo();
    expect(rede.canais.map((c) => c.nome)).toEqual(["notificacoes:cliente-a"]);
    expect(rede.removeChannel).not.toHaveBeenCalled();

    act(() => raiz.unmount());

    expect(rede.removeChannel).toHaveBeenCalledTimes(1);
    expect(rede.removeChannel).toHaveBeenCalledWith(rede.canais[0].canal);
    // Remonta um provedor vazio para o afterEach desmontar sem erro.
    raiz = createRoot(host);
  });

  it("sair da conta encerra o canal da conta que saiu", async () => {
    await renderizar();
    await passarOTempo();
    expect(rede.canais).toHaveLength(1);

    rede.user = null;
    await renderizar();
    await passarOTempo();

    expect(rede.removeChannel).toHaveBeenCalledTimes(1);
    expect(rede.removeChannel).toHaveBeenCalledWith(rede.canais[0].canal);
    expect(espelho.atual!.notifications).toEqual([]);
  });

  it("aba líder: aviso ao vivo vira UM recado `notification_update` para as outras abas", async () => {
    const outraAba = new CanalDeAbasFalso("ikcous_notifications");
    const recebidos: unknown[] = [];
    outraAba.onmessage = (e) => recebidos.push(e.data);

    await renderizar();
    await passarOTempo();
    expect(rede.aoMudar).toBeTypeOf("function");
    expect(recebidos).toEqual([]); // a leitura inicial não avisa ninguém

    rede.aoMudar?.();
    await passarOTempo();

    expect(recebidos).toEqual([{ type: "notification_update" }]);
  });

  it("aba secundária: recebe o recado, RELÊ o banco e atualiza o contador, sem repassar o eco", async () => {
    rede.souLider = false;
    await renderizar();
    await passarOTempo();
    expect(rede.consultasDosProprios).toBe(1);
    expect(espelho.atual!.unreadCount).toBe(0);
    expect(rede.canais).toEqual([]); // secundária não assina o tempo real

    // A "aba líder" é outra instância do mesmo canal; o banco ganhou um aviso.
    rede.dados = [aviso("aviso-2"), aviso("aviso-1", true)];
    const abaLider = new CanalDeAbasFalso("ikcous_notifications");
    abaLider.postMessage({ type: "notification_update" });
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(2);
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual([
      "aviso-2",
      "aviso-1",
    ]);
    expect(espelho.atual!.unreadCount).toBe(1);
    // Sem eco infinito: a secundária não posta de volta.
    const dela = CanalDeAbasFalso.todas.find((c) => c !== abaLider)!;
    expect(dela.postadas).toEqual([]);
  });

  it("aba secundária: mensagem de outro tipo não dispara releitura", async () => {
    rede.souLider = false;
    await renderizar();
    await passarOTempo();

    new CanalDeAbasFalso("ikcous_notifications").postMessage({
      type: "outra-coisa",
    });
    await passarOTempo();

    expect(rede.consultasDosProprios).toBe(1);
  });
});
