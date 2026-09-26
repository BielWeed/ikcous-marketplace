// Regras PURAS da devolução/troca (src/lib/devolucao.ts): rótulos pt-BR,
// leitores do jsonb das RPCs (a forma que a migration
// 20261175000000_a_devolucao_nasce_no_pedido.sql devolve), o espelho da
// máquina de estados e as regras do pedido do cliente (tipo previsto,
// resoluções permitidas, frete de ida, fotos obrigatórias).
import { describe, expect, it } from "vitest";

import {
  acoesDoCliente,
  acoesDoLojista,
  caminhoDaFoto,
  contagemDe,
  devolveFreteDeIda,
  erroDoMotivo,
  erroDosItens,
  etapasDaDevolucao,
  formatarDia,
  fotosObrigatorias,
  instrucaoParaOCliente,
  lerDevolucaoDetalhe,
  lerDevolucoesDoPedido,
  lerElegibilidade,
  lerListaAdmin,
  lerRespostaEtiquetaReversa,
  lerResultadoConclusao,
  lerResultadoSolicitacao,
  mensagemDoErro,
  mensagemDoErroDaEdge,
  resolucoesDaConclusao,
  resolucoesPermitidas,
  rotuloMetodo,
  rotuloMotivo,
  rotuloResolucao,
  rotuloStatus,
  rotuloTipo,
  textoDoPrazo,
  tipoPrevisto,
  totalAbertas,
  valorDaSelecao,
} from "@/lib/devolucao";
import type { ItemElegivel } from "@/types/devolucao";

const POLITICA = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: "2026-09-26T10:00:00Z",
};

const ELEGIBILIDADE_CRUA = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-09-24T15:00:00Z",
  dias_desde_entrega: 2,
  modalidade: "nacional",
  metodos: ["etiqueta_reversa", "envio_proprio"],
  prazos: {
    arrependimento_ate: "2026-10-01",
    troca_ate: "2026-10-24",
    vicio_ate: "2026-12-23",
  },
  janelas: { arrependimento: true, troca: true, vicio: true },
  itens: [
    {
      order_item_id: "oi-1",
      product_id: "p-1",
      product_name: "Tênis",
      image_url: null,
      quantidade: 2,
      ja_devolvida: 0,
      disponivel: 2,
      valor_unitario: 99.9,
    },
  ],
  politica: POLITICA,
};

const DETALHE_CRU = {
  id: "d-1",
  protocolo: "DV260926-ABCDE",
  order_id: "o-1",
  user_id: "u-1",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: null,
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status: "recebida",
  valor_itens: 199.8,
  valor_frete_ida: 20,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: ["u-1/o-1/a.jpg"],
  codigo_rastreio: "AB123456789BR",
  codigo_postagem: null,
  etiqueta_url: null,
  me_reverse_id: "reservando:123:abc",
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  prazo_ate: "2026-10-01",
  politica: POLITICA,
  created_at: "2026-09-26T10:00:00Z",
  updated_at: "2026-09-26T10:00:00Z",
  aprovada_em: "2026-09-26T11:00:00Z",
  postada_em: "2026-09-26T12:00:00Z",
  recebida_em: "2026-09-27T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [
    {
      id: "di-1",
      devolucao_id: "d-1",
      order_item_id: "oi-1",
      product_id: "p-1",
      variant_id: null,
      product_name: "Tênis",
      image_url: null,
      quantidade: 2,
      valor_unitario: 99.9,
      condicao: null,
      reestocar: null,
      reestocado_em: null,
    },
  ],
  eventos: [
    {
      id: 1,
      devolucao_id: "d-1",
      de_status: null,
      para_status: "solicitada",
      ator: "cliente",
      nota: null,
      created_by: "u-1",
      created_at: "2026-09-26T10:00:00Z",
    },
    // Status desconhecido (versão futura do banco) some da trilha sem
    // derrubar a ficha.
    { id: 2, para_status: "status_novo", ator: "loja", created_at: "x" },
  ],
  pedido: {
    id: "o-1",
    total: 219.8,
    shipping: 20,
    payment_method: "online",
    payment_status: "pago",
    canal: "online",
    customer_name: "Maria",
    whatsapp: "34999999999",
    shipping_label_id: null,
    shipping_option_id: "melhor-envio-1",
  },
};

const item = (extra: Partial<ItemElegivel> = {}): ItemElegivel => ({
  order_item_id: "oi-1",
  product_id: "p-1",
  product_name: "Tênis",
  image_url: null,
  quantidade: 2,
  ja_devolvida: 0,
  disponivel: 2,
  valor_unitario: 99.9,
  ...extra,
});

describe("rótulos pt-BR", () => {
  it("status, tipo, motivo, método e resolução falam a língua do cliente", () => {
    expect(rotuloStatus("em_transito")).toBe("A caminho");
    expect(rotuloStatus("concluida")).toBe("Concluída");
    expect(rotuloTipo("vicio")).toBe("Problema no produto");
    expect(rotuloMotivo("avariado_no_transporte")).toBe("Chegou danificado");
    expect(rotuloMotivo("outro")).toBe("Outro motivo");
    expect(rotuloMetodo("etiqueta_reversa")).toBe(
      "Código de postagem dos Correios",
    );
    expect(rotuloResolucao("vale")).toBe("Vale-troca");
  });
});

describe("leitores do jsonb das RPCs", () => {
  it("lerElegibilidade lê a forma de devolucao_elegibilidade", () => {
    const e = lerElegibilidade(ELEGIBILIDADE_CRUA);
    expect(e?.pode).toBe(true);
    expect(e?.metodos).toEqual(["etiqueta_reversa", "envio_proprio"]);
    expect(e?.itens[0].disponivel).toBe(2);
    expect(e?.politica.prazo_vicio_dias).toBe(90);
    expect(e?.prazos.arrependimento_ate).toBe("2026-10-01");
  });

  it("lerElegibilidade recusa forma inesperada (sem `pode`, sem política)", () => {
    expect(lerElegibilidade({ ...ELEGIBILIDADE_CRUA, pode: "sim" })).toBeNull();
    expect(
      lerElegibilidade({ ...ELEGIBILIDADE_CRUA, politica: null }),
    ).toBeNull();
    expect(lerElegibilidade(null)).toBeNull();
  });

  it("lerResultadoSolicitacao exige id, protocolo, tipo e status conhecidos", () => {
    expect(
      lerResultadoSolicitacao({
        id: "d-1",
        protocolo: "DV1",
        tipo: "vicio",
        status: "solicitada",
      }),
    ).toEqual({
      id: "d-1",
      protocolo: "DV1",
      tipo: "vicio",
      status: "solicitada",
    });
    expect(
      lerResultadoSolicitacao({ id: "d-1", protocolo: "DV1", tipo: "x" }),
    ).toBeNull();
  });

  it("lerDevolucoesDoPedido lê a lista e recusa linha torta", () => {
    const linha = {
      id: "d-1",
      protocolo: "DV1",
      status: "aprovada",
      tipo: "troca",
      resolucao_desejada: "troca",
      metodo_retorno: "coleta",
      valor_itens: 50,
      created_at: "2026-09-26T10:00:00Z",
    };
    expect(lerDevolucoesDoPedido([linha])?.[0].metodo_retorno).toBe("coleta");
    expect(lerDevolucoesDoPedido([])).toEqual([]);
    expect(lerDevolucoesDoPedido([{ ...linha, status: "?" }])).toBeNull();
    expect(lerDevolucoesDoPedido({})).toBeNull();
  });

  it("lerDevolucaoDetalhe lê linha + itens + trilha + pedido, e descarta evento desconhecido", () => {
    const d = lerDevolucaoDetalhe(DETALHE_CRU);
    expect(d?.status).toBe("recebida");
    expect(d?.itens).toHaveLength(1);
    expect(d?.eventos.map((e) => e.para_status)).toEqual(["solicitada"]);
    expect(d?.pedido?.payment_status).toBe("pago");
    expect(d?.politica?.aceita_vale).toBe(true);
    // me_reverse_id (token de reserva) não entra no tipo da tela.
    expect(d && "me_reverse_id" in d).toBe(false);
  });

  it("lerListaAdmin completa a contagem com zero e soma as abertas", () => {
    const lista = lerListaAdmin({
      total: 1,
      contagem: { solicitada: 2, aprovada: 1, em_transito: 1, concluida: 9 },
      itens: [],
    });
    expect(lista).not.toBeNull();
    if (!lista) return;
    expect(contagemDe(lista.contagem, "recebida")).toBe(0);
    expect(totalAbertas(lista.contagem)).toBe(4);
    expect(lerListaAdmin({ total_count: 3 })).toBeNull();
  });

  it("lerResultadoConclusao lê refund_id e reembolso_manual", () => {
    expect(
      lerResultadoConclusao({
        id: "d-1",
        status: "concluida",
        resolucao: "reembolso",
        valor_reembolso: 219.8,
        refund_id: "r-1",
        reembolso_manual: false,
        reestocados: 2,
      }),
    ).toEqual({
      id: "d-1",
      status: "concluida",
      resolucao: "reembolso",
      valor_reembolso: 219.8,
      refund_id: "r-1",
      reembolso_manual: false,
      reestocados: 2,
    });
  });

  it("etiqueta reversa: `codigo_postagem` é a verdade; `resgate` vira aviso", () => {
    const ok = lerRespostaEtiquetaReversa({
      ok: true,
      already: true,
      codigo_postagem: "PX123",
      etiqueta_url: "https://x/dce.pdf",
      me_reverse_id: "reservando:1:2",
    });
    expect(ok).toEqual({
      ok: true,
      dados: {
        codigo_postagem: "PX123",
        etiqueta_url: "https://x/dce.pdf",
        ja_existia: true,
        validade_ate: null,
      },
    });
    expect(
      lerRespostaEtiquetaReversa({ error: "Falhou no ME", resgate: true }),
    ).toEqual({ ok: false, erro: "Falhou no ME", resgate: true });
    expect(lerRespostaEtiquetaReversa({ ok: true }).ok).toBe(false);
  });
});

describe("mensagens de erro", () => {
  it("a mensagem da RPC passa como veio; falha de rede vira frase nossa", () => {
    expect(
      mensagemDoErro(
        { message: "Envie ao menos uma foto do problema no produto." },
        "x",
      ),
    ).toBe("Envie ao menos uma foto do problema no produto.");
    expect(mensagemDoErro(new TypeError("Failed to fetch"), "x")).toContain(
      "Sem conexão",
    );
    expect(mensagemDoErro(null, "genérica")).toBe("genérica");
  });

  it("mensagemDoErroDaEdge lê o `{error}` do corpo em error.context", async () => {
    const erro = {
      context: { json: () => Promise.resolve({ error: "Sem saldo no ME" }) },
    };
    expect(await mensagemDoErroDaEdge(erro, "genérica")).toBe(
      "Sem saldo no ME",
    );
    expect(await mensagemDoErroDaEdge({}, "genérica")).toBe("genérica");
  });
});

describe("ações permitidas por status", () => {
  it("cliente cancela em solicitada/aprovada e informa envio só quando cabe", () => {
    expect(
      acoesDoCliente({ status: "solicitada", metodo_retorno: "envio_proprio" }),
    ).toEqual(["cancelar"]);
    expect(
      acoesDoCliente({ status: "aprovada", metodo_retorno: "envio_proprio" }),
    ).toEqual(["informar_envio", "cancelar"]);
    // Etiqueta reversa: só depois do código de postagem (ele é o rastreio).
    expect(
      acoesDoCliente({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
      }),
    ).toEqual(["cancelar"]);
    expect(
      acoesDoCliente({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
        codigo_postagem: "PX1",
      }),
    ).toEqual(["informar_envio", "cancelar"]);
    expect(
      acoesDoCliente({ status: "aprovada", metodo_retorno: "coleta" }),
    ).toEqual(["cancelar"]);
    expect(
      acoesDoCliente({
        status: "em_transito",
        metodo_retorno: "envio_proprio",
      }),
    ).toEqual([]);
  });

  it("lojista segue a máquina de estados das RPCs", () => {
    expect(
      acoesDoLojista({ status: "solicitada", metodo_retorno: "coleta" }),
    ).toEqual(["aprovar", "recusar"]);
    expect(
      acoesDoLojista({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
      }),
    ).toEqual(["gerar_etiqueta", "marcar_em_transito", "marcar_recebida"]);
    expect(
      acoesDoLojista({
        status: "aprovada",
        metodo_retorno: "etiqueta_reversa",
        codigo_postagem: "PX1",
      }),
    ).toEqual(["marcar_em_transito", "marcar_recebida"]);
    expect(
      acoesDoLojista({ status: "aprovada", metodo_retorno: "entrega_na_loja" }),
    ).toEqual(["marcar_recebida"]);
    expect(
      acoesDoLojista({
        status: "em_transito",
        metodo_retorno: "envio_proprio",
      }),
    ).toEqual(["marcar_recebida"]);
    expect(
      acoesDoLojista({ status: "recebida", metodo_retorno: "envio_proprio" }),
    ).toEqual(["concluir", "reprovar"]);
    for (const final of [
      "concluida",
      "recusada",
      "cancelada",
      "reprovada",
    ] as const) {
      expect(
        acoesDoLojista({ status: final, metodo_retorno: "envio_proprio" }),
      ).toEqual([]);
    }
  });

  it("troca de política não fecha com reembolso", () => {
    expect(resolucoesDaConclusao("troca")).toEqual(["troca", "vale"]);
    expect(resolucoesDaConclusao("vicio")).toEqual([
      "reembolso",
      "troca",
      "vale",
    ]);
  });
});

describe("regras do pedido do cliente", () => {
  const todas = { arrependimento: true, troca: true, vicio: true };
  const soTrocaEVicio = { arrependimento: false, troca: true, vicio: true };
  const soVicio = { arrependimento: false, troca: false, vicio: true };

  it("tipo previsto segue o servidor: problema → vício; senão arrependimento, depois troca", () => {
    expect(tipoPrevisto("defeito", todas)).toBe("vicio");
    expect(tipoPrevisto("nao_gostei", todas)).toBe("arrependimento");
    expect(tipoPrevisto("nao_gostei", soTrocaEVicio)).toBe("troca");
    expect(tipoPrevisto("nao_gostei", soVicio)).toBeNull();
    expect(
      tipoPrevisto("defeito", {
        arrependimento: true,
        troca: true,
        vicio: false,
      }),
    ).toBeNull();
  });

  it("reembolso só no arrependimento ou em problema; troca/vale pela política", () => {
    expect(resolucoesPermitidas("tamanho_grande", todas, POLITICA)).toEqual([
      "reembolso",
      "troca",
      "vale",
    ]);
    expect(
      resolucoesPermitidas("tamanho_grande", soTrocaEVicio, POLITICA),
    ).toEqual(["troca", "vale"]);
    expect(
      resolucoesPermitidas("defeito", soVicio, {
        aceita_troca: false,
        aceita_vale: false,
      }),
    ).toEqual(["reembolso", "troca"]);
    expect(resolucoesPermitidas(null, todas, POLITICA)).toEqual([]);
  });

  it("fotos obrigatórias só em problema e quando a política exige", () => {
    expect(fotosObrigatorias("defeito", { exige_fotos_vicio: true })).toBe(
      true,
    );
    expect(fotosObrigatorias("defeito", { exige_fotos_vicio: false })).toBe(
      false,
    );
    expect(fotosObrigatorias("desisti", { exige_fotos_vicio: true })).toBe(
      false,
    );
    expect(
      erroDoMotivo({
        motivo: "defeito",
        detalhe: "",
        quantidadeDeFotos: 0,
        janelas: todas,
        politica: POLITICA,
      }),
    ).toBe("Envie ao menos uma foto do problema no produto.");
    expect(
      erroDoMotivo({
        motivo: "defeito",
        detalhe: "",
        quantidadeDeFotos: 1,
        janelas: todas,
        politica: POLITICA,
      }),
    ).toBeNull();
    expect(
      erroDoMotivo({
        motivo: "outro",
        detalhe: "  ",
        quantidadeDeFotos: 0,
        janelas: todas,
        politica: POLITICA,
      }),
    ).toBe("Conte em poucas palavras o motivo da devolução.");
  });

  it("valor em centavos e frete de ida só quando o pedido volta inteiro", () => {
    const itens = [
      item(),
      item({
        order_item_id: "oi-2",
        quantidade: 1,
        disponivel: 1,
        valor_unitario: 0.1,
      }),
    ];
    expect(
      valorDaSelecao(
        itens,
        new Map([
          ["oi-1", 2],
          ["oi-2", 1],
        ]),
      ),
    ).toBe(199.9);
    expect(
      devolveFreteDeIda("arrependimento", itens, new Map([["oi-1", 2]])),
    ).toBe(false);
    expect(
      devolveFreteDeIda(
        "arrependimento",
        itens,
        new Map([
          ["oi-1", 2],
          ["oi-2", 1],
        ]),
      ),
    ).toBe(true);
    expect(
      devolveFreteDeIda(
        "troca",
        itens,
        new Map([
          ["oi-1", 2],
          ["oi-2", 1],
        ]),
      ),
    ).toBe(false);
    // O que já estava em devolução ativa conta para "o pedido todo".
    const jaParcial = [item({ ja_devolvida: 1, disponivel: 1 })];
    expect(devolveFreteDeIda("vicio", jaParcial, new Map([["oi-1", 1]]))).toBe(
      true,
    );
    expect(erroDosItens(new Map())).toBe(
      "Escolha ao menos um item para devolver.",
    );
  });

  it("caminho da foto começa pela pasta do usuário (a policy do bucket exige)", () => {
    expect(caminhoDaFoto("u-1", "o-1", "abc", "image/jpeg")).toBe(
      "u-1/o-1/abc.jpg",
    );
    expect(caminhoDaFoto("u-1", "o-1", "abc", "image/png")).toBe(
      "u-1/o-1/abc.png",
    );
  });
});

describe("linha do tempo, prazos e instruções", () => {
  it("nacional passa por 'A caminho'; recusada termina em etapa negativa", () => {
    expect(
      etapasDaDevolucao({
        status: "aprovada",
        metodo_retorno: "envio_proprio",
      }).map((e) => `${e.status}:${e.estado}`),
    ).toEqual([
      "solicitada:feita",
      "aprovada:atual",
      "em_transito:pendente",
      "recebida:pendente",
      "concluida:pendente",
    ]);
    expect(
      etapasDaDevolucao({ status: "recusada", metodo_retorno: "coleta" }).map(
        (e) => `${e.status}:${e.estado}`,
      ),
    ).toEqual(["solicitada:feita", "recusada:negativa"]);
    expect(
      etapasDaDevolucao({
        status: "concluida",
        metodo_retorno: "entrega_na_loja",
      }).every((e) => e.estado === "feita"),
    ).toBe(true);
  });

  it("datas do banco não escorregam de fuso e o prazo fala em dias", () => {
    expect(formatarDia("2026-10-01")).toBe("01/10/2026");
    const hoje = new Date(2026, 8, 29, 23, 30);
    expect(textoDoPrazo("2026-10-01", hoje)).toBe("faltam 2 dias");
    expect(textoDoPrazo("2026-09-29", hoje)).toBe("vence hoje");
    expect(textoDoPrazo("2026-09-27", hoje)).toBe("venceu há 2 dias");
  });

  it("instrução de entrega na loja traz endereço e horário", () => {
    const d = lerDevolucaoDetalhe({
      ...DETALHE_CRU,
      status: "aprovada",
      metodo_retorno: "entrega_na_loja",
    });
    expect(d).not.toBeNull();
    if (!d) return;
    const texto = instrucaoParaOCliente(d, {
      endereco: "Rua A, 10",
      horario: "Seg a Sex, 9h às 18h",
    });
    expect(texto).toContain("Rua A, 10");
    expect(texto).toContain("Seg a Sex, 9h às 18h");
  });
});
