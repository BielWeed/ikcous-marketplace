// @vitest-environment jsdom
// Achado 6 (autônomo r3): a prévia de Minha loja > Contato tem de mostrar a
// MESMA mensagem que a vitrine manda. Antes, texto sem marcador aparecia só
// como a frase (a vitrine cola nome e preço), texto vazio mostrava "Confira os
// produtos!" (a vitrine manda nome e preço) e o link era /produtos?id=, rota
// que não existe (o link real é /product-detail?id=).
import {
  montarMensagemDeCompartilhar,
  textoDaPrevia,
} from "@/components/admin/minha-loja/modelos-de-mensagem";
import { describe, expect, it } from "vitest";

const exemplo = { name: "Camisa", price: 49.9, id: "7" };
const LINK = `${window.location.origin}/product-detail?id=7`;

describe("prévia do compartilhar — igual ao que a vitrine manda", () => {
  it("texto sem marcador: frase + nome + preço, e o link por último", () => {
    const r = textoDaPrevia("Olha que achei na Loja!", exemplo);
    expect(r).toMatch(/^Olha que achei na Loja! Camisa por R\$\s49,90 - /);
    expect(r.endsWith(LINK)).toBe(true);
  });

  it("texto vazio: nome, preço e link (nada de 'Confira os produtos!')", () => {
    const r = textoDaPrevia("", exemplo);
    expect(r).not.toContain("Confira os produtos!");
    expect(r).toMatch(/^Camisa por R\$\s49,90 - /);
    expect(r.endsWith(LINK)).toBe(true);
  });

  it("[link] aponta para /product-detail?id= (rota real) e não repete o link", () => {
    const r = textoDaPrevia("Veja: [link]", exemplo);
    expect(r).toBe(`Veja: ${LINK}`);
    expect(r).not.toContain("/produtos?id=");
  });

  it("marcador sem [link]: a mensagem da lojista e o link ao fim", () => {
    const r = textoDaPrevia("[nome] por [preco]. Acesse!", exemplo);
    expect(r).toMatch(/^Camisa por R\$\s49,90\. Acesse! - /);
    expect(r.endsWith(LINK)).toBe(true);
  });
});

describe("montarMensagemDeCompartilhar — a função única (prévia e vitrine)", () => {
  const dados = { nome: "Camisa", preco: "R$ 49,90", link: "https://x.com/p" };

  it("sem marcador: cola nome e preço na frente e avisa que não há [link]", () => {
    expect(montarMensagemDeCompartilhar("Olha!", dados)).toEqual({
      texto: "Olha! Camisa por R$ 49,90",
      temLink: false,
      completa: "Olha! Camisa por R$ 49,90 - https://x.com/p",
    });
  });

  it("com [link]: o link já está no texto e não é repetido", () => {
    expect(montarMensagemDeCompartilhar("[nome] [link]", dados)).toEqual({
      texto: "Camisa https://x.com/p",
      temLink: true,
      completa: "Camisa https://x.com/p",
    });
  });

  it("'$&' no nome não vira padrão de substituição", () => {
    const r = montarMensagemDeCompartilhar("[nome]", {
      ...dados,
      nome: "A$&B",
    });
    expect(r.texto).toBe("A$&B");
  });
});
