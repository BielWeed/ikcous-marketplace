// @vitest-environment jsdom
//
// "Minha loja" (Sobre a loja) no painel: o pedaço da identidade (nome e logo)
// é baixado sob demanda. Se o arquivo dele não baixa, só ESSE bloco mostra um
// aviso com "Tentar de novo"; o horário de atendimento e o resto da tela
// continuam na tela, sem a tela inteira de erro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const servidor = vi.hoisted(() => ({ ok: false }));

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
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeCity: "Monte Carmelo",
      storeState: "MG",
      businessHours: "Seg-Sáb: 9h às 18h",
    },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// O arquivo da identidade: pedir o módulo falha enquanto o servidor não
// responde (getter: o vitest guarda o resultado da fábrica entre os testes).
vi.mock("@/components/admin/settings/IdentitySettingsSection", async () => {
  const { createElement } = await import("react");
  const Identidade = () =>
    createElement("div", { "data-testid": "identidade-ok" }, "identidade");
  return {
    get IdentitySettingsSection() {
      if (!servidor.ok) {
        throw new TypeError(
          "Failed to fetch dynamically imported module: http://x/assets/IdentitySettingsSection-abc.js",
        );
      }
      return Identidade;
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Sobre a loja (painel) — identidade que não baixou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    servidor.ok = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  async function assentar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  async function abrirTela() {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(<AdminAboutStoreView onNavigate={vi.fn()} active={true} />);
    });
    await assentar();
  }

  const botaoPorTexto = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement | undefined;

  it("o resto da tela fica e só o bloco da identidade mostra o aviso", async () => {
    await abrirTela();

    expect(hospedeiro.querySelector("#store-business-hours")).not.toBeNull();
    expect(
      (hospedeiro.querySelector("#store-business-hours") as HTMLInputElement)
        .value,
    ).toBe("Seg-Sáb: 9h às 18h");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Esta parte não abriu",
    );
    expect(botaoPorTexto("Tentar de novo")).toBeDefined();
  });

  it("'Tentar de novo' com o arquivo de volta mostra a identidade", async () => {
    await abrirTela();

    servidor.ok = true;
    await act(async () => {
      botaoPorTexto("Tentar de novo")?.click();
    });
    await assentar();

    expect(
      hospedeiro.querySelector('[data-testid="identidade-ok"]'),
    ).not.toBeNull();
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });
});
