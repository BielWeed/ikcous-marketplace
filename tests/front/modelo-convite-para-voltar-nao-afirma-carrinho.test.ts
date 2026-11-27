// O modelo pronto "Lembrete de Carrinho" dizia "Seu carrinho de compras está
// te esperando!" e abria /cart — mas a tela "Avisar clientes" o envia para
// públicos que não conferem carrinho (Todos, Inativos, Gastaram R$ 150+,
// Novos, um cliente da ficha). Quem já comprou e está de carrinho vazio lia
// que tinha carrinho e caía num carrinho vazio. O modelo agora é um convite
// neutro que não afirma carrinho e abre a vitrine.
import { MODELOS_DE_CAMPANHA } from "@/lib/modelos-de-campanha";
import { describe, expect, it } from "vitest";

const convite = MODELOS_DE_CAMPANHA.auth;
const texto = `${convite.mensagem.title} ${convite.mensagem.body}`;

describe("modelo 'Convite para voltar'", () => {
  it("não afirma que a pessoa tem carrinho nem manda finalizar compra", () => {
    expect(texto).not.toMatch(/carrinho/i);
    expect(texto).not.toMatch(/finaliz/i);
  });

  it("abre a vitrine (página inicial), não o carrinho", () => {
    expect(convite.mensagem.url).toBe("/");
  });

  it("o nome na pílula também não promete carrinho", () => {
    expect(convite.title).not.toMatch(/carrinho/i);
    expect(convite.desc).not.toMatch(/carrinho|finalizar/i);
  });
});
