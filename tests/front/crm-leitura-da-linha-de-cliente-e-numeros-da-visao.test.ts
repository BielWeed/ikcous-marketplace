// A linha de cliente do CRM e três números da visão que nenhum teste lia
// campo por campo (achados por mutação em 24/11/2026). Dublês com nomes e
// e-mails fictícios (.invalid), nada de cliente real.
//  - cada campo da linha vem da chave certa da RPC (nota r/f/m, canal,
//    primeira/última compra, dias sem comprar): trocar uma chave pela outra
//    mostraria o número de um cliente no campo de outro;
//  - o valor médio que a RPC manda vale; sem ele, receita ÷ pedidos, e sem
//    pedido nenhum é null (nunca NaN);
//  - a chave da linha (usada pelo React para não misturar clientes) segue a
//    ordem chave > user_id > whatsapp > posição, e a posição é ÚNICA;
//  - taxas do crm_visao chegam como fração e a tela recebe percentual com
//    duas casas (28,57), e as etapas do funil vêm cada uma da sua chave.
import { lerClientesDoCrm, lerVisaoDoCrm } from "@/lib/crm";
import { describe, expect, it } from "vitest";

describe("lerClientesDoCrm: cada campo vem da chave certa", () => {
  it("lê todos os campos da linha de um comprador", () => {
    const lista = lerClientesDoCrm({
      total: 40,
      clientes: [
        {
          chave: "k-1",
          user_id: "u-1",
          nome: "Ana Teste",
          whatsapp: "11999990000",
          email: "ana@exemplo.invalid",
          pedidos: 4,
          receita: 400,
          ticket_medio: 90,
          primeira_compra: "2026-01-05",
          ultima_compra: "2026-11-01",
          dias_sem_comprar: 23,
          r: 5,
          f: 4,
          m: 3,
          segmento: "leais",
          canal_preferido: "online",
          valor_em_aberto: 12,
          cadastrado_em: "2025-12-30",
        },
      ],
    });

    expect(lista?.total).toBe(40);
    expect(lista?.clientes[0]).toEqual({
      chave: "k-1",
      userId: "u-1",
      nome: "Ana Teste",
      whatsapp: "11999990000",
      email: "ana@exemplo.invalid",
      pedidos: 4,
      receita: 400,
      ticketMedio: 90,
      primeiraCompra: "2026-01-05",
      ultimaCompra: "2026-11-01",
      diasSemComprar: 23,
      r: 5,
      f: 4,
      m: 3,
      segmento: "leais",
      canalPreferido: "online",
      valorEmAberto: 12,
      cadastradoEm: "2025-12-30",
    });
  });

  it("valor médio: o da RPC vale; sem ele é receita ÷ pedidos; sem pedido nenhum é null, nunca NaN", () => {
    const lista = lerClientesDoCrm({
      clientes: [
        { user_id: "u-1", pedidos: 4, receita: 400, ticket_medio: 90 },
        { user_id: "u-2", pedidos: 4, receita: 400 },
        { user_id: "u-3", pedidos: 0, receita: 0 },
      ],
    });

    expect(lista?.clientes.map((c) => c.ticketMedio)).toEqual([90, 100, null]);
  });

  it("chave da linha: chave > user_id > whatsapp > posição, e a posição nunca repete", () => {
    const lista = lerClientesDoCrm({
      clientes: [
        { chave: "k-1", user_id: "u-1", whatsapp: "11999990000" },
        { user_id: "u-2", whatsapp: "11999990001" },
        { whatsapp: "11999990002" },
        { nome: "Sem identificação A" },
        "lixo",
        { nome: "Sem identificação B" },
      ],
    });

    // A posição é a da lista que chegou (o "lixo" ocupa a 4), então as duas
    // linhas sem identificação não colidem.
    expect(lista?.clientes.map((c) => c.chave)).toEqual([
      "k-1",
      "u-2",
      "11999990002",
      "linha-3",
      "linha-5",
    ]);
  });
});

describe("lerVisaoDoCrm: números que a tela escreve", () => {
  it("taxas chegam como fração e saem como percentual com duas casas", () => {
    const visao = lerVisaoDoCrm({
      kpis: {
        taxa_recompra: 0.2857,
        receita_recorrente_pct: 0.6149,
        taxa_devolucao: 0.0321,
      },
    });

    expect(visao?.kpis.taxaRecompra).toBe(28.57);
    expect(visao?.kpis.receitaRecorrentePct).toBe(61.49);
    expect(visao?.kpis.taxaDevolucao).toBe(3.21);
  });

  it("cada etapa do funil vem da sua chave", () => {
    const visao = lerVisaoDoCrm({
      funil: {
        visitas: 1000,
        produtos_vistos: 700,
        carrinhos: 300,
        pedidos_criados: 120,
        pedidos_pagos: 90,
      },
    });

    expect(visao?.funil).toEqual({
      visitas: 1000,
      produtosVistos: 700,
      carrinhos: 300,
      pedidosCriados: 120,
      pedidosPagos: 90,
    });
  });
});
