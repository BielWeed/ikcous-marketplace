// Textos do cadastro fiscal (src/lib/fiscal/textos.ts): rótulos em português
// simples, a frase honesta de cada combinação regime x atividade sem conta e as
// frases da trava "só o dono". Lógica pura; fixtures inventadas (repo público).
import { describe, expect, it } from "vitest";

import {
  ATIVIDADES_FISCAIS,
  type AtividadeFiscal,
  REGIMES_FISCAIS,
  type RegimeFiscal,
  quemTemConta,
} from "@/lib/fiscal/cadastro";
import {
  FRASE_NAO_CONFIRMOU_QUEM_PODE,
  FRASE_SEM_DONO_CADASTRADO,
  FRASE_SO_O_DONO_ALTERA,
  ROTULO_TENTAR_DE_NOVO,
  type SituacaoDoDono,
  TEXTOS_DO_MEDIDOR_DO_MEI,
  efeitoDoVeredito,
  fraseDaSituacaoDoDono,
  fraseSemEstimativa,
  nomeDoMesDaData,
  rotuloDaAtividade,
  rotuloDoRegime,
} from "@/lib/fiscal/textos";

const CAUDA =
  "Seu caderno de guias e o arquivo para o contador funcionam normalmente.";

// O produto cartesiano inteiro: se alguém criar um regime ou uma atividade
// nova, a lista de `cadastro.ts` cresce e este teste cobra a frase dela.
const COMBINACOES: ReadonlyArray<{
  regime: RegimeFiscal;
  atividade: AtividadeFiscal;
}> = REGIMES_FISCAIS.flatMap((regime) =>
  ATIVIDADES_FISCAIS.map((atividade) => ({ regime, atividade })),
);

describe("rótulos em português simples", () => {
  it("o produto cartesiano tem as 10 combinações (5 regimes x 2 atividades)", () => {
    expect(COMBINACOES).toHaveLength(10);
  });

  it("cada regime tem rótulo não vazio e todos são diferentes", () => {
    const rotulos = REGIMES_FISCAIS.map((regime) => rotuloDoRegime(regime));
    for (const rotulo of rotulos) expect(rotulo.trim()).not.toBe("");
    expect(new Set(rotulos).size).toBe(REGIMES_FISCAIS.length);
  });

  it("cada atividade tem rótulo não vazio e todos são diferentes", () => {
    const rotulos = ATIVIDADES_FISCAIS.map((a) => rotuloDaAtividade(a));
    for (const rotulo of rotulos) expect(rotulo.trim()).not.toBe("");
    expect(new Set(rotulos).size).toBe(ATIVIDADES_FISCAIS.length);
  });

  it("os rótulos dos regimes e das atividades são os do plano", () => {
    expect(rotuloDoRegime("mei")).toBe("MEI");
    expect(rotuloDoRegime("simples")).toBe("Simples Nacional");
    expect(rotuloDoRegime("presumido")).toBe("Lucro Presumido");
    expect(rotuloDoRegime("real")).toBe("Lucro Real");
    expect(rotuloDoRegime("nao_sei")).toBe("Não sei, meu contador cuida");
    expect(rotuloDaAtividade("comercio")).toBe("Só comércio");
    expect(rotuloDaAtividade("com_servico")).toBe("Tem serviço");
  });
});

describe("fraseSemEstimativa: a frase honesta de quem não tem conta", () => {
  it("varre as 10 combinações: sem conta = frase no formato do plano; com conta = nenhuma frase", () => {
    for (const combinacao of COMBINACOES) {
      const conta = quemTemConta(combinacao);
      const frase = fraseSemEstimativa(combinacao);
      if (conta.tipo === "nenhuma") {
        expect(frase, JSON.stringify(combinacao)).not.toBeNull();
        expect(frase?.trim(), JSON.stringify(combinacao)).not.toBe("");
        expect(frase, JSON.stringify(combinacao)).toMatch(
          /^Ainda não fazemos estimativa /,
        );
        expect(frase?.endsWith(`. ${CAUDA}`), JSON.stringify(combinacao)).toBe(
          true,
        );
      } else {
        // Quem tem conta não leva a frase de "ainda não fazemos".
        expect(frase, JSON.stringify(combinacao)).toBeNull();
      }
    }
  });

  it("a frase muda quando o motivo muda, e só então", () => {
    const frasePorMotivo = new Map<string, Set<string>>();
    for (const combinacao of COMBINACOES) {
      const conta = quemTemConta(combinacao);
      const frase = fraseSemEstimativa(combinacao);
      if (conta.tipo !== "nenhuma" || frase === null) continue;
      const frases = frasePorMotivo.get(conta.motivo) ?? new Set<string>();
      frases.add(frase);
      frasePorMotivo.set(conta.motivo, frases);
    }
    // 4 motivos sem conta; cada um tem UMA frase (a atividade não muda o texto
    // de Presumido, Real e "Não sei") e as quatro são diferentes entre si.
    expect([...frasePorMotivo.keys()].sort()).toStrictEqual([
      "nao_sei",
      "presumido",
      "real",
      "simples_com_servico",
    ]);
    const todas = new Set<string>();
    for (const frases of frasePorMotivo.values()) {
      expect(frases.size).toBe(1);
      for (const frase of frases) todas.add(frase);
    }
    expect(todas.size).toBe(4);
  });

  it("o texto exato de cada caso", () => {
    expect(
      fraseSemEstimativa({ regime: "simples", atividade: "com_servico" }),
    ).toBe(
      `Ainda não fazemos estimativa para Simples Nacional com serviço. ${CAUDA}`,
    );
    expect(
      fraseSemEstimativa({ regime: "presumido", atividade: "comercio" }),
    ).toBe(`Ainda não fazemos estimativa para Lucro Presumido. ${CAUDA}`);
    expect(
      fraseSemEstimativa({ regime: "real", atividade: "com_servico" }),
    ).toBe(`Ainda não fazemos estimativa para Lucro Real. ${CAUDA}`);
    expect(
      fraseSemEstimativa({ regime: "nao_sei", atividade: "comercio" }),
    ).toBe(
      `Ainda não fazemos estimativa quando o contador cuida dos impostos. ${CAUDA}`,
    );
  });

  it("MEI e Simples de só comércio não recebem a frase", () => {
    expect(
      fraseSemEstimativa({ regime: "mei", atividade: "comercio" }),
    ).toBeNull();
    expect(
      fraseSemEstimativa({ regime: "simples", atividade: "comercio" }),
    ).toBeNull();
  });
});

describe("a trava só o dono: as cinco situações da tabela", () => {
  it("o texto exato do plano", () => {
    expect(FRASE_SO_O_DONO_ALTERA).toBe(
      "Só o dono da loja altera o cadastro fiscal.",
    );
    expect(FRASE_SEM_DONO_CADASTRADO).toBe(
      "Esta loja ainda não tem um dono cadastrado. Peça ao suporte do IKCOUS para cadastrar o dono; depois, recarregue a página.",
    );
    expect(FRASE_NAO_CONFIRMOU_QUEM_PODE).toBe(
      "Não deu para confirmar quem pode alterar.",
    );
    expect(ROTULO_TENTAR_DE_NOVO).toBe("Tentar de novo");
  });

  it("cada situação tem a frase certa; carregando e dono não têm frase", () => {
    const esperado: ReadonlyArray<[SituacaoDoDono, string | null]> = [
      ["carregando", null],
      ["sou_o_dono", null],
      ["outro_e_o_dono", FRASE_SO_O_DONO_ALTERA],
      ["sem_dono", FRASE_SEM_DONO_CADASTRADO],
      ["leitura_falhou", FRASE_NAO_CONFIRMOU_QUEM_PODE],
    ];
    for (const [situacao, frase] of esperado) {
      expect(fraseDaSituacaoDoDono(situacao), situacao).toBe(frase);
    }
  });
});

describe("medidor do MEI: o mês por extenso e o texto de quem começou depois de janeiro", () => {
  it("cada mês tem o nome certo, em minúscula e com acento", () => {
    const nomes = Array.from({ length: 12 }, (_, i) =>
      nomeDoMesDaData(`2026-${String(i + 1).padStart(2, "0")}-01`),
    );
    expect(nomes).toEqual([
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ]);
  });

  it("data que não tem mês legível não vira nome", () => {
    expect(nomeDoMesDaData(null)).toBeNull();
    expect(nomeDoMesDaData("")).toBeNull();
    expect(nomeDoMesDaData("lixo")).toBeNull();
    expect(nomeDoMesDaData("2026-00-01")).toBeNull();
    expect(nomeDoMesDaData("2026-13-01")).toBeNull();
  });

  it("o texto diz 'a partir de <mês>' e manda somar o que veio antes", () => {
    expect(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.comecou_depois_do_inicio(
        "2026-03-01",
      ),
    ).toBe(
      "O IKCOUS só tem as suas vendas a partir de março. Para saber quanto do limite você já usou, some a este número o que você vendeu antes disso neste ano (se a empresa abriu neste ano, só conta a partir da abertura).",
    );
  });

  it("sem mês legível, usa a frase genérica (nunca 'a partir de null')", () => {
    for (const desde of [null, "lixo", "2026-13-01"]) {
      const t =
        TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.comecou_depois_do_inicio(desde);
      expect(t).toContain(
        "a partir do mês em que você começou a vender por aqui",
      );
      expect(t).not.toContain("null");
      expect(t).not.toContain("undefined");
    }
  });
});

describe("medidor do MEI, ano completo: o número é um mínimo, o veredito nunca promete", () => {
  const FAIXAS = ["dentro", "excesso_ate_20", "excesso_acima_20"] as const;

  it("todo efeito e todo título começam com 'Pelo que o IKCOUS registrou,'", () => {
    const titulos = Object.entries(TEXTOS_DO_MEDIDOR_DO_MEI.titulosDaFaixa);
    expect(titulos.map(([faixa]) => faixa)).toEqual([...FAIXAS]);
    for (const [faixa, titulo] of titulos) {
      expect(titulo, faixa).toMatch(/^Pelo que o IKCOUS registrou, /);
    }
    for (const faixa of FAIXAS) {
      for (const abertura of [false, true]) {
        expect(
          efeitoDoVeredito(faixa, abertura),
          `${faixa} ${abertura}`,
        ).toMatch(/^Pelo que o IKCOUS registrou, /);
      }
    }
  });

  it("nenhum texto diz que nada muda nem que está tudo certo", () => {
    const todos = [
      ...Object.values(TEXTOS_DO_MEDIDOR_DO_MEI.titulosDaFaixa),
      ...FAIXAS.flatMap((f) => [
        efeitoDoVeredito(f, false),
        efeitoDoVeredito(f, true),
      ]),
    ].map((t) => t.toLowerCase());
    for (const t of todos) {
      expect(t).not.toContain("nada muda");
      expect(t).not.toContain("tudo certo");
      expect(t).not.toContain("por causa da receita");
    }
  });

  it("dentro do limite manda conferir as vendas feitas por fora", () => {
    expect(efeitoDoVeredito("dentro", false)).toBe(
      "Pelo que o IKCOUS registrou, você está dentro do limite do MEI. Confira as vendas feitas por fora do app: elas também contam para o limite.",
    );
  });

  it("até 20% acima: a consequência branda é CONDICIONAL ao que foi vendido por fora (ano normal)", () => {
    expect(efeitoDoVeredito("excesso_ate_20", false)).toBe(
      "Pelo que o IKCOUS registrou, você passou do limite em até 20%. Se, somando o que você vendeu por fora do app, o total ficar até 20% acima do limite, você deixa de ser MEI a partir de 1º de janeiro do ano seguinte, e a diferença é paga, sem acréscimos, junto com o DAS de janeiro. Se passar de 20%, a saída do MEI volta a 1º de janeiro deste ano. Avise a Receita até o último dia útil do mês seguinte ao do excesso.",
    );
  });

  it("até 20% acima: a consequência branda é CONDICIONAL ao que foi vendido por fora (ano de abertura)", () => {
    expect(efeitoDoVeredito("excesso_ate_20", true)).toBe(
      "Pelo que o IKCOUS registrou, você passou do limite proporcional em até 20%. Se, somando o que você vendeu por fora do app, o total ficar até 20% acima do limite proporcional, você deixa de ser MEI a partir de 1º de janeiro do ano seguinte. Se passar de 20%, a saída volta ao início da atividade. Avise a Receita até o último dia útil do mês seguinte ao do excesso.",
    );
  });

  it("até 20% acima: nenhuma variante afirma a consequência branda sem a ressalva do que foi vendido por fora", () => {
    for (const abertura of [false, true]) {
      const t = efeitoDoVeredito("excesso_ate_20", abertura);
      const rotulo = `ate_20 abertura=${abertura}`;
      expect(t, rotulo).toContain("por fora do app");
      expect(t, rotulo).toContain("Se passar de 20%");
      // a ressalva vem ANTES da consequência branda, e a faixa pior vem DEPOIS dela
      const ressalva = t.indexOf("Se, somando o que você vendeu por fora");
      const brando = t.indexOf("deixa de ser MEI a partir de 1º de janeiro");
      const pior = t.indexOf("Se passar de 20%");
      expect(ressalva, rotulo).toBeGreaterThan(0);
      expect(brando, rotulo).toBeGreaterThan(ressalva);
      expect(pior, rotulo).toBeGreaterThan(brando);
      // a frase branda nunca aparece solta, em maiúscula inicial, como afirmação
      expect(t, rotulo).not.toContain("Você deixa de ser MEI a partir de");
    }
  });

  it("acima de 20%: a consequência segue a mesma, só prefixada", () => {
    expect(efeitoDoVeredito("excesso_acima_20", false)).toContain(
      "Você deixa de ser MEI com efeito retroativo a 1º de janeiro do ano do excesso e passa a pagar pelo Simples Nacional normal.",
    );
  });

  it("as telas de cobertura completa chamam o limite pelo que ele é: só as vendas registradas no IKCOUS", () => {
    expect(TEXTOS_DO_MEDIDOR_DO_MEI.completa.subtitulo).toBe(
      "Quanto do limite as vendas registradas no IKCOUS já usam.",
    );
    expect(TEXTOS_DO_MEDIDOR_DO_MEI.completa.rotuloDoPercentual).toBe(
      "Parte do limite usada pelas vendas registradas no IKCOUS",
    );
    expect(TEXTOS_DO_MEDIDOR_DO_MEI.completa.rotuloDasVendas).toBe(
      "Vendas registradas no IKCOUS",
    );
    expect(TEXTOS_DO_MEDIDOR_DO_MEI.chamadaDoExcessoAte20).toBe(
      "Fale com um contador ou com o Sebrae.",
    );
  });
});
