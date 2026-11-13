// @vitest-environment jsdom
//
// Duas consultas do perfil no ar ao mesmo tempo (tablet com a consulta A
// atrasada; o nome é trocado no celular; o tablet consulta de novo e mostra o
// nome novo): a resposta ANTIGA, chegando depois, não pode recolocar o nome
// velho. A guarda por conta já existia; faltava a guarda por ORDEM — cada
// consulta leva um número, e resposta de número menor que o já aplicado é
// descartada.
//
// Harness copiado de auth-troca-direta-de-conta-zera-o-perfil-da-anterior.test.tsx.
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
  fetchProfile: (usuario?: { id: string }) => Promise<void>;
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
    fetchProfile: (usuario?: { id: string }) => Promise<void>;
  };
  aoAtualizar({
    userId: ctx.user?.id ?? null,
    nome: ctx.profile?.full_name ?? null,
    fetchProfile: ctx.fetchProfile,
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
/** Cada consulta do perfil recebe, em ordem, a próxima resposta desta fila. */
let consultas: Array<(r: RespostaPerfil) => void>;
let consultasFeitas: number;

const comNome = (nome: string): RespostaPerfil => ({
  data: [{ full_name: nome }],
  error: null,
});

beforeEach(() => {
  vi.stubGlobal("localStorage", criarLocalStorageFake());
  aoAtualizar = vi.fn<(snapshot: Snapshot) => void>(() => {});
  callbacksAuth = [];
  consultas = [];
  consultasFeitas = 0;
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
    (nome: string) => {
      if (nome !== "get_my_complete_profile") {
        return Promise.resolve({ data: false, error: null });
      }
      consultasFeitas += 1;
      return new Promise<RespostaPerfil>((resolve) => {
        consultas.push(resolve);
      });
    },
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
async function esperar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function entrar(id: string) {
  await act(async () => {
    for (const callback of callbacksAuth)
      void callback("SIGNED_IN", sessao(id));
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function responder(indice: number, resposta: RespostaPerfil) {
  await act(async () => {
    consultas.at(indice)!(resposta);
    await new Promise((r) => setTimeout(r, 30));
  });
}
/** Dispara uma consulta nova do perfil da conta A, como a tela faz ao reler. */
async function consultarDeNovo(id: string) {
  await act(async () => {
    void atual().fetchProfile({ id });
    await new Promise((r) => setTimeout(r, 30));
  });
}

it("a resposta ANTIGA que chega depois da mais nova não recoloca o nome velho", async () => {
  await montar();
  await entrar("A"); // consulta 0 (a atrasada)
  expect(consultasFeitas).toBe(1);
  await consultarDeNovo("A"); // consulta 1 (a mais nova)
  expect(consultasFeitas).toBe(2);

  await responder(1, comNome("Nome novo"));
  expect(atual()).toMatchObject({ userId: "A", nome: "Nome novo" });

  await responder(0, comNome("Nome velho"));
  expect(atual().nome).toBe("Nome novo");
});

it("na ordem normal (a antiga chega primeiro) a mais nova ainda vence", async () => {
  await montar();
  await entrar("A");
  await consultarDeNovo("A");
  await responder(0, comNome("Nome velho"));
  expect(atual().nome).toBe("Nome velho");
  await responder(1, comNome("Nome novo"));
  expect(atual().nome).toBe("Nome novo");
});

it("a mais nova FALHAR não impede a antiga de ser aplicada (nada mais novo foi aplicado)", async () => {
  await montar();
  await entrar("A");
  await consultarDeNovo("A");
  await responder(1, { data: null, error: { message: "sem rede" } });
  expect(atual().nome).toBeNull();
  await responder(0, comNome("Único dado que chegou"));
  expect(atual().nome).toBe("Único dado que chegou");
});

it("conta trocada: a resposta de A que chega depois da entrada de B continua descartada", async () => {
  await montar();
  await entrar("A"); // consulta 0
  await entrar("B"); // consulta 1
  await responder(1, comNome("Bia"));
  expect(atual()).toMatchObject({ userId: "B", nome: "Bia" });
  await responder(0, comNome("Ana"));
  expect(atual()).toMatchObject({ userId: "B", nome: "Bia" });
});

it("depois de sair e entrar de novo, o perfil novo é aplicado mesmo com números de consulta já usados", async () => {
  await montar();
  await entrar("A");
  await responder(0, comNome("Ana"));
  expect(atual().nome).toBe("Ana");
  await entrar("B");
  await responder(1, comNome("Bia"));
  expect(atual()).toMatchObject({ userId: "B", nome: "Bia" });
  await esperar();
});
