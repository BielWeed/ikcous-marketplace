// @vitest-environment jsdom
import { compressImage } from "@/utils/avatars";
import { compressCoverImage } from "@/utils/covers";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateProfile, fetchAddresses, fetchUserOrders, onNavigate } =
  vi.hoisted(() => ({
    updateProfile: vi.fn(),
    fetchAddresses: vi.fn(),
    fetchUserOrders: vi.fn(),
    onNavigate: vi.fn(),
  }));
const CONTA_A = { id: "conta-a", email: "conta-a@example.com" };
const CONTA_B = { id: "conta-b", email: "conta-b@example.com" };
let usuario = CONTA_A;
const BASE64 = "data:image/png;base64,Zm90by1vcmlnaW5hbA==";
const COMPRIMIDA = "data:image/jpeg;base64,Zm90by1jb21wcmltaWRh";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: usuario,
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
      storeName: "IKCOUS - imports",
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

type Leitor = {
  onload: ((evento: { target: { result: string } }) => Promise<void>) | null;
  onerror: (() => void) | null;
  readAsDataURL: ReturnType<typeof vi.fn>;
};

const imagens = [
  {
    nome: "foto",
    campo: "avatar_url",
    abrir: "[role=button][tabindex='0']",
    aba: "Foto Própria",
    inputId: "avatar_file_input_profile",
    comprimir: vi.mocked(compressImage),
    argumentos: [BASE64, 200, 200],
  },
  {
    nome: "capa",
    campo: "cover_url",
    abrir: "[title='Alterar capa de fundo']",
    aba: "Enviar Foto",
    inputId: "cover_file_input_profile",
    comprimir: vi.mocked(compressCoverImage),
    argumentos: [BASE64],
  },
] as const;

describe("ProfileView — foto e capa passam a conta do clique", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let leitores: Leitor[];
  let resolverCompressao: (imagem: string) => void;

  beforeEach(() => {
    vi.resetAllMocks();
    usuario = CONTA_A;
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
    const compressao = new Promise<string>((resolve) => {
      resolverCompressao = resolve;
    });
    vi.mocked(compressImage).mockReturnValue(compressao);
    vi.mocked(compressCoverImage).mockReturnValue(compressao);
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

  async function renderizar() {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
  }

  async function selecionarArquivo(imagem: (typeof imagens)[number]) {
    await renderizar();
    await act(async () => {
      hospedeiro.querySelector<HTMLElement>(imagem.abrir)!.click();
    });
    const aba = [
      ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
    ].find((botao) => botao.textContent?.trim() === imagem.aba)!;
    await act(async () => aba.click());
    const input = document.getElementById(imagem.inputId) as HTMLInputElement;
    const arquivo = new File(["foto"], "foto.png", { type: "image/png" });
    expect(input.disabled).toBe(false);
    await act(async () => {
      Object.defineProperty(input, "files", { value: [arquivo] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(leitores).toHaveLength(1);
    expect(leitores[0].readAsDataURL).toHaveBeenCalledExactlyOnceWith(arquivo);
    expect(imagem.comprimir).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  }

  async function terminarLeitura(imagem: (typeof imagens)[number]) {
    let envio!: Promise<void>;
    await act(async () => {
      envio = leitores[0].onload!({ target: { result: BASE64 } });
    });
    expect(imagem.comprimir).toHaveBeenCalledExactlyOnceWith(
      ...imagem.argumentos,
    );
    expect(updateProfile).not.toHaveBeenCalled();
    await act(async () => {
      resolverCompressao(COMPRIMIDA);
      await envio;
    });
  }

  it.each(imagens)(
    "$nome: envia a imagem comprimida e o id da conta A",
    async (imagem) => {
      await selecionarArquivo(imagem);
      await terminarLeitura(imagem);
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith(
        { [imagem.campo]: COMPRIMIDA },
        "conta-a",
      );
    },
  );

  it.each(imagens)(
    "$nome: mantém o id de A se a conta muda antes da leitura e compressão",
    async (imagem) => {
      await selecionarArquivo(imagem);
      usuario = CONTA_B;
      await renderizar();
      await terminarLeitura(imagem);
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith(
        { [imagem.campo]: COMPRIMIDA },
        "conta-a",
      );
    },
  );
});
