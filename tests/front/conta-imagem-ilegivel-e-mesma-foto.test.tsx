// @vitest-environment jsdom
//
// Foto/capa que o navegador não decodifica (ex.: HEIC no Chrome): antes o
// arquivo cru seguia para o banco, que recusava pelo teto de tamanho, e a
// pessoa via um erro genérico. Agora a compressão recusa e a tela avisa
// "Esta imagem não pôde ser lida, escolha JPG ou PNG". E o campo de arquivo é
// zerado depois de cada escolha: sem isso, escolher a MESMA foto de novo não
// dispara nada.
import { IMAGEM_ILEGIVEL, compressImage } from "@/utils/avatars";
import { compressCoverImage } from "@/utils/covers";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, fetchProfile, updateProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchProfile: vi.fn(),
  updateProfile: vi.fn(),
}));
const CONTA_A = { id: "conta-a", email: "conta-a@example.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: CONTA_A,
    profile: { avatar_url: "/avatar-a.png", cover_url: "/capa-a.png" },
    fetchProfile,
    updateProfile,
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
vi.stubGlobal("ResizeObserver", Stub);
vi.stubGlobal("IntersectionObserver", Stub);

// Imagem que nunca decodifica: dispara onerror, como um HEIC no Chrome.
class ImagemQuebrada {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_: string) {
    setTimeout(() => this.onerror?.(), 0);
  }
}

describe("compressImage/compressCoverImage — imagem que não decodifica", () => {
  beforeEach(() => vi.stubGlobal("Image", ImagemQuebrada));
  afterEach(() => vi.unstubAllGlobals());

  it("recusam com a mensagem de imagem ilegível, sem devolver o arquivo cru", async () => {
    await expect(compressImage("data:image/heic;base64,AAAA")).rejects.toThrow(
      IMAGEM_ILEGIVEL,
    );
    await expect(
      compressCoverImage("data:image/heic;base64,AAAA"),
    ).rejects.toThrow(IMAGEM_ILEGIVEL);
  });
});

describe("Conta — foto que não decodifica e escolher a mesma foto de novo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let leitor: { onload: (e: unknown) => Promise<void> };

  beforeEach(() => {
    vi.clearAllMocks();
    // biome-ignore lint/complexity/useArrowFunction: o vitest 4 só aceita function ou class num dublê chamado com new.
    vi.spyOn(globalThis, "FileReader").mockImplementation(function () {
      const l = { onload: null, onerror: null, readAsDataURL: vi.fn() };
      leitor = l as never;
      return l as unknown as FileReader;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.stubGlobal("ResizeObserver", Stub);
    vi.stubGlobal("IntersectionObserver", Stub);
  });

  async function montarEEscolher(
    inputId: string,
    abrir: () => HTMLElement,
    aba: string,
  ) {
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
    const input = document.getElementById(inputId) as HTMLInputElement;
    const zerados: string[] = [];
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: (v: string) => zerados.push(v),
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["foto"], "foto.heic", { type: "image/heic" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return zerados;
  }

  it("foto: avisa que a imagem não pôde ser lida e zera o campo de arquivo", async () => {
    const zerados = await montarEEscolher(
      "account-avatar-upload-icon",
      () => document.querySelector<HTMLElement>("[role=button][tabindex='0']")!,
      "Foto Própria",
    );
    expect(zerados).toEqual([""]);
    vi.stubGlobal("Image", ImagemQuebrada);
    await act(async () => {
      await leitor.onload({
        target: { result: "data:image/heic;base64,AAAA" },
      });
    });
    expect(toast.error).toHaveBeenCalledWith(IMAGEM_ILEGIVEL);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("capa: avisa, zera o campo e o texto não promete limite de 5 MB", async () => {
    const zerados = await montarEEscolher(
      "cover_file_input",
      () =>
        document.querySelector<HTMLElement>("[title='Alterar capa de fundo']")!,
      "Enviar Foto",
    );
    expect(zerados).toEqual([""]);
    expect(document.body.textContent).not.toContain("5MB");
    vi.stubGlobal("Image", ImagemQuebrada);
    await act(async () => {
      await leitor.onload({
        target: { result: "data:image/heic;base64,AAAA" },
      });
    });
    expect(toast.error).toHaveBeenCalledWith(IMAGEM_ILEGIVEL);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
