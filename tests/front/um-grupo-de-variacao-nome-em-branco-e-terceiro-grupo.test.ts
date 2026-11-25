// `src/utils/um-grupo-de-variacao.ts`: bordas que `um-grupo-de-variacao.test.ts`
// não segurava.
//
//  - variante legada com nome em branco não é um grupo (nem entra na lista de
//    grupos, nem faz o produto "ter grupo demais"), e a grafia do grupo sai sem
//    o espaço das pontas;
//  - nome em branco no formulário não é um segundo grupo: quem responde é a
//    validação de "nome obrigatório", não a trava de um grupo só;
//  - a mensagem usa "Cor e Tamanho" (os grupos em uso, ligados por " e ");
//  - ADICIONAR um grupo novo nunca vale como "renomear o grupo inteiro";
//  - produto legado que JÁ tem dois grupos não pode ganhar um TERCEIRO por
//    edição, nem se o nome novo parecer um renome (a regra é não piorar).
import {
  gruposDeVariacao,
  temGrupoDemais,
  travaDeUmGrupoSo,
} from "@/utils/um-grupo-de-variacao";
import { describe, expect, it } from "vitest";

const v = (id: string, name: string): { id: string; name: string } => ({
  id,
  name,
});

describe("gruposDeVariacao — nome em branco e grafia", () => {
  it("nome vazio ou só com espaço não é grupo", () => {
    expect(gruposDeVariacao([v("1", ""), v("2", "   ")])).toEqual([]);
    expect(gruposDeVariacao([v("1", "  "), v("2", "Cor")])).toEqual(["Cor"]);
  });

  it("a grafia devolvida não leva o espaço das pontas", () => {
    expect(gruposDeVariacao([v("1", "  Cor ")])).toEqual(["Cor"]);
  });

  it("variante de nome em branco não faz o produto ter grupo demais", () => {
    expect(temGrupoDemais([v("1", "Cor"), v("2", "")])).toBe(false);
  });
});

describe("travaDeUmGrupoSo — nome em branco no formulário", () => {
  it("nome em branco ao adicionar não conta como outro grupo", () => {
    const veredito = travaDeUmGrupoSo([v("1", "Cor")], null, "");
    expect(veredito.bloqueia).toBe(false);
  });

  it("nome só com espaço ao adicionar também não bloqueia", () => {
    expect(travaDeUmGrupoSo([v("1", "Cor")], null, "   ").bloqueia).toBe(false);
  });
});

describe("travaDeUmGrupoSo — mensagem e renomear", () => {
  it("os grupos em uso saem ligados por ' e '", () => {
    const veredito = travaDeUmGrupoSo(
      [v("1", "Cor"), v("2", "Tamanho")],
      null,
      "Cor",
    );
    expect(veredito.grupoEmUso).toBe("Cor e Tamanho");
  });

  it("adicionar um grupo novo bloqueia e NÃO é renomear o grupo inteiro", () => {
    expect(travaDeUmGrupoSo([v("1", "Cor")], null, "Tamanho")).toEqual({
      bloqueia: true,
      grupoEmUso: "Cor",
      renomeiaGrupoInteiro: false,
    });
  });

  it("editar o nome do único grupo vale como renomear o grupo inteiro (controle)", () => {
    expect(
      travaDeUmGrupoSo([v("1", "Tamnho"), v("2", "Tamnho")], "1", "Tamanho"),
    ).toEqual({
      bloqueia: false,
      grupoEmUso: "Tamnho",
      renomeiaGrupoInteiro: true,
    });
  });
});

describe("travaDeUmGrupoSo — produto legado com dois grupos", () => {
  const legado = [v("1", "Cor"), v("2", "Cor"), v("3", "Tamanho")];

  it("editar uma opção de Cor para um terceiro grupo é bloqueado", () => {
    const veredito = travaDeUmGrupoSo(legado, "1", "Estampa");
    expect(veredito.bloqueia).toBe(true);
    expect(veredito.renomeiaGrupoInteiro).toBe(false);
  });

  it("editar mantendo os dois grupos continua liberado (a regra é não piorar)", () => {
    expect(travaDeUmGrupoSo(legado, "1", "Cor").bloqueia).toBe(false);
    expect(travaDeUmGrupoSo(legado, "3", "Tamanho").bloqueia).toBe(false);
  });
});
