import type { View } from "@/types";
import type { PoliticaDevolucao } from "@/types/devolucao";

// Textos das três páginas que a cliente precisa achar ANTES de comprar ou
// cadastrar: Termos de uso, Política de Privacidade e Trocas e devoluções
// (LGPD e Código de Defesa do Consumidor).
//
// FONTE ÚNICA: a página (`PoliticaDaLojaView`) e a folha que abre no
// checkout, no produto e no cadastro desenham EXATAMENTE estes blocos —
// nenhuma tela escreve texto jurídico por conta própria.
//
// O que cada texto afirma foi conferido no código (não é modelo genérico):
// - dados pedidos: cadastro (nome, WhatsApp, CPF opcional, e-mail, senha),
//   endereço de entrega e, para transportadora, o CPF de quem recebe;
// - pagamento pelo app: Mercado Pago; na entrega/retirada: combinado com a loja;
// - frete: calculado pelo CEP; o CEP digitado é consultado em serviços de CEP;
// - não há rastreador de publicidade no app da cliente.
// A lojista PODE e DEVE revisar: o texto-base é honesto sobre o que o app faz,
// mas só ela sabe o CNPJ, o prazo de guarda e quem responde pelos dados.

/** As três páginas, na ordem em que aparecem nos links. */
export const TIPOS_DE_POLITICA = ["termos", "privacidade", "trocas"] as const;
export type TipoDePolitica = (typeof TIPOS_DE_POLITICA)[number];

export interface SecaoDeTexto {
  readonly id: string;
  readonly titulo: string;
  readonly paragrafos: readonly string[];
}

export interface DocumentoDePolitica {
  readonly tipo: TipoDePolitica;
  readonly titulo: string;
  readonly resumo: string;
  readonly secoes: readonly SecaoDeTexto[];
}

export interface DadosDaLoja {
  readonly nome: string;
}

/** Nome que a cliente lê no link e no título de cada página. */
export const NOME_DA_POLITICA: Readonly<Record<TipoDePolitica, string>> = {
  termos: "Termos de uso",
  privacidade: "Política de Privacidade",
  trocas: "Trocas e devoluções",
};

/** A tela (`View`) de cada página: é por ela que o rodapé da vitrine navega. */
export const VIEW_DA_POLITICA: Readonly<Record<TipoDePolitica, View>> = {
  termos: "terms",
  privacidade: "privacy",
  trocas: "returns-policy",
};

/** Quando não há política carregada, vale o mínimo do CDC art. 49. */
const ARREPENDIMENTO_MINIMO_DIAS = 7;

// TEXTO-BASE: a lojista deve revisar
function montarTermos(loja: DadosDaLoja): DocumentoDePolitica {
  return {
    tipo: "termos",
    titulo: NOME_DA_POLITICA.termos,
    resumo: `As regras para usar o app e comprar na ${loja.nome}.`,
    secoes: [
      {
        id: "quem-somos",
        titulo: "Quem vende",
        paragrafos: [
          `Este app é a loja virtual da ${loja.nome}. Ao criar uma conta, navegar ou fazer um pedido por aqui, você concorda com estes termos.`,
        ],
      },
      {
        id: "sua-conta",
        titulo: "Sua conta",
        paragrafos: [
          "Para pagar pelo app é preciso entrar na sua conta. Os dados que você informa (nome, WhatsApp, e-mail, endereço) precisam ser verdadeiros e estar atualizados, porque é com eles que o pedido é entregue.",
          "A senha é só sua. Quem entra com a sua senha faz pedidos em seu nome; avise a loja se achar que alguém usou a sua conta.",
        ],
      },
      {
        id: "produtos-e-precos",
        titulo: "Produtos e preços",
        paragrafos: [
          "Fotos e descrições mostram o produto da melhor forma possível, mas pequenas diferenças de cor e tela podem existir.",
          "Preço, estoque e frete podem mudar. Vale o que aparece no carrinho quando você finaliza o pedido.",
        ],
      },
      {
        id: "pagamento",
        titulo: "Pagamento",
        paragrafos: [
          "Quando você paga pelo app (Pix ou cartão), o pagamento é processado pelo Mercado Pago. O pedido só conta como pago depois que o Mercado Pago confirma o pagamento.",
          "Quando a loja oferece pagamento na entrega ou na retirada, a forma de pagar é a que aparece no checkout.",
        ],
      },
      {
        id: "entrega",
        titulo: "Entrega e frete",
        paragrafos: [
          "O valor e o prazo do frete são calculados pelo CEP de entrega, no carrinho e no checkout. Confira o endereço antes de finalizar: endereço errado pode atrasar ou impedir a entrega.",
        ],
      },
      {
        id: "trocas",
        titulo: "Trocas e devoluções",
        paragrafos: [
          "As regras de arrependimento, troca e defeito estão na página Trocas e devoluções, que faz parte destes termos.",
        ],
      },
      {
        id: "mudancas",
        titulo: "Mudanças nestes termos",
        paragrafos: [
          "A loja pode atualizar estes termos. Vale a versão que está publicada no app no momento do seu pedido.",
        ],
      },
      {
        id: "contato",
        titulo: "Dúvidas",
        paragrafos: [
          "Para falar sobre estes termos ou sobre um pedido, use o contato da loja que aparece no fim desta página.",
        ],
      },
    ],
  };
}

// TEXTO-BASE: a lojista deve revisar
function montarPrivacidade(loja: DadosDaLoja): DocumentoDePolitica {
  return {
    tipo: "privacidade",
    titulo: NOME_DA_POLITICA.privacidade,
    resumo: `Quais dados a ${loja.nome} guarda de você, para quê, e como pedir para corrigir ou apagar.`,
    secoes: [
      {
        id: "quem-cuida",
        titulo: "Quem cuida dos seus dados",
        paragrafos: [
          `A ${loja.nome} é quem decide como os dados deste app são usados (a "controladora" na Lei Geral de Proteção de Dados, a LGPD). Fale com a loja pelo contato que aparece no fim desta página.`,
        ],
      },
      {
        id: "que-dados",
        titulo: "Que dados pedimos",
        paragrafos: [
          "No cadastro: nome, WhatsApp, e-mail e senha. O CPF é opcional no cadastro e pode ser pedido na compra, por exemplo quando o envio é por transportadora.",
          "Na compra: endereço de entrega, itens do pedido, forma de pagamento escolhida e o andamento do pedido.",
          "Se você permitir as notificações, guardamos o identificador do seu aparelho para poder avisar você.",
        ],
      },
      {
        id: "para-que",
        titulo: "Para que usamos",
        paragrafos: [
          "Para processar e entregar o seu pedido, avisar sobre o andamento dele, atender dúvidas, trocas e devoluções e cumprir obrigações legais da loja, como as fiscais.",
          "Se você permitir as notificações, também avisamos sobre pedidos e novidades da loja. Você pode desligar quando quiser, nas configurações do aparelho ou do navegador.",
        ],
      },
      {
        id: "com-quem",
        titulo: "Com quem dividimos",
        paragrafos: [
          "Só o necessário para a compra acontecer: o Mercado Pago, que processa o pagamento feito pelo app; os serviços de frete e transportadoras, que recebem nome, endereço, WhatsApp e, quando exigido, o CPF de quem recebe; e os serviços de hospedagem e banco de dados que mantêm o app no ar. O CEP que você digita também é consultado em serviços de busca de CEP.",
          "A loja não vende os seus dados.",
        ],
      },
      {
        id: "seus-direitos",
        titulo: "Seus direitos",
        paragrafos: [
          "Pela LGPD, você pode pedir à loja: confirmar que guardamos dados seus, ver quais são, corrigir o que estiver errado e pedir a exclusão do que não precisamos manter. Nome, WhatsApp e endereços você mesma corrige no seu Perfil.",
          "Para pedir a exclusão da conta ou dos dados, fale com a loja pelo contato no fim desta página. Alguns dados, como os de pedidos já feitos, podem ter de ser mantidos por obrigação legal.",
        ],
      },
      {
        id: "seguranca",
        titulo: "Segurança e prazo",
        paragrafos: [
          "Os dados ficam em serviços com acesso protegido e só a equipe da loja que precisa deles para atender você os vê. Guardamos os dados enquanto a sua conta existir e pelo tempo que a lei exigir.",
        ],
      },
      {
        id: "mudancas",
        titulo: "Mudanças nesta política",
        paragrafos: [
          "Se esta política mudar, a versão nova fica publicada aqui no app.",
        ],
      },
    ],
  };
}

function paragrafosDe(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);
}

function listaEmTexto(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

// TEXTO-BASE: a lojista deve revisar
function montarTrocas(
  loja: DadosDaLoja,
  politica: PoliticaDevolucao | null,
): DocumentoDePolitica {
  const secoes: SecaoDeTexto[] = [];

  if (!politica) {
    // Sem a política da loja (ainda carregando ou fora do ar) só se afirma o
    // que a lei garante em qualquer loja. Prazo de troca e de defeito são
    // decisão da lojista e não se inventam aqui.
    secoes.push(
      {
        id: "arrependimento",
        titulo: "Desistir da compra",
        paragrafos: [
          `Compras feitas pelo app podem ser desfeitas em até ${ARREPENDIMENTO_MINIMO_DIAS} dias corridos depois que você recebe o produto, sem precisar dizer o motivo (Código de Defesa do Consumidor, art. 49).`,
        ],
      },
      {
        id: "outros-prazos",
        titulo: "Troca e produto com defeito",
        paragrafos: [
          `Os prazos de troca e de defeito dependem das regras da ${loja.nome}. Para saber os prazos e as condições, fale com a loja pelo contato no fim desta página.`,
        ],
      },
    );
  } else {
    const reembolso =
      politica.reembolso_momento === "apos_inspecao"
        ? "O reembolso sai depois que a loja confere o produto devolvido."
        : "O reembolso sai assim que a loja recebe o produto de volta.";
    secoes.push({
      id: "arrependimento",
      titulo: "Desistir da compra",
      paragrafos: [
        `Compras feitas pelo app podem ser desfeitas em até ${politica.prazo_arrependimento_dias} dias corridos depois que você recebe o produto, sem precisar dizer o motivo (Código de Defesa do Consumidor, art. 49).`,
        reembolso,
      ],
    });

    if (politica.aceita_troca && politica.prazo_troca_dias > 0) {
      const troca = [
        `Você pode trocar por outro tamanho, cor ou modelo em até ${politica.prazo_troca_dias} dias depois de receber. O produto precisa voltar em boas condições.`,
        politica.frete_troca_pago_por === "loja"
          ? "O frete da troca é pago pela loja."
          : "O frete da troca é pago por você.",
      ];
      if (politica.aceita_vale) {
        troca.push("A loja também aceita transformar a devolução em vale.");
      }
      secoes.push({ id: "troca", titulo: "Troca", paragrafos: troca });
    } else {
      secoes.push({
        id: "troca",
        titulo: "Troca",
        paragrafos: [
          `A ${loja.nome} não faz troca por preferência (tamanho, cor ou modelo). Continuam valendo a desistência da compra e o produto com defeito.`,
        ],
      });
    }

    const defeito = [
      `Produto com defeito, danificado no transporte, errado ou diferente do anunciado: você tem até ${politica.prazo_vicio_dias} dias depois de receber para avisar a loja.`,
    ];
    if (politica.exige_fotos_vicio) {
      defeito.push("Envie fotos do problema ao fazer o pedido.");
    }
    secoes.push({
      id: "defeito",
      titulo: "Produto com defeito",
      paragrafos: defeito,
    });

    const categorias = politica.categorias_sem_troca
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (categorias.length > 0) {
      secoes.push({
        id: "sem-troca",
        titulo: "Sem troca por preferência",
        paragrafos: [
          `Estes itens não têm troca por preferência: ${listaEmTexto(categorias)}.`,
        ],
      });
    }
  }

  secoes.push({
    id: "como-pedir",
    titulo: "Como pedir",
    paragrafos: [
      "Depois que o pedido for entregue, entre na sua conta, abra o pedido em Meus pedidos e toque em Solicitar devolução ou troca. Você recebe um protocolo e acompanha o andamento ali mesmo.",
    ],
  });

  const enderecoDaLoja = politica?.endereco_devolucao?.trim();
  if (enderecoDaLoja) {
    secoes.push({
      id: "endereco",
      titulo: "Onde entregar o produto devolvido",
      paragrafos: [enderecoDaLoja],
    });
  }

  const regrasDaLoja = politica?.texto_politica?.trim();
  if (regrasDaLoja) {
    secoes.push({
      id: "regras-da-loja",
      titulo: `Regras da ${loja.nome}`,
      paragrafos: paragrafosDe(regrasDaLoja),
    });
  }

  return {
    tipo: "trocas",
    titulo: NOME_DA_POLITICA.trocas,
    resumo: `Como desistir, trocar ou devolver um pedido da ${loja.nome}.`,
    secoes,
  };
}

/** Monta o documento do tipo pedido. `politica` só pesa em `trocas`. */
export function montarPolitica(
  tipo: TipoDePolitica,
  loja: DadosDaLoja,
  politica: PoliticaDevolucao | null,
): DocumentoDePolitica {
  switch (tipo) {
    case "termos":
      return montarTermos(loja);
    case "privacidade":
      return montarPrivacidade(loja);
    case "trocas":
      return montarTrocas(loja, politica);
  }
}

/** O documento inteiro numa string só (testes e leitores de tela de verificação). */
export function textoCorrido(doc: DocumentoDePolitica): string {
  return [
    doc.titulo,
    doc.resumo,
    ...doc.secoes.flatMap((s) => [s.titulo, ...s.paragrafos]),
  ].join("\n");
}
