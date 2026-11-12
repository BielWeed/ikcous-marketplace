// @vitest-environment jsdom
//
// E-mail da MESMA conta mudou no servidor (a loja atendeu uma correção, ou a
// cliente confirmou a troca em outro aparelho): o aparelho que ficou aberto
// recebe a sessão renovada (TOKEN_REFRESHED/USER_UPDATED) com o e-mail NOVO e
// o MESMO id. O `user` do contexto continuava o objeto antigo e "Minha conta"
// mostrava o e-mail velho. O `user` só pode ser trocado quando o e-mail muda de
// verdade: cada evento traz um objeto novo, e trocar sempre reabriria o laço de
// efeitos que o `setUser` evita ("PREVENT INFINITE EFFECT LOOPS").
//
// Harness copiado de auth-troca-direta-de-conta-zera-o-perfil-da-anterior.
import { supabase } from "@/lib/supabase";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface UsuarioDaSonda {
  id: string;
  email?: string;
}

interface Snapshot {
  user: UsuarioDaSonda | null;
  /** E-mail da sessão guardada (para provar que ela já vinha certa). */
  emailDaSessao: string | null;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    user: UsuarioDaSonda | null;
    session: { user: UsuarioDaSonda } | null;
  };
  aoAtualizar({
    user: ctx.user,
    emailDaSessao: ctx.session?.user?.email ?? null,
  });
  return null;
}

function criarLocalStorageFake() {
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

let raiz: Root;
let hospedeiro: HTMLDivElement;
let callbacksAuth: Array<(event: string, session: unknown) => unknown>;
let aoAtualizar: ReturnType<typeof vi.fn<(snapshot: Snapshot) => void>>;

beforeEach(() => {
  vi.stubGlobal("localStorage", criarLocalStorageFake());
  aoAtualizar = vi.fn<(snapshot: Snapshot) => void>(() => {});
  callbacksAuth = [];
  vi.mocked(supabase.auth.signOut)
    .mockReset()
    .mockResolvedValue({ error: null });
  (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { session: null },
  });
  (
    supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>
  ).mockImplementation(
    (callback: (event: string, session: unknown) => unknown) => {
      callbacksAuth.push(callback);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  );
  (supabase.rpc as ReturnType<typeof vi.fn>).mockImplementation(
    (nome: string) =>
      nome === "get_my_complete_profile"
        ? Promise.resolve({ data: [{ full_name: "Ana" }], error: null })
        : Promise.resolve({ data: false, error: null }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function montar() {
  vi.resetModules();
  const { AuthContext, AuthProvider } = await import("@/contexts/AuthContext");
  await act(async () => {
    raiz.render(
      <AuthProvider>
        <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
      </AuthProvider>,
    );
  });
}
const atual = () => aoAtualizar.mock.calls.at(-1)![0] as Snapshot;

/** Sempre um objeto NOVO por evento, como o cliente do Supabase faz. */
const sessao = (id: string, email?: string) => ({
  access_token: `tok-${id}-${Math.random()}`,
  user: email === undefined ? { id } : { id, email },
});
async function emitir(evento: string, sessaoDoEvento: unknown) {
  await act(async () => {
    for (const callback of callbacksAuth) {
      void callback(evento, sessaoDoEvento);
    }
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe("e-mail da mesma conta mudou: o user do contexto acompanha", () => {
  it.each(["USER_UPDATED", "TOKEN_REFRESHED"] as const)(
    "%s com o MESMO id e e-mail novo troca o user",
    async (evento) => {
      await montar();
      await emitir("SIGNED_IN", sessao("conta-1", "ana@example.com"));
      expect(atual().user).toMatchObject({
        id: "conta-1",
        email: "ana@example.com",
      });

      await emitir(evento, sessao("conta-1", "ana.nova@example.com"));
      expect(atual().user).toMatchObject({
        id: "conta-1",
        email: "ana.nova@example.com",
      });
      expect(atual().emailDaSessao).toBe("ana.nova@example.com");
    },
  );

  it("USER_UPDATED e depois TOKEN_REFRESHED: o e-mail novo fica e o user não é trocado de novo", async () => {
    await montar();
    await emitir("SIGNED_IN", sessao("conta-1", "ana@example.com"));
    await emitir("USER_UPDATED", sessao("conta-1", "ana.nova@example.com"));
    const aposAtualizar = atual().user;
    expect(aposAtualizar?.email).toBe("ana.nova@example.com");

    await emitir("TOKEN_REFRESHED", sessao("conta-1", "ana.nova@example.com"));
    expect(atual().user?.email).toBe("ana.nova@example.com");
    expect(atual().user).toBe(aposAtualizar);
  });

  it("controle: mesmo id e mesmo e-mail em vários eventos mantém a MESMA referência do user", async () => {
    await montar();
    await emitir("SIGNED_IN", sessao("conta-1", "ana@example.com"));
    const primeiro = atual().user;
    expect(primeiro?.email).toBe("ana@example.com");

    for (const evento of ["TOKEN_REFRESHED", "USER_UPDATED", "SIGNED_IN"]) {
      await emitir(evento, sessao("conta-1", "ana@example.com"));
      expect(atual().user).toBe(primeiro);
    }
    // O laço que o comentário do `setUser` evita: nenhum objeto `user`
    // diferente passou pela tela.
    const referencias = new Set(
      aoAtualizar.mock.calls
        .map(([snapshot]) => snapshot.user)
        .filter((u) => u !== null),
    );
    expect(referencias.size).toBe(1);
  });

  it("id diferente: troca de usuário como antes", async () => {
    await montar();
    await emitir("SIGNED_IN", sessao("conta-1", "ana@example.com"));
    await emitir("SIGNED_IN", sessao("conta-2", "ana@example.com"));
    expect(atual().user).toMatchObject({
      id: "conta-2",
      email: "ana@example.com",
    });

    await emitir("SIGNED_IN", sessao("conta-3", "bia@example.com"));
    expect(atual().user).toMatchObject({
      id: "conta-3",
      email: "bia@example.com",
    });
  });

  it("sem sessão: SIGNED_OUT zera o user; INITIAL_SESSION vazio não derruba quem já estava", async () => {
    await montar();
    await emitir("SIGNED_IN", sessao("conta-1", "ana@example.com"));
    const quemEstava = atual().user;

    await emitir("INITIAL_SESSION", null);
    expect(atual().user).toBe(quemEstava);

    await emitir("SIGNED_OUT", null);
    expect(atual().user).toBeNull();

    // INITIAL_SESSION sem sessão e sem ninguém: continua sem user.
    await emitir("INITIAL_SESSION", null);
    expect(atual().user).toBeNull();
  });

  it("e-mail ausente nos dois lados é tratado como igual: mesma referência", async () => {
    await montar();
    await emitir("SIGNED_IN", sessao("conta-1"));
    const primeiro = atual().user;
    expect(primeiro).toMatchObject({ id: "conta-1" });
    expect(primeiro?.email).toBeUndefined();

    await emitir("TOKEN_REFRESHED", sessao("conta-1"));
    expect(atual().user).toBe(primeiro);
  });

  it("e-mail que passa a existir (antes ausente) também chega ao user", async () => {
    await montar();
    await emitir("SIGNED_IN", sessao("conta-1"));
    await emitir("USER_UPDATED", sessao("conta-1", "ana@example.com"));
    expect(atual().user?.email).toBe("ana@example.com");
  });
});
