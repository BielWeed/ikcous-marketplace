// @vitest-environment jsdom
//
// MINHA CONTA — duas garantias de borda:
// 1) CPF gravado/limpo aqui apaga o pendente do cadastro (senão a próxima
//    abertura do app o gravaria POR CIMA do que a cliente digitou);
// 2) a aba Segurança mostra o e-mail de login vindo da SESSÃO, mesmo com o
//    carregamento do perfil lento ou falho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const fetchProfile = vi.fn();
const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };
const CPF_MASCARADO = "529.982.247-25";
const CPF_DIGITOS = "52998224725";
const CHAVE_PENDENTE = "ikcous:cpf-pendente-cadastro";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile,
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "token-cliente-1", user: USUARIO } },
        }),
    },
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return args[0] === "set_my_cpf" || args[0] === "update_my_profile_secure"
        ? pedidoCpfComCabecalho(resposta)
        : resposta;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
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

function botaoSalvar() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Salvar alterações"),
  ) as HTMLButtonElement | undefined;
}

function cpfInput() {
  return document.getElementById("cpf") as HTMLInputElement | null;
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
  };
}

describe("AccountSettingsView — pendente do cadastro e e-mail da sessão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: ReturnType<typeof armazemFalso>;
  let cpfNaConta: string | null;
  let respostaSetMyCpf: { data: null; error: null | { code: string } };

  function gravarPendente(userId = USUARIO.id) {
    armazem.setItem(
      CHAVE_PENDENTE,
      JSON.stringify({
        v: 1,
        userId,
        email: USUARIO.email,
        cpf: "11144477735",
        expiraEm: Date.now() + 60 * 60 * 1000,
      }),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cpfNaConta = null;
    respostaSetMyCpf = { data: null, error: null };
    armazem = armazemFalso();
    vi.stubGlobal("localStorage", armazem);
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      if (nome === "get_my_cpf") {
        return Promise.resolve({ data: cpfNaConta, error: null });
      }
      if (nome === "set_my_cpf") return Promise.resolve(respostaSetMyCpf);
      return Promise.resolve({ data: null, error: null });
    });
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
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
  });

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => cpfInput() !== null && !cpfInput()!.disabled);
  }

  async function salvar() {
    await act(async () => {
      botaoSalvar()!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("CPF digitado e gravado em Minha conta apaga o pendente do cadastro", async () => {
    gravarPendente();
    await montar();

    await act(async () => {
      digitar("cpf", CPF_MASCARADO);
    });
    await salvar();

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: CPF_DIGITOS });
    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it("CPF LIMPO em Minha conta também apaga o pendente (ela decidiu ficar sem)", async () => {
    cpfNaConta = CPF_DIGITOS;
    gravarPendente();
    await montar();

    await act(async () => {
      digitar("cpf", "");
    });
    await salvar();

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "" });
    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it("se a gravação do CPF FALHAR, o pendente fica (nada foi salvo na conta)", async () => {
    gravarPendente();
    respostaSetMyCpf = { data: null, error: { code: "XXYYY" } };
    await montar();

    await act(async () => {
      digitar("cpf", CPF_MASCARADO);
    });
    await salvar();

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: CPF_DIGITOS });
    expect(armazem.getItem(CHAVE_PENDENTE)).not.toBeNull();
  });

  it("salvar só o nome (CPF não mexido) não mexe no pendente", async () => {
    gravarPendente();
    await montar();

    await salvar();

    expect(rpc).not.toHaveBeenCalledWith("set_my_cpf", expect.anything());
    expect(armazem.getItem(CHAVE_PENDENTE)).not.toBeNull();
  });

  it("pendente de OUTRA conta no aparelho não é apagado pela gravação desta conta", async () => {
    gravarPendente("outra-conta");
    await montar();

    await act(async () => {
      digitar("cpf", CPF_MASCARADO);
    });
    await salvar();

    expect(armazem.getItem(CHAVE_PENDENTE)).not.toBeNull();
  });

  it("aba Segurança mostra o e-mail de login mesmo quando o perfil falha ao carregar", async () => {
    rpc.mockImplementation((nome: string) =>
      nome === "get_my_complete_profile"
        ? Promise.resolve({ data: null, error: { code: "XX000" } })
        : Promise.resolve({ data: null, error: null }),
    );
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await act(async () => {
      (
        document.getElementById("aba-conta-security") as HTMLButtonElement
      ).click();
    });

    const campo = document.getElementById("email") as HTMLInputElement;
    expect(campo.value).toBe(USUARIO.email);
  });
});
