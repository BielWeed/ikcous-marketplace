// "Loja pronta" (27/11/2026, decisão do sócio): a loja nova nasce com Pix,
// cartão e dinheiro na entrega ligados e com a entrega na cidade valendo R$ 10
// em 1 dia — e o checklist marcava "Como você recebe" e "Como você entrega"
// como FEITOS sem a lojista escolher nada. Agora, com a confirmação ainda
// vazia no banco (`entregaConfirmada`/`pagamentoConfirmado` === false), o passo
// fica pendente e diz, com os valores REAIS da loja, o que vale hoje. Coluna
// ausente (banco ainda sem a migration 20261652000000) = confirmado, igual a
// antes.
import {
  type ChaveDosSeisPassos,
  confirmacaoAoSalvarAEntrega,
  confirmacaoAoSalvarOPagamento,
  contagemDosPassos,
  entradaDosSeisPassos,
  proximoPasso,
  seisPassosDaLojaPronta,
  textoDaEntregaAConfirmar,
  textoDoRecebimentoAConfirmar,
} from "@/lib/loja-pronta";
import { describe, expect, it } from "vitest";

type Config = Parameters<typeof entradaDosSeisPassos>[0];
type Fatos = Parameters<typeof entradaDosSeisPassos>[1];

function passos(config: Partial<Config> = {}, fatos: Partial<Fatos> = {}) {
  return seisPassosDaLojaPronta(
    entradaDosSeisPassos(
      { originCep: "38500-000", ...config },
      {
        pixOk: false,
        formasNaEntrega: ["pix", "card", "cash"],
        produtos: [{ isActive: true, stock: 5 }],
        configCarregando: false,
        produtosCarregando: false,
        entrega: "feito",
        ...fatos,
      },
    ),
  );
}
const passo = (lista: ReturnType<typeof passos>, chave: ChaveDosSeisPassos) => {
  const achado = lista.find((p) => p.chave === chave);
  if (!achado) throw new Error(`sem o passo ${chave}`);
  return achado;
};

describe("Como você entrega: o que veio de fábrica pede confirmação", () => {
  it("loja nova (confirmação vazia) com o CEP 000: pendente, e diz o valor e o prazo de hoje", () => {
    const entrega = passo(passos({ entregaConfirmada: false }), "entrega");
    expect(entrega.estado).toBe("pendente");
    expect(entrega.rotuloPendente).toBe("Confirmar como você entrega");
    expect(entrega.aConfirmar).toBe(
      "Entrega na sua cidade: R$ 10,00, em 1 dia.",
    );
    expect(entrega.destino).toBe("admin-shipping");
  });

  it("confirmada: feito, sem pedido de confirmação", () => {
    const entrega = passo(passos({ entregaConfirmada: true }), "entrega");
    expect(entrega.estado).toBe("feito");
    expect(entrega.aConfirmar).toBeUndefined();
  });

  it("coluna ausente (banco sem a migration): vale confirmado, igual a hoje", () => {
    const entrega = passo(passos({}), "entrega");
    expect(entrega.estado).toBe("feito");
    expect(entrega.aConfirmar).toBeUndefined();
  });

  it("o texto usa os valores REAIS: taxa e prazo da loja, grátis e no mesmo dia", () => {
    expect(
      textoDaEntregaAConfirmar({ localDeliveryFee: 7.5, localDeliveryDays: 3 }),
    ).toBe("Entrega na sua cidade: R$ 7,50, em 3 dias.");
    expect(
      textoDaEntregaAConfirmar({ localDeliveryFee: 0, localDeliveryDays: 0 }),
    ).toBe("Entrega na sua cidade: grátis, no mesmo dia.");
    expect(
      textoDaEntregaAConfirmar({
        localDeliveryFee: 1234.5,
        localDeliveryDays: 1,
      }),
    ).toBe("Entrega na sua cidade: R$ 1.234,50, em 1 dia.");
    expect(textoDaEntregaAConfirmar({ localDeliveryEnabled: false })).toBe(
      "Na sua cidade: só retirada na loja.",
    );
    const entrega = passo(
      passos({
        entregaConfirmada: false,
        localDeliveryFee: 15,
        localDeliveryDays: 2,
      }),
      "entrega",
    );
    expect(entrega.aConfirmar).toBe(
      "Entrega na sua cidade: R$ 15,00, em 2 dias.",
    );
  });

  it("pendente por OUTRO motivo (sem CEP) continua 'Configurar a entrega', sem pedido de confirmação", () => {
    const entrega = passo(
      passos({ entregaConfirmada: false }, { entrega: "pendente" }),
      "entrega",
    );
    expect(entrega.estado).toBe("pendente");
    expect(entrega.rotuloPendente).toBe("Configurar a entrega");
    expect(entrega.aConfirmar).toBeUndefined();
  });

  it("ainda carregando: segue carregando (nunca vira pedido de confirmação)", () => {
    const entrega = passo(
      passos({ entregaConfirmada: false }, { entrega: "carregando" }),
      "entrega",
    );
    expect(entrega.estado).toBe("carregando");
    expect(entrega.aConfirmar).toBeUndefined();
  });
});

describe("Como você recebe: as formas de fábrica pedem confirmação", () => {
  it("loja nova: pendente, e lista as formas ligadas hoje", () => {
    const recebe = passo(passos({ pagamentoConfirmado: false }), "recebe");
    expect(recebe.estado).toBe("pendente");
    expect(recebe.rotuloPendente).toBe("Confirmar como você recebe");
    expect(recebe.aConfirmar).toBe(
      "Na entrega você aceita: Pix, cartão (maquininha) e dinheiro.",
    );
    expect(recebe.destino).toBe("admin-settings");
  });

  it("o PIX pelo app pronto NÃO dispensa a confirmação das formas na entrega", () => {
    const recebe = passo(
      passos({ pagamentoConfirmado: false }, { pixOk: true }),
      "recebe",
    );
    expect(recebe.estado).toBe("pendente");
    expect(recebe.aConfirmar).toBe(
      "Na entrega você aceita: Pix, cartão (maquininha) e dinheiro.",
    );
  });

  it("confirmado ou coluna ausente: feito", () => {
    expect(passo(passos({ pagamentoConfirmado: true }), "recebe").estado).toBe(
      "feito",
    );
    expect(passo(passos({}), "recebe").estado).toBe("feito");
    expect(passo(passos({}), "recebe").aConfirmar).toBeUndefined();
  });

  it("o texto segue as formas REAIS, na ordem de sempre", () => {
    expect(textoDoRecebimentoAConfirmar(["cash"])).toBe(
      "Na entrega você aceita: dinheiro.",
    );
    expect(textoDoRecebimentoAConfirmar(["cash", "pix"])).toBe(
      "Na entrega você aceita: Pix e dinheiro.",
    );
    expect(textoDoRecebimentoAConfirmar([])).toBe(
      "Você recebe só pelo app, no PIX.",
    );
  });

  it("sem PIX e sem forma na entrega segue 'Configurar como você recebe' (não é confirmação)", () => {
    const recebe = passo(
      passos({ pagamentoConfirmado: false }, { formasNaEntrega: [] }),
      "recebe",
    );
    expect(recebe.estado).toBe("pendente");
    expect(recebe.rotuloPendente).toBe("Configurar como você recebe");
    expect(recebe.aConfirmar).toBeUndefined();
  });
});

describe("a confirmação conta no 'N de 6' e vira o próximo passo", () => {
  it("as duas pendentes não contam como feitas (3 de 6, sem endereço) e entram na fila do próximo passo", () => {
    const lista = passos(
      {
        storeName: "Loja",
        logoUrl: "https://exemplo.test/l.png",
        whatsappNumber: "(34) 99999-9999",
        entregaConfirmada: false,
        pagamentoConfirmado: false,
      },
      {},
    );
    expect(contagemDosPassos(lista).feitos).toBe(3);
    expect(proximoPasso(lista)?.chave).toBe("endereco");
    expect(
      proximoPasso(lista.filter((p) => p.chave !== "endereco"))?.chave,
    ).toBe("recebe");
    const soAsConfirmacoes = lista.filter((p) => p.aConfirmar);
    expect(soAsConfirmacoes.map((p) => p.chave)).toEqual(["recebe", "entrega"]);
  });
});

describe("salvar Frete ou Pagamentos também confirma — só quando falta", () => {
  it("entrega: manda a confirmação só com a coluna presente e vazia", () => {
    expect(confirmacaoAoSalvarAEntrega({ entregaConfirmada: false })).toEqual({
      entregaConfirmada: true,
    });
    expect(confirmacaoAoSalvarAEntrega({ entregaConfirmada: true })).toEqual(
      {},
    );
    expect(confirmacaoAoSalvarAEntrega({})).toEqual({});
    expect(confirmacaoAoSalvarAEntrega(null)).toEqual({});
  });

  it("pagamento: idem", () => {
    expect(
      confirmacaoAoSalvarOPagamento({ pagamentoConfirmado: false }),
    ).toEqual({ pagamentoConfirmado: true });
    expect(
      confirmacaoAoSalvarOPagamento({ pagamentoConfirmado: true }),
    ).toEqual({});
    expect(confirmacaoAoSalvarOPagamento({})).toEqual({});
  });
});
