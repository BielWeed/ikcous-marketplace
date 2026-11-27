// @vitest-environment jsdom
// A chave de um lançamento que ficou "pode ter sido salvo" é de QUEM lançou.
// Antes ela ficava na aba sem dono: a funcionária saía, a dona entrava no mesmo
// aparelho e o próximo lançamento parecido da dona reaproveitava a chave da
// funcionária — o banco devolvia o registro antigo e o da dona não gravava.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chaveEmAbertoDoConteudo,
  esquecerChaveEmAberto,
  guardarChaveEmAberto,
} from "@/components/admin/financeiro/tentativasEmAberto";

const ARMAZEM = "fin-lancamento-tentativas-em-aberto";
const FUNCIONARIA = "8a1f0c2e-1111-4111-8111-000000000001";
const DONA = "8a1f0c2e-2222-4222-8222-000000000002";
const ALUGUEL = JSON.stringify({ descricao: "Aluguel", valor: 120 });

describe("chave em aberto amarrada a quem lançou", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("a chave da funcionária não é devolvida para a dona", () => {
    guardarChaveEmAberto(FUNCIONARIA, ALUGUEL, "chave-da-funcionaria");
    expect(chaveEmAbertoDoConteudo(DONA, ALUGUEL)).toBeNull();
    expect(chaveEmAbertoDoConteudo(FUNCIONARIA, ALUGUEL)).toBe(
      "chave-da-funcionaria",
    );
  });

  it("a dona guardar a dela não apaga nem troca a da funcionária", () => {
    guardarChaveEmAberto(FUNCIONARIA, ALUGUEL, "chave-da-funcionaria");
    guardarChaveEmAberto(DONA, ALUGUEL, "chave-da-dona");
    expect(chaveEmAbertoDoConteudo(DONA, ALUGUEL)).toBe("chave-da-dona");
    expect(chaveEmAbertoDoConteudo(FUNCIONARIA, ALUGUEL)).toBe(
      "chave-da-funcionaria",
    );
    esquecerChaveEmAberto(DONA, ALUGUEL);
    expect(chaveEmAbertoDoConteudo(DONA, ALUGUEL)).toBeNull();
    expect(chaveEmAbertoDoConteudo(FUNCIONARIA, ALUGUEL)).toBe(
      "chave-da-funcionaria",
    );
  });

  it("sem usuário conhecido nada é guardado nem reaproveitado", () => {
    guardarChaveEmAberto(null, ALUGUEL, "chave-sem-dono");
    expect(sessionStorage.getItem(ARMAZEM)).toBeNull();
    expect(chaveEmAbertoDoConteudo(null, ALUGUEL)).toBeNull();
    expect(() => esquecerChaveEmAberto(null, ALUGUEL)).not.toThrow();
  });

  it("registro antigo, de antes do dono, não é reaproveitado por ninguém", () => {
    // Monta o formato antigo a partir do novo: endereço só com o resumo do
    // conteúdo e registro sem `dono`.
    guardarChaveEmAberto(DONA, ALUGUEL, "chave-antiga");
    const novo = JSON.parse(sessionStorage.getItem(ARMAZEM) ?? "{}");
    const [endereco] = Object.keys(novo);
    const resumo = endereco.slice(endereco.indexOf(":") + 1);
    sessionStorage.setItem(
      ARMAZEM,
      JSON.stringify({
        [resumo]: { chave: "chave-antiga", em: Date.now() },
        [endereco]: { chave: "chave-antiga", em: Date.now() },
      }),
    );
    expect(chaveEmAbertoDoConteudo(DONA, ALUGUEL)).toBeNull();
    expect(chaveEmAbertoDoConteudo(FUNCIONARIA, ALUGUEL)).toBeNull();
  });

  it("registro com dono trocado no armazenamento não vale para o outro", () => {
    guardarChaveEmAberto(DONA, ALUGUEL, "chave-da-dona");
    const novo: Record<string, object> = JSON.parse(
      sessionStorage.getItem(ARMAZEM) ?? "{}",
    );
    const [[endereco, registro]] = Object.entries(novo);
    sessionStorage.setItem(
      ARMAZEM,
      JSON.stringify({ [endereco]: { ...registro, dono: FUNCIONARIA } }),
    );
    expect(chaveEmAbertoDoConteudo(DONA, ALUGUEL)).toBeNull();
  });
});
