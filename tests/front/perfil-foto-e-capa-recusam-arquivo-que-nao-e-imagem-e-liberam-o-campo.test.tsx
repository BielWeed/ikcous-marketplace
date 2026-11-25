// @vitest-environment jsdom
//
// Caça por mutação no Perfil: a escolha de foto e de capa tem duas guardas que
// nenhum teste prendia.
//   1. Arquivo que NÃO é imagem (PDF, planilha...) é recusado com aviso, sem
//      abrir leitura, sem compressão e sem gravar nada no perfil.
//   2. O campo de arquivo é zerado a cada escolha: sem isso, escolher a MESMA
//      foto de novo (depois de uma falha) não dispara nada.
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
    config: {
      storeName: "Loja de Teste",
      businessHours: "Seg-Sex: 8h as 19h",
      whatsappNumber: "34999999999",
    },
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

const casos = [
  {
    nome: "foto",
    abrir: "button[aria-label='Trocar foto de perfil']",
    aba: "Foto Própria",
    inputId: "avatar_file_input_profile",
    aviso: "Por favor, selecione um arquivo de imagem.",
    comprimir: vi.mocked(compressImage),
  },
  {
    nome: "capa",
    abrir: "[title='Alterar capa de fundo']",
    aba: "Enviar Foto",
    inputId: "cover_file_input_profile",
    aviso: "Selecione um arquivo de imagem.",
    comprimir: vi.mocked(compressCoverImage),
  },
] as const;

describe("ProfileView — foto e capa: só imagem, e o campo é liberado a cada escolha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let leitoresCriados: number;

  beforeAll(async () => {
    await import("@/views/customer/ProfileView");
  }, 60_000);

  beforeEach(() => {
    vi.resetAllMocks();
    leitoresCriados = 0;
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    // biome-ignore lint/complexity/useArrowFunction: dublê chamado com new pelo handler.
    vi.spyOn(globalThis, "FileReader").mockImplementation(function () {
      leitoresCriados += 1;
      return {
        onload: null,
        onerror: null,
        readAsDataURL: vi.fn(),
      } as unknown as FileReader;
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
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
    await act(async () => {
      hospedeiro.querySelector<HTMLElement>(caso.abrir)!.click();
    });
    const aba = [
      ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
    ].find((botao) => botao.textContent?.trim() === caso.aba)!;
    await act(async () => aba.click());
    return document.getElementById(caso.inputId) as HTMLInputElement;
  }

  /** Espia as atribuições a `input.value`: o código zera o campo com "". */
  function espiarValor(input: HTMLInputElement): string[] {
    const atribuicoes: string[] = [];
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: (novo: string) => {
        atribuicoes.push(novo);
      },
    });
    return atribuicoes;
  }

  async function escolher(input: HTMLInputElement, arquivo: File) {
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [arquivo],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it.each(casos)(
    "$nome: PDF é recusado com aviso, sem ler, sem comprimir e sem gravar",
    async (caso) => {
      const input = await abrirOCampo(caso);
      const atribuicoes = espiarValor(input);

      await escolher(
        input,
        new File(["conteudo"], "documento.pdf", { type: "application/pdf" }),
      );

      expect(vi.mocked(toast.error)).toHaveBeenCalledExactlyOnceWith(
        caso.aviso,
      );
      expect(leitoresCriados).toBe(0);
      expect(caso.comprimir).not.toHaveBeenCalled();
      expect(updateProfile).not.toHaveBeenCalled();
      // Mesmo recusado, o campo é liberado (escolher o mesmo arquivo de novo
      // tem de disparar o aviso outra vez).
      expect(atribuicoes).toEqual([""]);
    },
  );

  it.each(casos)(
    "$nome: imagem válida também libera o campo antes de ler",
    async (caso) => {
      const input = await abrirOCampo(caso);
      const atribuicoes = espiarValor(input);

      await escolher(
        input,
        new File(["foto"], "foto.png", { type: "image/png" }),
      );

      expect(leitoresCriados).toBe(1);
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(atribuicoes).toEqual([""]);
    },
  );
});
