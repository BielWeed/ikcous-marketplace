// Duplicar produto: o nome vira "<nome> (Cópia <rótulo>)" (+21 caracteres) e o
// código "<código>-COPIA-<uuid>" (+43). Sem cuidado, um nome de 190 caracteres
// passava do teto de 200 do campo (a cópia não abria/salvava como o formulário
// aceita), e duplicar a própria cópia empilhava "-COPIA-<uuid>" sobre
// "-COPIA-<uuid>", crescendo a cada rodada.
import { nomeECodigoDaCopia } from "@/lib/copia-do-produto";
import { LIMITE_DO_NOME_DO_PRODUTO } from "@/lib/limites-do-produto";
import { describe, expect, it } from "vitest";

const UUID_A = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
const UUID_B = "9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D";
const ROTULO_A = "3F2504E04F89";

describe("nomeECodigoDaCopia — nome", () => {
  it("nome curto: só ganha o sufixo, sem cortar nada", () => {
    const { nome } = nomeECodigoDaCopia({
      nome: "Camiseta Base",
      sku: "CAM-01",
      codigo: UUID_A,
    });
    expect(nome).toBe(`Camiseta Base (Cópia ${ROTULO_A})`);
  });

  it("nome de 190 caracteres: corta o ORIGINAL e o resultado cabe em 200 com o sufixo inteiro", () => {
    const original = "N".repeat(190);
    const { nome } = nomeECodigoDaCopia({
      nome: original,
      sku: "",
      codigo: UUID_A,
    });
    expect(nome.length).toBeLessThanOrEqual(LIMITE_DO_NOME_DO_PRODUTO);
    expect(nome.endsWith(` (Cópia ${ROTULO_A})`)).toBe(true);
    expect(nome.startsWith("N".repeat(150))).toBe(true);
  });

  it("nome já no teto de 200: continua cabendo e mantém o sufixo", () => {
    const { nome } = nomeECodigoDaCopia({
      nome: "N".repeat(LIMITE_DO_NOME_DO_PRODUTO),
      sku: "",
      codigo: UUID_A,
    });
    expect(nome).toHaveLength(LIMITE_DO_NOME_DO_PRODUTO);
    expect(nome.endsWith(` (Cópia ${ROTULO_A})`)).toBe(true);
  });

  it("nome antigo maior que o teto (produto legado) também termina dentro do teto", () => {
    const { nome } = nomeECodigoDaCopia({
      nome: "N".repeat(500),
      sku: "",
      codigo: UUID_A,
    });
    expect(nome.length).toBeLessThanOrEqual(LIMITE_DO_NOME_DO_PRODUTO);
    expect(nome.endsWith(` (Cópia ${ROTULO_A})`)).toBe(true);
  });

  it("o corte não deixa espaço pendurado antes do sufixo", () => {
    // 179 letras + espaço: o corte cai logo depois do espaço.
    const original = `${"N".repeat(178)} ${"X".repeat(40)}`;
    const { nome } = nomeECodigoDaCopia({
      nome: original,
      sku: "",
      codigo: UUID_A,
    });
    expect(nome).not.toMatch(/\s{2}/);
    expect(nome.length).toBeLessThanOrEqual(LIMITE_DO_NOME_DO_PRODUTO);
  });

  it("o corte não racha um emoji ao meio", () => {
    // Cada emoji ocupa 2 unidades; o corte cairia no meio de um deles.
    const original = "😀".repeat(100);
    const { nome } = nomeECodigoDaCopia({
      nome: original,
      sku: "",
      codigo: UUID_A,
    });
    expect(nome.length).toBeLessThanOrEqual(LIMITE_DO_NOME_DO_PRODUTO);
    // Sem metade de emoji: nenhuma unidade solta de par substituto.
    expect(nome).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });
});

describe("nomeECodigoDaCopia — código (SKU)", () => {
  it("origem com código: acrescenta -COPIA-<uuid>", () => {
    const { sku } = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: "CAM-01",
      codigo: UUID_A,
    });
    expect(sku).toBe(`CAM-01-COPIA-${UUID_A}`);
  });

  it("origem sem código: só COPIA-<uuid>, sem hífen na frente", () => {
    const { sku } = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: undefined,
      codigo: UUID_A,
    });
    expect(sku).toBe(`COPIA-${UUID_A}`);
  });

  it("duplicar uma cópia TROCA o sufixo -COPIA-<uuid> em vez de somar outro", () => {
    const { sku } = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: `CAM-01-COPIA-${UUID_A}`,
      codigo: UUID_B,
    });
    expect(sku).toBe(`CAM-01-COPIA-${UUID_B}`);
  });

  it("cópia de cópia de cópia nunca passa do tamanho da primeira cópia", () => {
    let sku: string | undefined = "CAM-01";
    const tamanhos: number[] = [];
    for (const codigo of [UUID_A, UUID_B, UUID_A, UUID_B, UUID_A]) {
      sku = nomeECodigoDaCopia({ nome: "x", sku, codigo }).sku;
      tamanhos.push(sku.length);
    }
    expect(new Set(tamanhos).size).toBe(1);
    expect(sku).toBe(`CAM-01-COPIA-${UUID_A}`);
  });

  it("código que só tinha o sufixo (origem sem código) volta a COPIA-<uuid> novo", () => {
    const { sku } = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: `COPIA-${UUID_A}`,
      codigo: UUID_B,
    });
    expect(sku).toBe(`COPIA-${UUID_B}`);
  });

  it("cadeia antiga já empilhada (-COPIA-A-COPIA-B) é desfeita por inteiro", () => {
    const { sku } = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: `CAM-01-COPIA-${UUID_A}-COPIA-${UUID_B}`,
      codigo: UUID_A,
    });
    expect(sku).toBe(`CAM-01-COPIA-${UUID_A}`);
  });

  it("código que apenas CONTÉM a palavra COPIA no meio não é mexido", () => {
    const { sku } = nomeECodigoDaCopia({
      nome: "Camiseta",
      sku: "COPIA-DE-SEGURANCA",
      codigo: UUID_A,
    });
    expect(sku).toBe(`COPIA-DE-SEGURANCA-COPIA-${UUID_A}`);
  });
});
