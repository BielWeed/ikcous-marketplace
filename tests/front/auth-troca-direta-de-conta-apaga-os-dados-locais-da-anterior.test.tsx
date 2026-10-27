// @vitest-environment jsdom
//
// Troca direta de conta (A -> B, sem passar por SIGNED_OUT): só o caminho do
// "Sair" apagava os dados locais da conta que saía. Na troca direta o CEP da A
// (`ikcous_last_shipping_cep`, lido sem dono pelo checkout) e os pedidos dela
// guardados no aparelho ficavam para a B. Agora a troca de PESSOA faz a mesma
// limpeza do Sair (a mesma função, não uma cópia); a MESMA conta reemitindo
// evento (token renovado, volta à aba) não apaga nada.
//
// Harness copiado de auth-troca-direta-de-conta-zera-o-perfil-da-anterior.test.tsx.
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

/** Aparelho com a A usando: CEP, pedidos, cache de frete, carrinho e coisas por usuário. */
function semearDadosDaA() {
  localStorage.setItem("ikcous_last_shipping_cep", "01310-100");
  localStorage.setItem("ikcous_shipping_cache_01310-100", "{}");
  localStorage.setItem(
    "ikcous_orders_cache_A",
    JSON.stringify([{ id: "ped-A" }]),
  );
  localStorage.setItem("ikcous_addresses_cache_A", "[]");
  localStorage.setItem("marketplace_cart_v1", "[]");
  // Escrita pendente legítima e rascunho por usuário NÃO são apagados (nem no
  // Sair): são trabalho em curso do dono da conta, que os reencontra ao voltar.
  localStorage.setItem("orders_offline_updates_queue:A", "[]");
  localStorage.setItem("admin_banner_form_draft:A", "{}");
}

const dadosDaAAindaExistem = () =>
  [
    "ikcous_last_shipping_cep",
    "ikcous_shipping_cache_01310-100",
    "ikcous_orders_cache_A",
    "ikcous_addresses_cache_A",
    "marketplace_cart_v1",
  ].filter((chave) => localStorage.getItem(chave) !== null);

it("troca direta A -> B apaga o CEP e os pedidos guardados da A (a mesma limpeza do Sair)", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  semearDadosDaA();
  expect(dadosDaAAindaExistem()).toHaveLength(5);

  await emitir("SIGNED_IN", "B");

  expect(atual().userId).toBe("B");
  expect(dadosDaAAindaExistem()).toEqual([]);
  // O que é por usuário e é trabalho pendente fica, como no Sair.
  expect(localStorage.getItem("orders_offline_updates_queue:A")).not.toBeNull();
  expect(localStorage.getItem("admin_banner_form_draft:A")).not.toBeNull();
});

it("limite: a MESMA conta reemitindo SIGNED_IN / TOKEN_REFRESHED não apaga nada", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  semearDadosDaA();

  await emitir("SIGNED_IN", "A");
  await emitir("TOKEN_REFRESHED", "A");

  expect(dadosDaAAindaExistem()).toHaveLength(5);
});

it("limite: visitante -> conta (sem conta anterior) não apaga o que o visitante guardou", async () => {
  await montar();
  localStorage.setItem("ikcous_last_shipping_cep", "01310-100");

  await emitir("SIGNED_IN", "A");

  expect(localStorage.getItem("ikcous_last_shipping_cep")).toBe("01310-100");
});

it("o Sair continua apagando tudo (SIGNED_OUT)", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  semearDadosDaA();

  await act(async () => {
    for (const callback of callbacksAuth) void callback("SIGNED_OUT", null);
    await new Promise((r) => setTimeout(r, 30));
  });

  expect(dadosDaAAindaExistem()).toEqual([]);
});
