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
  fraseDaSituacaoDoDono,
  fraseSemEstimativa,
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
