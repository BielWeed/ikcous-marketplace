// @vitest-environment jsdom
//
// Recarregar a página (F5, aba descartada pelo celular, fechar e reabrir) na
// tela "Nova senha" NÃO pode deixar a pessoa logada no Perfil sem ter trocado a
// senha. O link de recuperação já criou a sessão no aparelho, mas o modo "nova
// senha" só vivia na memória e em `?type=recovery` (que o app apaga do
// endereço): no recarregamento o app via uma sessão comum e abria o Perfil, e
// a senha esquecida continuava valendo.
//
// Agora o modo fica marcado no aparelho (validade curta, presa à conta da
// sessão) e o AuthProvider o devolve ao subir. A marca NÃO dá acesso a nada: só
// mantém a tela "Nova senha" para quem JÁ está com a sessão do link.
//
// RENDER DE VERDADE: AuthProvider real, supabase dublado, e o "recarregar" é
// desmontar e montar de novo com o MESMO localStorage.
import { act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
    },
    rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { message: "não usado" } }),
        }),
      }),
    })),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeCity: "Sao Paulo", storeState: "SP" } }),
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DA_SESSAO = "sb-teste-auth-token";
const UMA_HORA = 60 * 60 * 1000;

interface Sonda {
  isPasswordRecovery: boolean;
  updatePassword: (senha: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

let raiz: Root;
let host: HTMLDivElement;
let emitirAuth: (evento: string, sessao: unknown) => unknown;
let sonda: Sonda;
let armazem: Map<string, string>;

function sessaoDe(id: string) {
  return { access_token: "token-ficticio", user: { id } };
}

function guardarSessao(id: string) {
  armazem.set(CHAVE_DA_SESSAO, JSON.stringify(sessaoDe(id)));
}

/** Mesma chave que o módulo usa; lida pelo localStorage de verdade do teste. */
function marcaGravada(): { uid: string | null; ate: number } | null {
  for (const [chave, valor] of armazem) {
    if (chave.includes("recuperacao")) return JSON.parse(valor);
  }
  return null;
}

const aoNavegar = vi.fn();

async function montar(
  opts: { sessaoDoServidor?: string | null; comTela?: boolean } = {},
) {
  const { supabase } = await import("@/lib/supabase");
  const id = opts.sessaoDoServidor ?? null;
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: id ? sessaoDe(id) : null },
    error: null,
  } as never);
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: id ? { id } : null },
    error: null,
  } as never);
  vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);
  vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(
    (callback: any) => {
      emitirAuth = callback;
      return {
        data: {
          subscription: {
            id: "assinatura-teste",
            callback,
            unsubscribe: vi.fn(),
          },
        },
      };
    },
  );
  const { AuthContext, AuthProvider } = await import("@/contexts/AuthContext");
  const { AuthView } = opts.comTela
    ? await import("@/views/shared/AuthView")
    : { AuthView: null };
  function Espia() {
    const ctx = useContext(AuthContext) as unknown as Sonda;
    const recuperando = ctx.isPasswordRecovery;
    useEffect(() => {
      sonda = ctx;
    });
    return <span data-testid="modo">{String(recuperando)}</span>;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () =>
    raiz.render(
      <AuthProvider>
        <Espia />
        {AuthView ? <AuthView onNavigate={aoNavegar} /> : null}
      </AuthProvider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function desmontar() {
  await act(async () => raiz.unmount());
  host.remove();
}

/** Recarregar a página: tudo da memória some, o localStorage fica. */
async function recarregar(
  opts: { sessaoDoServidor?: string | null; comTela?: boolean } = {},
) {
  await desmontar();
  vi.resetModules();
  await montar(opts);
}

async function emitir(evento: string, id: string | null) {
  await act(async () => {
    void emitirAuth(evento, id ? sessaoDe(id) : null);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
    key: (i: number) => [...armazem.keys()].at(i) ?? null,
    get length() {
      return armazem.size;
    },
  });
  window.history.replaceState({}, "", "/");
  vi.resetModules();
});

afterEach(async () => {
  if (host?.isConnected) await desmontar();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AuthProvider — a tela Nova senha sobrevive ao recarregamento", () => {
  it("na tela: depois de recarregar aparece 'Nova Senha' e a pessoa NÃO é mandada ao Perfil", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    guardarSessao("conta-a");
    aoNavegar.mockClear();
    await recarregar({ sessaoDoServidor: "conta-a", comTela: true });

    expect(host.textContent).toContain("Nova Senha");
    expect(host.textContent).toContain("ATUALIZAR SENHA");
    expect(aoNavegar).not.toHaveBeenCalledWith("profile");
  });

  it("controle na tela: com sessão comum (sem marca) o app segue para o Perfil como sempre", async () => {
    guardarSessao("conta-a");
    aoNavegar.mockClear();
    await montar({ sessaoDoServidor: "conta-a", comTela: true });

    expect(host.textContent).not.toContain("Nova Senha");
    expect(aoNavegar).toHaveBeenCalledWith("profile");
  });

  it("abriu o link, recarregou antes de salvar: continua em Nova senha", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    expect(sonda.isPasswordRecovery).toBe(true);

    // O app apaga ?type=recovery do endereço e o supabase-js grava a sessão.
    guardarSessao("conta-a");
    await recarregar({ sessaoDoServidor: "conta-a" });

    expect(sonda.isPasswordRecovery).toBe(true);
  });

  it("por ?type=recovery no endereço, antes de existir sessão, e recarregou depois da sessão criada", async () => {
    window.history.replaceState({}, "", "/?type=recovery");
    await montar();
    expect(sonda.isPasswordRecovery).toBe(true);

    guardarSessao("conta-a");
    window.history.replaceState({}, "", "/");
    await recarregar({ sessaoDoServidor: "conta-a" });

    expect(sonda.isPasswordRecovery).toBe(true);
  });

  it("aberto pelo endereço, a marca passa a valer só para a conta que a sessão trouxe", async () => {
    window.history.replaceState({}, "", "/?type=recovery");
    await montar();
    expect(marcaGravada()?.uid).toBeNull();

    await emitir("SIGNED_IN", "conta-a");
    expect(marcaGravada()?.uid).toBe("conta-a");

    // Outra pessoa na sessão do aparelho depois: a marca da primeira não vale.
    guardarSessao("conta-b");
    window.history.replaceState({}, "", "/");
    await recarregar({ sessaoDoServidor: "conta-b" });
    expect(sonda.isPasswordRecovery).toBe(false);
  });

  it("recarregar duas vezes seguidas segue em Nova senha", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    guardarSessao("conta-a");
    await recarregar({ sessaoDoServidor: "conta-a" });
    await recarregar({ sessaoDoServidor: "conta-a" });

    expect(sonda.isPasswordRecovery).toBe(true);
  });

  it("depois de trocar a senha com sucesso, recarregar abre o app normal", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    guardarSessao("conta-a");
    await recarregar({ sessaoDoServidor: "conta-a" });
    expect(sonda.isPasswordRecovery).toBe(true);

    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: { id: "conta-a" } },
      error: null,
    } as never);
    await act(async () => {
      await sonda.updatePassword("SenhaNova#123");
    });
    expect(sonda.isPasswordRecovery).toBe(false);

    await recarregar({ sessaoDoServidor: "conta-a" });
    expect(sonda.isPasswordRecovery).toBe(false);
  });

  it("troca de senha RECUSADA pelo servidor mantém a marca: recarregar segue em Nova senha", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    guardarSessao("conta-a");
    await recarregar({ sessaoDoServidor: "conta-a" });

    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: null },
      error: { code: "weak_password", message: "fraca" },
    } as never);
    await act(async () => {
      await sonda.updatePassword("123");
    });
    expect(sonda.isPasswordRecovery).toBe(true);

    await recarregar({ sessaoDoServidor: "conta-a" });
    expect(sonda.isPasswordRecovery).toBe(true);
  });

  it("saiu da conta: a marca some e o recarregamento não volta para Nova senha", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    guardarSessao("conta-a");
    await emitir("SIGNED_OUT", null);
    expect(sonda.isPasswordRecovery).toBe(false);
    expect(marcaGravada()).toBeNull();

    // Mesmo que a sessão ainda estivesse no aparelho (outra aba entrou de novo).
    await recarregar({ sessaoDoServidor: "conta-a" });
    expect(sonda.isPasswordRecovery).toBe(false);
  });

  it.each([
    ["servidor confirma a saída", null],
    ["servidor devolve erro (rede caída)", { message: "rede" }],
  ])(
    "tocou em Sair no meio da troca (%s): a marca some e recarregar não volta para Nova senha",
    async (_nome, erroDoServidor) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await montar({ sessaoDoServidor: "conta-a" });
      await emitir("PASSWORD_RECOVERY", "conta-a");
      guardarSessao("conta-a");
      expect(marcaGravada()).not.toBeNull();

      const { supabase } = await import("@/lib/supabase");
      vi.mocked(supabase.auth.signOut).mockResolvedValue({
        error: erroDoServidor,
      } as never);
      await act(async () => {
        await sonda.logout();
      });
      expect(sonda.isPasswordRecovery).toBe(false);
      expect(marcaGravada()).toBeNull();

      // A sessão ainda estaria no aparelho (outra aba entrou de novo).
      guardarSessao("conta-a");
      await recarregar({ sessaoDoServidor: "conta-a" });
      expect(sonda.isPasswordRecovery).toBe(false);
    },
  );

  it("outra conta entrou no lugar: a marca da anterior não vale e é apagada", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    // A sessão guardada agora é de OUTRA pessoa.
    guardarSessao("conta-b");
    await recarregar({ sessaoDoServidor: "conta-b" });

    expect(sonda.isPasswordRecovery).toBe(false);
    expect(marcaGravada()).toBeNull();
  });

  it("marca vencida (mais de 1 hora) não vale: abre o app normal e a marca é apagada", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    guardarSessao("conta-a");
    const marca = marcaGravada();
    expect(marca).not.toBeNull();
    // Envelhece a marca: venceu há 1 minuto.
    for (const chave of [...armazem.keys()]) {
      if (chave.includes("recuperacao")) {
        armazem.set(
          chave,
          JSON.stringify({ ...marca, ate: Date.now() - 60_000 }),
        );
      }
    }
    await recarregar({ sessaoDoServidor: "conta-a" });

    expect(sonda.isPasswordRecovery).toBe(false);
    expect(marcaGravada()).toBeNull();
  });

  it("marca sem sessão no aparelho não prende ninguém numa tela sem conta", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    // A sessão nunca chegou a ser guardada (ou expirou e foi apagada).
    armazem.delete(CHAVE_DA_SESSAO);
    await recarregar({ sessaoDoServidor: null });

    expect(sonda.isPasswordRecovery).toBe(false);
    expect(marcaGravada()).toBeNull();
  });

  it("marca ilegível (texto qualquer) é ignorada sem derrubar o app", async () => {
    guardarSessao("conta-a");
    armazem.set("ikcous_recuperacao_de_senha", "isto não é json {");
    await montar({ sessaoDoServidor: "conta-a" });

    expect(sonda.isPasswordRecovery).toBe(false);
  });

  it("sem nenhuma marca e com sessão comum: abre o app normal (nada do que já funcionava muda)", async () => {
    guardarSessao("conta-a");
    await montar({ sessaoDoServidor: "conta-a" });

    expect(sonda.isPasswordRecovery).toBe(false);
  });

  it("pede o link de novo e abre o segundo: a validade da marca recomeça", async () => {
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");
    const primeira = marcaGravada();
    expect(primeira).not.toBeNull();
    // A primeira marca está quase vencendo.
    for (const chave of [...armazem.keys()]) {
      if (chave.includes("recuperacao")) {
        armazem.set(
          chave,
          JSON.stringify({ ...primeira, ate: Date.now() + 1000 }),
        );
      }
    }
    await emitir("PASSWORD_RECOVERY", "conta-a");
    const segunda = marcaGravada();
    expect(segunda?.ate).toBeGreaterThan(Date.now() + UMA_HORA - 60_000);
  });

  it("localStorage quebrado (modo privado cheio): o app não cai e o modo segue na memória", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("indisponível");
      },
      key: () => null,
      length: 0,
    });
    await montar();
    await emitir("PASSWORD_RECOVERY", "conta-a");

    expect(sonda.isPasswordRecovery).toBe(true);
  });
});
