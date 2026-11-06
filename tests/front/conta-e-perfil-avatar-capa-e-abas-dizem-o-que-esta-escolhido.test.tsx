// @vitest-environment jsdom
//
// Perfil e Ajustes da conta: quem usa leitor de tela precisa saber QUAL avatar,
// QUAL capa e QUAL aba estão valendo nas janelas "Escolher Avatar ou Foto" e
// "Capa de Fundo".
//
// DEFEITO: a opção escolhida era marcada só por borda e por um ícone de visto
// sem texto, e as abas só mudavam de cor — o leitor lia cada avatar só como o
// emoji e nenhum botão dizia "selecionado". Agora avatares, capas e abas levam
// `aria-pressed` (e o avatar tem nome: o rótulo, não o emoji).
import { PREDEFINED_AVATARS, getPredefinedAvatarSvg } from "@/utils/avatars";
import { PREDEFINED_COVERS, getPredefinedCoverSvg } from "@/utils/covers";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Objetos estáveis: um novo a cada render faria os efeitos da tela rodarem em laço.
const { rpc, estado } = vi.hoisted(() => ({
  rpc: vi.fn(),
  estado: {
    user: { id: "conta-a", email: "conta-a@example.com" },
    profile: {
      full_name: "Cliente",
      avatar_url: null,
      cover_url: null,
    } as {
      full_name: string;
      avatar_url: string | null;
      cover_url: string | null;
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: estado.user,
    profile: estado.profile,
    fetchProfile: vi.fn(),
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    deleteAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: vi.fn() }),
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
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
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

const RAPOSA = PREDEFINED_AVATARS[0];
const AVATAR_ESCOLHIDO = PREDEFINED_AVATARS[2];
const CAPA_ESCOLHIDA = PREDEFINED_COVERS[1];
const svgDoAvatar = (a: (typeof PREDEFINED_AVATARS)[number]) =>
  getPredefinedAvatarSvg(a.emoji, a.start, a.end);
const svgDaCapa = (c: (typeof PREDEFINED_COVERS)[number]) =>
  getPredefinedCoverSvg(c.start, c.end, c.patternType);

const telas = [
  {
    nome: "Perfil",
    abrirFoto: "button[aria-label='Trocar foto de perfil']",
    montar: async () => {
      const { ProfileView } = await import("@/views/customer/ProfileView");
      return <ProfileView onNavigate={vi.fn()} />;
    },
  },
  {
    nome: "Ajustes da conta",
    abrirFoto: "[role=button][tabindex='0']",
    montar: async () => {
      const { AccountSettingsView } = await import(
        "@/views/customer/AccountSettingsView"
      );
      return <AccountSettingsView />;
    },
  },
] as const;

describe.each(telas)(
  "$nome — avatar, capa e abas dizem o que está escolhido",
  (tela) => {
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

    async function abrir(seletor: string) {
      const elemento = await tela.montar();
      await act(async () => {
        raiz.render(elemento);
      });
      await act(async () =>
        hospedeiro.querySelector<HTMLElement>(seletor)!.click(),
      );
    }

    const botoesDaJanela = () => [
      ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
    ];
    const aba = (texto: string) =>
      botoesDaJanela().find((b) => b.textContent?.trim() === texto)!;

    it("avatar: só o escolhido diz aria-pressed=true, e cada um tem nome", async () => {
      estado.profile = {
        full_name: "Cliente",
        avatar_url: svgDoAvatar(AVATAR_ESCOLHIDO),
        cover_url: null,
      };
      await abrir(tela.abrirFoto);
      const avatares = PREDEFINED_AVATARS.map((a) => ({
        a,
        botao: botoesDaJanela().find(
          (b) => b.getAttribute("title") === a.label,
        )!,
      }));
      for (const { a, botao } of avatares) {
        expect(botao, `botão do avatar ${a.label}`).toBeDefined();
        expect(botao.getAttribute("aria-pressed")).toBe(
          a.id === AVATAR_ESCOLHIDO.id ? "true" : "false",
        );
        // O leitor lê o rótulo, não só o emoji.
        expect(botao.getAttribute("aria-label")).toBe(a.label);
      }
    });

    it("avatar: sem escolha nenhuma, nenhum diz aria-pressed=true", async () => {
      estado.profile = {
        full_name: "Cliente",
        avatar_url: null,
        cover_url: null,
      };
      await abrir(tela.abrirFoto);
      const botao = botoesDaJanela().find(
        (b) => b.getAttribute("title") === RAPOSA.label,
      )!;
      expect(botao.getAttribute("aria-pressed")).toBe("false");
    });

    it("abas do avatar: a aba aberta diz aria-pressed=true e a outra false, e isso troca ao clicar", async () => {
      estado.profile = {
        full_name: "Cliente",
        avatar_url: null,
        cover_url: null,
      };
      await abrir(tela.abrirFoto);
      expect(aba("Avatares").getAttribute("aria-pressed")).toBe("true");
      expect(aba("Foto Própria").getAttribute("aria-pressed")).toBe("false");
      await act(async () => aba("Foto Própria").click());
      expect(aba("Avatares").getAttribute("aria-pressed")).toBe("false");
      expect(aba("Foto Própria").getAttribute("aria-pressed")).toBe("true");
    });

    it("capa: só a escolhida diz aria-pressed=true", async () => {
      estado.profile = {
        full_name: "Cliente",
        avatar_url: null,
        cover_url: svgDaCapa(CAPA_ESCOLHIDA),
      };
      await abrir("[title='Alterar capa de fundo']");
      for (const c of PREDEFINED_COVERS) {
        const botao = botoesDaJanela().find(
          (b) => b.getAttribute("title") === c.label,
        )!;
        expect(botao, `botão da capa ${c.label}`).toBeDefined();
        expect(botao.getAttribute("aria-pressed")).toBe(
          c.id === CAPA_ESCOLHIDA.id ? "true" : "false",
        );
      }
    });

    it("capa: sem capa escolhida, a padrão (a que aparece marcada) diz aria-pressed=true", async () => {
      estado.profile = {
        full_name: "Cliente",
        avatar_url: null,
        cover_url: null,
      };
      await abrir("[title='Alterar capa de fundo']");
      const botao = (id: string) =>
        botoesDaJanela().find(
          (b) =>
            b.getAttribute("title") ===
            PREDEFINED_COVERS.find((c) => c.id === id)!.label,
        )!;
      expect(botao("sunset").getAttribute("aria-pressed")).toBe("true");
      expect(botao("midnight").getAttribute("aria-pressed")).toBe("false");
    });

    it("abas da capa: a aba aberta diz aria-pressed=true e a outra false, e isso troca ao clicar", async () => {
      estado.profile = {
        full_name: "Cliente",
        avatar_url: null,
        cover_url: null,
      };
      await abrir("[title='Alterar capa de fundo']");
      expect(aba("Gradientes").getAttribute("aria-pressed")).toBe("true");
      expect(aba("Enviar Foto").getAttribute("aria-pressed")).toBe("false");
      await act(async () => aba("Enviar Foto").click());
      expect(aba("Gradientes").getAttribute("aria-pressed")).toBe("false");
      expect(aba("Enviar Foto").getAttribute("aria-pressed")).toBe("true");
    });
  },
);
