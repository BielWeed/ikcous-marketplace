// Duplicar produto, as duas bordas que o teste de uuid em maiúsculas não vê:
//  - o uuid de verdade nasce em MINÚSCULAS (crypto.randomUUID). Se o código da
//    cópia só reconhecesse maiúsculas, duplicar a cópia empilharia
//    "-COPIA-<uuid>" sobre "-COPIA-<uuid>" a cada rodada;
//  - um nome que cabe EXATAMENTE no teto do sufixo não é mexido (nem aparado).
import { nomeECodigoDaCopia } from "@/lib/copia-do-produto";
import { LIMITE_DO_NOME_DO_PRODUTO } from "@/lib/limites-do-produto";
import { describe, expect, it } from "vitest";

const UUID_MINUSCULO_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_MINUSCULO_B = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

describe("nomeECodigoDaCopia — uuid em minúsculas (o que o navegador gera)", () => {
  it("duplicar a cópia TROCA o final do código em vez de empilhar outro", () => {
    const primeira = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: "CAM-01",
      codigo: UUID_MINUSCULO_A,
    });
    expect(primeira.sku).toBe(`CAM-01-COPIA-${UUID_MINUSCULO_A}`);

    const segunda = nomeECodigoDaCopia({
      nome: primeira.nome,
      sku: primeira.sku,
      codigo: UUID_MINUSCULO_B,
    });
    expect(segunda.sku).toBe(`CAM-01-COPIA-${UUID_MINUSCULO_B}`);
    expect(segunda.sku.split("COPIA")).toHaveLength(2);
  });

  it("o código não cresce em cinco rodadas seguidas de duplicação", () => {
    let sku = "CAM-01";
    const tamanhoDaPrimeira = `CAM-01-COPIA-${UUID_MINUSCULO_A}`.length;
    for (let i = 0; i < 5; i++) {
      const uuid = `3f2504e0-4f89-41d3-9a0c-0305e82c33${String(10 + i)}`;
      sku = nomeECodigoDaCopia({ nome: "Camiseta", sku, codigo: uuid }).sku;
      expect(sku.length).toBe(tamanhoDaPrimeira);
    }
  });

  it("cadeia já empilhada por versão antiga, também em minúsculas, é desfeita por inteiro", () => {
    const empilhado = `CAM-01-COPIA-${UUID_MINUSCULO_A}-COPIA-${UUID_MINUSCULO_B}`;
    const { sku } = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: empilhado,
      codigo: "11111111-2222-4333-8444-555555555555",
    });
    expect(sku).toBe("CAM-01-COPIA-11111111-2222-4333-8444-555555555555");
  });
});

describe("nomeECodigoDaCopia — nome no limite exato", () => {
  const rotulo = UUID_MINUSCULO_A.replaceAll("-", "").slice(0, 12);
  const sufixo = ` (Cópia ${rotulo})`;

  it("nome que cabe EXATAMENTE junto do sufixo não é cortado nem aparado", () => {
    const vagas = LIMITE_DO_NOME_DO_PRODUTO - sufixo.length;
    // Termina em espaço: se o corte rodasse mesmo sem precisar, o espaço sumiria.
    const original = `${"N".repeat(vagas - 1)} `;
    expect(original).toHaveLength(vagas);

    const { nome } = nomeECodigoDaCopia({
      nome: original,
      sku: "",
      codigo: UUID_MINUSCULO_A,
    });
    expect(nome).toBe(`${original}${sufixo}`);
    expect(nome).toHaveLength(LIMITE_DO_NOME_DO_PRODUTO);
  });

  it("um caractere a mais que o limite do sufixo encolhe o ORIGINAL em um e o resultado cabe", () => {
    const vagas = LIMITE_DO_NOME_DO_PRODUTO - sufixo.length;
    const { nome } = nomeECodigoDaCopia({
      nome: "N".repeat(vagas + 1),
      sku: "",
      codigo: UUID_MINUSCULO_A,
    });
    expect(nome).toBe(`${"N".repeat(vagas)}${sufixo}`);
    expect(nome).toHaveLength(LIMITE_DO_NOME_DO_PRODUTO);
  });
});
