// O histórico de campanhas do painel de avisos mostra o que a lojista ENVIOU aos
// clientes. Durante meses ele também mostrou linhas que não eram campanha: cada
// resposta da loja a uma pergunta ou avaliação gravava uma linha em
// `push_notifications_log` ("Sua pergunta foi respondida!", 0 aparelhos, selo
// "Não confirmada") sem enviar nada. Depois de ~20 respostas, essas linhas
// empurravam as campanhas de verdade para fora da lista de 20.
//
// A migration 20261240000000 parou de gravar a linha das PERGUNTAS, mas as que
// já existem ficam (apagar dado é decisão do dono) e a das AVALIAÇÕES continua
// sendo gravada — então a lista as filtra, e busca mais linhas do que mostra
// para que elas não ocupem os 20 lugares.
import { describe, expect, it } from "vitest";

import {
  LIMITE_DA_BUSCA_DO_HISTORICO,
  LIMITE_DO_HISTORICO,
  TITULOS_DE_RESPOSTA_DA_LOJA,
  somenteCampanhasReais,
} from "@/lib/historico-de-campanhas";

const linha = (id: string, title: string) => ({ id, title });

describe("somenteCampanhasReais", () => {
  it("tira as linhas das respostas da loja e mantém as campanhas, na ordem", () => {
    const entrada = [
      linha("a", "Frete grátis hoje"),
      linha("b", "Sua pergunta foi respondida!"),
      linha("c", "Sua avaliacao foi respondida!"),
      linha("d", "Sua avaliação foi respondida!"),
      linha("e", "Liquidação de verão"),
    ];
    expect(somenteCampanhasReais(entrada).map((l) => l.id)).toEqual(["a", "e"]);
  });

  it("não tira campanha cujo título só se PARECE com o da resposta", () => {
    const entrada = [
      linha("a", "Sua pergunta foi respondida"),
      linha("b", "Sua pergunta foi respondida! Venha ver"),
      linha("c", "sua pergunta foi respondida!"),
    ];
    expect(somenteCampanhasReais(entrada).map((l) => l.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("devolve no máximo 20 campanhas, as mais novas (a ordem de entrada já é a mais nova primeiro)", () => {
    const campanhas = Array.from({ length: 30 }, (_, i) =>
      linha(`c${i}`, `Campanha ${i}`),
    );
    const resultado = somenteCampanhasReais(campanhas);
    expect(resultado).toHaveLength(LIMITE_DO_HISTORICO);
    expect(resultado[0].id).toBe("c0");
    expect(resultado[19].id).toBe("c19");
  });

  it("uma enxurrada de respostas da loja NÃO empurra as campanhas para fora da lista", () => {
    // 80 respostas recentes (as linhas falsas) e, antes delas, 20 campanhas reais.
    const respostas = Array.from({ length: 80 }, (_, i) =>
      linha(`r${i}`, "Sua pergunta foi respondida!"),
    );
    const campanhas = Array.from({ length: 20 }, (_, i) =>
      linha(`c${i}`, `Campanha ${i}`),
    );
    const buscadas = [...respostas, ...campanhas].slice(
      0,
      LIMITE_DA_BUSCA_DO_HISTORICO,
    );
    // A busca de 100 linhas alcança as 20 campanhas; a de 20 (a de antes) não alcançaria nenhuma.
    expect(somenteCampanhasReais(buscadas)).toHaveLength(20);
    expect(somenteCampanhasReais(buscadas.slice(0, 20))).toHaveLength(0);
  });

  it("a busca é maior do que a lista, senão o filtro não teria de onde tirar", () => {
    expect(LIMITE_DA_BUSCA_DO_HISTORICO).toBeGreaterThan(LIMITE_DO_HISTORICO);
  });

  it("os títulos escondidos são exatamente os três que as RPCs gravam", () => {
    expect([...TITULOS_DE_RESPOSTA_DA_LOJA].sort()).toEqual([
      "Sua avaliacao foi respondida!",
      "Sua avaliação foi respondida!",
      "Sua pergunta foi respondida!",
    ]);
  });
});
