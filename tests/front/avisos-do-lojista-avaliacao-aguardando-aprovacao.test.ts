// A avaliacao que a cliente acabou de mandar nasce `pendente` (so a loja a
// publica, no botao Aprovar da tela Avaliacoes). O sino dizia para ela o mesmo
// que para qualquer avaliacao ja publicada — "sem resposta" — e, ao responder,
// o aviso sumia sem a avaliacao ter sido publicada. Agora o aviso de uma
// avaliacao pendente diz que ela espera APROVACAO e leva a tela ja filtrada
// por "Em moderacao".
import { describe, expect, it } from "vitest";

import { montarAvisos } from "@/utils/avisos-do-lojista";

function avaliacao(extra: Record<string, unknown> = {}) {
  return {
    id: "av-1",
    product_id: "prod-1",
    nomeDoProduto: "Caneta",
    rating: 5,
    created_at: "2026-10-01T10:00:00Z",
    ...extra,
  };
}

function avisosDe(...avaliacoes: Array<ReturnType<typeof avaliacao>>) {
  return montarAvisos({
    pedidos: [],
    perguntasPendentes: 0,
    avaliacoes: avaliacoes as never,
    produtos: [],
  });
}

describe("aviso de avaliacao aguardando aprovacao", () => {
  it("avaliacao pendente: titulo fala em aprovacao, nao em 'sem resposta'", () => {
    const [aviso] = avisosDe(avaliacao({ status: "pendente" }));

    expect(aviso.titulo).toBe("Avaliação de 5 estrelas aguardando aprovação");
    expect(aviso.detalhe).toBe("Caneta");
    expect(aviso.contaNoCracha).toBe(true);
  });

  it("uma estrela fica no singular", () => {
    const [aviso] = avisosDe(avaliacao({ status: "pendente", rating: 1 }));

    expect(aviso.titulo).toBe("Avaliação de 1 estrela aguardando aprovação");
  });

  it("leva a tela Avaliacoes ja filtrada por 'Em moderacao'", () => {
    const [aviso] = avisosDe(avaliacao({ status: "pendente" }));

    expect(aviso.destino).toEqual({
      view: "admin-reviews",
      limparFiltros: true,
      soEmModeracao: true,
    });
  });

  it("avaliacao ja publicada sem resposta continua 'sem resposta', na tela sem filtro", () => {
    for (const status of ["publicada", undefined]) {
      const [aviso] = avisosDe(avaliacao({ status }));

      expect(aviso.titulo).toBe("Avaliação de 5 estrelas sem resposta");
      expect(aviso.destino).toEqual({
        view: "admin-reviews",
        limparFiltros: true,
      });
    }
  });

  it("pendente e publicada convivem na lista, cada uma com o seu titulo", () => {
    const avisos = avisosDe(
      avaliacao({ id: "av-1", status: "publicada" }),
      avaliacao({ id: "av-2", status: "pendente" }),
    );

    expect(avisos.map((a) => a.titulo).sort()).toEqual([
      "Avaliação de 5 estrelas aguardando aprovação",
      "Avaliação de 5 estrelas sem resposta",
    ]);
  });
});
