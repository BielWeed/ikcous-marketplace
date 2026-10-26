// A paleta que o lojista TOCA no painel (em vez de digitar o nome da cor) sai do
// MESMO dicionário que a loja usa para desenhar a bolinha. Se as duas listas
// divergissem, a cor escolhida no painel apareceria sem amostra na loja.
import { PALETA_DE_CORES, corDaVariacao } from "@/utils/cor-da-variacao";
import { describe, expect, it } from "vitest";

describe("PALETA_DE_CORES", () => {
  it("tem as 18 cores combinadas, na ordem da grade do painel", () => {
    expect(PALETA_DE_CORES.map((cor) => cor.nome)).toEqual([
      "Preto",
      "Branco",
      "Cinza",
      "Azul",
      "Azul marinho",
      "Verde",
      "Vermelho",
      "Vinho",
      "Rosa",
      "Nude",
      "Bege",
      "Marrom",
      "Amarelo",
      "Laranja",
      "Roxo",
      "Lilás",
      "Dourado",
      "Prata",
    ]);
  });

  it("cada item tem o mesmo hex que a loja usa para desenhar a bolinha daquele nome", () => {
    for (const cor of PALETA_DE_CORES) {
      expect(corDaVariacao(cor.nome), cor.nome).toBe(cor.hex);
      expect(cor.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("o acento não quebra: Lilás cai em 'lilas' do dicionário", () => {
    const lilas = PALETA_DE_CORES.find((cor) => cor.nome === "Lilás");
    expect(lilas?.hex).toBe(corDaVariacao("lilas"));
    expect(lilas?.hex).toBe(corDaVariacao("LILÁS"));
  });

  it("nenhum nome se repete (nem ignorando maiúscula e acento)", () => {
    const chaves = PALETA_DE_CORES.map((cor) =>
      cor.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
    );
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
