// @vitest-environment jsdom
//
// Duas bordas da tela Minha conta (AccountSettingsView) sem teste até aqui:
//
// 1) INICIAIS do cartão de identidade (`iniciaisDoNome`): primeira letra da
//    primeira palavra + primeira letra da ÚLTIMA palavra, em maiúscula. Nome
//    de uma palavra só mostra UMA letra ("Madonna" -> "M"; trocar o `> 1` por
//    `>= 1` mostrava "MM"), e a maiúscula tem de respeitar o acento
//    ("álvares" -> "Á"). Também vale para emoji (um caractere de verdade, não
//    meio par de bytes) e para espaço sobrando no nome.
// 2) WhatsApp com LETRAS numa conta que não tinha WhatsApp: a máscara deixa
//    "abc" como está (não há dígito para formatar). O Salvar tem de recusar com
//    "WhatsApp inválido" e foco no campo; sem a conferência de campo "sem
//    dígito nenhum" o número comparável fica igual ao original (vazio), o
//    WhatsApp é tratado como "não mudou" e o Salvar dava sucesso em silêncio,
//    deixando "abc" na tela sem nunca ter sido gravado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const perfil = { nome: "Fulano de Tal", whatsapp: "" };
const rpc = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: { avatar_url: null, cover_url: null },
    fetchProfile: vi.fn().mockResolvedValue(true),
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
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
    rpc: (...args: unknown[]) => {
      rpc(...args);
      return Promise.resolve(
        args[0] === "get_my_complete_profile"
          ? {
              data: [{ full_name: perfil.nome, whatsapp: perfil.whatsapp }],
              error: null,
            }
          : { data: null, error: null },
      );
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObservadorFalso);
vi.stubGlobal("IntersectionObserver", ObservadorFalso);

function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AccountSettingsView: iniciais do cartão e WhatsApp sem dígito", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrirConta(nome: string, whatsapp = "") {
    perfil.nome = nome;
    perfil.whatsapp = whatsapp;
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    const inicio = Date.now();
    while (
      (document.getElementById("full_name") as HTMLInputElement | null)
        ?.value !== nome
    ) {
      if (Date.now() - inicio > 3000) throw new Error("perfil não carregou");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  const iniciais = () =>
    document.querySelector(
      '[aria-label="Alterar foto de perfil"] span[aria-hidden="true"]',
    )?.textContent;

  it.each([
    ["Fulano de Tal", "FT"],
    ["Madonna", "M"],
    ["ana maria souza", "AS"],
    ["joão álvares", "JÁ"],
    ["  Maria    Silva  ", "MS"],
    ["🙂 Ana", "🙂A"],
  ])("o nome %j mostra as iniciais %j", async (nome, esperado) => {
    await abrirConta(nome);
    expect(iniciais()).toBe(esperado);
  });

  it("WhatsApp só com letras, numa conta sem WhatsApp, é recusado e recebe o foco", async () => {
    const { toast } = await import("sonner");
    await abrirConta("Fulano de Tal", "");

    await act(async () => digitar("phone", "abc"));
    expect((document.getElementById("phone") as HTMLInputElement).value).toBe(
      "abc",
    );

    const salvar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar alterações"),
    ) as HTMLButtonElement;
    await act(async () => salvar.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "WhatsApp inválido",
      expect.anything(),
    );
    expect(document.activeElement?.id).toBe("phone");
    expect(
      rpc.mock.calls.some((c) => c[0] === "update_my_profile_secure"),
    ).toBe(false);
  });
});
