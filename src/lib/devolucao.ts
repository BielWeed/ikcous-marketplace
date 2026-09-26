/**
 * DEVOLUÇÃO/TROCA — regras PURAS do front (sem rede, sem React).
 *
 * Contrato: `docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md`
 * (seção "Devoluções") e a migration
 * `20261175000000_a_devolucao_nasce_no_pedido.sql`. O SERVIDOR decide tipo,
 * prazo, métodos e valores; aqui só se espelha o que a tela precisa para não
 * oferecer um caminho que a RPC vai recusar — e, quando ela recusa mesmo
 * assim, a mensagem dela aparece como veio (é pt-BR escrita para o leigo).
 *
 * Os rótulos moram em `Map` (e não em objeto indexado por chave dinâmica)
 * pela mesma razão do resto do painel: `security/detect-object-injection`.
 */
import { formatCurrency } from "@/lib/utils";
import type {
  AtorDoEvento,
  CondicaoItemDevolvido,
  ContagemPorStatus,
  DevolucaoDetalhe,
  ElegibilidadeDevolucao,
  EventoDevolucao,
  ItemDevolvido,
  ItemElegivel,
  JanelasDeDevolucao,
  LinhaDevolucaoAdmin,
  ListaDevolucoesAdmin,
  MetodoDevolucao,
  ModalidadeDevolucao,
  MotivoDevolucao,
  PedidoDaDevolucao,
  PoliticaDevolucao,
  ResolucaoDevolucao,
  ResultadoConclusao,
  ResultadoDeStatus,
  ResultadoEtiquetaReversa,
  ResultadoSolicitacao,
  ResumoDevolucao,
  StatusDevolucao,
  TipoDevolucao,
} from "@/types/devolucao";

// ---------------------------------------------------------------------------
// Vocabulário fechado (os CHECKs do banco)
// ---------------------------------------------------------------------------

/** Ordem dos chips do painel: primeiro o que pede ação, depois os finais. */
export const STATUS_EM_ORDEM: readonly StatusDevolucao[] = [
  "solicitada",
  "aprovada",
  "em_transito",
  "recebida",
  "concluida",
  "recusada",
  "cancelada",
  "reprovada",
];

/** Os quatro estados em andamento (o índice único do banco usa os mesmos). */
export const STATUS_ABERTOS: readonly StatusDevolucao[] = [
  "solicitada",
  "aprovada",
  "em_transito",
  "recebida",
];

const TIPOS: readonly TipoDevolucao[] = ["arrependimento", "vicio", "troca"];

/** Motivos de PROBLEMA no produto — viram tipo `vicio` no servidor. */
export const MOTIVOS_DE_PROBLEMA: readonly MotivoDevolucao[] = [
  "defeito",
  "avariado_no_transporte",
  "produto_errado",
  "faltando_peca",
  "diferente_do_anuncio",
];

/** Os motivos agrupados como o cliente pensa neles. */
export const GRUPOS_DE_MOTIVO: ReadonlyArray<{
  titulo: string;
  motivos: readonly MotivoDevolucao[];
}> = [
  {
    titulo: "Não serviu / mudei de ideia",
    motivos: [
      "tamanho_pequeno",
      "tamanho_grande",
      "nao_gostei",
      "cor_diferente",
      "desisti",
    ],
  },
  { titulo: "Problema com o produto", motivos: MOTIVOS_DE_PROBLEMA },
  { titulo: "Outro", motivos: ["outro"] },
];

const MOTIVOS: readonly MotivoDevolucao[] = GRUPOS_DE_MOTIVO.flatMap(
  (grupo) => grupo.motivos,
);

const RESOLUCOES: readonly ResolucaoDevolucao[] = [
  "reembolso",
  "troca",
  "vale",
];

export const METODOS_LOCAIS: readonly MetodoDevolucao[] = [
  "entrega_na_loja",
  "coleta",
];
export const METODOS_NACIONAIS: readonly MetodoDevolucao[] = [
  "etiqueta_reversa",
  "envio_proprio",
];
const METODOS: readonly MetodoDevolucao[] = [
  ...METODOS_LOCAIS,
  ...METODOS_NACIONAIS,
];

export const CONDICOES: readonly CondicaoItemDevolvido[] = [
  "nova",
  "usada",
  "danificada",
  "ausente",
];

const ATORES: readonly AtorDoEvento[] = ["cliente", "loja", "sistema"];

/** Limites do bucket `devolucoes` e da RPC. */
export const MAXIMO_DE_FOTOS = 6;
export const TAMANHO_MAXIMO_DA_FOTO = 5 * 1024 * 1024;
export const TIPOS_DE_FOTO: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** Mínimos legais que o painel não deixa o lojista furar (CHECK do banco). */
export const MINIMO_ARREPENDIMENTO_DIAS = 7;
export const MINIMO_VICIO_DIAS = 30;

// ---------------------------------------------------------------------------
// Rótulos pt-BR
// ---------------------------------------------------------------------------

const ROTULO_STATUS = new Map<StatusDevolucao, string>([
  ["solicitada", "Solicitada"],
  ["aprovada", "Aprovada"],
  ["recusada", "Recusada"],
  ["cancelada", "Cancelada"],
  ["em_transito", "A caminho"],
  ["recebida", "Recebida"],
  ["concluida", "Concluída"],
  ["reprovada", "Reprovada"],
]);

const ROTULO_STATUS_PLURAL = new Map<StatusDevolucao, string>([
  ["solicitada", "Solicitadas"],
  ["aprovada", "Aprovadas"],
  ["recusada", "Recusadas"],
  ["cancelada", "Canceladas"],
  ["em_transito", "A caminho"],
  ["recebida", "Recebidas"],
  ["concluida", "Concluídas"],
  ["reprovada", "Reprovadas"],
]);

const TITULO_STATUS_CLIENTE = new Map<StatusDevolucao, string>([
  ["solicitada", "Pedido de devolução enviado"],
  ["aprovada", "Devolução aprovada"],
  ["recusada", "Devolução não aprovada"],
  ["cancelada", "Devolução cancelada"],
  ["em_transito", "Produto a caminho da loja"],
  ["recebida", "A loja recebeu o produto"],
  ["concluida", "Devolução concluída"],
  ["reprovada", "Produto não aceito na inspeção"],
]);

const ROTULO_TIPO = new Map<TipoDevolucao, string>([
  ["arrependimento", "Arrependimento"],
  ["vicio", "Problema no produto"],
  ["troca", "Troca"],
]);

const ROTULO_MOTIVO = new Map<MotivoDevolucao, string>([
  ["tamanho_pequeno", "Ficou pequeno"],
  ["tamanho_grande", "Ficou grande"],
  ["nao_gostei", "Não gostei"],
  ["cor_diferente", "A cor é diferente do esperado"],
  ["desisti", "Desisti da compra"],
  ["defeito", "Veio com defeito"],
  ["avariado_no_transporte", "Chegou danificado"],
  ["produto_errado", "Recebi o produto errado"],
  ["faltando_peca", "Está faltando peça ou item"],
  ["diferente_do_anuncio", "Diferente do anúncio"],
  ["outro", "Outro motivo"],
]);

const ROTULO_RESOLUCAO = new Map<ResolucaoDevolucao, string>([
  ["reembolso", "Reembolso"],
  ["troca", "Troca"],
  ["vale", "Vale-troca"],
]);

const EXPLICACAO_RESOLUCAO = new Map<ResolucaoDevolucao, string>([
  ["reembolso", "O dinheiro volta para você pelo mesmo meio do pagamento."],
  ["troca", "A loja entrega outro tamanho, cor ou produto equivalente."],
  ["vale", "Você recebe um crédito para usar em outra compra na loja."],
]);

const ROTULO_METODO = new Map<MetodoDevolucao, string>([
  ["entrega_na_loja", "Entregar na loja"],
  ["coleta", "Coleta no endereço do pedido"],
  ["etiqueta_reversa", "Código de postagem dos Correios"],
  ["envio_proprio", "Eu mesmo envio"],
]);

const EXPLICACAO_METODO = new Map<MetodoDevolucao, string>([
  ["entrega_na_loja", "Você leva o produto até a loja."],
  [
    "coleta",
    "A loja combina um horário e busca o produto no endereço de entrega do pedido.",
  ],
  [
    "etiqueta_reversa",
    "A loja gera um código de postagem dos Correios, você leva o pacote a uma agência.",
  ],
  [
    "envio_proprio",
    "Você posta e informa o código de rastreio; no arrependimento e no defeito a loja reembolsa o frete.",
  ],
]);

const ROTULO_CONDICAO = new Map<CondicaoItemDevolvido, string>([
  ["nova", "Nova, sem uso"],
  ["usada", "Usada"],
  ["danificada", "Danificada"],
  ["ausente", "Não veio"],
]);

const ROTULO_MODALIDADE = new Map<ModalidadeDevolucao, string>([
  ["local", "Local"],
  ["nacional", "Correios ou transportadora"],
]);

const ROTULO_ATOR = new Map<AtorDoEvento, string>([
  ["cliente", "Cliente"],
  ["loja", "Loja"],
  ["sistema", "Sistema"],
]);

export const rotuloStatus = (s: StatusDevolucao) => ROTULO_STATUS.get(s) ?? s;
export const rotuloStatusPlural = (s: StatusDevolucao) =>
  ROTULO_STATUS_PLURAL.get(s) ?? s;
export const tituloDoStatusParaCliente = (s: StatusDevolucao) =>
  TITULO_STATUS_CLIENTE.get(s) ?? rotuloStatus(s);
export const rotuloTipo = (t: TipoDevolucao) => ROTULO_TIPO.get(t) ?? t;
export const rotuloMotivo = (m: MotivoDevolucao) => ROTULO_MOTIVO.get(m) ?? m;
export const rotuloResolucao = (r: ResolucaoDevolucao) =>
  ROTULO_RESOLUCAO.get(r) ?? r;
export const explicacaoResolucao = (r: ResolucaoDevolucao) =>
  EXPLICACAO_RESOLUCAO.get(r) ?? "";
export const rotuloMetodo = (m: MetodoDevolucao) => ROTULO_METODO.get(m) ?? m;
export const explicacaoMetodo = (m: MetodoDevolucao) =>
  EXPLICACAO_METODO.get(m) ?? "";
export const rotuloCondicao = (c: CondicaoItemDevolvido) =>
  ROTULO_CONDICAO.get(c) ?? c;
export const rotuloModalidade = (m: ModalidadeDevolucao) =>
  ROTULO_MODALIDADE.get(m) ?? m;
export const rotuloAtor = (a: AtorDoEvento) => ROTULO_ATOR.get(a) ?? a;

/** Cor por status (status é sempre cor + texto, nunca só cor). */
export type TomDoStatus = "atencao" | "andamento" | "sucesso" | "negativo";
const TOM_DO_STATUS = new Map<StatusDevolucao, TomDoStatus>([
  ["solicitada", "atencao"],
  ["aprovada", "andamento"],
  ["em_transito", "andamento"],
  ["recebida", "andamento"],
  ["concluida", "sucesso"],
  ["recusada", "negativo"],
  ["cancelada", "negativo"],
  ["reprovada", "negativo"],
]);
export const tomDoStatus = (s: StatusDevolucao): TomDoStatus =>
  TOM_DO_STATUS.get(s) ?? "andamento";

export const ehStatusAberto = (s: StatusDevolucao) =>
  STATUS_ABERTOS.includes(s);

export const ehMotivoDeProblema = (m: MotivoDevolucao | null | undefined) =>
  !!m && MOTIVOS_DE_PROBLEMA.includes(m);

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

export const formatarReais = (valor: number) => formatCurrency(valor);

/** Centavos inteiros antes de somar — `0.1 + 0.2` não pode virar dinheiro. */
export const paraCentavos = (valor: number) => Math.round(valor * 100);

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` → `dd/mm/aaaa` SEM passar por `Date`: a data do banco já está
 * no fuso da loja, e `new Date("2026-09-30")` é meia-noite UTC — que em
 * Brasília ainda é dia 29.
 */
export function formatarDia(dia: string | null | undefined): string {
  if (!dia) return "";
  const m = RE_DIA.exec(dia);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const data = new Date(dia);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleDateString("pt-BR");
}

/** `YYYY-MM-DD` → `dd/mm`. */
export function formatarDiaCurto(dia: string | null | undefined): string {
  const completo = formatarDia(dia);
  return completo ? completo.slice(0, 5) : "";
}

/** Instante ISO → `dd/mm/aaaa, hh:mm` no relógio do aparelho. */
export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Dias corridos de `hoje` (data local) até `dia` (`YYYY-MM-DD`). */
export function diasAte(dia: string, hoje: Date): number | null {
  const m = RE_DIA.exec(dia);
  if (!m) return null;
  const alvo = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo - base) / 86_400_000);
}

/** "vence hoje", "faltam 3 dias", "venceu há 2 dias". */
export function textoDoPrazo(dia: string, hoje: Date): string {
  const dias = diasAte(dia, hoje);
  if (dias === null) return "";
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias > 1) return `faltam ${dias} dias`;
  if (dias === -1) return "venceu ontem";
  return `venceu há ${-dias} dias`;
}

/** Idade de um pedido de devolução em dias inteiros (para o painel). */
export function idadeEmDias(iso: string, agora: Date): number | null {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return Math.max(
    0,
    Math.floor((agora.getTime() - data.getTime()) / 86_400_000),
  );
}

/** "hoje", "há 1 dia", "há 5 dias". */
export function textoDaIdade(iso: string, agora: Date): string {
  const dias = idadeEmDias(iso, agora);
  if (dias === null) return "";
  if (dias === 0) return "hoje";
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

// ---------------------------------------------------------------------------
// Regras do pedido do cliente (espelho do `solicitar_devolucao`)
// ---------------------------------------------------------------------------

/**
 * O tipo que o SERVIDOR vai decidir para este motivo, dadas as janelas
 * abertas — `null` quando nenhuma janela cobre o motivo (a RPC recusaria).
 */
export function tipoPrevisto(
  motivo: MotivoDevolucao,
  janelas: JanelasDeDevolucao,
): TipoDevolucao | null {
  if (ehMotivoDeProblema(motivo)) return janelas.vicio ? "vicio" : null;
  if (janelas.arrependimento) return "arrependimento";
  if (janelas.troca) return "troca";
  return null;
}

/** Por que um motivo está indisponível (texto curto para a opção). */
export function porqueMotivoIndisponivel(motivo: MotivoDevolucao): string {
  return ehMotivoDeProblema(motivo)
    ? "O prazo para reclamar de problema no produto terminou."
    : "O prazo para troca ou arrependimento terminou.";
}

/**
 * As resoluções que a RPC aceita para o motivo escolhido:
 * - problema (vício): reembolso e troca são direito (CDC art. 18); vale só
 *   se a loja trabalha com vale;
 * - arrependimento: reembolso sempre (art. 49); troca e vale pela política;
 * - troca de política (fora do arrependimento): só troca ou vale.
 */
export function resolucoesPermitidas(
  motivo: MotivoDevolucao | null,
  janelas: JanelasDeDevolucao,
  politica: Pick<PoliticaDevolucao, "aceita_troca" | "aceita_vale">,
): ResolucaoDevolucao[] {
  if (!motivo) return [];
  const tipo = tipoPrevisto(motivo, janelas);
  if (!tipo) return [];
  const saida: ResolucaoDevolucao[] = [];
  if (tipo !== "troca") saida.push("reembolso");
  if (tipo === "vicio" || politica.aceita_troca) saida.push("troca");
  if (politica.aceita_vale) saida.push("vale");
  return saida;
}

export function fotosObrigatorias(
  motivo: MotivoDevolucao | null,
  politica: Pick<PoliticaDevolucao, "exige_fotos_vicio">,
): boolean {
  return ehMotivoDeProblema(motivo) && politica.exige_fotos_vicio;
}

/** Quantidades escolhidas por `order_item_id` (só as maiores que zero). */
export type SelecaoDeItens = ReadonlyMap<string, number>;

export function valorDaSelecao(
  itens: readonly ItemElegivel[],
  selecao: SelecaoDeItens,
): number {
  let centavos = 0;
  for (const item of itens) {
    const qtd = selecao.get(item.order_item_id) ?? 0;
    if (qtd > 0) centavos += qtd * paraCentavos(item.valor_unitario);
  }
  return centavos / 100;
}

/**
 * Arrependimento e defeito devolvem também o frete de ida quando o pedido
 * volta INTEIRO (CDC art. 49, parágrafo único) — mesma conta do servidor:
 * o que já está em devolução ativa + o que vai agora cobre o pedido todo.
 */
export function devolveFreteDeIda(
  tipo: TipoDevolucao | null,
  itens: readonly ItemElegivel[],
  selecao: SelecaoDeItens,
): boolean {
  if (tipo !== "arrependimento" && tipo !== "vicio") return false;
  let total = 0;
  let coberto = 0;
  for (const item of itens) {
    total += item.quantidade;
    coberto += item.ja_devolvida + (selecao.get(item.order_item_id) ?? 0);
  }
  return total > 0 && coberto >= total;
}

export function erroDosItens(selecao: SelecaoDeItens): string | null {
  for (const qtd of selecao.values()) if (qtd > 0) return null;
  return "Escolha ao menos um item para devolver.";
}

export function erroDoMotivo(args: {
  motivo: MotivoDevolucao | null;
  detalhe: string;
  quantidadeDeFotos: number;
  janelas: JanelasDeDevolucao;
  politica: Pick<PoliticaDevolucao, "exige_fotos_vicio">;
}): string | null {
  const { motivo, detalhe, quantidadeDeFotos, janelas, politica } = args;
  if (!motivo) return "Escolha o motivo da devolução.";
  if (!tipoPrevisto(motivo, janelas)) return porqueMotivoIndisponivel(motivo);
  if (motivo === "outro" && detalhe.trim().length === 0) {
    return "Conte em poucas palavras o motivo da devolução.";
  }
  if (detalhe.length > 1000) return "Use no máximo 1000 caracteres.";
  if (fotosObrigatorias(motivo, politica) && quantidadeDeFotos === 0) {
    return "Envie ao menos uma foto do problema no produto.";
  }
  if (quantidadeDeFotos > MAXIMO_DE_FOTOS) return "Envie no máximo 6 fotos.";
  return null;
}

export function erroDaResolucao(args: {
  resolucao: ResolucaoDevolucao | null;
  metodo: MetodoDevolucao | null;
  permitidas: readonly ResolucaoDevolucao[];
  metodos: readonly MetodoDevolucao[];
}): string | null {
  const { resolucao, metodo, permitidas, metodos } = args;
  if (!resolucao || !permitidas.includes(resolucao)) {
    return "Escolha como prefere resolver.";
  }
  if (!metodo || !metodos.includes(metodo)) {
    return "Escolha como o produto volta para a loja.";
  }
  return null;
}

/** Extensão do arquivo no bucket pelo MIME (o bucket aceita jpeg/png/webp). */
export function extensaoDaFoto(mime: string): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** `<uid>/<order_id>/<uuid>.<ext>` — a policy só deixa gravar na pasta do uid. */
export function caminhoDaFoto(
  userId: string,
  orderId: string,
  uuid: string,
  mime: string,
): string {
  return `${userId}/${orderId}/${uuid}.${extensaoDaFoto(mime)}`;
}

// ---------------------------------------------------------------------------
// Ações permitidas por status
// ---------------------------------------------------------------------------

export type AcaoDoCliente = "cancelar" | "informar_envio";

/**
 * Espelho de `cancelar_devolucao` e `informar_envio_devolucao`. Na etiqueta
 * reversa o código de postagem JÁ É o rastreio dos Correios: o cliente só
 * informa o envio depois que a loja gerou o código (e manda o próprio
 * código, sem digitar nada).
 */
export function acoesDoCliente(d: {
  status: StatusDevolucao;
  metodo_retorno: MetodoDevolucao;
  codigo_postagem?: string | null;
}): AcaoDoCliente[] {
  if (d.status === "solicitada") return ["cancelar"];
  if (d.status !== "aprovada") return [];
  if (d.metodo_retorno === "envio_proprio")
    return ["informar_envio", "cancelar"];
  if (d.metodo_retorno === "etiqueta_reversa" && d.codigo_postagem) {
    return ["informar_envio", "cancelar"];
  }
  return ["cancelar"];
}

export type AcaoDoLojista =
  | "aprovar"
  | "recusar"
  | "gerar_etiqueta"
  | "marcar_em_transito"
  | "marcar_recebida"
  | "concluir"
  | "reprovar";

/** Espelho da máquina de estados das RPCs `admin_devolucao_*`. */
export function acoesDoLojista(d: {
  status: StatusDevolucao;
  metodo_retorno: MetodoDevolucao;
  codigo_postagem?: string | null;
}): AcaoDoLojista[] {
  switch (d.status) {
    case "solicitada":
      return ["aprovar", "recusar"];
    case "aprovada": {
      const acoes: AcaoDoLojista[] = [];
      if (d.metodo_retorno === "etiqueta_reversa" && !d.codigo_postagem) {
        acoes.push("gerar_etiqueta");
      }
      // Quem entrega na loja não fica "a caminho": chega no balcão.
      if (d.metodo_retorno !== "entrega_na_loja") {
        acoes.push("marcar_em_transito");
      }
      acoes.push("marcar_recebida");
      return acoes;
    }
    case "em_transito":
      return ["marcar_recebida"];
    case "recebida":
      return ["concluir", "reprovar"];
    default:
      return [];
  }
}

/** Resoluções que o lojista pode escolher ao concluir. */
export function resolucoesDaConclusao(
  tipo: TipoDevolucao,
): ResolucaoDevolucao[] {
  return tipo === "troca" ? ["troca", "vale"] : ["reembolso", "troca", "vale"];
}

/** Reestocar por padrão só o que voltou novo; ausente nunca reestoca. */
export const reestocarPorPadrao = (c: CondicaoItemDevolvido) => c === "nova";

// ---------------------------------------------------------------------------
// Linha do tempo e instruções ao cliente
// ---------------------------------------------------------------------------

export type EstadoDaEtapa = "feita" | "atual" | "pendente" | "negativa";

export interface EtapaDaDevolucao {
  status: StatusDevolucao;
  rotulo: string;
  estado: EstadoDaEtapa;
}

const ROTULO_ETAPA = new Map<StatusDevolucao, string>([
  ["solicitada", "Solicitada"],
  ["aprovada", "Aprovada"],
  ["em_transito", "A caminho"],
  ["recebida", "Recebida"],
  ["concluida", "Concluída"],
  ["recusada", "Recusada"],
  ["cancelada", "Cancelada"],
  ["reprovada", "Reprovada"],
]);

export function etapasDaDevolucao(d: {
  status: StatusDevolucao;
  metodo_retorno: MetodoDevolucao;
  aprovada_em?: string | null;
  postada_em?: string | null;
}): EtapaDaDevolucao[] {
  const passaPorTransito =
    METODOS_NACIONAIS.includes(d.metodo_retorno) || !!d.postada_em;
  const caminho: StatusDevolucao[] = [
    "solicitada",
    "aprovada",
    ...(passaPorTransito ? (["em_transito"] as const) : []),
    "recebida",
    "concluida",
  ];
  const etapa = (s: StatusDevolucao, estado: EstadoDaEtapa) => ({
    status: s,
    rotulo: ROTULO_ETAPA.get(s) ?? s,
    estado,
  });

  const indice = caminho.indexOf(d.status);
  if (indice >= 0) {
    return caminho.map((s, i) =>
      etapa(
        s,
        i < indice || d.status === "concluida"
          ? "feita"
          : i === indice
            ? "atual"
            : "pendente",
      ),
    );
  }

  // Finais negativos: o caminho até onde chegou + a etapa que encerrou.
  let ultimaFeita: StatusDevolucao = "solicitada";
  if (d.status === "reprovada") ultimaFeita = "recebida";
  else if (d.status === "cancelada" && d.aprovada_em) ultimaFeita = "aprovada";
  const ate = caminho.indexOf(ultimaFeita);
  return [
    ...caminho.slice(0, ate + 1).map((s) => etapa(s, "feita")),
    etapa(d.status, "negativa"),
  ];
}

/** O que o cliente faz agora (ou o que está acontecendo), em uma frase. */
export function instrucaoParaOCliente(
  d: Pick<
    DevolucaoDetalhe,
    | "status"
    | "tipo"
    | "metodo_retorno"
    | "codigo_postagem"
    | "codigo_rastreio"
    | "coleta_em"
    | "resolucao_final"
    | "reembolso_manual"
    | "valor_reembolso"
  >,
  loja: { endereco?: string | null; horario?: string | null },
): string {
  switch (d.status) {
    case "solicitada":
      return "A loja vai analisar o seu pedido e responder por aqui. Guarde o produto com a embalagem e os acessórios.";
    case "aprovada":
      switch (d.metodo_retorno) {
        case "entrega_na_loja": {
          const endereco = loja.endereco?.trim();
          const horario = loja.horario?.trim();
          return `Leve o produto até a loja${endereco ? `: ${endereco}` : ""}.${horario ? ` Horário de atendimento: ${horario}.` : ""}`;
        }
        case "coleta":
          return d.coleta_em
            ? `A loja vai buscar o produto no endereço do pedido em ${formatarDataHora(d.coleta_em)}.`
            : "A loja vai combinar com você o dia e o horário da coleta no endereço do pedido.";
        case "etiqueta_reversa":
          return d.codigo_postagem
            ? "Imprima a declaração de conteúdo (botão Etiqueta) e leve o pacote a uma agência dos Correios em até 7 dias, informando o código de postagem abaixo — ele também é o rastreio da devolução. Depois de postar, toque em “Já postei”."
            : "A loja está gerando o código de postagem dos Correios. Ele aparece aqui assim que ficar pronto.";
        default:
          return d.tipo === "troca"
            ? "Embale o produto, poste nos Correios ou na transportadora de sua preferência e informe o código de rastreio aqui."
            : "Embale o produto, poste nos Correios ou na transportadora de sua preferência e informe o código de rastreio aqui. Guarde o comprovante: a loja reembolsa o frete de volta.";
      }
    case "em_transito":
      return d.codigo_rastreio
        ? `O produto está a caminho da loja (rastreio ${d.codigo_rastreio}).`
        : "O produto está a caminho da loja.";
    case "recebida":
      return "A loja recebeu o produto e está conferindo. Você recebe um aviso quando terminar.";
    case "concluida": {
      if (d.resolucao_final === "reembolso") {
        const valor = formatarReais(d.valor_reembolso ?? 0);
        return d.reembolso_manual
          ? `Reembolso de ${valor} combinado com a loja (em mãos ou por PIX).`
          : `Reembolso de ${valor} liberado pelo Mercado Pago: PIX cai na sua conta; cartão aparece como crédito na fatura (o prazo é do seu banco).`;
      }
      if (d.resolucao_final === "troca") {
        return "A troca foi confirmada. A loja combina com você a entrega do novo produto.";
      }
      return "Seu vale-troca foi emitido. Fale com a loja para usar.";
    }
    case "recusada":
      return "A loja não aprovou esta devolução.";
    case "cancelada":
      return "Você cancelou esta devolução.";
    case "reprovada":
      return "O produto não foi aceito na inspeção da loja.";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Leitores do jsonb das RPCs (recusam forma inesperada com `null`)
// ---------------------------------------------------------------------------

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

const numero = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function umDe<T extends string>(lista: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (lista as readonly string[]).includes(v)
    ? (v as T)
    : null;
}

const listaDeTextos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const listaDe = <T extends string>(lista: readonly T[], v: unknown): T[] =>
  listaDeTextos(v).filter((x): x is T =>
    (lista as readonly string[]).includes(x),
  );

/** Lê um campo do objeto sem indexação dinâmica solta. */
const campo = (o: Objeto, chave: string): unknown =>
  Object.prototype.hasOwnProperty.call(o, chave)
    ? Object.getOwnPropertyDescriptor(o, chave)?.value
    : undefined;

export function lerPolitica(v: unknown): PoliticaDevolucao | null {
  if (!ehObjeto(v)) return null;
  const arrep = numero(campo(v, "prazo_arrependimento_dias"));
  const troca = numero(campo(v, "prazo_troca_dias"));
  const vicio = numero(campo(v, "prazo_vicio_dias"));
  if (arrep === null || troca === null || vicio === null) return null;
  return {
    prazo_arrependimento_dias: arrep,
    prazo_troca_dias: troca,
    prazo_vicio_dias: vicio,
    aceita_troca: campo(v, "aceita_troca") === true,
    aceita_vale: campo(v, "aceita_vale") === true,
    exige_fotos_vicio: campo(v, "exige_fotos_vicio") !== false,
    metodos_locais: listaDe(METODOS_LOCAIS, campo(v, "metodos_locais")),
    metodos_nacionais: listaDe(
      METODOS_NACIONAIS,
      campo(v, "metodos_nacionais"),
    ),
    reembolso_momento:
      umDe(
        ["ao_receber", "apos_inspecao"] as const,
        campo(v, "reembolso_momento"),
      ) ?? "ao_receber",
    frete_troca_pago_por:
      umDe(["loja", "cliente"] as const, campo(v, "frete_troca_pago_por")) ??
      "cliente",
    categorias_sem_troca: listaDeTextos(campo(v, "categorias_sem_troca")),
    texto_politica: texto(campo(v, "texto_politica")),
    endereco_devolucao: texto(campo(v, "endereco_devolucao")),
    updated_at: texto(campo(v, "updated_at")),
  };
}

function lerItemElegivel(v: unknown): ItemElegivel | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "order_item_id"));
  const quantidade = numero(campo(v, "quantidade"));
  const disponivel = numero(campo(v, "disponivel"));
  const valor = numero(campo(v, "valor_unitario"));
  if (!id || quantidade === null || disponivel === null || valor === null) {
    return null;
  }
  return {
    order_item_id: id,
    product_id: texto(campo(v, "product_id")),
    product_name: texto(campo(v, "product_name")),
    image_url: texto(campo(v, "image_url")),
    quantidade,
    ja_devolvida: numero(campo(v, "ja_devolvida")) ?? 0,
    disponivel,
    valor_unitario: valor,
  };
}

export function lerElegibilidade(v: unknown): ElegibilidadeDevolucao | null {
  if (!ehObjeto(v) || typeof campo(v, "pode") !== "boolean") return null;
  const politica = lerPolitica(campo(v, "politica"));
  const modalidade = umDe(
    ["local", "nacional"] as const,
    campo(v, "modalidade"),
  );
  const janelas = campo(v, "janelas");
  const prazos = campo(v, "prazos");
  const itensCrus = campo(v, "itens");
  if (
    !politica ||
    !modalidade ||
    !ehObjeto(janelas) ||
    !Array.isArray(itensCrus)
  ) {
    return null;
  }
  const itens = itensCrus.map(lerItemElegivel);
  if (itens.some((i) => i === null)) return null;
  const p = ehObjeto(prazos) ? prazos : {};
  return {
    pode: campo(v, "pode") === true,
    motivo_bloqueio: texto(campo(v, "motivo_bloqueio")),
    entregue_em: texto(campo(v, "entregue_em")),
    dias_desde_entrega: numero(campo(v, "dias_desde_entrega")),
    modalidade,
    metodos: listaDe(METODOS, campo(v, "metodos")),
    prazos: {
      arrependimento_ate: texto(campo(p, "arrependimento_ate")),
      troca_ate: texto(campo(p, "troca_ate")),
      vicio_ate: texto(campo(p, "vicio_ate")),
    },
    janelas: {
      arrependimento: campo(janelas, "arrependimento") === true,
      troca: campo(janelas, "troca") === true,
      vicio: campo(janelas, "vicio") === true,
    },
    itens: itens as ItemElegivel[],
    politica,
  };
}

export function lerResultadoSolicitacao(
  v: unknown,
): ResultadoSolicitacao | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  const protocolo = texto(campo(v, "protocolo"));
  const tipo = umDe(TIPOS, campo(v, "tipo"));
  const status = umDe(STATUS_EM_ORDEM, campo(v, "status"));
  if (!id || !protocolo || !tipo || !status) return null;
  return { id, protocolo, tipo, status };
}

export function lerResultadoDeStatus(v: unknown): ResultadoDeStatus | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  const status = umDe(STATUS_EM_ORDEM, campo(v, "status"));
  return id && status ? { id, status } : null;
}

function lerResumo(v: unknown): ResumoDevolucao | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  const protocolo = texto(campo(v, "protocolo"));
  const status = umDe(STATUS_EM_ORDEM, campo(v, "status"));
  const tipo = umDe(TIPOS, campo(v, "tipo"));
  const resolucao = umDe(RESOLUCOES, campo(v, "resolucao_desejada"));
  const metodo = umDe(METODOS, campo(v, "metodo_retorno"));
  if (!id || !protocolo || !status || !tipo || !resolucao || !metodo) {
    return null;
  }
  return {
    id,
    protocolo,
    status,
    tipo,
    resolucao_desejada: resolucao,
    metodo_retorno: metodo,
    valor_itens: numero(campo(v, "valor_itens")) ?? 0,
    created_at: texto(campo(v, "created_at")) ?? "",
  };
}

/** `devolucoes_do_pedido` — mais recente primeiro (ordem do servidor). */
export function lerDevolucoesDoPedido(v: unknown): ResumoDevolucao[] | null {
  if (!Array.isArray(v)) return null;
  const linhas = v.map(lerResumo);
  return linhas.some((l) => l === null) ? null : (linhas as ResumoDevolucao[]);
}

function lerItemDevolvido(v: unknown): ItemDevolvido | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  const quantidade = numero(campo(v, "quantidade"));
  if (!id || quantidade === null) return null;
  const reestocar = campo(v, "reestocar");
  return {
    id,
    order_item_id: texto(campo(v, "order_item_id")) ?? "",
    product_id: texto(campo(v, "product_id")),
    variant_id: texto(campo(v, "variant_id")),
    product_name: texto(campo(v, "product_name")),
    image_url: texto(campo(v, "image_url")),
    quantidade,
    valor_unitario: numero(campo(v, "valor_unitario")) ?? 0,
    condicao: umDe(CONDICOES, campo(v, "condicao")),
    reestocar: typeof reestocar === "boolean" ? reestocar : null,
    reestocado_em: texto(campo(v, "reestocado_em")),
  };
}

function lerEvento(v: unknown): EventoDevolucao | null {
  if (!ehObjeto(v)) return null;
  const para = umDe(STATUS_EM_ORDEM, campo(v, "para_status"));
  if (!para) return null;
  return {
    id: numero(campo(v, "id")) ?? 0,
    de_status: umDe(STATUS_EM_ORDEM, campo(v, "de_status")),
    para_status: para,
    ator: umDe(ATORES, campo(v, "ator")) ?? "sistema",
    nota: texto(campo(v, "nota")),
    created_at: texto(campo(v, "created_at")) ?? "",
  };
}

function lerPedido(v: unknown): PedidoDaDevolucao | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  if (!id) return null;
  return {
    id,
    total: numero(campo(v, "total")) ?? 0,
    shipping: numero(campo(v, "shipping")) ?? 0,
    payment_method: texto(campo(v, "payment_method")),
    payment_status: texto(campo(v, "payment_status")),
    canal: texto(campo(v, "canal")),
    customer_name: texto(campo(v, "customer_name")),
    whatsapp: texto(campo(v, "whatsapp")),
    shipping_label_id: texto(campo(v, "shipping_label_id")),
    shipping_option_id: texto(campo(v, "shipping_option_id")),
  };
}

export function lerDevolucaoDetalhe(v: unknown): DevolucaoDetalhe | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  const protocolo = texto(campo(v, "protocolo"));
  const orderId = texto(campo(v, "order_id"));
  const tipo = umDe(TIPOS, campo(v, "tipo"));
  const motivo = umDe(MOTIVOS, campo(v, "motivo"));
  const resolucao = umDe(RESOLUCOES, campo(v, "resolucao_desejada"));
  const modalidade = umDe(
    ["local", "nacional"] as const,
    campo(v, "modalidade"),
  );
  const metodo = umDe(METODOS, campo(v, "metodo_retorno"));
  const status = umDe(STATUS_EM_ORDEM, campo(v, "status"));
  if (
    !id ||
    !protocolo ||
    !orderId ||
    !tipo ||
    !motivo ||
    !resolucao ||
    !modalidade ||
    !metodo ||
    !status
  ) {
    return null;
  }
  const itensCrus = campo(v, "itens");
  const eventosCrus = campo(v, "eventos");
  const itens = (Array.isArray(itensCrus) ? itensCrus : []).map(
    lerItemDevolvido,
  );
  const eventos = (Array.isArray(eventosCrus) ? eventosCrus : []).map(
    lerEvento,
  );
  if (itens.some((i) => i === null)) return null;
  return {
    id,
    protocolo,
    order_id: orderId,
    tipo,
    motivo,
    detalhe: texto(campo(v, "detalhe")),
    resolucao_desejada: resolucao,
    resolucao_final: umDe(RESOLUCOES, campo(v, "resolucao_final")),
    modalidade,
    metodo_retorno: metodo,
    status,
    valor_itens: numero(campo(v, "valor_itens")) ?? 0,
    valor_frete_ida: numero(campo(v, "valor_frete_ida")) ?? 0,
    valor_reembolso: numero(campo(v, "valor_reembolso")),
    refund_id: texto(campo(v, "refund_id")),
    reembolso_manual: campo(v, "reembolso_manual") === true,
    fotos: listaDeTextos(campo(v, "fotos")),
    codigo_rastreio: texto(campo(v, "codigo_rastreio")),
    codigo_postagem: texto(campo(v, "codigo_postagem")),
    etiqueta_url: texto(campo(v, "etiqueta_url")),
    coleta_em: texto(campo(v, "coleta_em")),
    mensagem_loja: texto(campo(v, "mensagem_loja")),
    observacao_inspecao: texto(campo(v, "observacao_inspecao")),
    entregue_em: texto(campo(v, "entregue_em")),
    prazo_ate: texto(campo(v, "prazo_ate")) ?? "",
    politica: lerPolitica(campo(v, "politica")),
    created_at: texto(campo(v, "created_at")) ?? "",
    aprovada_em: texto(campo(v, "aprovada_em")),
    postada_em: texto(campo(v, "postada_em")),
    recebida_em: texto(campo(v, "recebida_em")),
    concluida_em: texto(campo(v, "concluida_em")),
    encerrada_em: texto(campo(v, "encerrada_em")),
    itens: itens as ItemDevolvido[],
    // Evento com status desconhecido some da trilha, mas não derruba a ficha.
    eventos: eventos.filter((e): e is EventoDevolucao => e !== null),
    pedido: lerPedido(campo(v, "pedido")),
  };
}

function lerContagem(v: unknown): ContagemPorStatus {
  const o = ehObjeto(v) ? v : {};
  return Object.fromEntries(
    STATUS_EM_ORDEM.map((s) => [s, numero(campo(o, s)) ?? 0]),
  ) as ContagemPorStatus;
}

/** Quantidade em um status (sem indexação dinâmica). */
export const contagemDe = (c: ContagemPorStatus, s: StatusDevolucao): number =>
  numero(campo(c as unknown as Objeto, s)) ?? 0;

/** Soma dos quatro estados em andamento. */
export const totalAbertas = (c: ContagemPorStatus): number =>
  STATUS_ABERTOS.reduce((soma, s) => soma + contagemDe(c, s), 0);

/** Soma de todos os estados. */
export const totalGeral = (c: ContagemPorStatus): number =>
  STATUS_EM_ORDEM.reduce((soma, s) => soma + contagemDe(c, s), 0);

function lerLinhaAdmin(v: unknown): LinhaDevolucaoAdmin | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  const protocolo = texto(campo(v, "protocolo"));
  const orderId = texto(campo(v, "order_id"));
  const tipo = umDe(TIPOS, campo(v, "tipo"));
  const motivo = umDe(MOTIVOS, campo(v, "motivo"));
  const status = umDe(STATUS_EM_ORDEM, campo(v, "status"));
  const resolucao = umDe(RESOLUCOES, campo(v, "resolucao_desejada"));
  const metodo = umDe(METODOS, campo(v, "metodo_retorno"));
  const modalidade = umDe(
    ["local", "nacional"] as const,
    campo(v, "modalidade"),
  );
  if (
    !id ||
    !protocolo ||
    !orderId ||
    !tipo ||
    !motivo ||
    !status ||
    !resolucao ||
    !metodo ||
    !modalidade
  ) {
    return null;
  }
  return {
    id,
    protocolo,
    order_id: orderId,
    cliente_nome: texto(campo(v, "cliente_nome")),
    cliente_whatsapp: texto(campo(v, "cliente_whatsapp")),
    tipo,
    motivo,
    status,
    resolucao_desejada: resolucao,
    metodo_retorno: metodo,
    modalidade,
    valor_itens: numero(campo(v, "valor_itens")) ?? 0,
    prazo_ate: texto(campo(v, "prazo_ate")) ?? "",
    created_at: texto(campo(v, "created_at")) ?? "",
  };
}

export function lerListaAdmin(v: unknown): ListaDevolucoesAdmin | null {
  if (!ehObjeto(v)) return null;
  const total = numero(campo(v, "total"));
  const itensCrus = campo(v, "itens");
  if (
    total === null ||
    !Array.isArray(itensCrus) ||
    !ehObjeto(campo(v, "contagem"))
  ) {
    return null;
  }
  const itens = itensCrus.map(lerLinhaAdmin);
  if (itens.some((i) => i === null)) return null;
  return {
    total,
    contagem: lerContagem(campo(v, "contagem")),
    itens: itens as LinhaDevolucaoAdmin[],
  };
}

export function lerResultadoConclusao(v: unknown): ResultadoConclusao | null {
  if (!ehObjeto(v)) return null;
  const id = texto(campo(v, "id"));
  const status = umDe(STATUS_EM_ORDEM, campo(v, "status"));
  const resolucao = umDe(RESOLUCOES, campo(v, "resolucao"));
  if (!id || !status || !resolucao) return null;
  return {
    id,
    status,
    resolucao,
    valor_reembolso: numero(campo(v, "valor_reembolso")),
    refund_id: texto(campo(v, "refund_id")),
    reembolso_manual: campo(v, "reembolso_manual") === true,
    reestocados: numero(campo(v, "reestocados")) ?? 0,
  };
}

export type RespostaEtiquetaReversa =
  | { ok: true; dados: ResultadoEtiquetaReversa }
  | { ok: false; erro: string; resgate: boolean };

const ERRO_ETIQUETA = "Resposta inesperada ao gerar o código de postagem.";

/** Aviso de quando a cobrança pode ter saído — nunca tentar de novo às cegas. */
export const AVISO_RESGATE_ETIQUETA =
  "A compra pode ter sido cobrada: confira sua conta do Melhor Envio antes de tentar de novo.";

/**
 * Corpo da edge `melhor-envio-etiqueta` (`gerar_devolucao_reversa`), de 2xx
 * ou de erro. O que vale como "gerado" é `codigo_postagem` — `me_reverse_id`
 * pode ser um token de reserva (`reservando:…`) e nunca aparece na tela.
 */
export function lerRespostaEtiquetaReversa(
  v: unknown,
): RespostaEtiquetaReversa {
  if (!ehObjeto(v)) return { ok: false, erro: ERRO_ETIQUETA, resgate: false };
  const erro = texto(campo(v, "error"));
  if (erro) {
    return { ok: false, erro, resgate: campo(v, "resgate") === true };
  }
  const codigo = texto(campo(v, "codigo_postagem"));
  if (campo(v, "ok") !== true || !codigo) {
    return { ok: false, erro: ERRO_ETIQUETA, resgate: false };
  }
  return {
    ok: true,
    dados: {
      codigo_postagem: codigo,
      etiqueta_url: texto(campo(v, "etiqueta_url")),
      ja_existia: campo(v, "already") === true,
      validade_ate: texto(campo(v, "validade_ate")),
    },
  };
}

// ---------------------------------------------------------------------------
// Mensagens de erro
// ---------------------------------------------------------------------------

const RE_REDE =
  /failed to fetch|networkerror|network request failed|load failed/i;

/**
 * A RPC já fala pt-BR com o leigo (as mensagens moram na migration) — a tela
 * mostra como veio. Só a falha de rede, que chega em inglês do navegador,
 * vira frase nossa.
 */
export function mensagemDoErro(erro: unknown, generica: string): string {
  const msg =
    ehObjeto(erro) && typeof campo(erro, "message") === "string"
      ? String(campo(erro, "message")).trim()
      : erro instanceof Error
        ? erro.message.trim()
        : "";
  if (!msg) return generica;
  if (RE_REDE.test(msg)) {
    return "Sem conexão com a internet. Confira a rede e tente de novo.";
  }
  return msg;
}

/**
 * Corpo de erro de edge function (supabase-js v2): fora de 2xx o corpo vem
 * em `error.context` (um Response). `null` quando não dá para ler.
 */
export async function corpoDoErroDaEdge(erro: unknown): Promise<unknown> {
  try {
    const contexto = ehObjeto(erro) ? campo(erro, "context") : undefined;
    const ler = ehObjeto(contexto) ? campo(contexto, "json") : undefined;
    if (typeof ler === "function") {
      return await (ler as () => Promise<unknown>).call(contexto);
    }
  } catch {
    // Corpo ilegível.
  }
  return null;
}

/** A mensagem `{error}` do corpo da edge, ou a genérica. */
export async function mensagemDoErroDaEdge(
  erro: unknown,
  generica: string,
): Promise<string> {
  const corpo = await corpoDoErroDaEdge(erro);
  return (ehObjeto(corpo) ? texto(campo(corpo, "error")) : null) ?? generica;
}
