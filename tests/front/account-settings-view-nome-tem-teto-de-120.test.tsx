// @vitest-environment jsdom
//
// Nome da Conta com teto de 120 (migration 20261399100000): o banco recusa nome de perfil acima de 120 caracteres e o
// "Salvar" mostraria só o aviso genérico de falha. A tela trava na digitação (`maxLength` do HTML conta unidades UTF-16,
// igual ou mais rígido que o `char_length` do banco: nada que ela aceita é recusado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProfile = vi.fn();
const updateProfile = vi.fn();
const updatePassword = vi.fn();
const rpc = vi.fn();

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile,
    updateProfile,
    updatePassword,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "token-cliente-1", user: USUARIO } },
        }),
    },
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

describe("AccountSettingsView — teto do nome", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      return Object.assign(Promise.resolve({ error: null }), {
        setHeader: vi.fn().mockReturnThis(),
      });
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

  async function montarConta() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return !nome.disabled && nome.value === "Fulano de Tal";
    });
  }

  it("o campo de nome completo limita a digitação a 120 caracteres", async () => {
    await montarConta();
    const campo = document.getElementById("full_name") as HTMLInputElement;
    expect(campo.getAttribute("maxlength")).toBe("120");
  });

  it("nome de exatamente 120 caracteres chega inteiro ao salvar a conta", async () => {
    await montarConta();
    const nome = `${"n".repeat(119)}z`;
    const campo = document.getElementById("full_name") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(campo, nome);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const salvar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar alterações"),
    ) as HTMLButtonElement;
    expect(salvar).toBeDefined();
    expect(salvar.disabled).toBe(false);
    await act(async () => salvar.click());
    await esperarAte(() =>
      rpc.mock.calls.some(
        ([chamada]) => chamada === "update_my_profile_secure",
      ),
    );
    expect(rpc).toHaveBeenCalledWith(
      "update_my_profile_secure",
      expect.objectContaining({ p_full_name: nome }),
    );
    await esperarAte(() => vi.mocked(toast.success).mock.calls.length > 0);
    expect(toast.success).toHaveBeenCalledWith("Perfil atualizado com sucesso");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
