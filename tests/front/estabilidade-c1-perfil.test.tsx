// @vitest-environment jsdom
import { supabase } from "@/lib/supabase";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    rpc: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/inscricao-de-push-da-conta", () => ({
  soltarInscricaoDoAparelho: vi.fn(),
  cancelarInscricaoDaConta: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda({
  contexto,
  observar,
}: {
  contexto: React.Context<any>;
  observar: (valor: any) => void;
}) {
  observar(useContext(contexto));
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => void valores.set(k, v),
    removeItem: (k: string) => void valores.delete(k),
    key: (i: number) => Array.from(valores.keys()).at(i) ?? null,
    get length() {
      return valores.size;
    },
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "descarta o perfil tardio de A após entrar B (passa por logout: %s)",
  async (sair) => {
    const perfis: Array<(valor: unknown) => void> = [];
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);
    vi.mocked(supabase.rpc).mockImplementation(((nome: string) =>
      nome === "get_my_complete_profile"
        ? new Promise((resolve) => perfis.push(resolve))
        : Promise.resolve({ data: false, error: null })) as any);
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const observar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda contexto={AuthContext} observar={observar} />
        </AuthProvider>,
      );
    });
    const evento = vi.mocked(supabase.auth.onAuthStateChange).mock.calls[0][0];
    const sessao = (id: string) =>
      ({ user: { id, app_metadata: {} }, access_token: `token-${id}` }) as any;
    await act(async () => {
      void evento("SIGNED_IN", sessao("A"));
    });
    expect(perfis).toHaveLength(1);
    if (sair) {
      await act(async () => {
        void evento("SIGNED_OUT", null);
      });
    }
    await act(async () => {
      void evento("SIGNED_IN", sessao("B"));
    });
    expect(perfis).toHaveLength(2);
    const perfilB = {
      id: "B",
      full_name: "Pessoa B",
      whatsapp: "222",
      avatar_url: "avatar-b",
      cover_url: "capa-b",
    };
    await act(async () => perfis[1]({ data: [perfilB], error: null }));
    expect(observar.mock.calls.at(-1)?.[0].profile).toEqual(perfilB);
    const inicioDaRespostaTardia = observar.mock.calls.length;
    await act(async () =>
      perfis[0]({
        data: [
          {
            id: "A",
            full_name: "Pessoa A",
            whatsapp: "111",
            avatar_url: "avatar-a",
            cover_url: "capa-a",
          },
        ],
        error: null,
      }),
    );
    // Nenhum render posterior à resposta de A pode expor os dados dela para B.
    expect(observar.mock.calls.at(-1)?.[0].profile).toEqual(perfilB);
    for (const [valor] of observar.mock.calls.slice(inicioDaRespostaTardia)) {
      expect(valor.user.id).toBe("B");
      expect(valor.profile).toEqual(perfilB);
    }
  },
);
