// "Sua loja está pronta para vender?": o que a tela escreve para a lojista sobre
// o alcance da entrega (resumo e aviso) e o MOTIVO de cada passo pendente (alcance
// curto, produto sem estoque). Sem o motivo informado, o texto é o de antes.
import { describe, expect, it } from "vitest";

import {
  type EntradaDosSeisPassos,
  avisoDaFaixaDeCep,
  entradaDosSeisPassos,
  resumoDoAlcance,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";

describe("resumoDoAlcance: em palavras da lojista", () => {
  it("texto sem números não alcança ninguém", () => {
    expect(resumoDoAlcance("38400-123", "abc")).toBe(
      "nenhum CEP: o que está escrito não tem números",
    );
  });

  it("alcance vazio é a região do CEP da loja, ou 'perto da loja' sem CEP", () => {
    expect(resumoDoAlcance("38400-123", "")).toBe("CEPs que começam com 38400");
    expect(resumoDoAlcance("38400-123", null)).toBe(
      "CEPs que começam com 38400",
    );
    expect(resumoDoAlcance(null, "")).toBe("CEPs perto da loja");
    expect(resumoDoAlcance("3840", "")).toBe("CEPs perto da loja");
  });

  it.each([
    ["38412", "CEPs que começam com 38412"],
    ["3840", "CEPs que começam com 3840"],
    ["3840000", "CEPs que começam com 3840000"],
    [" 38412 ", "CEPs que começam com 38412"],
  ])("um item curto (%j) é prefixo: %s", (faixa, resumo) => {
    expect(resumoDoAlcance("38400-123", faixa)).toBe(resumo);
  });

  it.each([
    ["CEP completo com 8 números", "38400000"],
    ["CEP completo com hífen", "38400-000"],
    ["faixa com hífen", "38400000-38499999"],
    ["lista de dois itens", "38400, 38500"],
    ["prefixo curto com hífen", "384-0"],
  ])("%s é 'CEPs que você escolheu'", (_nome, faixa) => {
    expect(resumoDoAlcance("38400-123", faixa)).toBe("CEPs que você escolheu");
  });
});

describe("avisoDaFaixaDeCep: o aviso do 'Alcance por CEP' (nunca bloqueia)", () => {
  it("faixa que inclui o CEP da loja não tem aviso", () => {
    expect(
      avisoDaFaixaDeCep({ originCep: "38400-123", localCepRange: "38400" }),
    ).toBeNull();
  });

  it("faixa que deixa o CEP da loja de fora avisa", () => {
    expect(
      avisoDaFaixaDeCep({ originCep: "38400-123", localCepRange: "39000" }),
    ).toBe(
      "O CEP da sua loja está fora do alcance escolhido. Confira se é isso mesmo.",
    );
  });

  it.each(["abc", "123456789", ", ,"])(
    "faixa que nenhum CEP entende (%j) diz que não está sendo entendida",
    (faixa) => {
      expect(
        avisoDaFaixaDeCep({ originCep: "38400-123", localCepRange: faixa }),
      ).toMatch(/^O alcance que você escreveu não está sendo entendido/);
    },
  );

  it("faixa preenchida com a loja sem CEP completo: nada a avisar", () => {
    expect(
      avisoDaFaixaDeCep({ originCep: "3840", localCepRange: "abc" }),
    ).toBeNull();
    expect(avisoDaFaixaDeCep({ localCepRange: "39000" })).toBeNull();
  });

  it("alcance vazio com CEP de rua avisa o prefixo; CEP geral (000) e sem CEP, não", () => {
    expect(
      avisoDaFaixaDeCep({ originCep: "38400-123", localCepRange: "" }),
    ).toBe(
      "Sua entrega local só vale para CEPs que começam com 38400. Se sua cidade tem vários CEPs, escolha até onde você entrega",
    );
    expect(
      avisoDaFaixaDeCep({ originCep: "38500-000", localCepRange: "" }),
    ).toBeNull();
    expect(
      avisoDaFaixaDeCep({ originCep: null, localCepRange: "" }),
    ).toBeNull();
    expect(avisoDaFaixaDeCep({})).toBeNull();
  });
});

const ESTADOS: EntradaDosSeisPassos["estados"] = {
  marca: "feito",
  endereco: "feito",
  whatsapp: "feito",
  recebe: "feito",
  entrega: "pendente",
  produto: "pendente",
};

type Fatos = Parameters<typeof entradaDosSeisPassos>[1];

function fatos(mudancas: Partial<Fatos> = {}): Fatos {
  return {
    pixOk: true,
    formasNaEntrega: [],
    produtos: [],
    configCarregando: false,
    produtosCarregando: false,
    entrega: "feito",
    ...mudancas,
  };
}

describe("entradaDosSeisPassos: o motivo da pendência", () => {
  const semEstoque = (mudancas: Partial<Fatos>) =>
    entradaDosSeisPassos({}, fatos(mudancas)).produtoSemEstoque;

  it("há 'sem estoque' quando existe produto ativo e NENHUM vende", () => {
    expect(semEstoque({ produtos: [{ isActive: true, stock: 0 }] })).toBe(true);
  });

  it("um produto que vende desfaz o 'sem estoque'", () => {
    expect(
      semEstoque({
        produtos: [
          { isActive: true, stock: 0 },
          { isActive: true, stock: 2 },
        ],
      }),
    ).toBe(false);
  });

  it("produto desativado, lista vazia ou lista ainda carregando não é 'sem estoque'", () => {
    expect(semEstoque({ produtos: [{ isActive: false, stock: 0 }] })).toBe(
      false,
    );
    expect(semEstoque({ produtos: [] })).toBe(false);
    expect(
      semEstoque({
        produtos: [{ isActive: true, stock: 0 }],
        produtosCarregando: true,
      }),
    ).toBe(false);
  });

  it("alcance curto só quando a entrega está pendente E o aviso do alcance dispara", () => {
    const curto = (entrega: "feito" | "pendente", originCep: string) =>
      entradaDosSeisPassos({ originCep, localCepRange: "" }, fatos({ entrega }))
        .entregaAlcanceCurto;

    expect(curto("pendente", "38400-123")).toBe(true);
    expect(curto("feito", "38400-123")).toBe(false);
    expect(curto("pendente", "38500-000")).toBe(false);
    expect(curto("feito", "38500-000")).toBe(false);
  });

  it("o prefixo citado é o dos 5 primeiros números do CEP da loja, ou null", () => {
    expect(
      entradaDosSeisPassos({ originCep: "38400-123" }, fatos()).entregaPrefixo,
    ).toBe("38400");
    expect(entradaDosSeisPassos({}, fatos()).entregaPrefixo).toBeNull();
  });
});

describe("seisPassosDaLojaPronta: o texto só muda quando o motivo é informado", () => {
  const passo = (
    chave: "entrega" | "produto",
    extra: Partial<EntradaDosSeisPassos> = {},
  ) => {
    const achado = seisPassosDaLojaPronta({
      estados: ESTADOS,
      pixOk: true,
      ...extra,
    }).find((p) => p.chave === chave);
    if (!achado) throw new Error(`passo ${chave} não existe`);
    return achado;
  };

  it("sem motivo informado: o texto de antes, sem explicação", () => {
    expect(passo("entrega").rotuloPendente).toBe("Configurar a entrega");
    expect(passo("entrega").explicacaoPendente).toBeUndefined();
    expect(passo("produto").rotuloPendente).toBe("Cadastrar um produto ativo");
    expect(passo("produto").explicacaoPendente).toBeUndefined();
  });

  it("alcance curto com prefixo cita o prefixo; sem prefixo diz 'perto da loja'", () => {
    const comPrefixo = passo("entrega", {
      entregaAlcanceCurto: true,
      entregaPrefixo: "38400",
    });
    expect(comPrefixo.rotuloPendente).toBe("Confirmar até onde você entrega");
    expect(comPrefixo.explicacaoPendente).toBe(
      "Hoje você entrega só em CEPs que começam com 38400",
    );

    const semPrefixo = passo("entrega", { entregaAlcanceCurto: true });
    expect(semPrefixo.explicacaoPendente).toBe(
      "Hoje você entrega só perto da loja",
    );
  });

  it("produto sem estoque pede reposição, não cadastro", () => {
    const repor = passo("produto", { produtoSemEstoque: true });

    expect(repor.rotuloPendente).toBe("Repor o estoque de um produto");
    expect(repor.explicacaoPendente).toBe(
      "Seus produtos ativos estão sem estoque",
    );
  });
});
