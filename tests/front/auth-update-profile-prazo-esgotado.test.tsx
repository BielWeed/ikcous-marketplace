// @vitest-environment jsdom
//
// Foto e capa pela aba Perfil (AuthContext.updateProfile) com rede lenta.
//
// DEFEITO 1 (mensagem enganosa): quando o salvamento passava de 20 s, a gravação
// voltava com `prazo_esgotado` e a tela dizia "Não foi possível atualizar seu
// perfil. Tente novamente." — mas a foto podia ter sido gravada logo depois, e a
// pessoa tentava de novo sem saber. A tela de Ajustes da conta já dizia "Não deu
// para confirmar: o dado pode ter sido salvo". Agora o `updateProfile` diz a
// mesma frase e, se a gravação chegar tarde, relê o perfil sozinho.
//
// DEFEITO 2 (espera sem fim depois de salvar): o `await fetchProfile()` que vem
// DEPOIS do salvamento não tinha prazo. Numa rede que ficava lenta logo após
// gravar, a bolinha de carregando e os botões da foto/capa ficavam presos. Agora
// a releitura tem 15 s; estourou, a gravação (que já deu certo) vale e devolve true.
//
// Mesmo padrão de auth-mensagem-traduzida.test.tsx (AuthContext real, supabase
// mockado, createRoot, sem @testing-library/react).
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

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
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado nestes testes" },
            }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM_NAO_DEU_PARA_CONFIRMAR =
  "Não deu para confirmar: o dado pode ter sido salvo. Confira sua conta antes de tentar de novo.";
const MENSAGEM_GENERICA =
  "Não foi possível atualizar seu perfil. Tente novamente.";

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

type Atualizar = (updates: {
  avatar_url?: string | null;
  cover_url?: string | null;
}) => Promise<boolean>;

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (updateProfile: Atualizar) => void;
}) {
  const ctx = useContext(authContext) as { updateProfile: Atualizar };
  aoAtualizar(ctx.updateProfile);
  return null;
}

const PENDENTE = Symbol("pendente");

describe("AuthContext.updateProfile — prazo na gravação e na releitura", () => {
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
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * `gravacao` e `leitura` decidem o que as duas RPCs do perfil respondem; o
   * resto (is_admin etc.) responde "não" na hora.
   */
  async function montar(opcoes: {
    gravacao: () => Promise<unknown>;
    leitura: () => Promise<unknown>;
  }) {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");
    const { toast } = await import("sonner");

    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { session: { access_token: "token-a", user: { id: "conta-a" } } },
      error: null,
    });
    (
      supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { user: { id: "conta-a" } }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    rpc.mockImplementation((nome: string) => {
      if (nome === "update_my_profile_secure") {
        return pedidoCpfComCabecalho(opcoes.gravacao());
      }
      if (nome === "get_my_complete_profile") return opcoes.leitura();
      return Promise.resolve({ data: false, error: null });
    });

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const updateProfile = aoAtualizar.mock.calls.at(-1)?.[0] as Atualizar;
    rpc.mockClear();
    return {
      rpc,
      updateProfile,
      toast: toast as unknown as {
        error: ReturnType<typeof vi.fn>;
        success: ReturnType<typeof vi.fn>;
      },
    };
  }

  /** Começa a chamada com relógio falso; `retorno.valor` fica PENDENTE até ela voltar. */
  async function iniciar(executar: () => Promise<boolean>) {
    vi.useFakeTimers();
    const retorno: { valor: boolean | typeof PENDENTE } = { valor: PENDENTE };
    await act(async () => {
      void executar().then((valor) => {
        retorno.valor = valor;
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    return retorno;
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  const gravacoes = (rpc: ReturnType<typeof vi.fn>) =>
    rpc.mock.calls.filter(([nome]) => nome === "update_my_profile_secure");
  const leituras = (rpc: ReturnType<typeof vi.fn>) =>
    rpc.mock.calls.filter(([nome]) => nome === "get_my_complete_profile");

  it("gravação que nunca responde: no prazo diz 'Não deu para confirmar', não a frase genérica", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc, updateProfile, toast } = await montar({
      gravacao: () => new Promise(() => {}),
      leitura: () => Promise.resolve({ data: [{}], error: null }),
    });

    const retorno = await iniciar(() => updateProfile({ avatar_url: "foto" }));
    // Um milissegundo antes do prazo de 20 s: ainda esperando, sem aviso.
    await avancar(20_000 - 1);
    expect(retorno.valor).toBe(PENDENTE);
    expect(toast.error).not.toHaveBeenCalled();

    await avancar(1);
    expect(gravacoes(rpc)).toHaveLength(1);
    expect(retorno.valor).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAO_DEU_PARA_CONFIRMAR);
    expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM_GENERICA);
  });

  it("gravação que chega DEPOIS do prazo: o perfil é relido sozinho", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let chegar: (valor: unknown) => void = () => {};
    const { rpc, updateProfile } = await montar({
      gravacao: () =>
        new Promise((resolve) => {
          chegar = resolve;
        }),
      leitura: () =>
        Promise.resolve({ data: [{ full_name: "Nome" }], error: null }),
    });

    await iniciar(() => updateProfile({ avatar_url: "foto" }));
    await avancar(20_000);
    expect(leituras(rpc)).toHaveLength(0);

    await act(async () => {
      chegar({ error: null });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(leituras(rpc)).toHaveLength(1);
  });

  it("gravou, mas a releitura nunca responde: solta no prazo e devolve true, sem aviso de erro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc, updateProfile, toast } = await montar({
      gravacao: () => Promise.resolve({ error: null }),
      leitura: () => new Promise(() => {}),
    });

    const retorno = await iniciar(() => updateProfile({ avatar_url: "foto" }));
    // Antes do prazo da releitura (15 s) a chamada ainda está pendurada.
    await avancar(15_000 - 1);
    expect(gravacoes(rpc)).toHaveLength(1);
    expect(leituras(rpc)).toHaveLength(1);
    expect(retorno.valor).toBe(PENDENTE);

    // Estourou: a gravação já deu certo, então é sucesso e nenhum erro aparece.
    await avancar(1);
    expect(retorno.valor).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: gravou e releu na hora, devolve true sem erro", async () => {
    const { rpc, updateProfile, toast } = await montar({
      gravacao: () => Promise.resolve({ error: null }),
      leitura: () =>
        Promise.resolve({ data: [{ full_name: "Nome" }], error: null }),
    });

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateProfile({ avatar_url: "foto" });
    });

    expect(resultado).toBe(true);
    expect(gravacoes(rpc)).toHaveLength(1);
    expect(leituras(rpc)).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: erro de verdade do banco continua com a frase genérica", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { updateProfile, toast } = await montar({
      gravacao: () =>
        Promise.resolve({ data: null, error: { message: "check constraint" } }),
      leitura: () => Promise.resolve({ data: [{}], error: null }),
    });

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateProfile({ avatar_url: "foto" });
    });

    expect(resultado).toBe(false);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(MENSAGEM_GENERICA);
  });
});
