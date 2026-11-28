import {
  type VariacaoComparavel,
  variacoesAposConflito,
} from "@/utils/campos-mexidos-do-produto";
import { describe, expect, it } from "vitest";

type Variacao = VariacaoComparavel & { stock?: number };
const variante = (extra: Partial<Variacao> = {}): Variacao => ({
  id: "v-1",
  name: "Cor",
  value: "Rosa",
  sku: "ROSA",
  codigoBarras: "ANTIGO",
  stockIncrement: 10,
  priceOverride: 100,
  active: true,
  imageUrl: "foto-antiga",
  ...extra,
});

describe("variacoesAposConflito", () => {
  it.each([
    { name: "Tonalidade" },
    { value: "Azul" },
    { sku: "OUTRO" },
    { codigoBarras: "DO-BANCO" },
    { priceOverride: 120 },
    { active: false },
    { imageUrl: "foto-nova" },
  ])("campo não editado recebe o banco: %j", (mudanca) => {
    const abertura = variante();
    const banco = variante(mudanca);
    const tela = variante();
    expect(variacoesAposConflito([tela], [abertura], [banco])).toEqual([banco]);
    expect(tela).toEqual(abertura);
  });

  it.each([
    [{ name: "Tipo" }, { name: "Tonalidade" }],
    [{ value: "Verde" }, { value: "Azul" }],
    [{ sku: "" }, { sku: "OUTRO" }],
    [{ codigoBarras: "" }, { codigoBarras: "DO-BANCO" }],
    [{ priceOverride: 0 }, { priceOverride: 120 }],
    [{ priceOverride: undefined }, { priceOverride: 120 }],
    [{ active: false }, { active: true }],
    [{ imageUrl: undefined }, { imageUrl: "foto-nova" }],
  ])("campo editado fica com a tela: %j", (local, externo) => {
    const tela = variante(local);
    expect(
      variacoesAposConflito([tela], [variante()], [variante(externo)]),
    ).toEqual([tela]);
  });

  it("código local não devolve preço antigo, e estoque sempre vem do banco", () => {
    const abertura = Object.freeze(variante({ stock: 10 }));
    const tela = Object.freeze(
      variante({ codigoBarras: "LOCAL", stockIncrement: 8, stock: 8 }),
    );
    const banco = Object.freeze(
      variante({ priceOverride: 120, stockIncrement: 9, stock: 9 }),
    );
    expect(variacoesAposConflito([tela], [abertura], [banco])).toEqual([
      variante({
        codigoBarras: "LOCAL",
        priceOverride: 120,
        stockIncrement: 9,
        stock: 9,
      }),
    ]);
  });

  it("preço local vence, mas recebe código que só outro aparelho editou", () => {
    expect(
      variacoesAposConflito(
        [variante({ priceOverride: 110 })],
        [variante()],
        [variante({ codigoBarras: "DO-BANCO", priceOverride: 120 })],
      ),
    ).toEqual([variante({ codigoBarras: "DO-BANCO", priceOverride: 110 })]);
  });

  it("opcionais vazios equivalentes não parecem edição local", () => {
    expect(
      variacoesAposConflito(
        [
          variante({
            sku: "",
            codigoBarras: "",
            imageUrl: "",
            priceOverride: undefined,
          }),
        ],
        [
          variante({
            sku: null,
            codigoBarras: undefined,
            imageUrl: null,
            priceOverride: null,
          }),
        ],
        [variante()],
      ),
    ).toEqual([variante()]);
  });

  it("estoque auxiliar ausente no banco não mantém o número antigo da tela", () => {
    expect(
      variacoesAposConflito(
        [variante({ stock: 7 })],
        [variante({ stock: 10 })],
        [variante({ stockIncrement: 9 })],
      ),
    ).toEqual([variante({ stockIncrement: 9 })]);
  });

  it("variação apagada no banco e não editada sai, mesmo com estoque local diferente", () => {
    expect(
      variacoesAposConflito(
        [variante({ stockIncrement: 8 })],
        [variante()],
        [],
      ),
    ).toEqual([]);
  });

  it("variação apagada no banco sai mesmo se a lojista a editou aqui", () => {
    // Mantê-la somaria o estoque velho dela ao do produto no segundo salvar
    // (estoque fantasma). O rascunho também a tira.
    const tela = variante({ codigoBarras: "LOCAL", stockIncrement: 5 });
    expect(variacoesAposConflito([tela], [variante()], [])).toEqual([]);
  });

  it("nova local permanece e nova do banco entra uma só vez", () => {
    const novaLocal = variante({
      id: "temp-nova",
      value: "Verde",
      stockIncrement: 3,
    });
    const novaDoBanco = variante({
      id: "v-2",
      value: "Azul",
      stockIncrement: 4,
    });
    expect(
      variacoesAposConflito(
        [variante(), novaLocal],
        [variante()],
        [variante(), novaDoBanco],
      ),
    ).toEqual([variante(), novaLocal, novaDoBanco]);
  });

  it("variação excluída localmente não volta do banco", () => {
    expect(variacoesAposConflito([], [variante()], [variante()])).toEqual([]);
  });
  describe("troca de valor que já foi gravada (a resposta do salvar se perdeu)", () => {
    // Tela: o "M" (vendido) virou "GG". O primeiro salvar gravou, mas a
    // resposta não voltou; o segundo foi recusado pela versão. No banco a
    // antiga continua "M" e desligada, e o "GG" novo já existe.
    const abertura = variante({ id: "v-m", value: "M", sku: "CAM-M" });
    const tela = variante({ id: "v-m", value: "GG", sku: "CAM-M" });
    const antigaGuardada = variante({
      id: "v-m",
      value: "M",
      sku: null,
      codigoBarras: null,
      active: false,
    });
    const novaDoBanco = variante({ id: "v-gg", value: "GG", sku: "CAM-M" });

    it("a antiga fica como o banco a guardou (M desligada) e o GG do banco entra uma vez só", () => {
      expect(
        variacoesAposConflito(
          [tela],
          [abertura],
          [antigaGuardada, novaDoBanco],
        ),
      ).toEqual([antigaGuardada, novaDoBanco]);
    });

    it("reconhece mesmo com outra grafia no banco (gg, espaços)", () => {
      const novaComOutraGrafia = { ...novaDoBanco, value: " gg " };
      expect(
        variacoesAposConflito(
          [tela],
          [abertura],
          [antigaGuardada, novaComOutraGrafia],
        ),
      ).toEqual([antigaGuardada, novaComOutraGrafia]);
    });

    it("BORDA: a antiga ainda LIGADA no banco não é troca gravada (outro aparelho só mexeu nela): a edição dela fica", () => {
      const antigaComPrecoNovo = variante({
        id: "v-m",
        value: "M",
        sku: "CAM-M",
        priceOverride: 150,
      });
      const [primeira] = variacoesAposConflito(
        [tela],
        [abertura],
        [antigaComPrecoNovo, novaDoBanco],
      );
      expect(primeira).toMatchObject({ id: "v-m", value: "GG", active: true });
    });

    it("BORDA: sem a opção nova no banco, a antiga desligada por outro aparelho mantém o valor que ela digitou", () => {
      const [primeira] = variacoesAposConflito(
        [tela],
        [abertura],
        [antigaGuardada],
      );
      expect(primeira).toMatchObject({ id: "v-m", value: "GG", active: false });
    });

    it("BORDA: a opção nova só serve a UMA troca (duas linhas não reclamam o mesmo GG)", () => {
      const aberturaP = variante({ id: "v-p", value: "P", sku: "CAM-P" });
      const telaP = variante({ id: "v-p", value: "GG", sku: "CAM-P" });
      const pGuardada = variante({
        id: "v-p",
        value: "P",
        sku: null,
        codigoBarras: null,
        active: false,
      });
      const resultado = variacoesAposConflito(
        [tela, telaP],
        [abertura, aberturaP],
        [antigaGuardada, pGuardada, novaDoBanco],
      );
      expect(resultado.map((v) => `${v.id}:${v.value}`)).toEqual([
        "v-m:M",
        "v-p:GG",
        "v-gg:GG",
      ]);
    });
  });
});
