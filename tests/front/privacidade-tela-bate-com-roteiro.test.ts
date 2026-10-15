// A tela da cliente promete uma lista do que a exclusão apaga e do que fica por
// lei. O roteiro que a loja executa (docs/runbooks/atender-pedido-de-privacidade.md)
// repete essa lista verbatim, e o SQL dele é ensaiado em
// tests/banco/anonimizar-conta-ensaio-viva.cjs. Se a tela mudar e o roteiro não,
// a tela passa a prometer o que a loja não faz: esta prova cai.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEXTOS_DA_CLIENTE } from "@/config/textos-de-privacidade";
import { describe, expect, it } from "vitest";

// Caminho montado só de literais do próprio teste (nada de entrada externa).
// eslint-disable-next-line security/detect-non-literal-fs-filename
const roteiro = readFileSync(
  join(process.cwd(), "docs", "runbooks", "atender-pedido-de-privacidade.md"),
  "utf8",
);

function entre(marca: string): string {
  const inicio = `<!-- tela:${marca} -->`;
  const fim = `<!-- /tela:${marca} -->`;
  const de = roteiro.indexOf(inicio);
  const ate = roteiro.indexOf(fim);
  expect(de, `o roteiro perdeu a marca ${inicio}`).toBeGreaterThanOrEqual(0);
  expect(ate).toBeGreaterThan(de);
  return roteiro.slice(de + inicio.length, ate).trim();
}

describe("a tela da cliente e o roteiro da loja dizem a mesma coisa", () => {
  it("a lista 'o que a exclusão apaga' é a mesma, item por item e na mesma ordem", () => {
    const doRoteiro = entre("apaga")
      .split("\n")
      .map((linha) => linha.replace(/^- /, "").trim());
    expect(doRoteiro).toEqual([...TEXTOS_DA_CLIENTE.apaga]);
  });

  it("o texto 'o que fica guardado por lei' é o mesmo", () => {
    expect(entre("fica")).toBe(TEXTOS_DA_CLIENTE.fica);
  });

  it("o roteiro traz os três blocos de SQL que o ensaio executa", () => {
    for (const nome of ["listar", "anonimizar", "sobras"]) {
      expect(roteiro).toContain(`\`\`\`sql\n-- BLOCO: ${nome}\n`);
    }
  });

  it("a correção de e-mail: a tela diz que a loja confirma com o e-mail novo, e o roteiro avisa o e-mail ATUAL e espera 3 dias antes de trocar ou anonimizar", () => {
    // A tela promete o que o roteiro faz: a loja escreve ao e-mail novo e só troca depois da resposta.
    expect(TEXTOS_DA_CLIENTE.confirmaEmailTexto).toContain(
      "escrever para esse e-mail novo",
    );
    expect(TEXTOS_DA_CLIENTE.confirmaEmailTexto).toContain(
      "só troca o e-mail de entrada da sua conta depois da sua resposta",
    );
    const semQuebra = roteiro.replace(/\s+/g, " ");
    // Celular emprestado: a sessão da cliente não prova que é ela. O roteiro manda avisar o e-mail de hoje...
    expect(semQuebra).toContain("Aviso ao e-mail ATUAL e espera de 3 dias");
    expect(semQuebra).toContain("Avise o e-mail que está hoje na conta");
    expect(semQuebra).toContain("não fui eu");
    // ...e esperar 3 dias corridos antes de trocar o e-mail E antes de anonimizar "valendo".
    expect(semQuebra).toContain("3 dias corridos");
    const correcao = roteiro
      .split("## Correção de e-mail")[1]
      .split("## O que NÃO fazer")[0]
      .replace(/\s+/g, " ");
    expect(correcao).toContain("Avise o e-mail ATUAL da conta");
    expect(correcao).toContain("3 dias corridos desde o aviso");
    const passo4 = roteiro
      .split("## Passo 4")[1]
      .split("## Passo 5")[0]
      .replace(/\s+/g, " ");
    expect(passo4).toContain("3 dias corridos");
    // A regra existente continua: sem resposta do e-mail novo em 7 dias, recusa.
    expect(correcao).toContain("não responder em 7 dias");
  });

  it("o roteiro nunca manda apagar o login nem os pedidos", () => {
    const blocoAnonimizar = roteiro
      .split("-- BLOCO: anonimizar")[1]
      .split("```")[0];
    expect(blocoAnonimizar).not.toMatch(/DELETE\s+FROM\s+auth\.users/i);
    expect(blocoAnonimizar).not.toMatch(
      /DELETE\s+FROM\s+public\.marketplace_orders/i,
    );
    expect(blocoAnonimizar).not.toMatch(/TRUNCATE/i);
    expect(blocoAnonimizar).not.toMatch(/DROP\s/i);
  });
});
