// @vitest-environment jsdom
//
// Redesenho "Tinta" da Conta (23/10/2026), cartão de identidade da aba Perfil:
// a pré-visualização grande da capa saiu da tela, e a capa continua editável
// pelo link "Alterar capa" (mesmo caminho do botão da câmera de antes). O link
// "Alterar foto" e o próprio avatar abrem o MESMO editor de foto. As iniciais
// só aparecem sem foto, e nome vazio não inventa iniciais.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  profile: { avatar_url: null, cover_url: null } as {
    avatar_url: string | null;
    cover_url: string | null;
  },
}));
const rpc = vi.fn();
const USUARIO = { id: "cliente-1", email: "cliente@example.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: auth.profile,
    fetchProfile: vi.fn(),
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
  }),
}));
vi.mock("@/components/account/PrivacidadeEMeusDados", () => ({
  PrivacidadeEMeusDados: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "t", user: USUARIO } },
        }),
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObservadorMudo);
vi.stubGlobal("IntersectionObserver", ObservadorMudo);

const botoes = () => [...document.body.querySelectorAll("button")];
const botaoComTexto = (t: string) =>
  botoes().find((b) => b.textContent?.trim() === t);

describe("Conta (Tinta) — cartão de identidade da aba Perfil", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    auth.profile = { avatar_url: null, cover_url: null };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(nomeSalvo: string) {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve(
        nome === "get_my_complete_profile"
          ? { data: [{ full_name: nomeSalvo, whatsapp: "" }], error: null }
          : { data: null, error: null },
      ),
    );
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }

  it("a prévia grande da capa saiu: sem imagem de capa enquanto o editor está fechado", async () => {
    await montar("Fulano de Tal");
    expect(document.querySelector("img[alt='Capa de Perfil']")).toBeNull();
    expect(
      document.querySelector("[title='Alterar capa de fundo']"),
    ).not.toBeNull();
  });

  it("'Alterar capa' abre o editor de capa", async () => {
    await montar("Fulano de Tal");
    await act(async () => botaoComTexto("Alterar capa")!.click());
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
    expect(document.querySelector("img[alt='Capa de Perfil']")).not.toBeNull();
  });

  it("'Alterar foto' abre o editor de foto", async () => {
    await montar("Fulano de Tal");
    await act(async () => botaoComTexto("Alterar foto")!.click());
    expect(document.querySelector("[role=dialog]")?.textContent).toContain(
      "Escolher Avatar ou Foto",
    );
  });

  it("o avatar é o primeiro [role=button] e abre o editor de foto", async () => {
    await montar("Fulano de Tal");
    const avatar = document.querySelector<HTMLElement>("[role=button]")!;
    expect(avatar.getAttribute("tabindex")).toBe("0");
    await act(async () => avatar.click());
    expect(document.querySelector("[role=dialog]")?.textContent).toContain(
      "Escolher Avatar ou Foto",
    );
  });

  it("sem foto, mostra as iniciais (primeira e última palavra) do nome salvo", async () => {
    await montar("  maria de souza  ");
    const avatar = document.querySelector<HTMLElement>("[role=button]")!;
    expect(avatar.textContent).toBe("MS");
  });

  it("nome de uma palavra só usa uma letra", async () => {
    await montar("Madonna");
    const avatar = document.querySelector<HTMLElement>("[role=button]")!;
    expect(avatar.textContent).toBe("M");
  });

  it("nome vazio não inventa iniciais e o cartão cai para o e-mail", async () => {
    await montar("");
    const avatar = document.querySelector<HTMLElement>("[role=button]")!;
    expect(avatar.textContent).toBe("");
    expect(avatar.querySelector("svg")).not.toBeNull();
    expect(hospedeiro.textContent).toContain("cliente@example.com");
  });

  it("com foto, mostra a foto e não as iniciais", async () => {
    auth.profile = {
      avatar_url: "data:image/png;base64,AAAA",
      cover_url: null,
    };
    await montar("Fulano de Tal");
    const avatar = document.querySelector<HTMLElement>("[role=button]")!;
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(avatar.textContent).toBe("");
  });
});
