/**
 * Tipos de domínio da DEVOLUÇÃO/TROCA de produto entregue (plano
 * `docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md`, seção
 * "Devoluções"; migration `20261175000000_a_devolucao_nasce_no_pedido.sql`).
 *
 * As tabelas e RPCs já estão em `database.types.ts`, mas lá tudo é `string`
 * e `Json`. Aqui mora o vocabulário FECHADO (os CHECKs do banco) e a forma
 * de cada `jsonb` que as RPCs devolvem — quem converte `Json` nestes tipos
 * são os leitores de `src/lib/devolucao.ts`, que recusam forma inesperada.
 */

export type StatusDevolucao =
  | "solicitada"
  | "aprovada"
  | "recusada"
  | "cancelada"
  | "em_transito"
  | "recebida"
  | "concluida"
  | "reprovada";

export type TipoDevolucao = "arrependimento" | "vicio" | "troca";

export type MotivoDevolucao =
  | "tamanho_pequeno"
  | "tamanho_grande"
  | "nao_gostei"
  | "desisti"
  | "cor_diferente"
  | "defeito"
  | "avariado_no_transporte"
  | "produto_errado"
  | "faltando_peca"
  | "diferente_do_anuncio"
  | "outro";

export type ResolucaoDevolucao = "reembolso" | "troca" | "vale";

export type MetodoDevolucao =
  | "entrega_na_loja"
  | "coleta"
  | "etiqueta_reversa"
  | "envio_proprio";

export type ModalidadeDevolucao = "local" | "nacional";

export type CondicaoItemDevolvido = "nova" | "usada" | "danificada" | "ausente";

export type AtorDoEvento = "cliente" | "loja" | "sistema";

/** Linha de `politica_devolucao` (sem `updated_by`, que as RPCs removem). */
export interface PoliticaDevolucao {
  prazo_arrependimento_dias: number;
  prazo_troca_dias: number;
  prazo_vicio_dias: number;
  aceita_troca: boolean;
  aceita_vale: boolean;
  exige_fotos_vicio: boolean;
  metodos_locais: MetodoDevolucao[];
  metodos_nacionais: MetodoDevolucao[];
  reembolso_momento: "ao_receber" | "apos_inspecao";
  frete_troca_pago_por: "loja" | "cliente";
  categorias_sem_troca: string[];
  texto_politica: string | null;
  endereco_devolucao: string | null;
  updated_at: string | null;
}

/** Um item do pedido como `devolucao_elegibilidade` o descreve. */
export interface ItemElegivel {
  order_item_id: string;
  product_id: string | null;
  product_name: string | null;
  image_url: string | null;
  quantidade: number;
  ja_devolvida: number;
  disponivel: number;
  valor_unitario: number;
}

export interface JanelasDeDevolucao {
  arrependimento: boolean;
  troca: boolean;
  vicio: boolean;
}

/** Datas `YYYY-MM-DD` (fuso da loja) — `null` quando a janela não existe. */
export interface PrazosDeDevolucao {
  arrependimento_ate: string | null;
  troca_ate: string | null;
  vicio_ate: string | null;
}

export interface ElegibilidadeDevolucao {
  pode: boolean;
  motivo_bloqueio: string | null;
  entregue_em: string | null;
  dias_desde_entrega: number | null;
  modalidade: ModalidadeDevolucao;
  metodos: MetodoDevolucao[];
  prazos: PrazosDeDevolucao;
  janelas: JanelasDeDevolucao;
  itens: ItemElegivel[];
  politica: PoliticaDevolucao;
}

/** Retorno de `solicitar_devolucao`. */
export interface ResultadoSolicitacao {
  id: string;
  protocolo: string;
  tipo: TipoDevolucao;
  status: StatusDevolucao;
}

/** Retorno das RPCs que só mudam o status (`{id, status}`). */
export interface ResultadoDeStatus {
  id: string;
  status: StatusDevolucao;
}

/** Uma linha de `devolucoes_do_pedido`. */
export interface ResumoDevolucao {
  id: string;
  protocolo: string;
  status: StatusDevolucao;
  tipo: TipoDevolucao;
  resolucao_desejada: ResolucaoDevolucao;
  metodo_retorno: MetodoDevolucao;
  valor_itens: number;
  created_at: string;
}

export interface ItemDevolvido {
  id: string;
  order_item_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string | null;
  image_url: string | null;
  quantidade: number;
  valor_unitario: number;
  condicao: CondicaoItemDevolvido | null;
  reestocar: boolean | null;
  reestocado_em: string | null;
}

export interface EventoDevolucao {
  id: number;
  de_status: StatusDevolucao | null;
  para_status: StatusDevolucao;
  ator: AtorDoEvento;
  nota: string | null;
  created_at: string;
}

export interface PedidoDaDevolucao {
  id: string;
  total: number;
  shipping: number;
  payment_method: string | null;
  payment_status: string | null;
  canal: string | null;
  customer_name: string | null;
  whatsapp: string | null;
  shipping_label_id: string | null;
  shipping_option_id: string | null;
}

/** Retorno de `devolucao_detalhe`: a linha inteira + itens, trilha e pedido. */
export interface DevolucaoDetalhe {
  id: string;
  protocolo: string;
  order_id: string;
  tipo: TipoDevolucao;
  motivo: MotivoDevolucao;
  detalhe: string | null;
  resolucao_desejada: ResolucaoDevolucao;
  resolucao_final: ResolucaoDevolucao | null;
  modalidade: ModalidadeDevolucao;
  metodo_retorno: MetodoDevolucao;
  status: StatusDevolucao;
  valor_itens: number;
  valor_frete_ida: number;
  valor_reembolso: number | null;
  refund_id: string | null;
  reembolso_manual: boolean;
  fotos: string[];
  codigo_rastreio: string | null;
  codigo_postagem: string | null;
  etiqueta_url: string | null;
  coleta_em: string | null;
  mensagem_loja: string | null;
  observacao_inspecao: string | null;
  entregue_em: string | null;
  prazo_ate: string;
  /** Retrato da política no momento do pedido (pode faltar em linha velha). */
  politica: PoliticaDevolucao | null;
  created_at: string;
  aprovada_em: string | null;
  postada_em: string | null;
  recebida_em: string | null;
  concluida_em: string | null;
  encerrada_em: string | null;
  itens: ItemDevolvido[];
  eventos: EventoDevolucao[];
  pedido: PedidoDaDevolucao | null;
}

export type ContagemPorStatus = Record<StatusDevolucao, number>;

/** Uma linha de `admin_devolucoes_listar().itens`. */
export interface LinhaDevolucaoAdmin {
  id: string;
  protocolo: string;
  order_id: string;
  cliente_nome: string | null;
  cliente_whatsapp: string | null;
  tipo: TipoDevolucao;
  motivo: MotivoDevolucao;
  status: StatusDevolucao;
  resolucao_desejada: ResolucaoDevolucao;
  metodo_retorno: MetodoDevolucao;
  modalidade: ModalidadeDevolucao;
  valor_itens: number;
  prazo_ate: string;
  created_at: string;
}

export interface ListaDevolucoesAdmin {
  total: number;
  contagem: ContagemPorStatus;
  itens: LinhaDevolucaoAdmin[];
}

/** Retorno de `admin_devolucao_concluir`. */
export interface ResultadoConclusao {
  id: string;
  status: StatusDevolucao;
  resolucao: ResolucaoDevolucao;
  valor_reembolso: number | null;
  refund_id: string | null;
  reembolso_manual: boolean;
  reestocados: number;
}

/**
 * Retorno da edge `melhor-envio-etiqueta` (`gerar_devolucao_reversa`).
 * `me_reverse_id` fica de fora de propósito: pode ser token de reserva e
 * nunca é mostrado.
 */
export interface ResultadoEtiquetaReversa {
  /** Também é o código de rastreio dos Correios. */
  codigo_postagem: string;
  /** A declaração de conteúdo (DC-e) que o cliente imprime. */
  etiqueta_url: string | null;
  /** `already`: o código já existia (nada novo foi comprado). */
  ja_existia: boolean;
  /** Só numa geração nova (agora + 7 dias). */
  validade_ate: string | null;
}

/** Inspeção de um item na conclusão (`p_itens` de `admin_devolucao_concluir`). */
export interface InspecaoDoItem {
  item_id: string;
  condicao: CondicaoItemDevolvido;
  reestocar: boolean;
}
