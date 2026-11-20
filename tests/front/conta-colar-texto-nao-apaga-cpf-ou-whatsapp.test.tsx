// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const USUARIO = { id: "cliente-teste", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };
const rpc = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile: async () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "token-teste", user: USUARIO } },
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

type Campo = "cpf" | "phone";
const campo = (id: Campo) => document.getElementById(id) as HTMLInputElement;

// O navegador aplica a colagem/remoção antes do evento input. O jsdom não
// faz essa edição sozinho, por isso usamos o setter nativo como os vizinhos.
function substituir(id: Campo, valor: string, inputType: string) {
  const el = campo(id);
  el.select();
  if (el.value === valor) return;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType,
        data: valor || null,
      }),
    );
  });
}

describe("AccountSettingsView — colar texto não equivale a apagar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "get_my_complete_profile") {
        return {
          data: [{ full_name: "Pessoa Exemplo", whatsapp: "34999998888" }],
          error: null,
        };
      }
      if (nome === "get_my_cpf") {
        return { data: "12345678909", error: null };
      }
      return { data: null, error: null };
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    expect(campo("cpf").disabled).toBe(false);
    expect(campo("cpf").value).toBe("123.456.789-09");
    expect(campo("phone").value).toBe("(34) 99999-8888");
  }

  async function salvar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar alterações"),
    );
    expect(botao?.disabled).toBe(false);
    await act(async () => botao!.click());
  }

  it.each([
    ["cpf", "CPF inválido"],
    ["phone", "WhatsApp inválido"],
  ] as const)(
    "recusa colar texto sobre o campo %s salvo",
    async (id, mensagem) => {
      await montar();

      substituir(id, "abc", "insertFromPaste");
      await salvar();

      const gravacoes = rpc.mock.calls.map(([nome]) => nome);
      expect(gravacoes).not.toContain("update_my_profile_secure");
      expect(gravacoes).not.toContain("set_my_cpf");
      expect(campo(id).getAttribute("aria-invalid")).toBe("true");
      expect(toast.error).toHaveBeenCalledWith(mensagem, expect.anything());
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("continua removendo o CPF quando a pessoa apaga o valor salvo", async () => {
    await montar();

    substituir("cpf", "", "deleteContentBackward");
    await salvar();

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "" });
  });

  it("continua removendo o WhatsApp quando a pessoa apaga o valor salvo", async () => {
    await montar();

    substituir("phone", "", "deleteContentBackward");
    await salvar();

    expect(rpc).toHaveBeenCalledWith(
      "update_my_profile_secure",
      expect.objectContaining({ p_whatsapp: "" }),
    );
  });

  it.each(["cpf", "phone"] as const)(
    "deixa a pessoa apagar o texto recusado do campo %s para remover o dado",
    async (id) => {
      await montar();
      substituir(id, "abc", "insertFromPaste");
      await salvar();
      rpc.mockClear();

      substituir(id, "", "deleteContentBackward");
      await salvar();

      if (id === "cpf") {
        expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "" });
      } else {
        expect(rpc).toHaveBeenCalledWith(
          "update_my_profile_secure",
          expect.objectContaining({ p_whatsapp: "" }),
        );
      }
      expect(campo(id).getAttribute("aria-invalid")).toBe("false");
    },
  );

  it("aceita um CPF válido digitado após o texto recusado", async () => {
    await montar();
    substituir("cpf", "abc", "insertFromPaste");
    await salvar();

    substituir("cpf", "98765432100", "insertText");
    await salvar();

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "98765432100" });
    expect(campo("cpf").value).toBe("987.654.321-00");
    expect(campo("cpf").getAttribute("aria-invalid")).toBe("false");
  });
});
