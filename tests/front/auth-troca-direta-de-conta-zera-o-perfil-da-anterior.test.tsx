// @vitest-environment jsdom
//
// Troca direta de conta (A -> B, sem passar por SIGNED_OUT): o `user` vira B
// na hora, mas o `profile` continuava o de A até a consulta do perfil de B
// responder — e se ela FALHASSE, ficava para sempre: B via o nome, o avatar e
// a capa de A. O perfil da conta anterior tem de sumir assim que o usuário
// muda; a mesma conta reemitindo evento (token renovado) não o apaga.
//
// Harness copiado de auth-sessao-tardia-no-boot-nao-se-perde.test.tsx.
import { supabase } from "@/lib/supabase";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

interface Snapshot {
  userId: string | null;
  nome: string | null;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    user: { id: string } | null;
    profile: { full_name?: string } | null;
  };
  aoAtualizar({
    userId: ctx.user?.id ?? null,
    nome: ctx.profile?.full_name ?? null,
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

type RespostaPerfil = { data: unknown; error: unknown };
let raiz: Root;
let hospedeiro: HTMLDivElement;
let callbacksAuth: Array<(event: string, session: unknown) => unknown>;
let aoAtualizar: ReturnType<typeof vi.fn<(snapshot: Snapshot) => void>>;
/** Perfil que o servidor devolve a quem estiver logado agora. */
let perfilDaVez: () => Promise<RespostaPerfil>;

const perfil = (nome: string) => async () => ({
  data: [{ full_name: nome }],
  error: null,
});
const perfilFalha = async (): Promise<RespostaPerfil> => ({
  data: null,
  error: { message: "sem rede" },
});

beforeEach(() => {
  vi.stubGlobal("localStorage", criarLocalStorageFake());
  aoAtualizar = vi.fn<(snapshot: Snapshot) => void>(() => {});
  callbacksAuth = [];
  perfilDaVez = perfil("Ana");
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
        ? perfilDaVez()
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
const sessao = (id: string) => ({ access_token: `tok-${id}`, user: { id } });
async function emitir(evento: string, id: string) {
  await act(async () => {
    for (const callback of callbacksAuth) void callback(evento, sessao(id));
    await new Promise((r) => setTimeout(r, 30));
  });
}

it("troca direta A -> B com a consulta do perfil de B falhando não deixa o perfil de A na tela", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  expect(atual()).toEqual({ userId: "A", nome: "Ana" });
  perfilDaVez = perfilFalha;
  await emitir("SIGNED_IN", "B");
  expect(atual().userId).toBe("B");
  expect(atual().nome).toBeNull();
});

it("troca direta A -> B: o perfil de A some antes de o de B chegar, e depois vem o de B", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  let entregar!: (r: RespostaPerfil) => void;
  perfilDaVez = () =>
    new Promise<RespostaPerfil>((resolve) => {
      entregar = resolve;
    });
  await emitir("SIGNED_IN", "B");
  expect(atual().userId).toBe("B");
  expect(atual().nome).toBeNull();
  await act(async () => {
    entregar({ data: [{ full_name: "Bia" }], error: null });
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(atual()).toEqual({ userId: "B", nome: "Bia" });
});

it("a mesma conta reemitindo evento com a consulta falhando mantém o perfil que já tinha", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  expect(atual().nome).toBe("Ana");
  perfilDaVez = perfilFalha;
  await emitir("TOKEN_REFRESHED", "A");
  expect(atual()).toEqual({ userId: "A", nome: "Ana" });
});
