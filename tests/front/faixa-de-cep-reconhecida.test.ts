import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { faixaDeCepReconhecida } from "@/lib/faixa-de-cep";
import {
  ScriptTarget,
  createSourceFile,
  isFunctionDeclaration,
  transpileModule,
} from "typescript";
import { describe, expect, it } from "vitest";

function carregarCotacao() {
  const caminho = new URL(
    "../../supabase/functions/calculate-shipping/index.ts",
    import.meta.url,
  );
  const fonte = createSourceFile(
    caminho.pathname,
    readFileSync(caminho, "utf8"),
    ScriptTarget.Latest,
  );
  const parser = fonte.statements.find(
    (no) => isFunctionDeclaration(no) && no.name?.text === "isLocalCep",
  );
  if (!parser || !isFunctionDeclaration(parser) || !parser.body) {
    throw new Error("isLocalCep não encontrado na função de cotação");
  }

  // Compila somente a função pura do repositório. Sem importar o módulo Deno,
  // sem require, sem servidor e sem interpolar entradas de teste.
  const js = transpileModule(parser.getText(fonte).replace(/^export\s+/, ""), {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(`${js}\nisLocalCep`) as (
    origem: string,
    destino: string,
    faixa: string,
  ) => boolean;
}

const isLocalCep = carregarCotacao();

function destinosCandidatos(faixa: string) {
  // A existência de um destino é decidida por uma ponta de intervalo ou pela
  // extensão de um prefixo. Em vez de copiar as decisões do parser, sondamos
  // um superconjunto: todo trecho contíguo dos dígitos de cada item, incluindo
  // o item inteiro e seus blocos. O parser real decide se o destino casa.
  const destinos = new Set(["00000000", "99999999"]);
  for (const item of faixa.split(",")) {
    const digitos = item.replace(/\D/g, "");
    for (let inicio = 0; inicio < digitos.length; inicio++) {
      for (let fim = inicio + 1; fim <= digitos.length; fim++) {
        const trecho = digitos.slice(inicio, fim);
        for (const preenchimento of ["0", "9"]) {
          const numero = Number(trecho.padEnd(8, preenchimento));
          if (numero <= 99_999_999) {
            destinos.add(String(numero).padStart(8, "0"));
          }
        }
      }
    }
  }
  return destinos;
}

describe("faixa de CEP reconhecível pela cotação para algum CEP de oito dígitos", () => {
  it.each([
    "38500-000",
    "38.500-000",
    "38500000",
    "385",
    "38500-000,38599-999",
    "38500-000, 38599-999",
    "38500-000/38599-999",
    "38500-000 a 38599-999",
    "38500-000 até 38599-999",
    "de 38500000 até 38599999",
    "38500000 a 38599999",
    "38500-000;38599-999",
    "38500-000\n38599-999",
    "38500-000,\n38599-999",
    "385;00",
    "38500000-38599999",
    "38599999-38500000",
    "385999-385000",
    "3850000",
    "3850000-3859999",
    "100000000-38500000",
    "100000000-100000001",
    "000000001-000000002",
    "00000000-99999999",
    "00000-000",
    "99999-999",
    "38500-000,38500-000",
    "38500-000,38599-999,01310-000",
    "38500000-38599999,01310-000",
    "999999999-999999999,385",
    "38500-000 a 38599-999, 01310",
    "lixo, 38500-000",
    "CEP 38500-000",
    "centro",
    "",
    "   ",
    "\t\n\r",
    ",,,",
    "---",
    "/;",
    "  38500 - 000  ",
    "38500--000",
    "38500-000-1",
    "３８５００-０００",
    "٣٨٥٠٠-٠٠٠",
    "38500–000",
    "38500​-000",
    " 38500-000　",
    "38500000，38599999",
  ])("painel e cotação concordam para %j", (faixa) => {
    const cotacaoReconhece = [...destinosCandidatos(faixa)].some((destino) => {
      // Uma origem de outra região impede que o fallback de faixa vazia
      // (isLocalCep, linha 600) seja confundido com uma faixa reconhecida.
      const origem = destino.startsWith("00000") ? "99999999" : "00000000";
      return isLocalCep(origem, destino, faixa);
    });
    expect(faixaDeCepReconhecida(faixa)).toBe(cotacaoReconhece);
  });
});
