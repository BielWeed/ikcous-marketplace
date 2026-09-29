// @vitest-environment jsdom
//
// Pedido do dono (22/09/2026): os acordeões "Nome, logo e cores" e
// "Atendimento" em Ajustes duplicavam a edição de identidade/horário que já
// existe em AdminAboutStoreView ("Sobre a Loja") — mesmos componentes
// (IdentitySettingsSection, BusinessHoursSection), mesmo contrato de
// salvamento. Este arquivo fixa os dois lados do contrato:
//   1. Ajustes NÃO edita mais identidade/horário — só leva para lá.
//   2. Sobre a Loja continua montando os dois editores de verdade.
// O comportamento DETALHADO de cada editor (salvar, recusar preto, horário
// nulo, etc.) já está coberto em admin-settings-identidade-da-loja.test.tsx,
// admin-settings-cor-da-loja.test.tsx, ajustes-horario-de-atendimento.test.tsx
// e identity-settings-section.test.tsx — não se duplica aqui.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    storeName: "Loja Teste",
    storeCity: "Uberlândia",
    storeState: "MG",
    businessHours: "Seg-Sáb: 9h às 18h",
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

// A identidade de verdade (RPC protegida) não é o alvo deste arquivo — só
// precisa resolver com uma fotografia válida para o rascunho existir e o
// campo #store-name aparecer (comportamento detalhado fica para os
// arquivos citados acima).
function assetFixture(
  name: string,
  width?: number,
  height?: number,
  media_type = "image/png",
) {
  return {
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    bytes: 100,
    media_type,
    ...(width === undefined ? {} : { width, height }),
  };
}
const origin = "https://abcdefghijklmnopqrst.supabase.co";
vi.mock("@/lib/adminStoreIdentity", () => ({
  readAdminStoreIdentity: vi.fn(async () => ({
    revision: "1",
    identity: {
      store_name: "Loja Teste",
      store_city: "Uberlândia",
      store_state: "MG",
      primary_color: "#ABCDEF",
      secondary_color: "#000000",
      accent_color: "#000000",
      logo_url: `${origin}/storage/v1/object/public/branding/${assetFixture("header.svg").path}`,
      branding_assets: {
        version: 1,
        originals: [
          assetFixture("source.svg", undefined, undefined, "image/svg+xml"),
        ],
        header: assetFixture(
          "header.svg",
          undefined,
          undefined,
          "image/svg+xml",
        ),
        loader: assetFixture(
          "loader.svg",
          undefined,
          undefined,
          "image/svg+xml",
        ),
        favicon: assetFixture(
          "favicon.ico",
          undefined,
          undefined,
          "image/vnd.microsoft.icon",
        ),
        apple_touch: assetFixture("apple.png", 180, 180),
        icon_192: assetFixture("192.png", 192, 192),
        icon_512: assetFixture("512.png", 512, 512),
        maskable_512: assetFixture("mask.png", 512, 512),
        og: assetFixture("og.png", 1200, 630),
      },
    },
  })),
  saveAdminStoreIdentity: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Identidade e horário: edição só em Sobre a Loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("Ajustes > Sua loja não mostra os acordeões duplicados e continua levando a Sobre a Loja", async () => {
    const onNavigate = vi.fn();
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Os campos de identidade/horário não existem mais nesta tela.
    expect(hospedeiro.querySelector("#store-name")).toBeNull();
    expect(hospedeiro.querySelector("#store-business-hours")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Nome, logo e cores");

    // O atalho para a edição de verdade continua de pé.
    const porta = [...hospedeiro.querySelectorAll('[role="button"]')].find(
      (el) => el.textContent?.includes("Sobre a Loja"),
    );
    expect(porta, "porta 'Sobre a Loja' ausente").toBeDefined();
    await act(async () => {
      porta!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });

  it("Sobre a Loja continua montando IdentitySettingsSection e BusinessHoursSection", async () => {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(<AdminAboutStoreView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await import("@/components/admin/settings/IdentitySettingsSection");
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // IdentitySettingsSection: campo de nome vindo do rascunho carregado.
    expect(hospedeiro.querySelector("#store-name")).not.toBeNull();
    // BusinessHoursSection: mesmo campo/id de sempre, com o valor salvo.
    const horario = hospedeiro.querySelector<HTMLInputElement>(
      "#store-business-hours",
    );
    expect(horario).not.toBeNull();
    expect(horario!.value).toBe("Seg-Sáb: 9h às 18h");
  });
});
