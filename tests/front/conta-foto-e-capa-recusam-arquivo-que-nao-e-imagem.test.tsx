// @vitest-environment jsdom
//
// Caça por mutação na Conta: escolher como foto ou capa um arquivo que NÃO é
// imagem (PDF, planilha...) é recusado com aviso, sem abrir leitura, sem
// compressão e sem gravar nada no perfil. O campo de arquivo é zerado mesmo
// assim, para ela poder escolher outro arquivo logo em seguida.
import { compressImage } from "@/utils/avatars";
import { compressCoverImage } from "@/utils/covers";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
vi.mock("@/utils/avatars", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/avatars")>()),
  compressImage: vi.fn(),
}));
vi.mock("@/utils/covers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/covers")>()),
  compressCoverImage: vi.fn(),
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

const casos = [
  {
    nome: "foto",
    abrir: () =>
      document.querySelector<HTMLElement>("[role=button][tabindex='0']")!,
    aba: "Foto Própria",
    inputId: "account-avatar-upload-icon",
    aviso: "Por favor, selecione um arquivo de imagem.",
    comprimir: vi.mocked(compressImage),
  },
  {
    nome: "capa",
    abrir: () =>
      document.querySelector<HTMLElement>("[title='Alterar capa de fundo']")!,
    aba: "Enviar Foto",
    inputId: "cover_file_input",
    aviso: "Selecione um arquivo de imagem.",
    comprimir: vi.mocked(compressCoverImage),
  },
] as const;

describe("Conta — foto e capa: só imagem", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let leitoresCriados: number;

  beforeAll(async () => {
    await import("@/views/customer/AccountSettingsView");
  }, 60_000);

  beforeEach(() => {
    vi.resetAllMocks();
    leitoresCriados = 0;
    vi.stubGlobal("ResizeObserver", Stub);
    vi.stubGlobal("IntersectionObserver", Stub);
    // biome-ignore lint/complexity/useArrowFunction: o vitest 4 só aceita function ou class num dublê chamado com new.
    vi.spyOn(globalThis, "FileReader").mockImplementation(function () {
      leitoresCriados += 1;
      return {
        onload: null,
        onerror: null,
        readAsDataURL: vi.fn(),
      } as unknown as FileReader;
    });
    rpc.mockResolvedValue({
      data: [{ full_name: "Nome", whatsapp: "" }],
      error: null,
    });
    updateProfile.mockResolvedValue(true);
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

  async function abrirOCampo(caso: (typeof casos)[number]) {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await act(async () => caso.abrir().click());
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")]
        .find((b) => b.textContent?.trim() === caso.aba)!
        .click();
    });
    return document.getElementById(caso.inputId) as HTMLInputElement;
  }

  async function escolher(input: HTMLInputElement, arquivo: File) {
    const zerados: string[] = [];
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: (v: string) => zerados.push(v),
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [arquivo],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return zerados;
  }

  it.each(casos)(
    "$nome: PDF é recusado com aviso, sem ler, sem comprimir, sem gravar e com o campo liberado",
    async (caso) => {
      const input = await abrirOCampo(caso);

      const zerados = await escolher(
        input,
        new File(["conteudo"], "documento.pdf", { type: "application/pdf" }),
      );

      expect(vi.mocked(toast.error)).toHaveBeenCalledExactlyOnceWith(
        caso.aviso,
      );
      expect(leitoresCriados).toBe(0);
      expect(caso.comprimir).not.toHaveBeenCalled();
      expect(updateProfile).not.toHaveBeenCalled();
      expect(zerados).toEqual([""]);
    },
  );

  it.each(casos)(
    "$nome: arquivo de imagem passa a guarda e abre a leitura (controle)",
    async (caso) => {
      const input = await abrirOCampo(caso);

      await escolher(
        input,
        new File(["foto"], "foto.png", { type: "image/png" }),
      );

      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(leitoresCriados).toBe(1);
    },
  );
});
