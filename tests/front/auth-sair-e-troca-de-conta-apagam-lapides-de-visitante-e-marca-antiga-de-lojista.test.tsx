// @vitest-environment jsdom
//
// Prova de mutação (24/11/2026): apagar `localStorage.removeItem(...)` das duas
// chaves abaixo, em `apagarDadosLocaisDaConta` (AuthContext), não derrubava
// NENHUM dos 19 testes de Sair e troca de conta. Eram as duas únicas chaves da
// lista sem teste:
//
//  - `marketplace_cart_tombstones_v1`: as lápides do carrinho de VISITANTE
//    ("esta linha foi tirada às T", valem por até 7 dias). Se sobram, a conta
//    que entra tem a linha dela escondida por um "tirar" que não foi dela.
//  - `ikcous_is_admin`: a marca antiga de lojista, sem id da conta. O "Sair"
//    ainda a lê (`haMarcaDeLojistaNoAparelho`) para decidir se apaga o catálogo
//    de admin do cofre; se ela sobra, o próximo logout de cliente comum apaga
//    o catálogo offline sem motivo.
//
// Vale no Sair (SIGNED_OUT) e na troca direta A -> B. A MESMA conta
// reemitindo evento não apaga nada.
//
// Harness copiado de auth-troca-direta-de-conta-apaga-os-dados-locais-da-anterior.test.tsx.
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

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (userId: string | null) => void;
}) {
  const ctx = useContext(authContext) as { user: { id: string } | null };
  aoAtualizar(ctx.user?.id ?? null);
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
let aoAtualizar: ReturnType<typeof vi.fn<(userId: string | null) => void>>;

beforeEach(() => {
  vi.stubGlobal("localStorage", criarLocalStorageFake());
  aoAtualizar = vi.fn<(userId: string | null) => void>(() => {});
  callbacksAuth = [];
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
const sessao = (id: string) => ({ access_token: `tok-${id}`, user: { id } });
async function emitir(evento: string, id: string | null) {
  await act(async () => {
    for (const callback of callbacksAuth)
      void callback(evento, id ? sessao(id) : null);
    await new Promise((r) => setTimeout(r, 30));
  });
}

const LAPIDES_DE_VISITANTE = "marketplace_cart_tombstones_v1";
const MARCA_ANTIGA_DE_LOJISTA = "ikcous_is_admin";
// Trabalho em curso do dono da conta: fica, no Sair e na troca direta.
const FILA_DA_CONTA = "orders_offline_updates_queue:A";

function semearAparelhoDaA() {
  localStorage.setItem(
    LAPIDES_DE_VISITANTE,
    JSON.stringify([{ key: "prod-1", deletedAt: Date.now() }]),
  );
  localStorage.setItem(MARCA_ANTIGA_DE_LOJISTA, "true");
  localStorage.setItem(FILA_DA_CONTA, "[]");
}

it("o Sair apaga as lápides do carrinho de visitante e a marca antiga de lojista", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  semearAparelhoDaA();

  await emitir("SIGNED_OUT", null);

  expect(localStorage.getItem(LAPIDES_DE_VISITANTE)).toBeNull();
  expect(localStorage.getItem(MARCA_ANTIGA_DE_LOJISTA)).toBeNull();
  expect(localStorage.getItem(FILA_DA_CONTA)).not.toBeNull();
});

it("a troca direta A -> B apaga as lápides do carrinho de visitante e a marca antiga de lojista", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  semearAparelhoDaA();

  await emitir("SIGNED_IN", "B");

  expect(aoAtualizar.mock.calls.at(-1)![0]).toBe("B");
  expect(localStorage.getItem(LAPIDES_DE_VISITANTE)).toBeNull();
  expect(localStorage.getItem(MARCA_ANTIGA_DE_LOJISTA)).toBeNull();
  expect(localStorage.getItem(FILA_DA_CONTA)).not.toBeNull();
});

it("limite: a MESMA conta reemitindo SIGNED_IN / TOKEN_REFRESHED não apaga as lápides", async () => {
  await montar();
  await emitir("SIGNED_IN", "A");
  semearAparelhoDaA();

  await emitir("SIGNED_IN", "A");
  await emitir("TOKEN_REFRESHED", "A");

  expect(localStorage.getItem(LAPIDES_DE_VISITANTE)).not.toBeNull();
  expect(localStorage.getItem(MARCA_ANTIGA_DE_LOJISTA)).toBe("true");
});
