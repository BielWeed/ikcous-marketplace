// @vitest-environment jsdom
// Montagem de auth-troca-direta-de-conta-zera-o-perfil-da-anterior.test.tsx.
import { supabase } from "@/lib/supabase";
import { act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
let emitirAuth: (evento: string, sessao: unknown) => unknown;
let recuperando = false;

beforeEach(async () => {
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
    key: (i: number) => [...armazem.keys()].at(i) ?? null,
    get length() {
      return armazem.size;
    },
  });
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
  vi.resetModules();
  const { AuthContext, AuthProvider } = await import("@/contexts/AuthContext");
  function Sonda() {
    const valor = useContext(AuthContext)!.isPasswordRecovery;
    useEffect(() => {
      recuperando = valor;
    }, [valor]);
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () =>
    raiz.render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function emitir(evento: string, id: string | null) {
  await act(async () => {
    void emitirAuth(
      evento,
      id ? { access_token: "token-ficticio", user: { id } } : null,
    );
    await new Promise((r) => setTimeout(r, 0));
  });
}

it("A1: saída em outra aba encerra a recuperação", async () => {
  await emitir("PASSWORD_RECOVERY", "conta-a");
  expect(recuperando).toBe(true);
  await emitir("SIGNED_OUT", null);
  expect(recuperando).toBe(false);
});
it("A1: sessão de outra conta não herda a recuperação", async () => {
  await emitir("PASSWORD_RECOVERY", "conta-a");
  expect(recuperando).toBe(true);
  await emitir("SIGNED_IN", "conta-b");
  expect(recuperando).toBe(false);
});
it("A1: renovar a mesma conta mantém a recuperação e um novo link pode iniciá-la para outra", async () => {
  await emitir("PASSWORD_RECOVERY", "conta-a");
  await emitir("TOKEN_REFRESHED", "conta-a");
  expect(recuperando).toBe(true);
  await emitir("PASSWORD_RECOVERY", "conta-b");
  expect(recuperando).toBe(true);
  await emitir("SIGNED_IN", "conta-a");
  expect(recuperando).toBe(false);
});
