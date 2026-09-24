// @vitest-environment jsdom
//
// O CPF MORA NA CONTA (23/09/2026) — PERFIL ("Informações Pessoais"):
// campo OPCIONAL, carregado por `lerCpfDaConta` (RPC `get_my_cpf`) e
// gravado por `gravarCpfDaConta` (RPC `set_my_cpf`) SÓ quando muda —
// nunca junto de `update_my_profile_secure` nem no `AuthContext.profile`
// (o CPF fica em memória do próprio componente).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProfile = vi.fn();
const updateProfile = vi.fn();
const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };
const CPF_MASCARADO = "529.982.247-25";
const CPF_DIGITOS = "52998224725";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile,
    updateProfile,
    updatePassword: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const { rpc, cpfNaContaMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  cpfNaContaMock: { valor: null as string | null },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { updateUser: vi.fn() },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

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
    b.textContent?.includes("Salvar Alterações"),
  ) as HTMLButtonElement | undefined;
}

function cpfInput() {
  return document.getElementById("cpf") as HTMLInputElement | null;
}

describe("AccountSettingsView — CPF opcional em Informações Pessoais", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    cpfNaContaMock.valor = null;
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      if (nome === "get_my_cpf") {
        return Promise.resolve({ data: cpfNaContaMock.valor, error: null });
      }
      if (nome === "update_my_profile_secure") {
        return Promise.resolve({ data: null, error: null });
      }
      if (nome === "set_my_cpf") {
        return Promise.resolve({ data: null, error: null });
      }
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

  it("conta SEM CPF: campo carrega vazio, e salvar sem mexer não chama set_my_cpf", async () => {
    cpfNaContaMock.valor = null;
    await montar();

    expect(cpfInput()!.value).toBe("");

    await act(async () => {
      botaoSalvar()!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rpc).toHaveBeenCalledWith("update_my_profile_secure", {
      p_full_name: "Fulano de Tal",
      p_whatsapp: null,
    });
    expect(rpc).not.toHaveBeenCalledWith("set_my_cpf", expect.anything());
  });

  it("conta COM CPF: campo carrega mascarado, e salvar sem mexer não regrava (não chama set_my_cpf)", async () => {
    cpfNaContaMock.valor = CPF_DIGITOS;
    await montar();

    expect(cpfInput()!.value).toBe(CPF_MASCARADO);

    await act(async () => {
      botaoSalvar()!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rpc).not.toHaveBeenCalledWith("set_my_cpf", expect.anything());
  });

  it("preenche um CPF novo e salva: chama set_my_cpf com os dígitos", async () => {
    cpfNaContaMock.valor = null;
    await montar();

    await act(async () => {
      digitar("cpf", CPF_MASCARADO);
    });
    await act(async () => {
      botaoSalvar()!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: CPF_DIGITOS });
  });

  it("limpa um CPF que já existia e salva: chama set_my_cpf com string vazia (caminho de remover)", async () => {
    cpfNaContaMock.valor = CPF_DIGITOS;
    await montar();
    expect(cpfInput()!.value).toBe(CPF_MASCARADO);

    await act(async () => {
      digitar("cpf", "");
    });
    await act(async () => {
      botaoSalvar()!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "" });
  });

  it("CPF inválido: marca erro no campo, NÃO chama nenhuma RPC de salvar (nem perfil, nem CPF)", async () => {
    cpfNaContaMock.valor = null;
    await montar();
    rpc.mockClear();

    await act(async () => {
      digitar("cpf", "111.111.111-11");
    });
    await act(async () => {
      botaoSalvar()!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(cpfInput()!.getAttribute("aria-invalid")).toBe("true");
    expect(rpc).not.toHaveBeenCalledWith(
      "update_my_profile_secure",
      expect.anything(),
    );
    expect(rpc).not.toHaveBeenCalledWith("set_my_cpf", expect.anything());
  });

  it("nunca aparece no AuthContext.profile — updateProfile (que gravaria no contexto global) não é chamado para CPF", async () => {
    cpfNaContaMock.valor = null;
    await montar();

    await act(async () => {
      digitar("cpf", CPF_MASCARADO);
    });
    await act(async () => {
      botaoSalvar()!.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(updateProfile).not.toHaveBeenCalled();
  });
});
