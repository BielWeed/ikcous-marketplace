// @vitest-environment jsdom
//
// Conexão instável: a consulta dos avisos próprios responde e a das campanhas
// fica "pendurada" (conecta e não responde). O `Promise.all` do contexto não
// tinha prazo: o `loading` nunca terminava, a tela ficava nos esqueletos, sem
// erro e sem "Tentar de novo" (nem os avisos que já tinham respondido
// apareciam). Agora a ESPERA da tela tem prazo: estourou = o `catch` de
// sempre diz "Não conseguimos carregar suas notificações." e o `finally`
// encerra o carregamento. A consulta abandonada pode responder depois: ela não
// escreve estado nem solta o carregamento de uma rodada NOVA.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";

type Resposta = {
  data: Record<string, unknown>[] | null;
  error: unknown;
};

const rede = vi.hoisted(() => ({
  user: { id: "cliente-fixture" },
  // Uma fila por consulta: cada rodada consome a próxima promessa da fila.
  propria: [] as Promise<unknown>[],
  campanha: [] as Promise<unknown>[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: rede.user }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// O cartão de avisos do aparelho lê o hook de push (que puxa o supabase real).
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    permission: "default",
    subscription: null,
    semConta: true,
    sondado: true,
    subscribe: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let campanha = false;
      const consulta = {
        eq: () => consulta,
        is: () => {
          campanha = true;
          return consulta;
        },
        order: () => consulta,
        limit: () =>
          (campanha ? rede.campanha : rede.propria).shift() ??
          Promise.resolve({ data: [], error: null }),
      };
      return { select: () => consulta };
    },
  },
}));

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import { NotificationsView } from "@/views/customer/NotificationsView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendente() {
  let resolver!: (valor: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}
function aviso(id: string, usuario: string | null = "cliente-fixture") {
  return {
    id,
    usuario_id: usuario,
    titulo: id,
    mensagem: "Aviso",
    tipo: "system",
    lida: false,
    // Relativa: a campanha só vale por 30 dias para quem criou a conta antes.
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  };
}
const ok = (linhas: Record<string, unknown>[]) =>
  Promise.resolve({ data: linhas, error: null });

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

describe("avisos da cliente — consulta pendurada vira erro com 'Tentar de novo'", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        close() {}
      },
    );
    localStorage.clear();
    rede.propria = [];
    rede.campanha = [];
    espelho.atual = null;
    // O erro da consulta vai para o console de propósito; sem ruído no teste.
    vi.spyOn(console, "error").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function montar(comTela = false) {
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <Sonda />
          {comTela ? <NotificationsView onNavigate={() => {}} /> : null}
        </NotificationProvider>,
      );
    });
  }
  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("uma consulta responde e a outra nunca: estoura o prazo, solta o carregamento e a tela oferece 'Tentar de novo'", async () => {
    rede.propria = [ok([aviso("proprio")])];
    rede.campanha = [pendente().promessa];
    await montar(true);

    // Antes do prazo: ainda carregando (esqueleto), sem erro.
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1_000);
    expect(espelho.atual!.loading).toBe(true);
    expect(espelho.atual!.erro).toBeNull();
    expect(
      host.querySelector("[data-testid='sino-carregando']"),
    ).not.toBeNull();

    await avancar(2_000);
    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.erro).toBe(
      "Não conseguimos carregar suas notificações.",
    );
    expect(host.querySelector("[data-testid='sino-carregando']")).toBeNull();
    expect(host.textContent).toContain("Não conseguimos carregar");
    const retry = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );
    expect(retry).toBeDefined();

    // O botão refaz a consulta e, agora respondendo, a lista aparece.
    rede.propria = [ok([aviso("proprio")])];
    rede.campanha = [ok([])];
    await act(async () => {
      (retry as HTMLButtonElement).click();
    });
    expect(espelho.atual!.erro).toBeNull();
    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual(["proprio"]);
  });

  it("controle: as duas respondem rápido, a lista chega como sempre e o prazo não deixa erro", async () => {
    rede.propria = [ok([aviso("proprio")])];
    rede.campanha = [ok([aviso("campanha", null)])];
    await montar();

    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.erro).toBeNull();
    expect(espelho.atual!.notifications.map((n) => n.id).sort()).toEqual([
      "campanha",
      "proprio",
    ]);
    // O prazo foi desarmado: passar o tempo não inventa erro depois.
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS + 5_000);
    expect(espelho.atual!.erro).toBeNull();
    expect(espelho.atual!.notifications).toHaveLength(2);
  });

  it("controle: resposta com erro explícito continua sendo o mesmo erro, na hora, sem esperar o prazo", async () => {
    rede.propria = [Promise.resolve({ data: null, error: { code: "42501" } })];
    rede.campanha = [ok([])];
    await montar();

    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.erro).toBe(
      "Não conseguimos carregar suas notificações.",
    );
  });

  it("a rodada abandonada que estoura o prazo depois NÃO solta o carregamento nem apaga a lista da rodada nova", async () => {
    // Rodada 1 pendurada desde t=0. Em t=5 s a cliente toca (ou o app relê) e
    // começa a rodada 2; a rodada 1 estoura em t=20 s com a 2 ainda no ar.
    const campanhaVelha = pendente();
    rede.propria = [ok([aviso("velho")])];
    rede.campanha = [campanhaVelha.promessa];
    await montar();
    await avancar(5_000);

    const propriaNova = pendente();
    const campanhaNova = pendente();
    rede.propria = [propriaNova.promessa];
    rede.campanha = [campanhaNova.promessa];
    await act(async () => {
      void espelho.atual!.refresh();
    });
    expect(espelho.atual!.loading).toBe(true);

    // Em t=20 s a rodada 1 estoura: a 2 segue no ar, carregando e sem erro.
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 5_000 + 500);
    expect(espelho.atual!.loading).toBe(true);
    expect(espelho.atual!.erro).toBeNull();

    // A resposta tardia da consulta abandonada também não escreve nada.
    await act(async () => {
      campanhaVelha.resolver({ data: [aviso("tardio", null)], error: null });
    });
    expect(espelho.atual!.loading).toBe(true);
    expect(espelho.atual!.notifications).toHaveLength(0);

    // A rodada 2 responde dentro do prazo dela: só o que é dela aparece.
    await act(async () => {
      propriaNova.resolver({ data: [aviso("novo")], error: null });
      campanhaNova.resolver({ data: [], error: null });
    });
    expect(espelho.atual!.loading).toBe(false);
    expect(espelho.atual!.erro).toBeNull();
    expect(espelho.atual!.notifications.map((n) => n.id)).toEqual(["novo"]);
  });
});
