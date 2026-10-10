// Laudo caça-bugs 31/08 (menor E): a auto-seleção do frete pegava
// `options[0]` — a PRIMEIRA opção da resposta, não a mais barata. O
// comentário dizia "auto-select cheapest" e o código pegava a primeira:
// cliente podia nascer travado na opção cara (SEDEX primeiro da lista,
// PAC barato que ninguém viu). Aqui a regra é explícita: MENOR PREÇO;
// empate, MENOR PRAZO — e nenhum caso inventa opção que não veio.

import {
  opcaoMaisBarata,
  resolverEscolhaDoFrete,
} from "@/lib/auto-selecao-de-frete";
import { describe, expect, it } from "vitest";

type Opcao = { id: string; price: number; deliveryDays: number };

const opcao = (id: string, price: number, deliveryDays: number): Opcao => ({
  id,
  price,
  deliveryDays,
});

describe("opcaoMaisBarata — a auto-seleção honesta", () => {
  it("pega o MENOR preço, não o primeiro da lista", () => {
    const opcoes = [opcao("sedex", 54.88, 4), opcao("pac", 26.41, 8)];
    expect(opcaoMaisBarata(opcoes)?.id).toBe("pac");
  });

  it("lista em ordem qualquer: a regra não depende da ordem", () => {
    const opcoes = [opcao("b", 30, 5), opcao("cara", 90, 1), opcao("a", 10, 9)];
    expect(opcaoMaisBarata(opcoes)?.id).toBe("a");
  });

  it("empate de preço: ganha o MENOR prazo", () => {
    const opcoes = [opcao("lento", 20, 9), opcao("rapido", 20, 2)];
    expect(opcaoMaisBarata(opcoes)?.id).toBe("rapido");
  });

  it("lista vazia ou ausente: nada inventado", () => {
    expect(opcaoMaisBarata([])).toBeNull();
    expect(opcaoMaisBarata(null)).toBeNull();
    expect(opcaoMaisBarata(undefined)).toBeNull();
  });

  it("uma opção só: é ela", () => {
    expect(opcaoMaisBarata([opcao("unica", 15, 3)])?.id).toBe("unica");
  });
});

// Captura do dono (23/09/2026): PAC R$ 25,31 auto-selecionado sobrevivia à
// Loggi R$ 10,49 da cotação seguinte, porque QUALQUER seleção era
// preservada por id. Só a escolha da CLIENTE é preservada.
describe("resolverEscolhaDoFrete — quem escolheu decide o que sobrevive", () => {
  const pac = opcao("superfrete-1", 25.31, 8);
  const loggi = opcao("melhor-envio-31", 10.49, 3);
  const pacFresco = opcao("superfrete-1", 24.9, 8);

  it("escolha AUTOMÁTICA anterior ainda na lista: a mais barata da lista nova vence", () => {
    expect(resolverEscolhaDoFrete(pac, [pac, loggi], false)).toEqual({
      opcao: loggi,
      origem: "automatica",
    });
  });

  it("escolha da CLIENTE ainda na lista: preservada, com o objeto FRESCO", () => {
    const r = resolverEscolhaDoFrete(pac, [pacFresco, loggi], true);
    expect(r.opcao).toBe(pacFresco);
    expect(r.origem).toBe("cliente");
  });

  it("escolha da CLIENTE que sumiu: a mais barata, e a origem volta a ser automática", () => {
    expect(resolverEscolhaDoFrete(pac, [loggi], true)).toEqual({
      opcao: loggi,
      origem: "automatica",
    });
  });

  it("sem seleção: a mais barata, automática (a bandeira sozinha não inventa escolha)", () => {
    expect(resolverEscolhaDoFrete(null, [pac, loggi], true)).toEqual({
      opcao: loggi,
      origem: "automatica",
    });
  });

  it("lista vazia: nada, automática", () => {
    expect(resolverEscolhaDoFrete(pac, [], true)).toEqual({
      opcao: null,
      origem: "automatica",
    });
  });
});
