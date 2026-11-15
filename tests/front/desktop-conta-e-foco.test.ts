/* eslint-disable security/detect-non-literal-fs-filename -- Lê só fontes locais com nomes fixos deste teste, nunca entrada de usuário. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// Literais observados antes da mudança: só variantes de >=1024 px podem entrar.
const casos = [
  [
    "ProfileView",
    "mx-auto max-w-md space-y-7 px-4",
    ["lg:max-w-none", "lg:grid", "lg:grid-cols-[280px_1fr]", "lg:gap-8"],
  ],
  [
    "ProfileView",
    "relative h-[120px] w-full overflow-hidden bg-muted",
    ["lg:rounded-3xl"],
  ],
  [
    "AccountSettingsView",
    "mx-auto max-w-md space-y-6 px-4 py-6 sm:px-6 sm:py-8",
    ["lg:max-w-none", "lg:grid", "lg:grid-cols-[280px_1fr]"],
  ],
  [
    "AccountSettingsView",
    "flex w-full rounded-[14px] bg-muted p-1",
    ["lg:sticky", "lg:top-24", "lg:flex-col"],
  ],
  [
    "AddressFormView",
    "mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-5",
    ["lg:max-w-2xl"],
  ],
  [
    "AboutStoreView",
    "mx-auto max-w-md space-y-6 px-4 pt-6 sm:px-6 sm:pt-8",
    ["lg:max-w-2xl"],
  ],
  ["UserProfileView", "mx-auto max-w-md space-y-6 px-4", ["lg:max-w-2xl"]],
  [
    "UserProfileView",
    "group relative h-44 w-full overflow-hidden bg-zinc-100 shadow-inner",
    ["lg:mx-auto", "lg:max-w-2xl", "lg:rounded-3xl"],
  ],
  ["OrderSuccessView", "grid w-full max-w-xs gap-4", ["lg:max-w-2xl"]],
  [
    "PoliticaDaLojaView",
    "mx-auto max-w-md space-y-6 px-4 py-6 sm:px-6 sm:py-8",
    ["lg:max-w-2xl"],
  ],
] as const;

function fonte(tela: string) {
  return readFileSync(resolve("src/views/customer", `${tela}.tsx`), "utf8");
}

describe("conta e telas de foco no computador", () => {
  for (const [tela, celular, computador] of casos) {
    it(`${tela}: ${celular} preserva celular e tablet`, () => {
      const texto = fonte(tela);
      const inicio = texto.indexOf(celular);
      const literal = texto
        .slice(inicio)
        .split(/["\x60]|\$\{/)[0]
        .trim();
      expect(inicio).toBeGreaterThanOrEqual(0);
      expect(classesDoCelular(literal)).toBe(celular);
      for (const classe of computador)
        expect(literal.split(/\s+/)).toContain(classe);
    });
  }

  it("notificações limita conteúdo interno sem limitar a raiz de rolagem", () => {
    const texto = fonte("NotificationsView");
    expect(texto).toContain(
      'className="pb-customer flex min-h-full flex-col bg-background"',
    );
    expect(texto).toContain(
      'className="flex flex-1 flex-col px-4 pt-2 lg:mx-auto lg:w-full lg:max-w-2xl"',
    );
    expect(
      texto.includes('<div className="lg:mx-auto lg:w-full lg:max-w-2xl">'),
    ).toBe(false);
  });

  it("menu Conta existente vira lateral sticky sem novos destinos", () => {
    const texto = fonte("ProfileView");
    for (const classe of [
      "lg:row-start-2",
      "lg:row-span-4",
      "lg:sticky",
      "lg:top-24",
      "lg:self-start",
    ]) {
      expect(texto).toContain(classe);
    }

    // Contrato conferido em HEAD f04669a6a: mesmos itens e mesmos callbacks,
    // inclusive o destino calculado de CADA política. Uma troca por auth falha.
    const itens = texto.match(/<LinhaDoMenu\b[\s\S]*?\/>/g) ?? [];
    expect(itens.map((item) => item.replace(/\s+/g, " ").trim())).toEqual([
      '<LinhaDoMenu titulo="Segurança e conta" descricao="Alterar senha e dados pessoais" onClick={() => onNavigate("account-settings")} />',
      '<LinhaDoMenu titulo="Sobre a loja" descricao="A loja por trás deste app" onClick={() => onNavigate("about-store")} />',
      "<LinhaDoMenu key={tipo} titulo={nomeDaPolitica(tipo)} descricao={descricaoDaPolitica(tipo)} onClick={() => onNavigate(viewDaPolitica(tipo))} />",
    ]);
    expect(texto).toContain("TIPOS_DE_POLITICA.map((tipo) => (");
  });

  it("WhatsApp muda só offset do PC", () => {
    const texto = fonte("AboutStoreView");
    expect(texto).toContain("lg:!bottom-6");
    expect(texto).toContain(
      "calc(var(--nav-height, 56px) + 16px + var(--safe-area-bottom, 0px))",
    );
  });
});
