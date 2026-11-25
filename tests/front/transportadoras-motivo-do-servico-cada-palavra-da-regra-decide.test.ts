// Caça por mutação (25/11/2026), "serviço que não cotou" nas transportadoras.
// A lojista só lê o motivo do provedor se ele for uma frase em português sem
// cara de erro técnico; senão aparece a frase fixa. Os testes que já existiam
// cobriam alguns exemplos, mas tirar uma palavra da lista de "cara técnica" ou
// de "cara de português" não fazia nenhum teste reclamar. Aqui cada palavra e
// cada sinal da regra tem o seu caso:
//   - qualquer um dos sinais técnicos, mesmo ao lado de uma frase em português,
//     manda para a frase fixa (a mensagem do provedor nunca vaza para a tela);
//   - qualquer uma das palavras comuns do português, sozinha, basta para o
//     motivo aparecer.
import { describe, expect, it } from "vitest";

import {
  FRASE_SERVICO_NAO_COTOU,
  textoDoServicoQueNaoCotou,
} from "@/components/admin/settings/transportadoras-conteudo";

describe("textoDoServicoQueNaoCotou: sinais de texto técnico", () => {
  it.each([
    ["chave abrindo", "não coube { aqui"],
    ["chave fechando", "não coube } aqui"],
    ["colchete abrindo", "não coube [ aqui"],
    ["colchete fechando", "não coube ] aqui"],
    ["menor que", "não coube < aqui"],
    ["maior que", "não coube > aqui"],
    ["endereço http", "não coube http://servidor aqui"],
    ["endereço https", "não coube https://servidor aqui"],
    ["código de três dígitos", "não coube 503 aqui"],
    ["palavra status", "não coube status aqui"],
    ["palavra error", "não coube error aqui"],
    ["palavra exception", "não coube exception aqui"],
    ["palavra unavailable", "não coube unavailable aqui"],
    ["palavra timeout", "não coube timeout aqui"],
    ["expressão timed out", "não coube timed out aqui"],
    ["palavra invalid", "não coube invalid aqui"],
    ["palavra failed", "não coube failed aqui"],
    ["palavra failure", "não coube failure aqui"],
    ["expressão not found", "não coube not found aqui"],
    ["palavra forbidden", "não coube forbidden aqui"],
    ["palavra unauthorized", "não coube unauthorized aqui"],
    ["palavra gateway", "não coube gateway aqui"],
    ["palavra internal", "não coube internal aqui"],
    ["palavra server", "não coube server aqui"],
    ["palavra undefined", "não coube undefined aqui"],
    ["palavra null", "não coube null aqui"],
    ["expressão bad request", "não coube bad request aqui"],
    ["maiúsculas também valem", "não coube TIMEOUT aqui"],
  ])("%s => frase fixa", (_nome, detalhe) => {
    expect(textoDoServicoQueNaoCotou(detalhe)).toBe(FRASE_SERVICO_NAO_COTOU);
  });

  it("número de quatro dígitos ou colado em letras não é código de três dígitos", () => {
    expect(textoDoServicoQueNaoCotou("não coube 5030 aqui")).toBe(
      "não cotou (não coube 5030 aqui)",
    );
    expect(textoDoServicoQueNaoCotou("não coube a503 aqui")).toBe(
      "não cotou (não coube a503 aqui)",
    );
  });
});

describe("textoDoServicoQueNaoCotou: sinais de português", () => {
  it.each([
    "não",
    "nao",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "para",
    "com",
    "sem",
    "em",
    "no",
    "na",
    "por",
    "uma",
    "ou",
    "que",
    "fora",
    "acima",
    "abaixo",
  ])("a palavra '%s' sozinha basta para mostrar o motivo", (palavra) => {
    const detalhe = `peso ${palavra} peso`;
    expect(textoDoServicoQueNaoCotou(detalhe)).toBe(`não cotou (${detalhe})`);
  });

  it.each(["á", "à", "â", "ã", "é", "ê", "í", "ó", "ô", "õ", "ú", "ç"])(
    "a letra acentuada '%s' sozinha basta para mostrar o motivo",
    (letra) => {
      const detalhe = `xx${letra}xx`;
      expect(textoDoServicoQueNaoCotou(detalhe)).toBe(`não cotou (${detalhe})`);
    },
  );

  it("palavra que só contém o sinal dentro de outra (sem borda) não conta", () => {
    // "pedido" tem "de", "cotado" tem "do", "bem" tem "em": nenhuma é palavra inteira.
    expect(textoDoServicoQueNaoCotou("pedido cotado bem")).toBe(
      FRASE_SERVICO_NAO_COTOU,
    );
  });

  it("texto sem cara de português nem de erro vai para a frase fixa", () => {
    expect(textoDoServicoQueNaoCotou("xyz abc")).toBe(FRASE_SERVICO_NAO_COTOU);
  });
});

describe("textoDoServicoQueNaoCotou: sem detalhe", () => {
  it("indefinido vira 'erro do serviço'; texto vazio é detalhe sem português e vai para a frase fixa", () => {
    expect(textoDoServicoQueNaoCotou(undefined)).toBe(
      "não cotou (erro do serviço)",
    );
    expect(textoDoServicoQueNaoCotou("")).toBe(FRASE_SERVICO_NAO_COTOU);
  });
});
