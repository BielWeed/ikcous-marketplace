// @vitest-environment jsdom
//
// A1-fix2 — achado BLOQUEANTE da revisão de contexto limpo do lote VITRINE.
// `MENSAGEM_ERRO_LOGIN_GENERICA` (AuthContext.tsx) foi criada para o CLIENTE
// e é disparada pelo TOAST global de `login` para QUALQUER chamador — mas
// AdminLoginView.tsx (a tela do LOJISTA) também chama `login` e monta a
// PRÓPRIA frase inline (`mensagemDeErroAdminLogin`) para o mesmo ramo
// genérico. Isso violava dois invariantes ao mesmo tempo:
//
//   (I) o toast e o banner inline diziam frases DIFERENTES para o mesmo
//       erro, na mesma tela, ao mesmo tempo;
//   (II) a frase do toast ("...ou fale com a loja") manda o DONO da loja
//        falar com a loja — instrução sem destinatário possível.
//
// Este teste monta o AuthProvider DE VERDADE (não mocka useAuth) envolvendo
// AdminLoginView, para que o toast venha do `login` real do AuthContext e o
// banner inline venha do retorno real de `login` processado pela view — é a
// integração entre os dois arquivos que causava a divergência, então só um
// teste que renderiza os dois juntos prova a correção. Mesmo padrão de
// montagem de auth-mensagem-traduzida.test.tsx (Sonda/createRoot, sem
// @testing-library/react) e mesmo mock de supabase.
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

describe("AdminLoginView — ramo genérico concorda com o toast e não manda o lojista falar com a loja", () => {
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

  // "causa desconhecida (rede caída, status 0)" — o mesmo caso do canário já
  // coberto em auth-mensagem-traduzida.test.tsx para o CLIENTE (AuthView),
  // desta vez através da tela do LOJISTA. `status: 0` é o que o
  // @supabase/auth-js devolve quando o `fetch` falha (AuthRetryableFetchError,
  // lib/fetch.js) — não bate em nenhum `if` de mensagemDeErroAdminLogin nem
  // do `login`, então cai nos dois ramos genéricos ao mesmo tempo.
  it("toast e banner inline dizem a MESMA frase, e ela não manda o lojista 'falar com a loja'", async () => {
    const { AuthProvider } = await import("@/contexts/AuthContext");
    const { AdminLoginView } = await import("@/views/admin/AdminLoginView");
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

    const onLogin = vi.fn();
    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <AdminLoginView onLogin={onLogin} onNavigate={onNavigate} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    await act(async () => {
      digitar("admin-email", "lojista@example.com");
      digitar("admin-password", "senha-certa");
    });

    const form = hospedeiro.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await esperarMicrotarefas();
    });

    const mensagemToast = (toast.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const mensagemInline = document
      .querySelector(".text-red-400")
      ?.textContent?.trim();

    // Invariante (I): o toast global e o banner inline concordam — a mesma
    // frase, não duas versões diferentes do mesmo erro.
    expect(mensagemInline).toBe(mensagemToast);

    // Invariante (II): nenhuma das duas frases manda o dono da loja "falar
    // com a loja" — instrução sem destinatário possível para quem É a loja.
    expect(mensagemToast).not.toMatch(/fale com a loja/i);
    expect(mensagemInline).not.toMatch(/fale com a loja/i);

    // A trava geral do lote: nada de erro cru do Supabase na tela.
    expect(mensagemToast).not.toMatch(/failed to fetch/i);
    expect(mensagemInline).not.toMatch(/failed to fetch/i);

    // Ainda genérica e honesta (não presume credenciais erradas nem revela
    // status de conta) — mesma âncora textual do ramo genérico do cliente.
    expect(mensagemToast).toMatch(/não foi possível entrar/i);

    // R2 (achado da revisão de contexto limpo) — buraco de cobertura: sem
    // esta asserção, trocar `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA` por
    // "Não foi possível entrar agora." (sem NENHUMA cláusula de saída)
    // continuava passando nas quatro asserções acima — elas só checam
    // CONCORDÂNCIA e AUSÊNCIA de texto, nunca que a frase oferece um
    // caminho. Um lojista lendo só "não foi possível entrar, tente de
    // novo" para uma causa PERMANENTE (conta banida, provedor desativado)
    // fica preso num loop sem saída. Esta asserção POSITIVA garante que a
    // frase aponta para algum lugar fora do painel, não só que as duas
    // concordam entre si.
    expect(mensagemToast).toMatch(/verificado fora deste painel/i);

    expect(onLogin).not.toHaveBeenCalled();
  });
});
