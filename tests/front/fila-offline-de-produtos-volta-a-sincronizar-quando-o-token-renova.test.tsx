// @vitest-environment jsdom
//
// Irmão de fila-offline-de-pedidos-volta-a-sincronizar-quando-o-token-renova:
// a lojista edita preço/estoque de um produto sem internet, a rede volta com o
// token já vencido e a edição ficava parada para sempre -- a passada da fila lê
// "sem sessão por erro de rede", encerra sem enviar e ninguém a reagenda (os
// efeitos só dependem de `user?.id`, `isAdmin` e do `online`; o supabase-js só
// renova o token ~1 min depois e a renovação não muda o id do usuário).
//
// Agora, se a passada parou POR ERRO DE REDE (e só nesse caso), o hook espera
// o supabase-js avisar que a sessão voltou (`TOKEN_REFRESHED`/`SIGNED_IN` do
// MESMO usuário) e refaz a passada em silêncio. A trava de troca de conta e a
// versão-base do produto continuam valendo: a passada refeita confere a sessão
// antes de CADA envio e o UPDATE só grava se a versão não mudou.
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  auth: { id: null as string | null, admin: true },
  // O que o cliente Supabase diz AGORA (`getSession`).
  sessao: {
    id: null as string | null,
    erro: null as unknown,
    // Quando preenchida, a leitura da sessão só responde depois dela.
    espera: null as null | Promise<void>,
  },
  atualizados: [] as { id: string; payload: any }[],
  // Quando preenchido, o UPDATE só conclui quando alguém o chamar.
  segurarEnvio: null as null | { concluir: () => void },
  segurar: false,
  ouvintes: new Set<(evento: string, sessao: unknown) => void>(),
  // Simula "a renovação saiu ANTES de a assinatura existir": roda no momento
  // em que alguém assina e não entrega evento nenhum.
  aoAssinar: null as null | (() => void),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mock.auth.id ? { id: mock.auth.id } : null,
    isAdmin: mock.auth.admin,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [
      {
        id: "prod-1",
        name: "Produto 1",
        updatedAt: "2026-10-01T10:00:00.000000+00:00",
      },
    ],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: any) => row,
  mapVariantFromDB: (row: any) => row,
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "t"),
    dismiss: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (payload: any) => ({
        eq: (_coluna: string, id: string) => {
          mock.atualizados.push({ id, payload });
          const encadeado = {
            eq: () => encadeado,
            is: () => encadeado,
            select: () => {
              const resposta = { data: [{ id }], error: null };
              if (!mock.segurar) return Promise.resolve(resposta);
              return new Promise((resolve) => {
                mock.segurarEnvio = { concluir: () => resolve(resposta) };
              });
            },
          };
          return encadeado;
        },
      }),
    }),
    auth: {
      refreshSession: vi.fn(),
      getSession: async () => {
        await mock.sessao.espera;
        return {
          data: {
            session: mock.sessao.id ? { user: { id: mock.sessao.id } } : null,
          },
          error: mock.sessao.erro,
        };
      },
      onAuthStateChange: (
        ouvinte: (evento: string, sessao: unknown) => void,
      ) => {
        mock.ouvintes.add(ouvinte);
        mock.aoAssinar?.();
        return {
          data: {
            subscription: { unsubscribe: () => mock.ouvintes.delete(ouvinte) },
          },
        };
      },
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "products_offline_updates_queue:admin-a";
const HORA = 60 * 60 * 1000;

let host: HTMLDivElement;
let raiz: Root;

const erroDeRede = () => new AuthRetryableFetchError("Failed to fetch", 0);

function itemDe(id: string, updates: object) {
  return {
    id,
    updates,
    baseUpdatedAt: "2026-10-01T10:00:00.000000+00:00",
    timestamp: Date.now() - HORA,
  };
}

function fila(): any[] | null {
  const bruto = localStorage.getItem(CHAVE);
  return bruto === null ? null : JSON.parse(bruto);
}

function tokenVencidoSemRede() {
  mock.sessao.id = null;
  mock.sessao.erro = erroDeRede();
}

function tokenRenovado(uid = "admin-a") {
  mock.sessao.id = uid;
  mock.sessao.erro = null;
}

/** O que o supabase-js faz quando a renovação sai: avisa todos os ouvintes. */
function avisar(evento: string, uid: string | null) {
  for (const ouvinte of [...mock.ouvintes]) {
    ouvinte(evento, uid ? { user: { id: uid } } : null);
  }
}

function idsEnviados(): string[] {
  return mock.atualizados.map((a) => a.id);
}

async function montar() {
  const { useProducts } = await import("@/hooks/useProducts");
  function Sonda() {
    useProducts({ autoFetch: true });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Monta o hook com a rede de volta: a passada do `online` roda 1 s depois. */
async function montarComRedeDeVolta() {
  await montar();
  await passar(1100);
}

describe("fila offline de produtos — religa quando o token renova", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.auth.id = "admin-a";
    mock.auth.admin = true;
    tokenVencidoSemRede();
    mock.atualizados.length = 0;
    mock.segurar = false;
    mock.segurarEnvio = null;
    mock.ouvintes.clear();
    mock.aoAssinar = null;
    mock.sessao.espera = null;
    localStorage.clear();
    localStorage.setItem(
      CHAVE,
      JSON.stringify([itemDe("prod-1", { name: "Do A" })]),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const t of [
      toast.loading,
      toast.success,
      toast.error,
      toast.info,
      toast.warning,
      toast.dismiss,
    ]) {
      vi.mocked(t).mockClear();
    }
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    localStorage.clear();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("token vencido e sem rede na volta: nada sai, a edição fica, e quando o token renova do MESMO usuário ela é enviada UMA vez", async () => {
    await montarComRedeDeVolta();

    expect(mock.atualizados).toHaveLength(0);
    expect(fila()).toHaveLength(1);
    expect(mock.ouvintes.size).toBe(1);

    tokenRenovado();
    avisar("TOKEN_REFRESHED", "admin-a");
    await passar(1100);

    expect(idsEnviados()).toEqual(["prod-1"]);
    expect(fila()).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(mock.ouvintes.size).toBe(0);

    // Outra renovação (de hora em hora) não envia nada de novo.
    avisar("TOKEN_REFRESHED", "admin-a");
    await passar(1100);
    expect(mock.atualizados).toHaveLength(1);
  });

  it("SIGNED_IN do mesmo usuário também religa a passada", async () => {
    await montarComRedeDeVolta();
    expect(mock.atualizados).toHaveLength(0);

    tokenRenovado();
    avisar("SIGNED_IN", "admin-a");
    await passar(1100);

    expect(idsEnviados()).toEqual(["prod-1"]);
  });

  it("a retentativa é SILENCIOSA: nenhum 'Sincronizando…' novo, e o aviso da primeira passada não é apagado às cegas", async () => {
    await montarComRedeDeVolta();
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).toHaveBeenCalledWith("t");

    // Renovação avisada, mas a rede ainda falha ao reler a sessão.
    avisar("TOKEN_REFRESHED", "admin-a");
    await passar(1100);
    expect(toast.loading).toHaveBeenCalledTimes(1);
    // `toast.dismiss()` SEM id apagaria TODOS os avisos da tela.
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(mock.atualizados).toHaveLength(0);
    expect(mock.ouvintes.size).toBe(1);

    tokenRenovado();
    avisar("TOKEN_REFRESHED", "admin-a");
    await passar(1100);
    expect(idsEnviados()).toEqual(["prod-1"]);
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("sessão encerrada de verdade (sem erro de rede): NÃO reagenda nada", async () => {
    mock.sessao.id = null;
    mock.sessao.erro = null;
    await montarComRedeDeVolta();

    expect(mock.atualizados).toHaveLength(0);
    expect(fila()).toHaveLength(1);
    expect(mock.ouvintes.size).toBe(0);

    tokenRenovado();
    avisar("SIGNED_IN", "admin-a");
    await passar(1100);
    expect(mock.atualizados).toHaveLength(0);
  });

  it("renovação RECUSADA pelo servidor (token inválido, não é rede): NÃO reagenda", async () => {
    mock.sessao.id = null;
    mock.sessao.erro = new AuthApiError(
      "Invalid Refresh Token: Already Used",
      400,
      "refresh_token_already_used",
    );
    await montarComRedeDeVolta();

    expect(mock.atualizados).toHaveLength(0);
    expect(mock.ouvintes.size).toBe(0);
  });

  it("a conta trocou (sessão de OUTRO usuário, sem erro): NÃO reagenda", async () => {
    mock.sessao.id = "admin-b";
    mock.sessao.erro = null;
    await montarComRedeDeVolta();

    expect(mock.atualizados).toHaveLength(0);
    expect(fila()).toHaveLength(1);
    expect(mock.ouvintes.size).toBe(0);
  });

  it("uma passada seguinte que NÃO parou pela rede desfaz a espera (a marca da anterior não vale mais)", async () => {
    await montarComRedeDeVolta();
    expect(mock.ouvintes.size).toBe(1);

    // A lojista saiu da conta; a rede volta a oscilar e o `online` dispara de novo.
    mock.sessao.id = null;
    mock.sessao.erro = null;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(mock.atualizados).toHaveLength(0);
    expect(mock.ouvintes.size).toBe(0);
  });

  it("aviso de renovação de OUTRO usuário não religa a passada nem envia a edição de A", async () => {
    await montarComRedeDeVolta();
    expect(mock.ouvintes.size).toBe(1);

    tokenRenovado("admin-b");
    avisar("TOKEN_REFRESHED", "admin-b");
    await passar(1100);

    expect(mock.atualizados).toHaveLength(0);
    expect(fila()).toHaveLength(1);
    expect(mock.ouvintes.size).toBe(1);
  });

  it("aviso de renovação do dono, mas a sessão do cliente já é de OUTRO: a trava de troca de conta vale e nada é enviado", async () => {
    await montarComRedeDeVolta();

    tokenRenovado("admin-b");
    avisar("TOKEN_REFRESHED", "admin-a");
    await passar(1100);

    expect(mock.atualizados).toHaveLength(0);
    expect(fila()).toHaveLength(1);
  });

  it("`online` e a renovação chegando JUNTOS enviam a edição uma vez só", async () => {
    await montarComRedeDeVolta();
    expect(mock.atualizados).toHaveLength(0);
    expect(mock.ouvintes.size).toBe(1);

    // O UPDATE fica pendurado: as duas passadas agendadas (a do `online` e a
    // da renovação) disparam no mesmo segundo, com a primeira ainda em voo.
    mock.segurar = true;
    tokenRenovado();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      avisar("TOKEN_REFRESHED", "admin-a");
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mock.atualizados).toHaveLength(1);

    await act(async () => {
      mock.segurarEnvio?.concluir();
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(idsEnviados()).toEqual(["prod-1"]);
    expect(fila()).toBeNull();
  });

  it("a renovação que saiu ENTRE a leitura da sessão e a assinatura não se perde", async () => {
    mock.aoAssinar = () => {
      tokenRenovado();
    };
    await montarComRedeDeVolta();
    await passar(1100);

    expect(idsEnviados()).toEqual(["prod-1"]);
    expect(fila()).toBeNull();
  });

  it("sair da tela com a passada ainda lendo a sessão: o fim dela não deixa assinatura para trás", async () => {
    let responder: () => void = () => {};
    mock.sessao.espera = new Promise<void>((resolve) => {
      responder = resolve;
    });
    await montarComRedeDeVolta();
    expect(mock.ouvintes.size).toBe(0);

    act(() => {
      raiz.unmount();
    });
    // A leitura volta DEPOIS do desmonte, com erro de rede.
    await act(async () => {
      responder();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mock.ouvintes.size).toBe(0);
    expect(mock.atualizados).toHaveLength(0);
    raiz = createRoot(host);
  });

  it("sair da tela desfaz a espera: sem assinatura sobrando e sem envio depois do desmonte", async () => {
    await montarComRedeDeVolta();
    expect(mock.ouvintes.size).toBe(1);

    act(() => {
      raiz.unmount();
    });
    expect(mock.ouvintes.size).toBe(0);

    tokenRenovado();
    avisar("TOKEN_REFRESHED", "admin-a");
    await passar(1100);
    expect(mock.atualizados).toHaveLength(0);
    expect(fila()).toHaveLength(1);
    // o afterEach desmonta de novo: recria a raiz para não duplicar.
    raiz = createRoot(host);
  });
});
