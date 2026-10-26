// Textos da conta/entrada/endereços/perfil público não podem voltar a 7-10 px
// cinza claro (ilegíveis no celular e abaixo de AA), e a página sem internet
// precisa ter contraste AA e nenhum atributo inline que a CSP bloqueia.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, montado de import.meta.url
  readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");

describe("textos pequenos e cinza claro da conta", () => {
  it("AuthView: dica de senha, subtítulo e 'Não possui conta?' em 12 px e zinc-600", () => {
    const auth = ler("src/views/shared/AuthView.tsx");
    for (const marca of [
      'id="password-dica"',
      "subtituloBoasVindas(config.storeName)",
      '"Não possui conta?"',
    ]) {
      const i = auth.indexOf(marca);
      expect(i, marca).toBeGreaterThan(-1);
      const trecho = auth.slice(Math.max(0, i - 260), i + 120);
      expect(trecho, marca).toMatch(/text-xs[^"]*text-zinc-600/);
      expect(trecho, marca).not.toMatch(/text-\[10px\]/);
    }
  });

  it("AddressList: rua, etiquetas e apelido legíveis", () => {
    const lista = ler("src/components/ui/custom/AddressList.tsx");
    expect(lista).not.toMatch(/text-\[(7|9)px\]/);
    expect(lista).not.toContain("truncate text-[11px] font-bold text-zinc-900");
    expect(lista).not.toContain("max-w-[150px]");
    expect(lista).toContain(
      "mt-0.5 truncate text-xs font-medium text-zinc-600",
    );
  });

  it("UserProfileView: nada de 8-9 px em texto", () => {
    expect(ler("src/views/customer/UserProfileView.tsx")).not.toMatch(
      /text-\[(8|9)px\]/,
    );
  });
});

describe("public/offline.html", () => {
  const html = ler("public/offline.html");

  it("cinza do texto de apoio é #a1a1aa (AA sobre #09090b)", () => {
    expect(html).toContain("--muted: #a1a1aa;");
    expect(html).not.toContain("#71717a");
  });

  it("não tem atributo inline de evento (a CSP bloqueia e ele nunca roda)", () => {
    expect(html).not.toMatch(/\son(error|load|click)=/i);
  });
});
