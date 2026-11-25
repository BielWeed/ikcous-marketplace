// Bordas das regras PURAS da devolução/troca (src/lib/devolucao.ts) que a
// mutação achou sem teste:
//  - o milissegundo exato em que o código de postagem da etiqueta reversa vence,
//    qual geração vale quando há mais de uma e o que acontece com data ilegível;
//  - a linha do tempo de uma devolução cancelada ANTES de ser aprovada e de uma
//    reprovada na inspeção;
//  - lista vazia e valor negativo na conta do "Não veio" e do frete de ida (o
//    dinheiro nunca pode sair negativo nem devolver frete de um pedido vazio);
//  - a fronteira de 6 fotos e a conferência de resolução/forma de devolver.
import { describe, expect, it } from "vitest";

import {
  NOTA_CODIGO_DE_POSTAGEM_GERADO,
  centavosDosItensQueNaoVieram,
  devolveFreteDeIda,
  erroDaResolucao,
  erroDoMotivo,
  etapasDaDevolucao,
  instrucaoParaOCliente,
} from "@/lib/devolucao";
import type { EventoDevolucao, ItemElegivel } from "@/types/devolucao";

const DIA_MS = 24 * 60 * 60 * 1000;

const geracao = (id: number, created_at: string): EventoDevolucao => ({
  id,
  de_status: "solicitada",
  para_status: "aprovada",
  ator: "sistema",
  nota: NOTA_CODIGO_DE_POSTAGEM_GERADO,
  created_at,
});

const comEtiqueta = (eventos: EventoDevolucao[]) => ({
  status: "aprovada" as const,
  tipo: "arrependimento" as const,
  metodo_retorno: "etiqueta_reversa" as const,
  codigo_postagem: "PX123BR",
  etiqueta_url: "https://exemplo.test/dce.pdf",
  codigo_rastreio: null,
  coleta_em: null,
  resolucao_final: null,
  reembolso_manual: false,
  valor_reembolso: null,
  eventos,
});

describe("código de postagem da etiqueta reversa: validade de 7 dias", () => {
  const gerado = "2026-10-01T12:00:00Z";
  const fim = Date.parse(gerado) + 7 * DIA_MS;

  it("no milissegundo exato do fim o código ainda vale; um milissegundo depois venceu", () => {
    const d = comEtiqueta([geracao(1, gerado)]);
    // 12:00Z de 08/10 é 09:00 em Brasília.
    expect(instrucaoParaOCliente(d, {}, null, fim)).toContain(
      "válido até 08/10 às 09:00 (horário de Brasília)",
    );
    expect(instrucaoParaOCliente(d, {}, null, fim + 1)).toBe(
      "Este código de postagem venceu. Fale com a loja para gerar outro.",
    );
  });

  it("com duas gerações vale a mais recente, qualquer que seja a ordem da lista", () => {
    const antigo = geracao(1, gerado);
    const novo = geracao(2, "2026-10-05T12:00:00Z");
    // 09/10: o primeiro código (vence 08/10) já morreu, o segundo (12/10) não.
    const agora = Date.parse("2026-10-09T12:00:00Z");
    for (const eventos of [
      [antigo, novo],
      [novo, antigo],
    ]) {
      const texto = instrucaoParaOCliente(
        comEtiqueta(eventos),
        {},
        null,
        agora,
      );
      expect(texto).toContain("válido até 12/10 às 09:00");
      expect(texto).not.toContain("venceu");
    }
  });

  it("geração com data ilegível: não inventa validade nem diz que venceu", () => {
    const d = comEtiqueta([geracao(1, gerado), geracao(2, "data-que-nao-le")]);
    // Bem depois do fim da geração legível: se a ilegível fosse ignorada, o
    // texto diria que o código venceu.
    const texto = instrucaoParaOCliente(d, {}, null, fim + 30 * DIA_MS);
    expect(texto).not.toContain("venceu");
    expect(texto).not.toContain("válido até");
    expect(texto).toContain("em até 7 dias");
  });

  it("sem nenhuma geração registrada também não inventa validade", () => {
    const texto = instrucaoParaOCliente(
      comEtiqueta([]),
      {},
      null,
      fim + DIA_MS,
    );
    expect(texto).not.toContain("venceu");
    expect(texto).not.toContain("válido até");
    expect(texto).toContain("em até 7 dias");
  });
});

describe("linha do tempo dos finais negativos", () => {
  const resumo = (
    status: Parameters<typeof etapasDaDevolucao>[0]["status"],
    aprovada_em: string | null,
  ) =>
    etapasDaDevolucao({
      status,
      metodo_retorno: "envio_proprio",
      aprovada_em,
    }).map((e) => `${e.status}:${e.estado}`);

  it("cancelada ANTES de aprovada não mostra 'Aprovada' como feita", () => {
    expect(resumo("cancelada", null)).toEqual([
      "solicitada:feita",
      "cancelada:negativa",
    ]);
  });

  it("cancelada DEPOIS de aprovada mostra 'Aprovada' como feita", () => {
    expect(resumo("cancelada", "2026-10-02T10:00:00Z")).toEqual([
      "solicitada:feita",
      "aprovada:feita",
      "cancelada:negativa",
    ]);
  });

  it("reprovada na inspeção passou por tudo até 'Recebida'", () => {
    expect(resumo("reprovada", "2026-10-02T10:00:00Z")).toEqual([
      "solicitada:feita",
      "aprovada:feita",
      "em_transito:feita",
      "recebida:feita",
      "reprovada:negativa",
    ]);
  });
});

describe("conta do 'Não veio' e do frete de ida nas bordas", () => {
  const linha = (quantidade: number, valor_unitario: number) => ({
    quantidade,
    valor_unitario,
  });

  it("valor do servidor negativo ou zero nunca vira desconto", () => {
    const itens = [linha(1, 10)];
    expect(centavosDosItensQueNaoVieram(-500, itens, itens)).toBe(0);
    expect(centavosDosItensQueNaoVieram(0, itens, itens)).toBe(0);
  });

  it("sem itens e sem ausentes não há o que descontar", () => {
    expect(centavosDosItensQueNaoVieram(1000, [], [])).toBe(0);
  });

  it("tudo ausente desconta o valor inteiro mesmo com preço unitário zero", () => {
    const itens = [linha(1, 0)];
    expect(centavosDosItensQueNaoVieram(500, itens, itens)).toBe(500);
  });

  it("nunca desconta mais do que o valor do servidor (ausente além do que foi pedido)", () => {
    const itens = [linha(1, 10), linha(1, 10)];
    expect(centavosDosItensQueNaoVieram(1000, itens, [linha(3, 10)])).toBe(
      1000,
    );
  });

  const item = (quantidade: number, ja_devolvida: number): ItemElegivel => ({
    order_item_id: "oi-1",
    product_id: "p-1",
    product_name: "Camiseta",
    image_url: null,
    quantidade,
    ja_devolvida,
    disponivel: quantidade - ja_devolvida,
    valor_unitario: 10,
  });

  it("pedido sem itens (ou de quantidade zero) não devolve frete de ida", () => {
    expect(devolveFreteDeIda("arrependimento", [], new Map())).toBe(false);
    expect(devolveFreteDeIda("vicio", [item(0, 0)], new Map())).toBe(false);
  });

  it("devolve o frete só quando o que já voltou mais o que vai agora cobre o pedido todo", () => {
    const itens = [item(3, 1)];
    expect(devolveFreteDeIda("vicio", itens, new Map([["oi-1", 1]]))).toBe(
      false,
    );
    expect(devolveFreteDeIda("vicio", itens, new Map([["oi-1", 2]]))).toBe(
      true,
    );
  });
});

describe("conferências do pedido do cliente nas bordas", () => {
  const janelas = { arrependimento: true, troca: true, vicio: true };
  const prazos = {
    arrependimento_ate: "2026-10-08",
    troca_ate: "2026-10-31",
  };
  const politica = { exige_fotos_vicio: true };
  const erroComFotos = (quantidadeDeFotos: number) =>
    erroDoMotivo({
      motivo: "desisti",
      detalhe: "",
      quantidadeDeFotos,
      janelas,
      prazos,
      politica,
    });

  it("6 fotos ainda cabem; 7 não", () => {
    expect(erroComFotos(6)).toBeNull();
    expect(erroComFotos(7)).toBe("Envie no máximo 6 fotos.");
  });

  it("resolução fora das permitidas não passa, mesmo sendo uma resolução válida", () => {
    expect(
      erroDaResolucao({
        resolucao: "reembolso",
        metodo: "envio_proprio",
        permitidas: ["troca", "vale"],
        metodos: ["envio_proprio"],
      }),
    ).toBe("Escolha como prefere resolver.");
  });

  it("forma de devolver fora da lista de agora não passa (a lista mudou depois da escolha)", () => {
    expect(
      erroDaResolucao({
        resolucao: "troca",
        metodo: "coleta",
        permitidas: ["troca"],
        metodos: ["etiqueta_reversa", "envio_proprio"],
      }),
    ).toBe("Escolha como o produto volta para a loja.");
    expect(
      erroDaResolucao({
        resolucao: "troca",
        metodo: "envio_proprio",
        permitidas: ["troca"],
        metodos: ["etiqueta_reversa", "envio_proprio"],
      }),
    ).toBeNull();
  });
});
