// 23/09/2026, produção IKCOUS em aa87649: `/logos/transportadoras/*.svg`
// respondia 200 `text/html` (o app shell) — `public/logos/` não estava nos
// prefixos reservados do matcher, então o porteiro tratava o logo como
// DOCUMENTO e devolvia `/index.html` com a ficha no lugar da imagem. O
// frete caía no ícone genérico (fallback do `onError`) em toda loja.
//
// A regra que fica: TODA pasta de `public/` é copiada crua para a raiz do
// build e é arquivo estático — nenhuma pode casar o padrão de documento.
// O teste lê as pastas do disco para que a PRÓXIMA pasta nova em `public/`
// quebre aqui, e não em produção.
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CAMINHO_DOCUMENTO_REGEX } from "@/hospedagem/porteiro";

const PASTA_PUBLIC = path.resolve(import.meta.dirname, "..", "..", "public");

const pastasDePublic = readdirSync(PASTA_PUBLIC, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name);

describe("matcher do porteiro — pastas de public/ são arquivo estático, nunca documento", () => {
  it("public/ tem pastas para conferir (a leitura do disco não voltou vazia)", () => {
    expect(pastasDePublic).toContain("logos");
  });

  it.each(pastasDePublic)(
    "/%s/<arquivo> NÃO casa o padrão de documento",
    (pasta) => {
      expect(CAMINHO_DOCUMENTO_REGEX.test(`/${pasta}/qualquer.svg`)).toBe(
        false,
      );
    },
  );

  it("os logos reais do frete não casam (o caso medido em produção)", () => {
    expect(
      CAMINHO_DOCUMENTO_REGEX.test("/logos/transportadoras/correios.svg"),
    ).toBe(false);
    expect(
      CAMINHO_DOCUMENTO_REGEX.test("/logos/provedores/melhor-envio.svg"),
    ).toBe(false);
  });

  it("rota de documento que só COMEÇA com o nome da pasta continua documento (o prefixo tem a barra)", () => {
    expect(CAMINHO_DOCUMENTO_REGEX.test("/logos")).toBe(true);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/logosfera")).toBe(true);
  });
});
