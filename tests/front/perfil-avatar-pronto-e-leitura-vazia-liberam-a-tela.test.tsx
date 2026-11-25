// @vitest-environment jsdom
//
// Caça por mutação no Perfil: depois de mexer na foto ou na capa a tela tem de
// ser LIBERADA em todo desfecho, e ninguém prendia isso.
//   1. Escolher um avatar pronto: se a loja recusar (`updateProfile` devolve
//      false) a janela continua aberta MAS o aviso "Atualizando..." some e nada
//      de "sucesso" aparece; se aceitar, avisa e fecha.
//   2. Arquivo lido sem conteúdo (resultado vazio): foto e capa avisam o erro de
//      leitura, não comprimem, não gravam e soltam o "Atualizando..." /
//      "Salvando..." — sem isso a janela ficava travada.
import { PREDEFINED_AVATARS, compressImage } from "@/utils/avatars";
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

const { updateProfile, fetchAddresses, fetchUserOrders, onNavigate } =
  vi.hoisted(() => ({
    updateProfile: vi.fn(),
    fetchAddresses: vi.fn(),
    fetchUserOrders: vi.fn(),
    onNavigate: vi.fn(),
  }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "conta-a", email: "conta-a@example.com" },
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses,
    deleteAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => null,
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => null,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/utils/avatars", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/avatars")>()),
  compressImage: vi.fn(),
}));
vi.mock("@/utils/covers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/covers")>()),
  compressCoverImage: vi.fn(),
}));
// A aba de upload fica disponível sem esperar a animação de saída.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type Leitor = {
  onload: ((evento: { target: { result: string } }) => Promise<void>) | null;
  onerror: (() => void) | null;
  readAsDataURL: ReturnType<typeof vi.fn>;
};

describe("ProfileView — foto e capa soltam a tela em todo desfecho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let leitores: Leitor[];

  beforeAll(async () => {
    await import("@/views/customer/ProfileView");
  }, 60_000);

  beforeEach(() => {
    vi.resetAllMocks();
    leitores = [];
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    // biome-ignore lint/complexity/useArrowFunction: dublê chamado com new pelo handler.
    vi.spyOn(globalThis, "FileReader").mockImplementation(function () {
      const leitor: Leitor = {
        onload: null,
        onerror: null,
        readAsDataURL: vi.fn(),
      };
      leitores.push(leitor);
      return leitor as unknown as FileReader;
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

  async function abrir(abrirSeletor: string, aba: string | null) {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
    await act(async () => {
      hospedeiro.querySelector<HTMLElement>(abrirSeletor)!.click();
    });
    if (aba) {
      const botaoAba = [
        ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
      ].find((b) => b.textContent?.trim() === aba)!;
      await act(async () => botaoAba.click());
    }
  }

  const dialogo = () => document.querySelector("[role=dialog]");
  const textoDoDialogo = () => dialogo()?.textContent ?? "";

  describe("avatar pronto", () => {
    const abrirAvatares = () =>
      abrir("button[aria-label='Trocar foto de perfil']", null);
    const escolherPrimeiro = async () => {
      const botao = document.querySelector<HTMLButtonElement>(
        `[role=dialog] button[aria-label='${PREDEFINED_AVATARS[0].label}']`,
      );
      expect(botao).not.toBeNull();
      await act(async () => botao?.click());
    };

    it("loja recusou: a janela segue aberta, sem 'Atualizando...' e sem aviso de sucesso", async () => {
      updateProfile.mockResolvedValue(false);
      await abrirAvatares();

      await escolherPrimeiro();

      expect(updateProfile).toHaveBeenCalledTimes(1);
      expect(dialogo()).not.toBeNull();
      expect(textoDoDialogo()).not.toContain("Atualizando...");
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it("enquanto a loja responde, a foto do cabeçalho mostra o giro de 'salvando' (e só então)", async () => {
      let responder!: (ok: boolean) => void;
      updateProfile.mockReturnValue(
        new Promise<boolean>((resolve) => {
          responder = resolve;
        }),
      );
      await abrirAvatares();
      const giro = () =>
        hospedeiro.querySelector(
          "button[aria-label='Trocar foto de perfil'] .animate-spin",
        );
      expect(giro()).toBeNull();

      await escolherPrimeiro();
      expect(giro()).not.toBeNull();

      await act(async () => responder(false));
      expect(giro()).toBeNull();
    });

    it("erro ao salvar: avisa, e a janela também é solta", async () => {
      updateProfile.mockRejectedValue(new Error("rede caiu"));
      const erroNoConsole = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await abrirAvatares();

      await escolherPrimeiro();

      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "Erro ao salvar avatar.",
      );
      expect(textoDoDialogo()).not.toContain("Atualizando...");
      erroNoConsole.mockRestore();
    });

    it("loja aceitou: avisa e fecha a janela", async () => {
      updateProfile.mockResolvedValue(true);
      await abrirAvatares();

      await escolherPrimeiro();

      expect(vi.mocked(toast.success)).toHaveBeenCalledExactlyOnceWith(
        "Avatar atualizado com sucesso!",
      );
      expect(dialogo()).toBeNull();
    });
  });

  describe("arquivo lido sem conteúdo", () => {
    async function escolherArquivoELerVazio(inputId: string) {
      const input = document.getElementById(inputId) as HTMLInputElement;
      await act(async () => {
        Object.defineProperty(input, "files", {
          configurable: true,
          value: [new File(["x"], "foto.png", { type: "image/png" })],
        });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(leitores).toHaveLength(1);
      await act(async () => {
        await leitores[0].onload!({ target: { result: "" } });
      });
    }

    it("foto: avisa 'Erro ao ler a imagem.', não comprime, não grava e solta o 'Atualizando...'", async () => {
      await abrir("button[aria-label='Trocar foto de perfil']", "Foto Própria");

      await escolherArquivoELerVazio("avatar_file_input_profile");

      expect(vi.mocked(toast.error)).toHaveBeenCalledExactlyOnceWith(
        "Erro ao ler a imagem.",
      );
      expect(vi.mocked(compressImage)).not.toHaveBeenCalled();
      expect(updateProfile).not.toHaveBeenCalled();
      expect(textoDoDialogo()).not.toContain("Atualizando...");
    });

    it("capa: avisa 'Erro ao ler imagem.', não comprime, não grava e volta o botão 'Fechar'", async () => {
      await abrir("[title='Alterar capa de fundo']", "Enviar Foto");

      await escolherArquivoELerVazio("cover_file_input_profile");

      expect(vi.mocked(toast.error)).toHaveBeenCalledExactlyOnceWith(
        "Erro ao ler imagem.",
      );
      expect(vi.mocked(compressCoverImage)).not.toHaveBeenCalled();
      expect(updateProfile).not.toHaveBeenCalled();
      expect(textoDoDialogo()).not.toContain("Salvando...");
      expect(textoDoDialogo()).toContain("Fechar");
    });
  });
});
