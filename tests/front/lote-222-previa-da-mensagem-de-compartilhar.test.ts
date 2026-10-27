// @vitest-environment jsdom
// Lote 222 (C4): a prévia só troca [nome], [preco] e [link] — o que a vitrine
// troca de fato. Apelidos como {nome} saem crus nos dois lados.
import { textoDaPrevia } from "@/components/admin/minha-loja/modelos-de-mensagem";
import { describe, expect, it } from "vitest";

const exemplo = { name: "Camisa", price: 49.9, id: "7" };

describe("lote 222 — prévia da mensagem de compartilhar", () => {
  it("{nome} não é trocado (a vitrine não troca)", () => {
    expect(textoDaPrevia("Olha {nome}", exemplo)).toBe("Olha {nome}");
  });
  it("apelidos longos também ficam crus", () => {
    const t = "[nome_produto] {preco_produto} {link_produto} {link}";
    expect(textoDaPrevia(t, exemplo)).toBe(t);
  });
  it("[nome] e [preco] são trocados, sem diferença de maiúscula", () => {
    const r = textoDaPrevia("[NOME] por [preco]", exemplo);
    expect(r).toMatch(/^Camisa por R\$\s49,90$/);
  });
  it("[link] vira o endereço do produto", () => {
    expect(textoDaPrevia("[link]", exemplo)).toContain("/produtos?id=7");
  });
});
