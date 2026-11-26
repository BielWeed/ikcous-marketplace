// `src/utils/um-grupo-de-variacao.ts`: o nome digitado vem com o separador de
// atributos (" / ") SOLTO na ponta ("Tamanho / ", " / Tamanho"). Sem aparar o
// espaço da ponta antes de contar os atributos, "Tamanho / " contaria DOIS
// atributos (o segundo vazio) e a correção do nome do único grupo do produto
// ("Cor" -> "Tamanho") deixaria de valer como renomear o grupo inteiro: cairia
// na trava de "um grupo só" e o lojista ficaria sem conseguir consertar o nome.
import { travaDeUmGrupoSo } from "@/utils/um-grupo-de-variacao";
import { describe, expect, it } from "vitest";

const v = (id: string, name: string): { id: string; name: string } => ({
  id,
  name,
});

describe("travaDeUmGrupoSo — separador solto na ponta do nome novo", () => {
  const unicoGrupo = [v("1", "Cor"), v("2", "Cor")];

  it("'Tamanho / ' (separador sobrando no fim) conta UM atributo e vale como renomear", () => {
    expect(travaDeUmGrupoSo(unicoGrupo, "1", "Tamanho / ")).toEqual({
      bloqueia: false,
      grupoEmUso: "Cor",
      renomeiaGrupoInteiro: true,
    });
  });

  it("' / Tamanho' (separador sobrando no começo) também conta UM atributo", () => {
    expect(travaDeUmGrupoSo(unicoGrupo, "1", " / Tamanho")).toEqual({
      bloqueia: false,
      grupoEmUso: "Cor",
      renomeiaGrupoInteiro: true,
    });
  });

  it("controle: um nome de DOIS atributos de verdade num grupo de um só não é renomear", () => {
    const veredito = travaDeUmGrupoSo(unicoGrupo, "1", "Cor / Tamanho");
    expect(veredito.renomeiaGrupoInteiro).toBe(false);
    expect(veredito.bloqueia).toBe(true);
  });
});
