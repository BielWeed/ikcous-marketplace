// @vitest-environment jsdom
//
// R3 (revisão de contexto limpo do lote VITRINE, achado A1-fix3) — a outra
// metade do invariante que `admin-login-generico-concorda-com-toast-e-nao-
// manda-lojista-falar-com-a-loja.test.tsx` já prova para o LOJISTA: o toast
// global (disparado por `AuthContext.login`) e o banner inline (montado por
// `AuthView.handleSubmit`, com a SUA PRÓPRIA constante importada) precisam
// concordar para o CLIENTE também. Antes deste arquivo, nada em `tests/`
// amarrava os dois — e é exatamente essa lacuna que deixa passar em
// silêncio um `audience` errado: se o default de `login` (AuthContext)
// mudasse de "customer" para "admin" (e a tela do cliente continuasse
// chamando `login` sem passar audience — o estado ANTES de R1), o toast
// passaria a usar `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA` enquanto o banner
// inline de AuthView continuaria com `MENSAGEM_ERRO_LOGIN_GENERICA`
// (importada e usada como default LOCAL, independente do que o toast
// disparou) — as duas frases divergindo na MESMA tela, ao mesmo tempo. Este
// teste renderiza o AuthProvider DE VERDADE (mesmo padrão de
// admin-login-generico-concorda-*.test.tsx) para que o toast venha do
// `login` real e o banner venha do processamento real de AuthView — só a
// integração entre os dois prova a concordância.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado neste teste" },
            }),
        }),
      }),
    })),
  },
}));

// Mesmo motivo dos arquivos irmãos: sem este mock, importar AuthView de
// verdade arrasta @/lib/supabase.ts e estoura "Web Worker is not supported"
// no jsdom.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeCity: "Sao Paulo", storeState: "SP" },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos que testam AuthContext diretamente.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AuthView — toast global e banner inline concordam para o CLIENTE (outra metade do invariante de R3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // "causa desconhecida (rede caída, status 0)" — o mesmo canário já usado
  // em auth-mensagem-traduzida.test.tsx (ponto 2, "login") e no espelho para
  // o lojista (admin-login-generico-concorda-*.test.tsx): não bate em
  // nenhum `if` com frase própria, então cai no ramo genérico dos DOIS
  // lados (toast em AuthContext.login, banner em AuthView.handleSubmit) ao
  // mesmo tempo — é o par que mais expõe divergência entre os dois.
  it("toast e banner inline dizem a MESMA frase para o cliente, e ela não manda 'contate o suporte' (frase do lojista)", async () => {
    const { AuthProvider } = await import("@/contexts/AuthContext");
    const { AuthView } = await import("@/views/shared/AuthView");
    const { supabase } = await import("@/lib/supabase");
    const { toast } = await import("sonner");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    (
      supabase.auth.signInWithPassword as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {},
      error: { status: 0, message: "Failed to fetch" },
    });

    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <AuthView onNavigate={onNavigate} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    await act(async () => {
      digitar("email", "cliente@example.com");
      digitar("password", "senha-certa");
    });

    const entrarBotao = localizarBotaoPorTexto("ENTRAR AGORA")!;
    await act(async () => {
      entrarBotao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    const mensagemToast = (toast.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const mensagemInline = document
      .querySelector(".text-red-600")
      ?.textContent?.trim();

    // Invariante: o toast global e o banner inline concordam — a mesma
    // frase, não duas versões diferentes do mesmo erro na mesma tela.
    expect(mensagemInline).toBe(mensagemToast);

    // A frase é a do CLIENTE ("fale com a loja"), nunca a do LOJISTA
    // ("verificado fora deste painel") — se algum dia o `login` decidir a
    // audiência errada para esta tela, é aqui que aparece.
    expect(mensagemToast).toMatch(/fale com a loja/i);
    expect(mensagemInline).toMatch(/fale com a loja/i);
    expect(mensagemToast).not.toMatch(/verificado fora deste painel/i);
    expect(mensagemInline).not.toMatch(/verificado fora deste painel/i);

    expect(mensagemToast).not.toMatch(/failed to fetch/i);
    expect(mensagemInline).not.toMatch(/failed to fetch/i);
  });
});
