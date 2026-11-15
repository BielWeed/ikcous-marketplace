// @vitest-environment jsdom
//
// P62 (painel em computador) — tela Marca: o campo "Nome da loja" é o ÚNICO
// campo da grade de duas colunas (`sm:grid-cols-2`), então ocupava meia coluna:
// ~207 px medidos em Chromium a 1280 px. A célula do campo ganha `xl:col-span-2`
// (1280+) e o campo passa a usar a largura útil da seção.
//
// O celular não muda: só entra classe `xl:`. O que a grade e a célula têm SEM
// prefixo fica congelado como LITERAL (escrito à mão, nunca lido do git). O
// jsdom não mede layout (os pixels vêm do Chromium); aqui a prova é o className
// do componente REAL e mutantes em CÓPIA do className, para a trava não ser
// decorativa.
import { IdentitySettingsSection } from "@/components/admin/settings/IdentitySettingsSection";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  auth: {
    user: { id: "admin-a" },
    isAdmin: true,
    adminStatus: "admin",
    session: { user: { id: "admin-a" }, access_token: "synthetic-session" },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { businessHours: "Antigo", shippingFee: 1 },
    isLoaded: true,
    updateConfig: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => h.origin,
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
vi.mock("@/lib/adminStoreIdentity", () => ({
  readAdminStoreIdentity: h.read,
  saveAdminStoreIdentity: vi.fn(),
}));
vi.mock("@/lib/prepareIdentityImage", () => ({
  prepareIdentityImage: vi.fn(),
  prepareIdentityAppIcons: vi.fn(),
}));
vi.mock("@/lib/uploadIdentityImage", () => ({ uploadIdentityImage: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

// Lista literal do que a grade e a célula têm no celular (sem `lg:`/`xl:`).
const GRADE_NO_CELULAR = "grid grid-cols-1 gap-3 sm:grid-cols-2";
const CELULA_NO_CELULAR = "space-y-1.5";

function violacoesDaGrade(className: string): string[] {
  const v: string[] = [];
  if (classesDoCelular(className) !== GRADE_NO_CELULAR) v.push("celular mudou");
  return v;
}

function violacoesDaCelula(className: string): string[] {
  const v: string[] = [];
  if (classesDoCelular(className) !== CELULA_NO_CELULAR)
    v.push("celular mudou");
  if (!tokens(className).includes("xl:col-span-2"))
    v.push("falta xl:col-span-2");
  return v;
}

function asset(name: string, media_type = "image/svg+xml") {
  return {
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    bytes: 100,
    media_type,
  };
}
function snapshot() {
  return {
    revision: "9007199254740993",
    identity: {
      store_name: "Loja Teste",
      store_city: "Uberlândia",
      store_state: "MG",
      primary_color: "#ABCDEF",
      secondary_color: "#000000",
      accent_color: "#000000",
      logo_url: `${h.origin}/storage/v1/object/public/branding/${asset("header.svg").path}`,
      branding_assets: {
        version: 1,
        originals: [asset("source.svg")],
        header: asset("header.svg"),
        loader: asset("loader.svg"),
        favicon: asset("favicon.ico", "image/vnd.microsoft.icon"),
        apple_touch: {
          ...asset("apple.png", "image/png"),
          width: 180,
          height: 180,
        },
        icon_192: { ...asset("192.png", "image/png"), width: 192, height: 192 },
        icon_512: { ...asset("512.png", "image/png"), width: 512, height: 512 },
        maskable_512: {
          ...asset("mask.png", "image/png"),
          width: 512,
          height: 512,
        },
        og: { ...asset("og.png", "image/png"), width: 1200, height: 630 },
      },
    },
  };
}

describe("P62 Marca: o campo Nome da loja usa a largura útil no PC", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    h.read.mockReset();
    h.read.mockImplementation(async () => snapshot());
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function celulaEGrade() {
    await act(async () => {
      root.render(<IdentitySettingsSection active />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const campo = host.querySelector<HTMLInputElement>("#store-name");
    expect(campo).not.toBeNull();
    const grade = campo!.closest("fieldset") as HTMLElement;
    // input -> linha `flex` -> célula da grade (filha direta do fieldset).
    const celula = campo!.parentElement!.parentElement as HTMLElement;
    expect(celula.parentElement).toBe(grade);
    return { celula, grade };
  }

  it("a célula ganha `xl:col-span-2` e o celular continua só `space-y-1.5`", async () => {
    const { celula } = await celulaEGrade();
    expect(violacoesDaCelula(celula.className)).toEqual([]);
    expect(classesDoCelular(celula.className)).toBe(CELULA_NO_CELULAR);
  });

  it("a grade não muda em nenhuma largura", async () => {
    const { grade } = await celulaEGrade();
    expect(violacoesDaGrade(grade.className)).toEqual([]);
    expect(grade.className).toBe(GRADE_NO_CELULAR);
  });

  it("mutantes em cópia: sem o token, ou sem prefixo, a regra cai", async () => {
    const { celula } = await celulaEGrade();
    const semOToken = tokens(celula.className)
      .filter((c) => c !== "xl:col-span-2")
      .join(" ");
    expect(violacoesDaCelula(semOToken)).toContain("falta xl:col-span-2");
    const semPrefixo = tokens(celula.className)
      .map((c) => (c === "xl:col-span-2" ? "col-span-2" : c))
      .join(" ");
    expect(violacoesDaCelula(semPrefixo)).toContain("falta xl:col-span-2");
    expect(violacoesDaCelula(semPrefixo)).toContain("celular mudou");
    // Classe de celular alterada na grade: a regra da grade tem de pegar.
    expect(
      violacoesDaGrade(`${GRADE_NO_CELULAR} xl:grid-cols-1 gap-4`),
    ).toContain("celular mudou");
  });
});
