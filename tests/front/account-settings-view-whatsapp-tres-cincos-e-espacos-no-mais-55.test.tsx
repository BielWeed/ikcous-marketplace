// @vitest-environment jsdom
//
// Protege `mascararWhatsappDaConta` (dentro de AccountSettingsView.tsx), a
// máscara do campo WhatsApp da tela Minha conta, em duas bordas do código do
// país que o teste vizinho (account-settings-view-whatsapp-mascara-e-valida)
// não olha:
//  - "+", "+5" e "+55" ficam como estão (a pessoa ainda está digitando o país),
//    mas um terceiro 5 já é número: "+555" tem que virar "5". Afrouxar a guarda
//    de `/^\+5{0,2}$/` para `{0,3}` deixava "+555" CRU no campo;
//  - espaço colado antes ou depois do "+55" não pode ficar no campo ("  +55 "
//    volta como "+55"), porque a guarda compara o texto já aparado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };

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
    rpc: (nome: string) =>
      Promise.resolve(
        nome === "get_my_complete_profile"
          ? {
              data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
              error: null,
            }
          : { data: null, error: null },
      ),
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

async function esperarPeloNome() {
  const inicio = Date.now();
  while (
    (document.getElementById("full_name") as HTMLInputElement | null)?.value !==
    "Fulano de Tal"
  ) {
    if (Date.now() - inicio > 3000) throw new Error("perfil não carregou");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("AccountSettingsView: WhatsApp com o código do país sendo digitado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarPeloNome();
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const telefone = () => document.getElementById("phone") as HTMLInputElement;

  it.each(["+", "+5", "+55"])("%s fica como está", async (texto) => {
    await act(async () => digitar("phone", texto));
    expect(telefone().value).toBe(texto);
  });

  it("o terceiro 5 depois do +55 já é número: o + e o país saem", async () => {
    await act(async () => digitar("phone", "+555"));
    expect(telefone().value).toBe("5");
    await act(async () => digitar("phone", "+5555"));
    expect(telefone().value).toBe("55");
  });

  it("espaço colado em volta do +55 não fica no campo", async () => {
    await act(async () => digitar("phone", "  +55 "));
    expect(telefone().value).toBe("+55");
  });
});
