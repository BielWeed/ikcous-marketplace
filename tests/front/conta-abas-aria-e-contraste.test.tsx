// @vitest-environment jsdom
//
// Abas da Conta (Tinta): (1) cada aba liga ao seu painel por aria-controls e o
// painel aponta de volta por aria-labelledby, com ids únicos; (2) a aba NÃO
// selecionada tem contraste >= 4,5:1 sobre o fundo do controle nos dois temas
// (text-muted-foreground sobre bg-muted dava 4,39:1 no claro). O cálculo lê as
// variáveis de src/index.css, então um ajuste de tema que quebre o contraste
// derruba o teste.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: { avatar_url: null, cover_url: null },
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
    rpc: () => Promise.resolve({ data: null, error: null }),
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

const abas = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')];

describe("Conta (Tinta) — abas: aria-controls, aria-labelledby e contraste", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("a aba selecionada liga ao painel e o painel aponta de volta, nas duas abas", async () => {
    const ids = new Set<string>();
    for (const nome of ["Perfil", "Segurança"]) {
      const aba = abas().find((a) => a.textContent === nome)!;
      await act(async () => aba.click());
      expect(aba.getAttribute("aria-selected")).toBe("true");
      const idDoPainel = aba.getAttribute("aria-controls")!;
      expect(idDoPainel).toBeTruthy();
      const painel = document.getElementById(idDoPainel)!;
      expect(painel.getAttribute("role")).toBe("tabpanel");
      expect(painel.getAttribute("aria-labelledby")).toBe(aba.id);
      expect(aba.id).toBeTruthy();
      ids.add(aba.id);
      ids.add(idDoPainel);
    }
    expect(ids.size).toBe(4);
  });

  it("a aba não selecionada não usa a cor de texto que reprovava no claro", () => {
    const naoSelecionada = abas().find(
      (a) => a.getAttribute("aria-selected") === "false",
    )!;
    expect(naoSelecionada.className).not.toContain("text-muted-foreground");
    expect(naoSelecionada.className).toContain("text-foreground/70");
  });

  // ---- contraste, calculado das variáveis reais do tema ----
  function variavel(bloco: string, nome: string): [number, number, number] {
    const m = bloco.match(
      new RegExp(`--${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
    )!;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  function rgb([h, s, l]: [number, number, number]) {
    const sat = s / 100;
    const lum = l / 100;
    const a = sat * Math.min(lum, 1 - lum);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return lum - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const brilho = (c: number[]) =>
    0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  function contraste(a: number[], b: number[]) {
    const [x, y] = [brilho(a), brilho(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function blocoDoTema(inicio: string) {
    const css = readFileSync("src/index.css", "utf8");
    const i = css.indexOf(inicio);
    return css.slice(i, css.indexOf("}", i));
  }

  it.each([
    ["claro", ":root {"],
    ["escuro", ".dark {"],
  ])(
    "tema %s: texto foreground/70 sobre bg-muted passa de 4,5:1",
    (_t, ini) => {
      const bloco = blocoDoTema(ini);
      const fundo = rgb(variavel(bloco, "muted"));
      const texto = rgb(variavel(bloco, "foreground"));
      const misturado = texto.map((v, i) => v * 0.7 + fundo[i] * 0.3);
      expect(contraste(misturado, fundo)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("controle: a cor antiga (muted-foreground) reprova no tema claro", () => {
    const bloco = blocoDoTema(":root {");
    const c = contraste(
      rgb(variavel(bloco, "muted-foreground")),
      rgb(variavel(bloco, "muted")),
    );
    expect(c).toBeLessThan(4.5);
  });
});
