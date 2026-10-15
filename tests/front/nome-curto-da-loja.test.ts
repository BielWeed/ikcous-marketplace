// O nome que aparece EMBAIXO do ícone do app instalado no celular. O celular
// corta esse rótulo perto dos 12 caracteres: com o nome inteiro da loja
// ("Savy Collection", 15), o ícone saía como "Savy Collec…", cortado no meio
// da palavra. `nomeCurtoDaLoja` entrega a versão que cabe, sem cortar palavra
// quando dá. Não mede o rótulo num aparelho real.
import { identityHtml } from "@/config/identidadeNoHtml";
import { nomeCurtoDaLoja } from "@/config/nomeCurtoDaLoja";
import { describe, expect, it } from "vitest";

describe("nomeCurtoDaLoja — o rótulo do ícone instalado", () => {
  it("nome que já cabe em 12 caracteres fica como está", () => {
    expect(nomeCurtoDaLoja("IKCOUS")).toBe("IKCOUS");
    expect(nomeCurtoDaLoja("Casa de Bolo")).toBe("Casa de Bolo");
  });

  it("nome comprido vira as palavras do começo que cabem, sem cortar palavra", () => {
    expect(nomeCurtoDaLoja("Savy Collection")).toBe("Savy");
    expect(nomeCurtoDaLoja("Papelaria Central Norte")).toBe("Papelaria");
    expect(nomeCurtoDaLoja("Moda Bela Vista Store")).toBe("Moda Bela");
  });

  it("não deixa 'de/da/do/e/&' pendurado no fim", () => {
    expect(nomeCurtoDaLoja("Ateliê da Serra")).toBe("Ateliê");
    expect(nomeCurtoDaLoja("Loja do Teste PWA")).toBe("Loja");
    expect(nomeCurtoDaLoja("Pizza & Cia Grande")).toBe("Pizza & Cia");
  });

  it("usa a parte antes do separador ' | ' ou ' - ' (a mesma convenção do cabeçalho)", () => {
    expect(nomeCurtoDaLoja("IKCOUS | Marketplace Local")).toBe("IKCOUS");
    expect(nomeCurtoDaLoja("Moda Sol - Centro da Cidade")).toBe("Moda Sol");
  });

  it("hífen colado dentro da palavra não é separador", () => {
    expect(nomeCurtoDaLoja("Pé-de-Moça Doces")).toBe("Pé-de-Moça");
  });

  it("nome inteiro que cabe em 12 não é mexido, mesmo com separador", () => {
    expect(nomeCurtoDaLoja("Moda - Sol")).toBe("Moda - Sol");
  });

  it("palavra única maior que 12 é cortada em 12, nunca passa disso", () => {
    expect(nomeCurtoDaLoja("Supercalifragilistico")).toBe("Supercalifra");
    expect(nomeCurtoDaLoja("Supercalifragilistico Loja")).toBe("Supercalifra");
  });

  it("corta por caractere de verdade, sem partir emoji ao meio", () => {
    const emojis = "😀".repeat(14);
    expect(Array.from(nomeCurtoDaLoja(emojis))).toHaveLength(12);
    expect(nomeCurtoDaLoja(emojis)).toBe("😀".repeat(12));
  });

  it("espaço sobrando nas pontas e no meio é arrumado antes de medir", () => {
    expect(nomeCurtoDaLoja("  Savy   Collection  ")).toBe("Savy");
    expect(nomeCurtoDaLoja("   IKCOUS   ")).toBe("IKCOUS");
  });

  it("nome vazio continua vazio (quem chama decide o que fazer)", () => {
    expect(nomeCurtoDaLoja("")).toBe("");
    expect(nomeCurtoDaLoja("   ")).toBe("");
  });

  it("nunca passa de 12 caracteres, qualquer que seja o nome", () => {
    const nomes = [
      "Mercadinho Santa Terezinha do Menino Jesus",
      "A",
      "Loja X Y Z W V U T S R Q",
      "Doces & Salgados da Vovó Maria Aparecida",
      "Eletrônicos | Informática | Celulares",
    ];
    for (const nome of nomes) {
      const curto = nomeCurtoDaLoja(nome);
      expect(Array.from(curto).length).toBeLessThanOrEqual(12);
      expect(curto.length).toBeGreaterThan(0);
    }
  });
});

describe("o rótulo do ícone no iPhone acompanha o nome curto", () => {
  const html =
    '<head><title>x</title><meta name="apple-mobile-web-app-title" content="IKCOUS" />' +
    '<meta name="application-name" content="IKCOUS" /></head>';
  const identidade = (storeName: string) =>
    ({
      identity: {
        storeName,
        city: null,
        state: null,
        projectRef: "abcdefghijklmnopqrst",
        theme: { primary: "#111111", secondary: "#222222", accent: "#333333" },
        assets: {
          og: { media_type: "image/png" },
          favicon: { media_type: "image/png" },
        },
      },
      localUrls: {
        og: "/og.png",
        favicon: "/f.png",
        apple_touch: "/a.png",
        loader: "/l.png",
      },
      publicUrl: "https://loja.exemplo",
    }) as unknown as Parameters<typeof identityHtml>[1];

  it("apple-mobile-web-app-title leva o nome curto; application-name segue inteiro", () => {
    const saida = identityHtml(html, identidade("Savy Collection"));
    expect(saida).toContain(
      '<meta name="apple-mobile-web-app-title" content="Savy" />',
    );
    expect(saida).toContain(
      '<meta name="application-name" content="Savy Collection" />',
    );
  });
});
