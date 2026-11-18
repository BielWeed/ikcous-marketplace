// @vitest-environment jsdom
// CPF pendente é dado pessoal: Sair apaga também quando a rede falha.
// Uma resposta atrasada do cadastro ou da retomada não pode trazê-lo de volta.
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
      signUp: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mesma fixture pública dos testes vizinhos; nunca dado de cliente.
const CPF = "52998224725";
const EMAIL = "cliente@example.com";
const SESSAO = {
  user: { id: "user-a", email: EMAIL, app_metadata: {} },
  access_token: "token-de-teste",
};
type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;
interface Acoes {
  logout: () => Promise<void>;
  signUp: (
    email: string,
    senha: string,
    nome: string,
    telefone: string,
    cpf?: string,
  ) => Promise<boolean>;
}

function Sonda({
  contexto,
  aoAtualizar,
}: {
  readonly contexto: React.Context<any>;
  readonly aoAtualizar: (acoes: Acoes) => void;
}) {
  aoAtualizar(useContext(contexto));
  return null;
}

function armazemFalso() {
  const mapa = new Map<string, string>();
  return {
    getItem: (chave: string) => mapa.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, valor);
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
    clear: () => {
      mapa.clear();
    },
    key: (indice: number) => Array.from(mapa.keys()).at(indice) ?? null,
    get length() {
      return mapa.size;
    },
  };
}

function adiar<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("Sair apaga o CPF pendente e impede a volta por resposta atrasada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.stubGlobal("localStorage", armazemFalso());
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");
    const cpfPendente = await import("@/lib/cpf-pendente-do-cadastro");
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: null,
    } as any);
    let callback: AuthChangeCallback = () => {};
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });
    vi.mocked(supabase.auth.signOut).mockImplementation(async () => {
      await callback("SIGNED_OUT", null);
      return { error: null };
    });
    let acoes!: Acoes;
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda
            contexto={AuthContext}
            aoAtualizar={(valor) => {
              acoes = valor;
            }}
          />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await callback("SIGNED_IN", SESSAO);
    });
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: SESSAO },
      error: null,
    } as any);
    const guardar = () => {
      expect(
        cpfPendente.salvarPendente({
          userId: SESSAO.user.id,
          email: EMAIL,
          cpf: CPF,
        }),
      ).toBe(true);
      // Só afirma presença/ausência para não imprimir CPF em falhas.
      expect(
        localStorage.getItem(cpfPendente.CHAVE_CPF_PENDENTE) !== null,
      ).toBe(true);
    };
    const temPendente = () =>
      localStorage.getItem(cpfPendente.CHAVE_CPF_PENDENTE) !== null;
    return {
      supabase,
      cpfPendente,
      guardar,
      temPendente,
      acoes,
      evento: (tipo: string) =>
        callback(tipo, tipo === "SIGNED_OUT" ? null : SESSAO),
    };
  }

  it("Sair remove o registro de CPF e e-mail do navegador", async () => {
    const { guardar, temPendente, acoes } = await montar();
    guardar();
    await act(async () => {
      await acoes.logout();
    });
    expect(temPendente()).toBe(false);
  });

  it("apaga no toque em Sair, antes de a rede responder", async () => {
    const { guardar, temPendente, acoes, supabase } = await montar();
    guardar();
    const resposta = adiar<{ error: null }>();
    vi.mocked(supabase.auth.signOut).mockReturnValue(resposta.promessa);
    let saida!: Promise<void>;
    await act(async () => {
      saida = acoes.logout();
    });
    const ficouGuardadoEnquantoSaia = temPendente();
    resposta.resolver({ error: null });
    await act(async () => {
      await saida;
    });
    expect(ficouGuardadoEnquantoSaia).toBe(false);
  });

  it("Sair com erro de rede também remove o pendente, sem depender do evento", async () => {
    const { guardar, temPendente, acoes, supabase } = await montar();
    guardar();
    vi.mocked(supabase.auth.signOut).mockResolvedValue({
      error: { message: "rede indisponível" },
    } as any);
    await act(async () => {
      await acoes.logout();
    });
    expect(temPendente()).toBe(false);
  });

  it("SIGNED_OUT de sessão encerrada remove o pendente", async () => {
    const { guardar, temPendente, evento } = await montar();
    guardar();
    await act(async () => {
      await evento("SIGNED_OUT");
    });
    expect(temPendente()).toBe(false);
  });

  it("TOKEN_REFRESHED não apaga o pendente da sessão ainda ativa", async () => {
    const { guardar, temPendente, evento } = await montar();
    guardar();
    await act(async () => {
      await evento("TOKEN_REFRESHED");
    });
    expect(temPendente()).toBe(true);
  });

  it("retomada em voo que falha depois do Sair não recria o registro", async () => {
    const { guardar, temPendente, acoes, cpfPendente, supabase } =
      await montar();
    guardar();
    const resposta = adiar<{ data: null; error: { code: string } }>();
    let chegouNaRpc = false;
    vi.mocked(supabase.rpc).mockImplementation((nome: string) => {
      if (nome !== "set_my_cpf")
        return Promise.resolve({ data: null, error: null }) as any;
      chegouNaRpc = true;
      return pedidoCpfComCabecalho(resposta.promessa) as any;
    });
    const retomada = cpfPendente.retomarCpfPendente({
      userId: SESSAO.user.id,
      email: EMAIL,
    });
    await vi.waitFor(() => expect(chegouNaRpc).toBe(true));
    await act(async () => {
      await acoes.logout();
    });
    resposta.resolver({ data: null, error: { code: "rede" } });
    await retomada;
    expect(temPendente()).toBe(false);
  });

  it.each(["Sair", "SIGNED_OUT"])(
    "cadastro em voo que termina depois de %s não guarda o CPF",
    async (saida) => {
      const { temPendente, acoes, evento, supabase } = await montar();
      const resposta = adiar<any>();
      vi.mocked(supabase.auth.signUp).mockReturnValue(resposta.promessa);
      const cadastro = acoes.signUp(EMAIL, "senha-de-teste", "Teste", "", CPF);
      await act(async () => {
        if (saida === "Sair") await acoes.logout();
        else await evento("SIGNED_OUT");
      });
      resposta.resolver({
        data: { user: SESSAO.user, session: null },
        error: null,
      });
      await act(async () => {
        await cadastro;
      });
      expect(temPendente()).toBe(false);
    },
  );
});
