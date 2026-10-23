// Nome composto de cor (23/10/2026): "Xadrez Preto, Cinza e Branco" cita três
// cores e a amostra da opção precisa mostrá-las, em vez de derrubar a fileira
// inteira para texto. O dicionário continua fixo; muda só a busca dentro do nome.
import { corDaVariacao, coresDoNome } from "@/utils/cor-da-variacao";
import { describe, expect, it } from "vitest";

const preto = corDaVariacao("Preto")!;
const cinza = corDaVariacao("Cinza")!;
const branco = corDaVariacao("Branco")!;

describe("coresDoNome: cores citadas num nome composto", () => {
  it("nome composto devolve as cores na ordem em que aparecem", () => {
    expect(coresDoNome("Xadrez Preto, Cinza e Branco")).toEqual([
      preto,
      cinza,
      branco,
    ]);
  });

  it("chave de várias palavras vence as de uma palavra (azul marinho não vira azul)", () => {
    expect(coresDoNome("Azul Marinho Listrado")).toEqual([
      corDaVariacao("Azul Marinho"),
    ]);
    expect(coresDoNome("Azul Marinho Listrado")).not.toContain(
      corDaVariacao("Azul"),
    );
  });

  it("nome sem nenhuma cor conhecida não devolve nada", () => {
    expect(coresDoNome("Estampado")).toEqual([]);
  });

  it("nome inteiro do dicionário devolve uma cor só", () => {
    expect(coresDoNome("Preto")).toEqual([preto]);
    expect(coresDoNome("Off White")).toEqual([corDaVariacao("off white")]);
    expect(coresDoNome("Verde Militar")).toEqual([
      corDaVariacao("verde militar"),
    ]);
  });

  it("só casa palavra inteira: Pretexto não vira preto", () => {
    expect(coresDoNome("Pretexto")).toEqual([]);
    expect(coresDoNome("Azulejo Cinzento")).toEqual([]);
    expect(coresDoNome("Roxinho")).toEqual([]);
  });

  it("ignora acento, caixa e espaço sobrando", () => {
    expect(coresDoNome("  CAFÉ  ")).toEqual([corDaVariacao("cafe")]);
    expect(coresDoNome("Cinza   Chumbo")).toEqual([
      cinza,
      corDaVariacao("chumbo"),
    ]);
    expect(coresDoNome("Listrado Preto/Branco")).toEqual([preto, branco]);
    expect(coresDoNome("Off-White")).toEqual([corDaVariacao("off white")]);
  });

  it("não repete a mesma cor (preto e preta, branco e branca)", () => {
    expect(coresDoNome("Preto e Preta")).toEqual([preto]);
    expect(coresDoNome("Branco, Branca e Preto")).toEqual([branco, preto]);
  });

  it("vazio, só espaço e só pontuação não devolvem nada", () => {
    expect(coresDoNome("")).toEqual([]);
    expect(coresDoNome("   ")).toEqual([]);
    expect(coresDoNome(" , / - ")).toEqual([]);
  });

  it("corDaVariacao segue igual: nome inteiro ou hex válido, senão nulo", () => {
    expect(corDaVariacao("Preto")).toBe(preto);
    expect(corDaVariacao("Xadrez Preto, Cinza e Branco")).toBeNull();
    expect(corDaVariacao("Estampado", "#ff0000")).toBe("#ff0000");
    expect(corDaVariacao("Estampado", "vermelho")).toBeNull();
  });
});
