import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// Módulo JS sem declaração de tipos, mesmo padrão de hospedagem-rotas.test.ts.
// @ts-expect-error Módulo JS nativo sem declaração.
import * as dev from "../../scripts/dev-oficial.mjs";

const REF_OFICIAL = "cafkrminfnokvgjqtkle";
const REF_ANTIGO = "dekxabvqdsuukijblazl";
const html = (ref: string) =>
  `<html><script>window.__FICHA__={"conexao":{"supabaseUrl":"https://${ref}.supabase.co","publishableKey":"chave-publica-de-teste"},"x":1}</script></html>`;

describe("npm run dev:oficial só sobe ligado ao banco oficial da IKCOUS", () => {
  const canais = JSON.parse(
    readFileSync("scripts/frota/canais-de-backend.json", "utf8"),
  );

  it("o ref esperado vem do canal versionado da IKCOUS (não de texto solto)", () => {
    expect(dev.refDoCanal(canais, "IKCOUS")).toBe(REF_OFICIAL);
    expect(dev.refDoCanal(canais, "loja que nao existe")).toBeNull();
  });

  it("lê a URL e a chave pública da ficha do HTML publicado", () => {
    expect(dev.extrairConexaoDaFicha(html(REF_OFICIAL))).toEqual({
      supabaseUrl: `https://${REF_OFICIAL}.supabase.co`,
      publishableKey: "chave-publica-de-teste",
    });
  });

  it("aceita a ficha do banco oficial", () => {
    const conexao = dev.extrairConexaoDaFicha(html(REF_OFICIAL));
    expect(dev.motivoDeRecusa(conexao, REF_OFICIAL)).toBeNull();
  });

  it("controle negativo: RECUSA a ficha que aponta para o banco ANTIGO", () => {
    const conexao = dev.extrairConexaoDaFicha(html(REF_ANTIGO));
    expect(dev.motivoDeRecusa(conexao, REF_OFICIAL)).toContain(
      `${REF_ANTIGO}.supabase.co`,
    );
  });

  it("recusa página sem ficha, ficha sem chave e canal desconhecido", () => {
    expect(dev.extrairConexaoDaFicha("<html>sem ficha</html>")).toBeNull();
    expect(
      dev.extrairConexaoDaFicha(
        '{"conexao":{"supabaseUrl":"https://a.supabase.co"}}',
      ),
    ).toBeNull();
    expect(dev.motivoDeRecusa(null, REF_OFICIAL)).toContain("ficha");
    expect(
      dev.motivoDeRecusa(dev.extrairConexaoDaFicha(html(REF_OFICIAL)), null),
    ).toContain("canais-de-backend");
  });

  it("recusa host que só PARECE o oficial (sufixo/prefixo enganoso)", () => {
    const enganoso = {
      supabaseUrl: `https://${REF_OFICIAL}.supabase.co.malicioso.example`,
      publishableKey: "x",
    };
    expect(dev.motivoDeRecusa(enganoso, REF_OFICIAL)).not.toBeNull();
  });
});
