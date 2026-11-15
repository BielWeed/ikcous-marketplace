// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    rpc: vi.fn().mockImplementation((nome: string) =>
      Promise.resolve({
        data: nome === "is_admin" ? false : null,
        error: null,
      }),
    ),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://falso.supabase.co",
  lerChaveSupabase: () => "chave-falsa",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag de testes do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ external: { google: true } }),
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([
  { view: "auth", from: "checkout" },
  { view: "auth", from: "order-details", id: "pedido-falso" },
  { view: "auth", requested: "admin" },
  { view: "auth", requested: "https://fora.invalid" },
])("SIGNED_IN depois de hash='' mantém destino seguro (%j)", async (origem) => {
  const { guardarDestinoGoogle } = await import("@/lib/google-login");
  const { destinoPosLogin, idDoDestinoPosLogin } = await import(
    "@/lib/destinoPosLogin"
  );
  history.replaceState(origem, "", "/auth");
  guardarDestinoGoogle();
  history.replaceState(
    null,
    "",
    "/auth#access_token=falso&refresh_token=falso",
  );
  const { AuthProvider } = await import("@/contexts/AuthContext");
  const { AuthView } = await import("@/views/shared/AuthView");
  const { supabase } = await import("@/lib/supabase");
  vi.mocked(supabase.auth.onAuthStateChange).mockClear();
  const destinos: unknown[] = [];
  const sucesso = () => {
    const destino = destinoPosLogin(history.state);
    destinos.push({
      destino,
      id: destino ? idDoDestinoPosLogin(destino, history.state) : undefined,
    });
    if (destino) history.replaceState({ view: destino }, "", `/${destino}`);
  };
  await act(async () =>
    root.render(
      <AuthProvider>
        <AuthView onSuccess={sucesso} onNavigate={vi.fn()} />
      </AuthProvider>,
    ),
  );
  // Ordem REAL do SDK implícito: lê os tokens -> limpa hash (zera state) -> anuncia a sessão.
  location.hash = "";
  expect(history.state == null).toBe(true); // Chrome: null; jsdom: undefined.
  const callback = vi.mocked(supabase.auth.onAuthStateChange).mock.calls[0][0];
  await act(async () => {
    await callback("SIGNED_IN", {
      user: { id: "cliente-falsa", identities: [{ provider: "google" }] },
      access_token: "falso",
    } as never);
  });
  const esperado =
    origem.from === "checkout"
      ? "checkout"
      : origem.from === "order-details"
        ? "order-details"
        : "profile";
  expect(destinos).toContainEqual({
    destino: esperado,
    id: origem.from === "order-details" ? "pedido-falso" : undefined,
  });
  expect(location.pathname).toBe(`/${esperado}`);
  expect(host.textContent).not.toContain("Seu WhatsApp");
});
