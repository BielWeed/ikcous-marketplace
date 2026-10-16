import notasDasVersoes from "@/novidades/notas-das-versoes.json";
import { describe, expect, it } from "vitest";

const proibidas = [
  "PR",
  "migration",
  "deploy",
  "cache",
  "service worker",
  "SHA",
  "commit",
  "API",
  "banco de dados",
  "RPC",
  "build",
  "calculado por edge",
];

// As bordas Unicode evitam aceitar jargão colado em acentos e não confundem
// palavras comuns, como "própria", com a sigla "PR".
// Literal (sem `new RegExp`): a lista abaixo espelha `proibidas`, e o segundo
// teste prova que cada palavra de `proibidas` é pega por ela.
const jargao =
  /(?:^|[^\p{L}\p{N}_])(?:PR|migration|deploy|cache|service worker|SHA|commit|API|banco de dados|RPC|build|calculado por edge)(?=$|[^\p{L}\p{N}_])/iu;

function validarTexto(valor: unknown): void {
  expect(typeof valor).toBe("string");
  if (typeof valor !== "string") return;
  expect(valor.trim().length).toBeGreaterThan(0);
  expect(valor).not.toMatch(jargao);
}

describe("texto das notas publicadas", () => {
  it("tem título e listas com texto simples, sem termos técnicos", () => {
    const catalogo: unknown = notasDasVersoes;
    expect(catalogo).toBeTypeOf("object");
    expect(catalogo).not.toBeNull();
    if (!catalogo || typeof catalogo !== "object") return;
    expect(Object.keys(catalogo).length).toBeGreaterThan(0);
    for (const nota of Object.values(catalogo)) {
      expect(nota).toBeTypeOf("object");
      expect(nota).not.toBeNull();
      if (!nota || typeof nota !== "object") continue;
      const campos = nota as Record<string, unknown>;
      validarTexto(campos.titulo);
      for (const lista of [
        campos.novidades,
        campos.correcoes,
        campos.melhorias,
      ]) {
        expect(Array.isArray(lista)).toBe(true);
        if (Array.isArray(lista)) {
          for (const texto of lista) validarTexto(texto);
        }
      }
    }
  });

  it("o guarda distingue palavras inteiras e ignora maiúsculas", () => {
    for (const palavra of proibidas) {
      expect(`Texto com ${palavra.toUpperCase()}.`).toMatch(jargao);
    }
    expect("Entrega própria e pedidos seguros.").not.toMatch(jargao);
  });
});
