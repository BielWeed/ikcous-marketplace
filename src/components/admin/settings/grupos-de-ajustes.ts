import { NOMES_DO_PAINEL, type TelaDoPainel } from "@/config/nomes-do-painel";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import {
  type ChaveDosSeisPassos,
  type ConfigDosSeisPassos,
  type EstadoDoItem,
  entradaDosSeisPassos,
  estadoDaEntrega,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
import { type ConfigDaEntrega, statusDaEntrega } from "@/lib/status-da-entrega";

// Os seis grupos da tela de Ajustes (painel simples, spec 2026-10-09 §3),
// declarados UMA vez. A tela (AdminSettingsView) desenha os grupos e a ajuda
// da mesma tela lista os mesmos grupos lendo ESTA constante: se um grupo
// entrar, sair ou mudar de nome, tela e ajuda mudam juntas (era o texto
// "três grupos" escrito à mão que apodrecia).
//
// As portas de dentro dos grupos são as de PORTAS_DO_PAINEL.ajustes, com o
// nome de NOMES_DO_PAINEL; o teste confere que nenhuma se perde nem repete.
// Os acordeões (Transportadoras, Formas de pagamento, Mercado Pago, Trocas e
// devoluções, Minha loja está no ar?, Consultas de frete) não são portas:
// continuam sendo montados pela tela dentro do grupo de cada um.

export type ChaveDoGrupoDeAjustes =
  | "minha-loja"
  | "aparencia"
  | "entrega"
  | "pagamentos"
  | "devolucao"
  | "ferramentas";

export interface PortaDoGrupoDeAjustes {
  readonly tela: TelaDoPainel;
  /** Linha curta sob o nome da porta, no cartão. */
  readonly descricao: string;
}

export interface GrupoDeAjustes {
  readonly chave: ChaveDoGrupoDeAjustes;
  readonly titulo: string;
  /** O que o grupo traz, em uma ou duas frases — texto da ajuda. */
  readonly ajuda: string;
  /** Cartões-porta que abrem outra tela do painel (vazio = só acordeões). */
  readonly portas: readonly PortaDoGrupoDeAjustes[];
}

export const GRUPOS_DE_AJUSTES: readonly GrupoDeAjustes[] = [
  {
    chave: "minha-loja",
    titulo: NOMES_DO_PAINEL["admin-about-store"],
    ajuda:
      "Nome, logo, cores, endereço, horário de atendimento e a descrição da loja — tudo editado numa única tela.",
    portas: [
      {
        tela: "admin-about-store",
        descricao: "Marca, endereço, horário e descrição",
      },
    ],
  },
  {
    chave: "aparencia",
    titulo: "Aparência do app",
    ajuda:
      "Os Banners (artes, links e agendamentos) e as Vitrines (títulos, ordem e ativação) que a cliente vê no app.",
    portas: [
      { tela: "admin-banners", descricao: "Artes, links e agendamentos" },
      { tela: "admin-carousels", descricao: "Títulos, ordem e ativação" },
    ],
  },
  {
    chave: "entrega",
    titulo: NOMES_DO_PAINEL["admin-shipping"],
    ajuda:
      "A tela de Entrega e frete (frete local, nacional e retirada) e, aqui mesmo, as Transportadoras: a escolha da transportadora e o token da integração — ajuste raro, feito uma vez.",
    portas: [
      {
        tela: "admin-shipping",
        descricao: "Frete local, nacional e retirada na loja",
      },
    ],
  },
  {
    chave: "pagamentos",
    titulo: "Pagamentos",
    ajuda:
      "O que a loja aceita na entrega e as chaves do Mercado Pago para receber pelo app, com teste de conexão.",
    portas: [],
  },
  {
    chave: "devolucao",
    titulo: "Regras de troca e devolução",
    ajuda:
      "Prazos, formas de devolver e o texto da política que a cliente lê antes de comprar.",
    portas: [],
  },
  {
    chave: "ferramentas",
    titulo: "Ferramentas",
    ajuda:
      "A Conexão (online ou offline) da loja neste aparelho; Minha loja está no ar? — o termômetro do pagamento por PIX com o diagnóstico completo e a medição de latência com o banco de dados — e as Consultas de frete, o histórico das cotações já feitas à transportadora ativa.",
    portas: [],
  },
];

// ── O subtítulo de status de cada grupo (painel simples, E5) ────────────────
//
// O cartão "Como está sua loja" (4 indicadores) saiu de Ajustes: o estado
// agora mora numa linha sob o título do grupo, calculada pela MESMA função dos
// seis passos do Início (`loja-pronta.ts`) — "Falta: WhatsApp", "Na entrega +
// PIX". Regra escrita em dois lugares diverge (lição #53), então aqui só se
// ESCOLHE qual passo fala por qual grupo e como o texto se escreve.
//
//   minha-loja  → marca + endereço + WhatsApp: "Falta: …" ou "Tudo preenchido"
//   entrega     → o passo "entrega": "Falta: CEP da loja" ou o resumo da cidade e do país
//   pagamentos  → o passo "recebe": o que está ativo, ou "Falta: Como você recebe"
//   aparencia, devolucao, ferramentas → sem passo próprio: sem subtítulo
//
// Passo `carregando` não chuta: o grupo fica SEM subtítulo. Na entrega isso
// vale enquanto a leitura das transportadoras não chegou — e, se ela falhar,
// continua sem subtítulo até a seção de Transportadoras reler.

/** Os três níveis do PIX pelo app em Ajustes (o mesmo do termômetro). */
export type NivelDoPixEmAjustes = "ok" | "alerta" | "off";

export interface EntradaDosSubtitulos {
  /** A config da loja já carregada (a tela só desenha os grupos com ela). */
  readonly config: ConfigDosSeisPassos & ConfigDaEntrega;
  /** `formasPagamentoNaEntregaValidas(config.formasPagamentoEntrega)`. */
  readonly formasNaEntrega: readonly FormaDePagamentoNaEntrega[];
  /** PIX pelo app: funcionando, ligado sem chave, ou desligado. */
  readonly nivelDoPix: NivelDoPixEmAjustes;
  /**
   * Nomes das transportadoras com cotação REAL ligada (chave salva e, quando
   * o provedor exige, e-mail de contato válido) — o que Ajustes já leu para o
   * acordeão de Transportadoras. `null` = a leitura ainda não chegou (ou
   * falhou): com cobertura nacional a entrega fica SEM subtítulo (nada de
   * "a confirmar"), até a seção de Transportadoras reler.
   */
  readonly nomesLigados: readonly string[] | null;
}

interface EntregaEmAjustes {
  readonly estado: EstadoDoItem;
  /** "Falta: CEP da loja", quando `pendente`; o resumo curto, quando `feito`. */
  readonly texto: string;
}

// O fato "entrega" dos seis passos vem de `estadoDaEntrega` (loja-pronta.ts),
// a MESMA regra do cartão do Início: pronta = CEP completo da loja. O texto do
// subtítulo, esse sim, usa o que Ajustes TEM em mãos (nenhuma chamada nova):
// `statusDaEntrega` diz a cidade e o país. Sem transportadora o passo continua
// feito (a entrega na cidade já funciona) e o texto avisa "Sem transportadora".
function entregaEmAjustes(
  config: ConfigDaEntrega,
  nomesLigados: readonly string[] | null,
): EntregaEmAjustes {
  const estado = estadoDaEntrega(config, false);
  if (estado === "pendente") {
    return { estado, texto: "Falta: CEP da loja" };
  }
  const soNaCidade = (config.shippingCoverage || "national") === "local";
  if (nomesLigados === null && !soNaCidade) {
    return { estado, texto: "" };
  }
  const [local, nacional] = statusDaEntrega({
    config,
    credsErro: nomesLigados === null,
    nomesLigados: nomesLigados ?? [],
  });
  return { estado, texto: `${local.valor} · ${nacional.valor}` };
}

function textoDoRecebimento(
  formasNaEntrega: readonly FormaDePagamentoNaEntrega[],
  nivelDoPix: NivelDoPixEmAjustes,
): string {
  const naEntrega = formasNaEntrega.length > 0 ? "Na entrega" : null;
  if (nivelDoPix === "ok") return naEntrega ? `${naEntrega} + PIX` : "PIX";
  // Ligado sem a chave pública: o PIX está QUEBRADO, não "ativo" — a mesma
  // verdade do termômetro. (Sem forma na entrega o passo nem chega aqui:
  // ele é pendente.)
  if (nivelDoPix === "alerta") return `${naEntrega ?? ""} · PIX sem chave`;
  return naEntrega ?? "";
}

/**
 * O subtítulo de status de cada grupo que tem um. Grupo ausente do mapa =
 * sem subtítulo. Lido com `.get` (índice de variável acorda o
 * object-injection do eslint).
 */
export function subtitulosDosGrupos(
  entrada: EntradaDosSubtitulos,
): ReadonlyMap<ChaveDoGrupoDeAjustes, string> {
  const { config, formasNaEntrega, nivelDoPix, nomesLigados } = entrada;
  const entrega = entregaEmAjustes(config, nomesLigados);
  const passos = seisPassosDaLojaPronta(
    entradaDosSeisPassos(config, {
      pixOk: nivelDoPix === "ok",
      formasNaEntrega,
      // Os dois passos que Ajustes não lê: produto fica de fora da conta.
      produtos: [],
      produtosCarregando: true,
      configCarregando: false,
      entrega: entrega.estado,
    }),
  );
  const passo = (chave: ChaveDosSeisPassos) =>
    passos.find((p) => p.chave === chave);

  const subtitulos = new Map<ChaveDoGrupoDeAjustes, string>();

  const daLoja = [passo("marca"), passo("endereco"), passo("whatsapp")].filter(
    (p) => p !== undefined,
  );
  const faltam = daLoja.filter((p) => p.estado === "pendente");
  if (faltam.length > 0) {
    subtitulos.set(
      "minha-loja",
      `Falta: ${faltam.map((p) => p.rotulo).join(", ")}`,
    );
  } else if (daLoja.every((p) => p.estado === "feito")) {
    subtitulos.set("minha-loja", "Tudo preenchido");
  }

  const passoEntrega = passo("entrega");
  if (passoEntrega?.estado === "pendente" || passoEntrega?.estado === "feito") {
    subtitulos.set("entrega", entrega.texto);
  }

  const recebe = passo("recebe");
  if (recebe?.estado === "pendente") {
    subtitulos.set("pagamentos", `Falta: ${recebe.rotulo}`);
  } else if (recebe?.estado === "feito") {
    subtitulos.set(
      "pagamentos",
      textoDoRecebimento(formasNaEntrega, nivelDoPix),
    );
  }

  return subtitulos;
}
