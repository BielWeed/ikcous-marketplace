import {
  formaDePagamentoDesligadaNaLoja,
  pagamentoIncompativelComFrete,
  primeiraFormaDePagamentoDisponivel,
} from "@/lib/guarda-de-frete";
// REGRA DO FRETE × PAGAMENTO (dono, 21/09/2026): o checkout deixava fechar
// compra com PIX/cartão/dinheiro NA ENTREGA para frete de TRANSPORTADORA
// (Melhor Envio/Frenet) de outra cidade — a transportadora não é a loja
// saindo com o troco. Envio por transportadora EXIGE pagamento antecipado
// ("online"); entrega local preserva as modalidades da loja.
//
// POR QUE UNIT E NÃO COMPONENTE (mesmo espírito da `finalizarBloqueadoPorFrete`,
// em finalizar-bloqueado-por-frete.test.ts): a matriz inteira (modalidade ×
// método × flag) discrimina em microsegundos sem montar o formulário de
// convidado; no componente, só os pares defeituosos dão sinal — e o par
// gratuito-externo nem chega a existir lá sem re-mockar a cotação.
//
// O CONTRATO DO ID (o que este arquivo também prova, pelo lado de quem
// chama): a modalidade se decide PELO ID da opção, nunca pelo preço nem
// pelo texto — "local-delivery" é local (grátis ou paga), qualquer outro id
// resolvível ("melhor-envio-*", "frenet-*", "free-shipping-promo") é
// transportadora. A guarda recebe o boolean já decidido; os casos abaixo
// nomeiam o id que produz cada boolean, o mesmo mapeamento de
// CheckoutView (`selectedShippingOption?.id === "local-delivery"`).
import { describe, expect, it } from "vitest";

type Metodo = "pix" | "card" | "cash" | "online";

const caso = (args: {
  idDaOpcao: string | null;
  paymentMethod: Metodo;
  pagamentoOnlineLigado: boolean;
}) => {
  const temOpcaoSelecionada = args.idDaOpcao !== null;
  const ehEntregaLocal = args.idDaOpcao === "local-delivery";
  return pagamentoIncompativelComFrete({
    temOpcaoSelecionada,
    ehEntregaLocal,
    paymentMethod: args.paymentMethod,
    pagamentoOnlineLigado: args.pagamentoOnlineLigado,
  });
};

describe("pagamentoIncompativelComFrete — transportadora exige antecipado", () => {
  // O BYPASS ORIGINAL da regra: dinheiro na entrega com correio de outra
  // cidade. É o par que este arquivo existe para matar.
  it("O DEFEITO: melhor-envio + cash -> TRAVADO", () => {
    expect(
      caso({
        idDaOpcao: "melhor-envio-CorreiosSedex",
        paymentMethod: "cash",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(true);
  });

  it("o mesmo bypass pelos outros meios na entrega: pix e card com melhor-envio -> TRAVADO", () => {
    for (const metodo of ["pix", "card"] as const) {
      expect(
        caso({
          idDaOpcao: "melhor-envio-CorreiosSedex",
          paymentMethod: metodo,
          pagamentoOnlineLigado: true,
        }),
      ).toBe(true);
      expect(
        caso({
          idDaOpcao: "frenet-SEDEX",
          paymentMethod: metodo,
          pagamentoOnlineLigado: true,
        }),
      ).toBe(true);
    }
  });

  it("transportadora + online -> LIVRE (antecipado é o que a regra pede)", () => {
    expect(
      caso({
        idDaOpcao: "melhor-envio-CorreiosSedex",
        paymentMethod: "online",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(false);
    expect(
      caso({
        idDaOpcao: "frenet-PAC",
        paymentMethod: "online",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(false);
  });

  // O GRATUITO EXTERNO ("free-shipping-promo", provider "free") é o id de
  // promoção de frete grátis que a edge calculate-shipping devolve no
  // caminho de TRANSPORTADORA: grátis de transportadora CONTINUA
  // transportadora — INDEPENDENTE DO PREÇO (o contrário de price 0 não
  // diz nada sobre quem entrega).
  it("gratuito EXTERNO (free-shipping-promo) continua transportadora: cash -> TRAVADO, online -> LIVRE", () => {
    expect(
      caso({
        idDaOpcao: "free-shipping-promo",
        paymentMethod: "cash",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(true);
    expect(
      caso({
        idDaOpcao: "free-shipping-promo",
        paymentMethod: "online",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(false);
  });

  // Price 0 não muda a classificação: o id é o contrato. Entrega local
  // GRÁTIS continua local (as três modalidades da loja intactas); frete de
  // transportadora com promoção a R$ 0 continua exigindo antecipado.
  it("price 0 NÃO decide nada: local-delivery grátis -> LIVRE; melhor-envio a R$ 0 + cash -> TRAVADO", () => {
    expect(
      caso({
        idDaOpcao: "local-delivery",
        paymentMethod: "cash",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(false);
    expect(
      caso({
        idDaOpcao: "melhor-envio-CorreiosPAC",
        paymentMethod: "cash",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(true);
  });

  it("entrega local preserva TODAS as modalidades da loja (pix/card/cash/online)", () => {
    for (const metodo of ["pix", "card", "cash", "online"] as const) {
      expect(
        caso({
          idDaOpcao: "local-delivery",
          paymentMethod: metodo,
          pagamentoOnlineLigado: true,
        }),
      ).toBe(false);
    }
  });

  it("sem opção selecionada -> LIVRE para qualquer método (a finalizarBloqueadoPorFrete é quem tranca)", () => {
    // Duas guardas não falam duas vezes: sem opção, a trava do Finalizar é
    // da guarda irmã (frete sem escolha), não desta.
    for (const metodo of ["pix", "card", "cash", "online"] as const) {
      expect(
        caso({
          idDaOpcao: null,
          paymentMethod: metodo,
          pagamentoOnlineLigado: true,
        }),
      ).toBe(false);
    }
  });

  // A FLAG TEM DE VALER para o estado STALE: "online" selecionado com a
  // flag DESLIGADA não é selecionável pela tela (a opção nem renderiza) —
  // só existe como estado velho de sessão (flag caiu no meio) ou payload
  // forjado. Um antecipado que não pode ser pago trava em QUALQUER
  // modalidade: local, transportadora e sem opção (o ramo de cima da
  // guarda olha o método ANTES da modalidade).
  it("'online' com a flag DESLIGADA (estado stale) -> TRAVADO em qualquer modalidade", () => {
    for (const idDaOpcao of [
      "local-delivery",
      "melhor-envio-CorreiosSedex",
      null,
    ] as const) {
      expect(
        caso({
          idDaOpcao,
          paymentMethod: "online",
          pagamentoOnlineLigado: false,
        }),
      ).toBe(true);
    }
  });

  // Para os métodos "na entrega" a flag não muda nada: com pagamento
  // online DESLIGADO o "online" nem aparece na tela, então transportadora
  // já está bloqueada de qualquer jeito (só resta pix/card/cash — todos
  // travados). É o que estabiliza a tela sem ping-pong com o efeito de
  // auto-seleção.
  it("flag desligada não muda o resultado dos meios na entrega: transportadora + cash -> TRAVADO; local + cash -> LIVRE", () => {
    expect(
      caso({
        idDaOpcao: "melhor-envio-CorreiosSedex",
        paymentMethod: "cash",
        pagamentoOnlineLigado: false,
      }),
    ).toBe(true);
    expect(
      caso({
        idDaOpcao: "local-delivery",
        paymentMethod: "cash",
        pagamentoOnlineLigado: false,
      }),
    ).toBe(false);
  });
});

// FORMAS DE PAGAMENTO POR LOJA (25/09/2026): o segundo eixo de travamento do
// Finalizar — a loja desligou UMA forma "na entrega" (pix/card/cash) que
// não é mais selecionável, mas o estado (`paymentMethod`) ainda aponta para
// ela (corrida entre a tela filtrar as opções e o clique chegar ao banco, ou
// estado velho de sessão). "online" nunca entra aqui — é inteiramente da
// guarda irmã (`pagamentoIncompativelComFrete`, acima).
describe("formaDePagamentoDesligadaNaLoja — a loja desligou a forma selecionada", () => {
  it("pix selecionado, mas a loja só aceita card/cash -> TRAVADO", () => {
    expect(
      formaDePagamentoDesligadaNaLoja({
        paymentMethod: "pix",
        formasNaEntrega: ["card", "cash"],
      }),
    ).toBe(true);
  });

  it("pix selecionado e a loja aceita pix -> LIVRE", () => {
    expect(
      formaDePagamentoDesligadaNaLoja({
        paymentMethod: "pix",
        formasNaEntrega: ["pix", "card", "cash"],
      }),
    ).toBe(false);
  });

  it("a loja desligou TODAS as formas na entrega ([]) -> qualquer uma delas TRAVA", () => {
    for (const metodo of ["pix", "card", "cash"] as const) {
      expect(
        formaDePagamentoDesligadaNaLoja({
          paymentMethod: metodo,
          formasNaEntrega: [],
        }),
      ).toBe(true);
    }
  });

  it("'online' NUNCA trava por aqui — mesmo com formasNaEntrega vazia, é a guarda irmã quem decide", () => {
    expect(
      formaDePagamentoDesligadaNaLoja({
        paymentMethod: "online",
        formasNaEntrega: [],
      }),
    ).toBe(false);
  });
});

// A ORDEM DE FALLBACK quando o método selecionado deixa de estar disponível
// (checkout, brief 25/09/2026): online primeiro quando logado e ligado —
// senão a primeira das formas na entrega ainda disponíveis, na ordem em que
// a loja as tem (pix, card, cash é a ordem canônica que o servidor
// preserva). `null` quando NENHUMA das duas existe: convidado numa loja só
// "online" (mostra o aviso de login) ou loja genuinamente sem forma nenhuma
// (o invariante do banco já deveria impedir — defesa em profundidade).
describe("primeiraFormaDePagamentoDisponivel — a ordem do fallback", () => {
  it("logado + online ligado -> 'online', mesmo com pix/card/cash também disponíveis", () => {
    expect(
      primeiraFormaDePagamentoDisponivel({
        formasNaEntrega: ["pix", "card", "cash"],
        pagamentoOnlineLigado: true,
        logado: true,
      }),
    ).toBe("online");
  });

  it("logado + online DESLIGADO -> primeira das formas na entrega", () => {
    expect(
      primeiraFormaDePagamentoDisponivel({
        formasNaEntrega: ["card", "cash"],
        pagamentoOnlineLigado: false,
        logado: true,
      }),
    ).toBe("card");
  });

  it("CONVIDADO nunca recebe 'online', mesmo com a flag ligada (online exige conta)", () => {
    expect(
      primeiraFormaDePagamentoDisponivel({
        formasNaEntrega: ["cash"],
        pagamentoOnlineLigado: true,
        logado: false,
      }),
    ).toBe("cash");
  });

  it("convidado numa loja SÓ 'online' (formasNaEntrega vazia) -> null (mostra o aviso de login, nunca 'online')", () => {
    expect(
      primeiraFormaDePagamentoDisponivel({
        formasNaEntrega: [],
        pagamentoOnlineLigado: true,
        logado: false,
      }),
    ).toBe(null);
  });

  it("logado, online desligado, formasNaEntrega vazia -> null (loja sem forma nenhuma; o invariante do banco já deveria impedir)", () => {
    expect(
      primeiraFormaDePagamentoDisponivel({
        formasNaEntrega: [],
        pagamentoOnlineLigado: false,
        logado: true,
      }),
    ).toBe(null);
  });

  it("respeita a ORDEM da lista (o servidor preserva a ordem que o front manda)", () => {
    expect(
      primeiraFormaDePagamentoDisponivel({
        formasNaEntrega: ["cash", "pix"],
        pagamentoOnlineLigado: false,
        logado: true,
      }),
    ).toBe("cash");
  });
});
