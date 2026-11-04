// @vitest-environment jsdom
//
// Conta: quem usa só o teclado (ou leitor de tela) precisa conseguir chegar ao
// envio da foto de perfil e da capa.
//
// DEFEITO: os quatro campos de arquivo eram `className="hidden"` (display:none),
// que não recebe foco no Tab; o <label> em volta também não é focável. O
// teclado abria a janela e parava ali, sem como acionar o envio. Agora o campo
// é `sr-only` (some da vista mas continua focável) e o label mostra um anel de
// foco quando o campo recebe foco (`focus-within`).
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, estado } = vi.hoisted(() => ({
  rpc: vi.fn(),
  estado: {
    profile: { avatar_url: "/avatar-a.png", cover_url: "/capa-a.png" } as {
      avatar_url: string | null;
      cover_url: string | null;
    },
  },
}));
const CONTA_A = { id: "conta-a", email: "conta-a@example.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: CONTA_A,
    profile: estado.profile,
    fetchProfile: vi.fn(),
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Stub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Conta — campos de foto e de capa alcançáveis pelo teclado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", Stub);
    vi.stubGlobal("IntersectionObserver", Stub);
    rpc.mockResolvedValue({
      data: [{ full_name: "Nome", whatsapp: "" }],
      error: null,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function abrirAba(abrir: () => HTMLElement, aba: string) {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await act(async () => abrir().click());
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")]
        .find((b) => b.textContent?.trim() === aba)!
        .click();
    });
  }

  const abrirFoto = () =>
    document.querySelector<HTMLElement>("[role=button][tabindex='0']")!;
  const abrirCapa = () =>
    document.querySelector<HTMLElement>("[title='Alterar capa de fundo']")!;

  function esperaFocavelComAnel(id: string) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    expect(input, `#${id} existe`).not.toBeNull();
    const classes = (input as HTMLInputElement).className.split(/\s+/);
    // display:none (classe "hidden") tira o campo da ordem do Tab.
    expect(classes).not.toContain("hidden");
    expect(classes).toContain("sr-only");
    expect((input as HTMLInputElement).tabIndex).not.toBe(-1);
    const label = (input as HTMLInputElement).closest("label");
    expect(label, `#${id} está dentro de um label`).not.toBeNull();
    const classesDoLabel = (label as HTMLLabelElement).className;
    expect(classesDoLabel).toContain("focus-within:ring-2");
    // O campo escondido é posicionado em relação ao label, não à página.
    expect(classesDoLabel).toMatch(/\brelative\b|\babsolute\b/);
  }

  it("foto já enviada: o ícone da câmera e o botão 'Escolher Outra Foto' recebem foco", async () => {
    estado.profile = { avatar_url: "/avatar-a.png", cover_url: "/capa-a.png" };
    await abrirAba(abrirFoto, "Foto Própria");
    esperaFocavelComAnel("account-avatar-upload-icon");
    esperaFocavelComAnel("account-avatar-upload-button");
  });

  it("sem foto ainda: a área 'Enviar foto do dispositivo' recebe foco", async () => {
    estado.profile = { avatar_url: null, cover_url: "/capa-a.png" };
    await abrirAba(abrirFoto, "Foto Própria");
    esperaFocavelComAnel("avatar_file_input");
  });

  it("capa: o campo de envio recebe foco", async () => {
    estado.profile = { avatar_url: "/avatar-a.png", cover_url: null };
    await abrirAba(abrirCapa, "Enviar Foto");
    esperaFocavelComAnel("cover_file_input");
  });

  it("o fluxo de envio não mudou: os campos continuam aceitando só imagem e sendo ligados ao label", async () => {
    estado.profile = { avatar_url: "/avatar-a.png", cover_url: null };
    await abrirAba(abrirFoto, "Foto Própria");
    for (const id of [
      "account-avatar-upload-icon",
      "account-avatar-upload-button",
    ]) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input.type).toBe("file");
      expect(input.accept).toBe("image/*");
      expect(input.closest("label")?.getAttribute("for")).toBe(id);
    }
  });
});
