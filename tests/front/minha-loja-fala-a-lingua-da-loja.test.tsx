// @vitest-environment jsdom
//
// Painel simples, onda J (J6): "Minha loja" fala a língua da lojista. Nada de
// "MiB" (a lojista conhece "MB"), de "checkout" no Contato, de "peça futura"
// na Descrição; a frase do Horário aparece uma vez só; e "Salvar horário" /
// "Descartar horário" têm cara de botão (altura de toque de 44px e estado
// desligado visível), não de texto solto.
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

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    storeCity: "Monte Carmelo",
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
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
// A marca (bloco 1) lê a identidade salva; devolvemos uma mínima, só para o
// editor de imagens (e a dica "Até 20 MB") aparecer.
vi.mock("@/lib/adminStoreIdentity", () => {
  const origem = "https://abcdefghijklmnopqrst.supabase.co";
  const sha = "a".repeat(64);
  const arquivo = (nome: string, media_type = "image/png") => ({
    path: `v1/${sha}/${nome}`,
    sha256: sha,
    bytes: 100,
    media_type,
  });
  return {
    readAdminStoreIdentity: vi.fn().mockResolvedValue({
      revision: "1",
      identity: {
        store_name: "Loja Teste",
        store_city: "Uberlândia",
        store_state: "MG",
        primary_color: "#ABCDEF",
        secondary_color: "#000000",
        accent_color: "#000000",
        logo_url: `${origem}/storage/v1/object/public/branding/v1/${sha}/header.svg`,
        branding_assets: {
          version: 1,
          originals: [arquivo("source.svg", "image/svg+xml")],
          header: arquivo("header.svg", "image/svg+xml"),
          loader: arquivo("loader.svg", "image/svg+xml"),
          favicon: arquivo("favicon.ico", "image/vnd.microsoft.icon"),
          apple_touch: { ...arquivo("apple.png"), width: 180, height: 180 },
          icon_192: { ...arquivo("192.png"), width: 192, height: 192 },
          icon_512: { ...arquivo("512.png"), width: 512, height: 512 },
          maskable_512: { ...arquivo("mask.png"), width: 512, height: 512 },
          og: { ...arquivo("og.png"), width: 1200, height: 630 },
        },
      },
    }),
    saveAdminStoreIdentity: vi.fn(),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Minha loja — texto sem linguagem interna", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    // Carrega antes o bloco da marca (lazy na tela): o "Carregando…" resolve
    // dentro do act, sem aviso de suspensão fora dele.
    await import("@/components/admin/settings/IdentitySettingsSection");
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(<AdminAboutStoreView onNavigate={vi.fn()} active={true} />);
    });
    // O bloco da marca é carregado sob demanda: espera sair o "Carregando…".
    await vi.waitFor(async () => {
      await act(async () => {
        await esperarMicrotarefas();
      });
      expect(hospedeiro.textContent).not.toContain("Carregando identidade");
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  function botao(texto: string): HTMLButtonElement {
    const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );
    expect(achado, `botão "${texto}"`).toBeDefined();
    return achado as HTMLButtonElement;
  }

  it("não tem MiB, checkout nem peça futura", () => {
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/MiB/);
    expect(texto).not.toMatch(/checkout/i);
    expect(texto).not.toMatch(/peça futura/i);
  });

  it("o Horário não repete a descrição do bloco dentro do campo", () => {
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Informe quando a loja atende");
    expect(texto).toContain(
      "Aparece na página Sobre a Loja e no rodapé da página inicial.",
    );
    // O aviso útil (limpar o campo tira o horário do app) mora só na descrição.
    expect(texto).toContain("Em branco, não aparece");
    expect(texto).not.toContain("o aplicativo omite o horário");
    expect(texto).not.toContain("Expediente publicado");
    // A Marca também não diz duas vezes o que o cabeçalho do bloco já disse.
    expect(texto).not.toContain("Nome, cores e imagens da sua loja");
  });

  it("'Salvar horário' é botão primário de 44px, com o desligado visível", () => {
    const salvar = botao("Salvar horário");
    expect(salvar.className).toContain("min-h-11");
    expect(salvar.className).toContain("disabled:opacity-40");
    expect(salvar.className).toContain("bg-admin-gold");
  });

  it("'Descartar horário' é botão secundário de 44px, com o desligado visível", () => {
    const descartar = botao("Descartar horário");
    expect(descartar.className).toContain("min-h-11");
    expect(descartar.className).toContain("disabled:opacity-40");
    expect(descartar.className).toContain("border-white/15");
  });

  it("o campo do horário tem 44px e o rótulo não repete o título do bloco", () => {
    const campo = hospedeiro.querySelector("#store-business-hours");
    expect(campo?.className).toContain("h-11");
    const rotulo = hospedeiro.querySelector(
      'label[for="store-business-hours"]',
    );
    expect(rotulo?.textContent).toBe("Dias e horários");
  });

  it("a Descrição não diz duas vezes a regra da linha em branco", () => {
    const texto = hospedeiro.textContent ?? "";
    expect(texto.split("linha em branco").length - 1).toBe(1);
    expect(texto).toContain("Texto simples, sem negrito nem imagens.");
  });

  it("a dica das imagens da marca diz 'Até 20 MB'", () => {
    expect(hospedeiro.textContent).toContain("Até 20 MB");
  });
});
