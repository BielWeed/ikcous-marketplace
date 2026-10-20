// @vitest-environment jsdom
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { AccountSettingsView } from "@/views/customer/AccountSettingsView";
import { ProfileView } from "@/views/customer/ProfileView";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const mock = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  fetchProfile: vi.fn(),
  fetchAddresses: vi.fn(),
  fetchUserOrders: vi.fn(),
  user: { id: "cliente-1", email: "cliente@example.com" },
  profile: {
    full_name: "Pessoa de teste",
    avatar_url: "https://exemplo.com/avatar.jpg",
    cover_url: null,
  },
  leitura: undefined as Promise<unknown> | undefined,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mock.user,
    profile: mock.profile,
    updateProfile: mock.updateProfile,
    fetchProfile: mock.fetchProfile,
    loading: false,
    isAdmin: false,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: mock.fetchAddresses,
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: mock.fetchUserOrders }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (nome: string) => ({
      data:
        nome === "get_my_complete_profile"
          ? [{ full_name: "Pessoa de teste", whatsapp: "" }]
          : null,
      error: null,
    }),
  },
}));
vi.mock("@/utils/avatars", () => ({
  PREDEFINED_AVATARS: [
    {
      id: "teste",
      label: "Avatar de teste",
      emoji: "A",
      start: "#fff",
      end: "#000",
    },
  ],
  getPredefinedAvatarSvg: () => "data:image/svg+xml,avatar",
  compressImage: async () => "data:image/jpeg;base64,foto",
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("framer-motion", async () => {
  const { createElement } = await import("react");
  const componentes = new Map<
    string,
    (props: Record<string, unknown>) => ReactNode
  >();
  const ignoradas = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
    "layout",
    "layoutId",
  ]);
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_alvo, tag: string) => {
          if (!componentes.has(tag)) {
            componentes.set(tag, (props) =>
              createElement(
                tag,
                Object.fromEntries(
                  Object.entries(props).filter(
                    ([chave]) => !ignoradas.has(chave),
                  ),
                ),
              ),
            );
          }
          return componentes.get(tag);
        },
      },
    ),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function botao(texto: string): HTMLButtonElement {
  const encontrado = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  expect(encontrado).toBeDefined();
  return encontrado!;
}

describe.each(["perfil", "ajustes"])("foto do cliente em %s", (tela) => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    mock.leitura = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "FileReader",
      class {
        onload: ((evento: unknown) => Promise<void>) | null = null;
        readAsDataURL() {
          // Guarda a promessa do callback assíncrono, inclusive a rejeição,
          // para aguardar o finally sem criar rejeição solta no teste.
          mock.leitura = this.onload!({
            target: { result: "data:image/jpeg;base64,foto" },
          }).catch((e: unknown) => e);
        }
      },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(
        tela === "perfil" ? (
          <ProfileView onNavigate={vi.fn()} />
        ) : (
          <AccountSettingsView />
        ),
      );
    });
    await act(async () => {
      (host.querySelector('[role="button"]') as HTMLElement).click();
    });
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe.each(["foto", "avatar", "remocao"])("%s", (ponto) => {
    it.each(["sucesso", "erro", "rejeicao"])(
      "veta enquanto grava e libera após %s",
      async (desfecho) => {
        const envio = adiar<boolean>();
        mock.updateProfile.mockReturnValue(envio.promessa);
        if (ponto !== "avatar") {
          await act(async () => {
            botao("Foto Própria").click();
          });
        }
        await act(async () => {
          if (ponto === "avatar") {
            const avatar = document.querySelector(
              'button[title="Avatar de teste"]',
            ) as HTMLButtonElement;
            avatar.click();
          } else if (ponto === "remocao") {
            botao("Remover Foto").click();
          } else {
            const input = document.querySelector(
              'input[type="file"][name="avatar"]',
            ) as HTMLInputElement;
            Object.defineProperty(input, "files", {
              value: [new File(["foto"], "f.jpg", { type: "image/jpeg" })],
              configurable: true,
            });
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        try {
          expect(mock.updateProfile).toHaveBeenCalledTimes(1);
          expect(haOperacaoSensivel()).toBe(true);
          expect(motivosDeOperacaoSensivel()).toEqual(["foto-de-perfil"]);
        } finally {
          await act(async () => {
            if (desfecho === "rejeicao") {
              envio.rejeitar(new Error("falha simulada"));
            } else {
              envio.resolver(desfecho === "sucesso");
            }
            await mock.leitura;
          });
        }
        expect(haOperacaoSensivel()).toBe(false);
      },
    );
  });
});
