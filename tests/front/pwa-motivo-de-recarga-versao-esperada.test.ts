// @vitest-environment jsdom
// "Sistema Atualizado" só aparece se a versão que chegou serve à que a
// atualização esperava. Os testes existentes só variam o último número
// (patch); aqui o número do meio e o primeiro também decidem, e 1.5.10 é maior
// que 1.5.9 (em texto seria o contrário).
import {
  CHAVE_ORIGEM_DE_ATUALIZACAO,
  CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO,
  consumirOrigemDaAtualizacao,
  gravaOrigemDeAtualizacao,
  gravaVersaoEsperadaDaAtualizacao,
} from "@/lib/motivo-de-recarga";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

function trocouParaChegar(esperada: string, chegou: string): boolean {
  gravaOrigemDeAtualizacao("0.0.1-sha.origem");
  gravaVersaoEsperadaDaAtualizacao(esperada);
  return consumirOrigemDaAtualizacao(chegou).trocouDeBuild;
}

describe("consumirOrigemDaAtualizacao — a versão que chegou serve à esperada?", () => {
  it.each([
    // [esperada, chegou, serve]
    ["1.5.208", "1.5.208", true],
    ["1.5.208", "1.5.209", true],
    ["1.5.208", "1.5.207", false],
    ["1.5.208", "1.6.0", true],
    ["1.5.208", "1.4.999", false],
    ["1.5.208", "2.0.0", true],
    ["1.5.208", "0.9.999", false],
    ["1.5.9", "1.5.10", true],
    ["1.5.10", "1.5.9", false],
    ["1.9.0", "1.10.0", true],
    ["1.10.0", "1.9.0", false],
    ["1.5.208-sha.alvo", "1.5.208+build.outro", true],
  ])("esperada %s, chegou %s: prova de troca=%s", (esperada, chegou, serve) => {
    expect(trocouParaChegar(esperada, chegou)).toBe(serve);
  });

  it("chegou uma versão ilegível: nunca vira 'Pronto'", () => {
    expect(trocouParaChegar("1.5.208", "desconhecida")).toBe(false);
  });

  it("esperada ilegível ou ausente não contradiz: vale a troca de build", () => {
    expect(trocouParaChegar("lixo", "1.5.1")).toBe(true);
    gravaOrigemDeAtualizacao("0.0.1-sha.origem");
    expect(consumirOrigemDaAtualizacao("1.5.1").trocouDeBuild).toBe(true);
  });

  it("a mesma versão da origem nunca prova troca, mesmo com a esperada satisfeita", () => {
    gravaOrigemDeAtualizacao("1.5.208-sha.mesmo");
    gravaVersaoEsperadaDaAtualizacao("1.5.100");
    expect(consumirOrigemDaAtualizacao("1.5.208-sha.mesmo").trocouDeBuild).toBe(
      false,
    );
  });

  it("consumir apaga a evidência: a segunda leitura não prova nada", () => {
    gravaOrigemDeAtualizacao("0.0.1-sha.origem");
    gravaVersaoEsperadaDaAtualizacao("1.5.1");
    expect(consumirOrigemDaAtualizacao("1.5.1").trocouDeBuild).toBe(true);
    expect(sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBeNull();
    expect(
      sessionStorage.getItem(CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO),
    ).toBeNull();
    expect(consumirOrigemDaAtualizacao("1.5.1")).toEqual({
      trocouDeBuild: false,
      de: null,
      versaoEsperada: null,
    });
  });

  it("devolve de onde partiu e o que esperava, com o sufixo original", () => {
    gravaOrigemDeAtualizacao("1.5.100-sha.velho");
    gravaVersaoEsperadaDaAtualizacao("1.5.200-sha.alvo");
    expect(consumirOrigemDaAtualizacao("1.5.200-sha.novo")).toEqual({
      trocouDeBuild: true,
      de: "1.5.100-sha.velho",
      versaoEsperada: "1.5.200-sha.alvo",
    });
  });
});
