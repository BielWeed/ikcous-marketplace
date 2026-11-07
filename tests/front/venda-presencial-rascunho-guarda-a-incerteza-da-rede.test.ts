// Balcão — o rascunho do cupom guarda UM fato do envio: "a rede falhou e a venda
// pode ter sido gravada". Sem isso, recarregar o app depois de "Não sabemos se
// a venda foi registrada" apagava o aviso e o Cancelar passava a jurar "Nada é
// registrado" (refazer a venda = pedido em dobro e estoque baixado duas vezes).
//
// Só o FATO vai ao disco (um booleano), nunca o texto da mensagem: o que volta
// é sempre a constante do código, e nenhuma recusa antiga (estoque, permissão)
// sobrevive ao recarregamento.
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  estadoInicialDaVenda,
  lerRascunho,
  lerRascunhoComIdade,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { MENSAGEM_DE_REDE_DA_VENDA } from "@/lib/erro-da-venda-presencial";

const AGORA = Date.parse("2026-11-07T15:00:00-03:00");

function cupomComUmItem(erro: string | null): EstadoDaVenda {
  const base = estadoInicialDaVenda(() => "chave-1");
  return {
    ...base,
    etapa: "fechamento",
    pagamento: "cash",
    itens: [
      {
        chave: "p1:",
        productId: "p1",
        variantId: null,
        nome: "Camiseta Lisa",
        variacao: null,
        preco: 39.9,
        quantidade: 1,
        estoque: 10,
        imagem: "",
      },
    ],
    erro,
  };
}

describe("rascunho do balcão — incerteza de rede sobrevive ao recarregamento", () => {
  it("erro de rede gravado volta como a mesma frase de rede (o Cancelar não jura 'nada registrado')", () => {
    const disco = serializarRascunho(
      cupomComUmItem(MENSAGEM_DE_REDE_DA_VENDA),
      AGORA,
    );
    const lido = lerRascunho(disco, AGORA);
    expect(lido?.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
    // o resto do cupom volta como sempre
    expect(lido?.itens).toHaveLength(1);
    expect(lido?.chaveDeIdempotencia).toBe("chave-1");
  });

  it("o que vai ao disco é só o fato, não o texto da mensagem", () => {
    const disco = serializarRascunho(
      cupomComUmItem(MENSAGEM_DE_REDE_DA_VENDA),
      AGORA,
    );
    expect(JSON.parse(disco).talvezGravada).toBe(true);
    expect(disco).not.toContain(MENSAGEM_DE_REDE_DA_VENDA);
    expect(JSON.parse(disco).erro).toBeUndefined();
  });

  it("recusa antiga (estoque, permissão…) NÃO sobrevive: vira null", () => {
    const disco = serializarRascunho(
      cupomComUmItem("Estoque insuficiente (Disponível: 1, Solicitado: 3)"),
      AGORA,
    );
    expect(lerRascunho(disco, AGORA)?.erro).toBeNull();
    expect(JSON.parse(disco).talvezGravada).toBeUndefined();
  });

  it("sem erro nenhum, nada é gravado e volta null", () => {
    const disco = serializarRascunho(cupomComUmItem(null), AGORA);
    expect(JSON.parse(disco).talvezGravada).toBeUndefined();
    expect(lerRascunho(disco, AGORA)?.erro).toBeNull();
  });

  it("rascunho de antes do campo existir continua valendo, sem erro", () => {
    const antigo = JSON.parse(serializarRascunho(cupomComUmItem(null), AGORA));
    // exatamente o que o app gravava antes: nenhuma chave nova
    expect("talvezGravada" in antigo).toBe(false);
    const lido = lerRascunhoComIdade(JSON.stringify(antigo), AGORA);
    expect(lido).not.toBeNull();
    expect(lido?.estado.erro).toBeNull();
    expect(lido?.estado.itens).toHaveLength(1);
  });

  it("valor torto no disco NUNCA vira mensagem: só `true` exato vale", () => {
    const base = JSON.parse(serializarRascunho(cupomComUmItem(null), AGORA));
    for (const torto of [
      "true",
      1,
      "Você ganhou um prêmio",
      { mensagem: "x" },
      null,
      false,
    ]) {
      const lido = lerRascunho(
        JSON.stringify({ ...base, talvezGravada: torto }),
        AGORA,
      );
      expect(lido, JSON.stringify(torto)).not.toBeNull();
      expect(lido?.erro, JSON.stringify(torto)).toBeNull();
    }
    // e uma string livre gravada no antigo campo `erro` também é ignorada
    const comTexto = lerRascunho(
      JSON.stringify({ ...base, erro: "Você ganhou um prêmio" }),
      AGORA,
    );
    expect(comTexto?.erro).toBeNull();
  });

  it("o campo gravado não vaza para dentro do estado restaurado", () => {
    const disco = serializarRascunho(
      cupomComUmItem(MENSAGEM_DE_REDE_DA_VENDA),
      AGORA,
    );
    const lido = lerRascunho(disco, AGORA);
    expect(lido).not.toBeNull();
    expect("talvezGravada" in (lido as object)).toBe(false);
  });

  it("cupom velho (outro dia) também volta com a incerteza: continua sem jurar 'nada registrado'", () => {
    const ontem = AGORA - 30 * 3_600_000;
    const disco = serializarRascunho(
      cupomComUmItem(MENSAGEM_DE_REDE_DA_VENDA),
      ontem,
    );
    const lido = lerRascunhoComIdade(disco, AGORA);
    expect(lido?.velho).toBe(true);
    expect(lido?.estado.etapa).toBe("cupom");
    expect(lido?.estado.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
  });
});
