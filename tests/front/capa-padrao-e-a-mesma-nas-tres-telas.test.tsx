// @vitest-environment jsdom
//
// A capa padrão do perfil (a de quem nunca escolheu capa, `cover_url` nulo) era laranja/rosa ("Sunset Glow", a que a
// janela "Capa de Fundo" marca como atual) para a própria pessoa — no Perfil e em Ajustes da conta — e azul/ciano no
// perfil público dela, que quem toca no nome numa avaliação ou pergunta vê. Uma capa que ela nunca escolheu e que nem
// está na lista de capas.
//
// Agora existe UMA constante (`CAPA_PADRAO_URL`, em utils/covers.ts, derivada da primeira capa da lista, "sunset") e as
// três telas usam ela. Este teste monta as três com `cover_url` nulo e confere que a capa desenhada é a mesma, e que
// ela é a Sunset Glow da lista.
import {
  CAPA_PADRAO_URL,
  PREDEFINED_COVERS,
  getPredefinedCoverSvg,
} from "@/utils/covers";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Objetos estáveis: um novo a cada render faria os efeitos das telas rodarem em laço.
const { rpc, estado } = vi.hoisted(() => ({
  rpc: vi.fn(),
  estado: {
    user: { id: "conta-a", email: "conta-a@example.com" },
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
    perfilPublico: {
      id: "user-alvo",
      full_name: "Cliente Teste",
      avatar_url: null,
      created_at: "2026-01-01T00:00:00.000Z",
      cover_url: null as string | null,
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
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: (tabela: string) => {
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: estado.perfilPublico, error: null }),
            }),
          }),
        };
      }
      throw new Error(`from inesperado neste teste: ${tabela}`);
    },
  },
}));
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
      enableReviews: true,
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

const SUNSET = PREDEFINED_COVERS.find((c) => c.id === "sunset")!;
const SVG_DA_SUNSET = getPredefinedCoverSvg(
  SUNSET.start,
  SUNSET.end,
  SUNSET.patternType,
);

const telas = [
  {
    nome: "Perfil (a própria pessoa)",
    montar: async () => {
      const { ProfileView } = await import("@/views/customer/ProfileView");
      return <ProfileView onNavigate={vi.fn()} />;
    },
    antes: async (_hospedeiro: HTMLElement) => {},
  },
  {
    nome: "Ajustes da conta (a própria pessoa, janela Capa de Fundo)",
    montar: async () => {
      const { AccountSettingsView } = await import(
        "@/views/customer/AccountSettingsView"
      );
      return <AccountSettingsView />;
    },
    antes: async (hospedeiro: HTMLElement) => {
      await act(async () =>
        hospedeiro
          .querySelector<HTMLElement>("[title='Alterar capa de fundo']")!
          .click(),
      );
    },
  },
  {
    nome: "Perfil público (quem vê o perfil dela)",
    montar: async () => {
      const { UserProfileView } = await import(
        "@/views/customer/UserProfileView"
      );
      return <UserProfileView userId="user-alvo" onNavigate={() => {}} />;
    },
    antes: async (_hospedeiro: HTMLElement) => {},
  },
] as const;

describe("capa padrão — a mesma constante nas três telas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", Stub);
    vi.stubGlobal("IntersectionObserver", Stub);
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Nome", whatsapp: "" }],
          error: null,
        });
      }
      if (
        nome === "perfil_publico_avaliacoes" ||
        nome === "perfil_publico_perguntas"
      ) {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
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

  it("a constante é a Sunset Glow da lista de capas", () => {
    expect(CAPA_PADRAO_URL).toBe(SVG_DA_SUNSET);
  });

  it.each(telas)(
    "$nome: sem capa escolhida desenha a capa padrão",
    async (tela) => {
      const elemento = await tela.montar();
      await act(async () => {
        raiz.render(elemento);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await tela.antes(hospedeiro);

      const capa = document.querySelector<HTMLImageElement>(
        "img[alt='Capa de Perfil']",
      );
      expect(capa, "imagem da capa").not.toBeNull();
      expect(capa!.getAttribute("src")).toBe(CAPA_PADRAO_URL);
      expect(capa!.getAttribute("src")).toBe(SVG_DA_SUNSET);
    },
  );

  it("controle: capa escolhida continua valendo no perfil público", async () => {
    const escolhida = PREDEFINED_COVERS[1];
    const svgEscolhido = getPredefinedCoverSvg(
      escolhida.start,
      escolhida.end,
      escolhida.patternType,
    );
    estado.perfilPublico = { ...estado.perfilPublico, cover_url: svgEscolhido };
    try {
      const { UserProfileView } = await import(
        "@/views/customer/UserProfileView"
      );
      await act(async () => {
        raiz.render(
          <UserProfileView userId="user-alvo" onNavigate={() => {}} />,
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const capa = document.querySelector<HTMLImageElement>(
        "img[alt='Capa de Perfil']",
      );
      expect(capa!.getAttribute("src")).toBe(svgEscolhido);
      expect(capa!.getAttribute("src")).not.toBe(CAPA_PADRAO_URL);
    } finally {
      estado.perfilPublico = { ...estado.perfilPublico, cover_url: null };
    }
  });
});
