// @vitest-environment jsdom
//
// O RASCUNHO DO PEDIDO DE DEVOLUÇÃO (itens, motivo, texto da cliente, solução)
// mora no `sessionStorage` da aba, por conta e por pedido
// (src/lib/rascunho-da-devolucao.ts), e vale 2 h. A tela já não o mostra a
// outra conta, mas o "Sair" não o apagava: num aparelho compartilhado, o texto
// da cliente anterior ficava na aba, legível nas ferramentas de
// desenvolvedor. Agora o logout apaga TODOS os rascunhos de devolução da aba,
// nos dois caminhos de saída (`SIGNED_OUT` e o `logout()` com o `signOut()`
// falhando). Controle: chave de outro prefixo na mesma aba continua.
//
// Andaime: o MESMO de checkout-rascunho-limpa-no-logout.test.tsx.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type RascunhoDaDevolucao,
  lerRascunhoDaDevolucao,
  salvarRascunhoDaDevolucao,
} from "@/lib/rascunho-da-devolucao";

const PREFIXO = "ikcous:rascunho-da-devolucao:";
// Contém o prefixo, mas não COMEÇA por ele: não é rascunho de devolução.
const CHAVE_PARECIDA = `outra-coisa:${PREFIXO}user-a:pedido-1`;
const CHAVE_DE_OUTRO_PREFIXO = "ikcous:outra-coisa-da-aba";
const CHAVE_DO_TOKEN = "sb-teste-auth-token";

const RASCUNHO: RascunhoDaDevolucao = {
  passo: 3,
  itens: [["oi-1", 1]],
  motivo: "desisti",
  detalhe: "texto que só a cliente A escreveu",
  resolucao: "reembolso",
  metodo: null,
  fotos: 2,
};

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      resend: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado nestes testes" },
            }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  userId: string | null;
  logout: () => Promise<void>;
}

type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    user: { id: string } | null;
    logout: () => Promise<void>;
  };
  aoAtualizar({
    userId: ctx.user?.id ?? null,
    logout: ctx.logout,
  });
  return null;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function criarArmazemFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

function sessaoDe(userId: string) {
  return {
    user: { id: userId, app_metadata: {} },
    access_token: `tok-${userId}`,
  };
}

function chavesDeRascunho(): string[] {
  const s = globalThis.sessionStorage;
  const chaves: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const chave = s.key(i);
    if (chave?.startsWith(PREFIXO)) chaves.push(chave);
  }
  return chaves;
}

// Três rascunhos (duas contas, dois pedidos): a varredura apaga todos, não só
// o primeiro — remover enquanto percorre desloca os índices.
function guardarRascunhos() {
  const s = globalThis.sessionStorage;
  salvarRascunhoDaDevolucao(s, "user-a", "pedido-1", RASCUNHO);
  salvarRascunhoDaDevolucao(s, "user-a", "pedido-2", RASCUNHO);
  salvarRascunhoDaDevolucao(s, "user-b", "pedido-3", RASCUNHO);
  s.setItem(CHAVE_PARECIDA, "fica");
  s.setItem(CHAVE_DE_OUTRO_PREFIXO, "fica");
  expect(chavesDeRascunho()).toHaveLength(3);
  expect(lerRascunhoDaDevolucao(s, "user-a", "pedido-1")?.detalhe).toBe(
    "texto que só a cliente A escreveu",
  );
}

function conferirSoOsRascunhosSairam() {
  const s = globalThis.sessionStorage;
  expect(chavesDeRascunho()).toEqual([]);
  expect(lerRascunhoDaDevolucao(s, "user-a", "pedido-1")).toBeNull();
  expect(s.getItem(CHAVE_PARECIDA)).toBe("fica");
  expect(s.getItem(CHAVE_DE_OUTRO_PREFIXO)).toBe("fica");
}

describe("rascunho da devolução — limpo no logout", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarArmazemFake());
    vi.stubGlobal("sessionStorage", criarArmazemFake());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    try {
      globalThis.sessionStorage.clear();
    } catch {
      // O caso do armazenamento bloqueado: o acesso lança de propósito.
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    let callback: AuthChangeCallback = () => {};
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    return { callback: () => callback, aoAtualizar };
  }

  it("SIGNED_OUT apaga todos os rascunhos de devolução e só eles", async () => {
    const { callback, aoAtualizar } = await montarLogado();
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-a");
    guardarRascunhos();

    const cb = callback();
    await act(async () => {
      cb("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    conferirSoOsRascunhosSairam();
  });

  it("logout() com signOut() falhando (rede caída) também apaga os rascunhos", async () => {
    const { aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");
    guardarRascunhos();
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    conferirSoOsRascunhosSairam();
  });

  // A varredura roda dentro de `clearLocalUserData`, ANTES do resto da limpeza
  // do Sair (rastreio, dados da conta e, no ramo do `signOut()` falhando, o
  // token da sessão no `localStorage`). Se o acesso bloqueado lançasse daqui,
  // o Sair parava no meio e o token de quem saiu ficava no aparelho.
  it("sessionStorage que lança no acesso (navegador bloqueando): o Sair termina e apaga o token", async () => {
    const { aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });
    globalThis.localStorage.setItem(CHAVE_DO_TOKEN, "token-de-quem-saiu");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("bloqueado", "SecurityError");
      },
    });

    const estado = ultimoEstado(aoAtualizar)!;
    await expect(
      act(async () => {
        await estado.logout();
        await esperarMicrotarefas();
      }),
    ).resolves.toBeUndefined();
    expect(ultimoEstado(aoAtualizar)?.userId).toBeNull();
    expect(globalThis.localStorage.getItem(CHAVE_DO_TOKEN)).toBeNull();
  });
});
