// Tarefa C3.1 (plano docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md,
// seção 5.3): o CÉREBRO do caixa de balcão, isolado da tela. Tudo que este
// arquivo decide (o que entra no cupom, quando um bipe repetido é ignorado,
// quando o botão "Registrar venda" pode ser clicado, o que sobrevive a um
// F5) é PURO — nenhuma linha aqui chama Supabase, `fetch` nem lê `window`
// fora do próprio hook (`useVendaPresencial`, no fim do arquivo, que é a
// única parte impura: `localStorage` e o relógio do JS). A tela de C3.2 é
// burra de propósito: ela só mostra o `estado` e despacha ações.
//
// DECISÕES DO DONO que este arquivo aplica (contexto da tarefa):
//  D2 — cliente é "sem cliente", um `user_id` de cliente já cadastrado, ou
//       avulso por nome+WhatsApp. Não se cria conta aqui (v1).
//  D3 — sem rede a venda é RECUSADA, não enfileirada: o rascunho é a única
//       "fila" (o cupom simplesmente não é apagado até o servidor confirmar).
//  D4 — desconto é em REAIS e exige motivo escrito quando > 0.
//
// O preço de cada item vem SEMPRE do que a RPC `buscar_por_codigo_barras`
// devolveu (ou, na busca manual de C3.2, do que `get_admin_products_paged`
// devolveu) — nunca de algo digitado na tela. É por isso que `ItemDoCupom`
// não tem um "preço editável": mudar o preço aqui reabriria a classe de
// defeito que `src/lib/preco-vendido.ts` existe para fechar (override zero
// tratado como ausência de preço).

import { JANELA_DE_REPETICAO_MS } from "@/lib/leitor/debounce-de-leitura";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

// ============================================================================
// PASSO 1 — TIPOS
// ============================================================================

/** As cinco camadas da tela (plano 5.3): cada uma é uma "folha" por cima do
 * cupom, exceto `cupom`, que é a base. */
export type EtapaDaVenda =
  | "cupom"
  | "escolha_de_variacao"
  | "cliente"
  | "fechamento"
  | "pix"
  | "recibo";

/** A MESMA lista do union acima, mas em VALOR — é o que permite validar uma
 * etapa vinda de fora do compilador (o rascunho lido do `localStorage`, por
 * exemplo) contra a união fechada, em vez de aceitar qualquer `string`.
 * Achado ANOTADO da rodada de correção: `pareceRascunhoValido` checava só
 * `typeof v.etapa === "string"`, e uma etapa desconhecida (storage
 * adulterada, resíduo de uma versão futura) passava reto — a tela de C3.2
 * escolhe a camada por `estado.etapa` e não desenharia camada nenhuma. */
export const ETAPAS_DA_VENDA: readonly EtapaDaVenda[] = [
  "cupom",
  "escolha_de_variacao",
  "cliente",
  "fechamento",
  "pix",
  "recibo",
];

/** A lista É FECHADA na RPC `registrar_venda_presencial` (migration
 * 20261162000000:262-263) — espelhar aqui em vez de `string` solto é o que
 * faz o TypeScript recusar uma quarta forma de pagamento no build, antes do
 * 22023 do servidor. */
export type FormaDePagamentoDoBalcao = "cash" | "pix" | "card";

/** O que o balconista ESCOLHE na tela: as três formas de
 * `registrar_venda_presencial` (dinheiro, PIX na chave da loja conferido na
 * mão, maquininha) mais o PIX com QR (`pix_qr`), que NÃO passa por aquela RPC
 * — nasce à espera do pagamento em `iniciar_venda_presencial_pix` (migration
 * 20261184000000) e só vira venda paga quando o Mercado Pago confirma. */
export type FormaEscolhidaNoBalcao = FormaDePagamentoDoBalcao | "pix_qr";

/** O PIX com QR em curso. `chave` é a idempotência PRÓPRIA do PIX (nasce ao
 * tocar "Gerar PIX", nunca a do cupom — a do cupom fica livre para a venda em
 * dinheiro se o PIX for cancelado); `orderId` chega quando a RPC responde.
 * Vai para o rascunho: um F5 no meio da espera volta para o MESMO PIX. */
export interface PixDaVenda {
  readonly chave: string;
  readonly orderId: string | null;
}

/** Um item do cupom em curso. `chave` é a identidade do item NO CUPOM — dois
 * bipes do MESMO produto/variação somam quantidade no MESMO item; produto e
 * variação diferentes nunca colidem porque o `variantId` entra na chave. */
export interface ItemDoCupom {
  /** `${productId}::${variantId ?? ""}` — use `chaveDoItemDoCupom`, não
   * monte a string à mão (é o que garante que C3.1 e C3.2 nunca divirjam
   * do formato). */
  readonly chave: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly nome: string;
  /** "Tamanho PP" — já montada de `{nome, valor}` da variação; `null` para
   * produto sem variação. */
  readonly variacao: string | null;
  /** Preço vendido, exatamente como o BANCO devolveu. Nunca digitado. */
  readonly preco: number;
  readonly quantidade: number;
  /** Estoque efetivo no momento em que o item entrou/foi atualizado no
   * cupom (ver `estoqueEfetivo`, PASSO 4) — é o teto do `+`. */
  readonly estoque: number;
  readonly imagem: string;
}

/** D2: só estes três caminhos. Não existe um quarto "criar conta". */
export type ClienteDaVenda =
  | { readonly tipo: "sem_cliente" }
  | {
      readonly tipo: "cadastrado";
      readonly userId: string;
      readonly nome: string;
      readonly whatsapp: string | null;
    }
  | {
      readonly tipo: "avulso";
      readonly nome: string;
      readonly whatsapp: string;
    };

/** Os quatro avisos que a máquina pode acender para a tela — nenhum deles é
 * uma exceção lançada: são estado, porque a tela precisa continuar viva e
 * bipável logo depois (o balconista não para o turno por causa de um
 * código torto). */
export type AvisoDaVenda =
  | { readonly tipo: "nao_cadastrado"; readonly codigo: string }
  | { readonly tipo: "inativo"; readonly nome: string }
  | { readonly tipo: "esgotado"; readonly nome: string }
  | { readonly tipo: "ignorado_repetido"; readonly codigo: string };

/** Uma "opção" da folha de variação — mesma forma que a RPC devolve em
 * `variacoes[]` (migration 20261161000000:316-329). */
export interface OpcaoDeVariacao {
  readonly variant_id: string;
  readonly nome: string;
  readonly valor: string;
  readonly preco: number;
  readonly estoque: number;
  readonly imagem: string | null;
  readonly codigo_barras: string | null;
}

/** O "produto" que a RPC devolve — presente tanto quando `origem` é
 * `'produto'` quanto quando é `'variante'` (a variante sempre vem junto do
 * pai, migration 20261161000000:266-283). */
export interface ProdutoDoCodigo {
  readonly id: string;
  readonly nome: string;
  readonly ativo: boolean;
  readonly preco_venda: number;
  readonly estoque: number;
  readonly imagem: string | null;
  readonly codigo_barras: string | null;
  readonly tem_variantes: boolean;
}

/** A "variante" que a RPC devolve quando `origem === 'variante'`. */
export interface VarianteDoCodigo {
  readonly variant_id: string;
  readonly nome: string;
  readonly valor: string;
  readonly preco: number;
  readonly estoque: number;
  readonly imagem: string | null;
  readonly codigo_barras: string | null;
}

/** A resposta CRUA de `buscar_por_codigo_barras` (migration
 * 20261161000000:378-387) — as MESMAS nove chaves sempre, medidas no
 * contexto da tarefa. Quem chama a RPC é a tela (C3.2); este arquivo só lê
 * o resultado. */
export interface RespostaDoCodigo {
  readonly encontrado: boolean;
  readonly origem: "produto" | "variante" | null;
  readonly codigo: string;
  readonly produto: ProdutoDoCodigo | null;
  readonly variante: VarianteDoCodigo | null;
  readonly preco: number | null;
  readonly estoque: number | null;
  /** NUNCA null na RPC (ela usa `COALESCE(..., '[]'::jsonb)`) — mas o tipo
   * aceita indefinido/opcional de nada: é sempre um array, possivelmente
   * vazio. */
  readonly variacoes: readonly OpcaoDeVariacao[];
}

/** A folha de "qual combinação?" fica pendente entre o bipe do código do
 * MODELO e a escolha do balconista. `produtoId` NÃO está nas nove chaves da
 * RPC dentro de `variacoes[]` — vem de `resposta.produto.id`, guardado aqui
 * porque sem ele `variacao_escolhida` não teria como montar `productId`/
 * `chave` do item (decisão deste arquivo, registrada no relatório da
 * tarefa). */
export interface EscolhaDeVariacaoPendente {
  readonly codigo: string;
  readonly produtoId: string;
  readonly produtoNome: string;
  readonly opcoes: readonly OpcaoDeVariacao[];
}

/** O que a tela precisa do retorno de `registrar_venda_presencial`
 * (migration 20261162000000:498-515) para desenhar o recibo — já traduzido
 * para o vocabulário do cupom, não o jsonb cru da RPC. */
export interface ReciboDaVendaRegistrada {
  readonly orderId: string;
  /** Seis últimos caracteres do id, maiúsculos — mesma regra de
   * `AdminOrdersView.tsx:2028`. */
  readonly numero: string;
  readonly criadoEm: string;
  readonly total: number;
  readonly subtotal: number;
  readonly desconto: number;
  readonly pagamento: FormaEscolhidaNoBalcao;
  readonly cliente: ClienteDaVenda;
  readonly itens: readonly ItemDoCupom[];
  /** `true` quando a chave de idempotência já tinha sido usada e a RPC
   * devolveu o pedido existente em vez de criar outro (duplo toque). A
   * tela mostra o MESMO recibo, sem erro nenhum (pdv-c1.json). */
  readonly jaExistia: boolean;
}

/** O estado inteiro do caixa — é exatamente isto que o rascunho grava (menos
 * `recibo`/`enviando`/`erro`, que são de SESSÃO: ver `serializarRascunho`). */
export interface EstadoDaVenda {
  readonly etapa: EtapaDaVenda;
  readonly itens: readonly ItemDoCupom[];
  readonly cliente: ClienteDaVenda;
  readonly pagamento: FormaEscolhidaNoBalcao | null;
  /** B14 (resposta do dono, 28/09): no PIX na chave da loja e na maquininha
   * não há quem confirme sozinho — o balconista marca que CONFERIU o
   * pagamento (no app do banco / no comprovante da maquininha) antes de
   * registrar. Zera a cada troca de forma. */
  readonly pagamentoConferido: boolean;
  /** O PIX com QR em curso (ver `PixDaVenda`); `null` fora dele. */
  readonly pix: PixDaVenda | null;
  /** EM REAIS (D4), nunca centavos. */
  readonly desconto: number;
  /** Obrigatório quando `desconto > 0` (D4) — string vazia quando não há
   * desconto ou motivo ainda não digitado. */
  readonly motivoDoDesconto: string;
  /** UMA por cupom (PASSO 7): sobrevive ao rascunho, só muda em
   * `cupom_limpo`. É o que faz um F5 no meio da venda não virar pedido
   * duplicado quando a rede volta. */
  readonly chaveDeIdempotencia: string;
  readonly escolhaDeVariacao: EscolhaDeVariacaoPendente | null;
  /** O último item que ENTROU no cupom (não o último código decodificado —
   * ver o comentário de `deveIgnorarLeitura` sobre a diferença). A tela usa
   * isto para destacar o item recém-lido por ~2s. */
  readonly ultimaEntrada: {
    readonly chave: string;
    readonly codigo: string;
    readonly em: number;
  } | null;
  readonly aviso: AvisoDaVenda | null;
  readonly enviando: boolean;
  readonly erro: string | null;
  readonly recibo: ReciboDaVendaRegistrada | null;
}

/**
 * As ações da máquina. Duas delas carregam um dado que, em qualquer outro
 * lugar do arquivo, seria "impuro" (o instante `em`, a chave nova de
 * `cupom_limpo`): a regra desta tarefa é o REDUCER nunca ler
 * `Date.now()`/`crypto`/`localStorage` sozinho — quem chama `despachar`
 * (o hook, no fim do arquivo, ou o teste) é quem fornece esses valores. É
 * o mesmo molde de injeção de `src/lib/chave-do-pedido.ts:107`.
 */
export type AcaoDaVenda =
  /** A resposta CRUA da RPC `buscar_por_codigo_barras` para `codigo`. Quem
   * chama a RPC é a tela (C3.2); este arquivo só decide o que fazer com o
   * resultado. */
  | {
      readonly tipo: "codigo_resolvido";
      readonly codigo: string;
      readonly resposta: RespostaDoCodigo;
      readonly em: number;
    }
  | {
      readonly tipo: "variacao_escolhida";
      readonly opcao: OpcaoDeVariacao;
      readonly em: number;
    }
  | { readonly tipo: "variacao_cancelada" }
  /** A busca manual por nome/SKU (C3.2) desemboca aqui, pelo MESMO caminho
   * de guardas (soma de quantidade, teto de estoque) do bipe. */
  | {
      readonly tipo: "item_adicionado_manualmente";
      readonly item: ItemDoCupom;
      readonly em: number;
    }
  | {
      readonly tipo: "quantidade_alterada";
      readonly chave: string;
      readonly delta: 1 | -1;
    }
  | { readonly tipo: "item_removido"; readonly chave: string }
  /** `novaChave` é gerada por quem despacha (o hook, via `gerarChave`) —
   * não pelo reducer, que tem de continuar puro. Sem este campo o reducer
   * precisaria chamar `crypto.randomUUID()` sozinho, quebrando a garantia
   * de pureza que os testes desta tarefa cobram. */
  | { readonly tipo: "cupom_limpo"; readonly novaChave: string }
  | { readonly tipo: "cliente_definido"; readonly cliente: ClienteDaVenda }
  | {
      readonly tipo: "pagamento_escolhido";
      readonly pagamento: FormaEscolhidaNoBalcao;
    }
  | { readonly tipo: "pagamento_conferido"; readonly conferido: boolean }
  /** "Gerar PIX": a chave própria do PIX nasce AQUI (gerada por quem
   * despacha, como `cupom_limpo`) e vai para o rascunho ANTES da chamada —
   * se a resposta se perder, o retry usa a MESMA chave e recebe o mesmo
   * pedido. Chamar de novo com um PIX já preparado mantém a chave antiga. */
  | { readonly tipo: "pix_preparado"; readonly chave: string }
  /** A RPC respondeu: a venda existe, à espera do PIX. */
  | { readonly tipo: "pix_aberto"; readonly orderId: string }
  /** O PIX morreu (cancelado pela loja, vencido): volta ao fechamento com o
   * cupom INTACTO e a chave do PIX descartada — o próximo PIX é outra venda. */
  | { readonly tipo: "pix_encerrado" }
  | {
      readonly tipo: "desconto_alterado";
      readonly valor: number;
      readonly motivo: string;
    }
  | { readonly tipo: "etapa_pedida"; readonly etapa: EtapaDaVenda }
  | { readonly tipo: "aviso_limpo" }
  | { readonly tipo: "envio_iniciado" }
  | { readonly tipo: "envio_falhou"; readonly mensagem: string }
  | {
      readonly tipo: "venda_registrada";
      readonly recibo: ReciboDaVendaRegistrada;
    }
  /** O F5: o hook lê o rascunho na montagem e substitui o estado inteiro
   * por este. */
  | { readonly tipo: "rascunho_restaurado"; readonly estado: EstadoDaVenda };

// ============================================================================
// PASSO 7 (parte 1) — A CHAVE DE IDEMPOTÊNCIA nasce aqui, não no clique.
// ============================================================================

/**
 * Estado inicial de um cupom novo. `gerarChave` entra por parâmetro (molde:
 * `src/lib/chave-do-pedido.ts:107`) para o teste poder fixar a chave em vez
 * de depender de `crypto.randomUUID()` de verdade.
 */
export function estadoInicialDaVenda(
  gerarChave: () => string = () => globalThis.crypto.randomUUID(),
): EstadoDaVenda {
  return {
    etapa: "cupom",
    itens: [],
    cliente: { tipo: "sem_cliente" },
    pagamento: null,
    pagamentoConferido: false,
    pix: null,
    desconto: 0,
    motivoDoDesconto: "",
    chaveDeIdempotencia: gerarChave(),
    escolhaDeVariacao: null,
    ultimaEntrada: null,
    aviso: null,
    enviando: false,
    erro: null,
    recibo: null,
  };
}

// ============================================================================
// A chave do item no cupom — um único lugar monta a string, para C3.1 e a
// tela de C3.2 (que também precisa montar `ItemDoCupom` na busca manual)
// nunca divergirem do formato.
// ============================================================================

export function chaveDoItemDoCupom(
  productId: string,
  variantId: string | null,
): string {
  return `${productId}::${variantId ?? ""}`;
}

// ============================================================================
// PASSO 4 — O ESTOQUE EFETIVO (armadilha medida na revisão de C1.2)
// ============================================================================

/**
 * Quando `origem === 'produto'` e o produto TEM variações, a RPC devolve em
 * `estoque` o `p.estoque` da LINHA DO PRODUTO — que não é a soma das
 * variações (a coluna só existe para produto sem variação; para produto com
 * variação ela fica desatualizada por desenho, ninguém mais escreve nela).
 * Decidir "esgotado" por esse número aceitaria vender uma combinação sem
 * estoque nenhum, ou recusaria uma venda que tinha estoque nas combinações.
 * A regra espelha `mapProductFromDB` (src/lib/mappers.ts:97-106), que soma
 * `stock_increment` das variantes ativas em vez de usar a coluna do
 * produto.
 */
export function estoqueEfetivo(resposta: RespostaDoCodigo): number {
  if (!resposta.encontrado) return 0;
  if (resposta.origem === "variante") return resposta.estoque ?? 0;
  if (resposta.origem === "produto" && resposta.variacoes.length > 0) {
    return resposta.variacoes.reduce((soma, opcao) => soma + opcao.estoque, 0);
  }
  return resposta.estoque ?? 0;
}

// ============================================================================
// PASSO 3 — A GUARDA DA LEITURA REPETIDA
// ============================================================================

/**
 * `useLeitorDeCodigo` (C2) já ignora o MESMO código decodificado duas vezes
 * dentro de `JANELA_DE_REPETICAO_MS` — mas essa janela conta da
 * DECODIFICAÇÃO, e entre `aoLer` e este código chegar aqui como
 * `codigo_resolvido` há uma ida ao servidor (`buscar_por_codigo_barras`).
 * Duas leituras separadas por 1,6s (fora da janela do leitor) podem ter as
 * respostas voltando fora de ordem, ou uma resposta lenta pode chegar bem
 * depois de o item já ter entrado no cupom por outro caminho (busca
 * manual, por exemplo). Por isso esta guarda é sobre um fato DIFERENTE:
 * o código JÁ APLICADO ao cupom (`estado.ultimaEntrada`), não o código
 * decodificado pela câmera/teclado. Reaproveita a MESMA constante do
 * leitor (não redefine `1500`) porque o balconista espera o mesmo
 * comportamento nas duas pontas.
 */
export function deveIgnorarLeitura(
  estado: EstadoDaVenda,
  codigo: string,
  agora: number,
): boolean {
  const ultima = estado.ultimaEntrada;
  if (!ultima) return false;
  return ultima.codigo === codigo && agora - ultima.em < JANELA_DE_REPETICAO_MS;
}

// ============================================================================
// PASSO 5 — GUARDAS DE ETAPA E OS DERIVADOS PUROS (para não haver duas contas)
// ============================================================================

/** Não se vai para `fechamento` com o cupom vazio, nem para `recibo` sem
 * `recibo` preenchido. As demais etapas (`cupom`, `escolha_de_variacao`,
 * `cliente`) são sempre alcançáveis por navegação explícita.
 *
 * Achado ANTES DE CRESCER da rodada de correção: depois de `venda_registrada`
 * nada impedia `etapa_pedida` de tirar o estado de `recibo` de volta para
 * `cupom` com o cupom (itens, cliente, pagamento) INTACTO e a MESMA
 * `chaveDeIdempotencia` já consumida — o balconista monta uma venda NOVA
 * sobre uma chave velha, a RPC (migration 20261162000000, ramo de
 * idempotência) enxerga "duplo toque" e devolve o PEDIDO ANTIGO sem erro
 * nenhum: a segunda venda não nasce, o estoque não é debitado, mas o
 * dinheiro já entrou na gaveta. A ÚNICA saída da camada de recibo passa a
 * ser `cupom_limpo` (que gira a chave e não passa por `podeIrPara`) — nunca
 * `etapa_pedida`, que é o caminho que um Voltar/popstate tomaria. */
export function podeIrPara(
  estado: EstadoDaVenda,
  etapa: EtapaDaVenda,
): boolean {
  if (
    estado.etapa === "recibo" &&
    estado.recibo !== null &&
    etapa !== "recibo"
  ) {
    return false;
  }
  // PIX com QR aberto: a venda JÁ existe no banco, com o estoque reservado.
  // Sair da camada por navegação (Voltar, popstate) deixaria um QR pagável
  // sem ninguém olhando — a saída é `pix_encerrado` (depois de cancelar) ou
  // `venda_registrada` (pago), nunca `etapa_pedida`.
  if (estado.etapa === "pix" && estado.pix?.orderId && etapa !== "pix") {
    return false;
  }
  if (etapa === "pix") return Boolean(estado.pix?.orderId);
  if (etapa === "fechamento") return estado.itens.length > 0;
  if (etapa === "recibo") return estado.recibo !== null;
  return true;
}

/** Reais → centavos inteiros. A conta do cupom é feita em CENTAVOS (achado
 * D5 da investigação de 28/09): em float, 3 × 1,15 = 3,4499999… e um
 * desconto de 3,45 era recusado aqui como "maior que o subtotal" — o banco
 * (numeric) aceitaria. */
export function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function subtotalDaVenda(itens: readonly ItemDoCupom[]): number {
  const centavos = itens.reduce(
    (soma, item) => soma + emCentavos(item.preco) * item.quantidade,
    0,
  );
  return centavos / 100;
}

/** `subtotal - desconto`, nunca negativo — o clamp é só de exibição; quem
 * RECUSA desconto maior que o subtotal é `vendaPodeSerRegistrada` (e,
 * atrás dela, a RPC). */
export function totalDaVenda(estado: EstadoDaVenda): number {
  const centavos =
    emCentavos(subtotalDaVenda(estado.itens)) - emCentavos(estado.desconto);
  return Math.max(0, centavos) / 100;
}

/** Troco do dinheiro, em reais: `null` sem valor recebido; negativo quando
 * falta dinheiro. Só de tela — nada disto vai para a RPC. */
export function trocoDaVenda(
  total: number,
  recebido: number | null,
): number | null {
  if (recebido === null || !Number.isFinite(recebido)) return null;
  return (emCentavos(recebido) - emCentavos(total)) / 100;
}

/** As duas formas que ninguém confirma sozinho (B14). */
export function formaPedeConferencia(
  forma: FormaEscolhidaNoBalcao | null,
): boolean {
  return forma === "pix" || forma === "card";
}

/**
 * Repete, em português e ANTES da rede, as recusas que
 * `registrar_venda_presencial` daria (migration 20261162000000). Não é
 * duplicar a regra de dinheiro: o servidor continua sendo quem decide de
 * verdade — isto só evita a viagem de ida e volta para um erro que a tela
 * já sabia de antemão. Ordem e mensagens espelham a ordem em que a RPC
 * verifica (:262-360).
 */
export function vendaPodeSerRegistrada(
  estado: EstadoDaVenda,
): { readonly ok: true } | { readonly ok: false; readonly motivo: string } {
  if (estado.recibo !== null) {
    // Achado ANTES DE CRESCER (mesma causa de `podeIrPara`, cinturão e
    // suspensório): mesmo que algum caminho consiga tirar a etapa de
    // "recibo" sem passar por `cupom_limpo`, o botão de registrar não pode
    // reenviar um cupom cuja `chaveDeIdempotencia` já foi consumida por
    // ESTA venda.
    return {
      ok: false,
      motivo:
        "Esta venda já foi registrada — limpe o cupom para começar outra.",
    };
  }
  if (estado.pagamento === null) {
    // migration 20261162000000:264
    return {
      ok: false,
      motivo: "Forma de pagamento inválida para venda no balcão.",
    };
  }
  if (estado.itens.length === 0) {
    // migration 20261162000000:268
    return { ok: false, motivo: "A venda precisa de pelo menos um item." };
  }
  if (estado.desconto < 0) {
    // migration 20261162000000:280
    return { ok: false, motivo: "O desconto não pode ser negativo." };
  }
  if (estado.desconto > 0 && estado.motivoDoDesconto.trim() === "") {
    // migration 20261162000000:286
    return { ok: false, motivo: "Informe o motivo do desconto." };
  }
  if (emCentavos(estado.desconto) > emCentavos(subtotalDaVenda(estado.itens))) {
    // migration 20261162000000:360
    return {
      ok: false,
      motivo: "O desconto não pode ser maior que o subtotal da venda.",
    };
  }
  if (estado.pagamento === "pix_qr" && totalDaVenda(estado) <= 0) {
    // migration 20261184000000 — o Mercado Pago não gera PIX de R$ 0,00.
    return { ok: false, motivo: "Um PIX precisa de valor maior que zero." };
  }
  if (formaPedeConferencia(estado.pagamento) && !estado.pagamentoConferido) {
    return {
      ok: false,
      motivo:
        estado.pagamento === "pix"
          ? "Confira o PIX no app do banco e marque que conferiu."
          : "Confira o comprovante da maquininha e marque que conferiu.",
    };
  }
  return { ok: true };
}

// ============================================================================
// PASSO 2 — O REDUCER PURO
// ============================================================================

/**
 * Insere/soma `item` no cupom. Ler o MESMO item (mesma `chave`) de novo
 * SOMA quantidade — é o fluxo de caixa de mercado: três bipes do mesmo
 * produto são três unidades. O teto é sempre o estoque MAIS RECENTE que
 * chegou (`item.estoque`), porque o estoque pode ter mudado entre dois
 * bipes do mesmo código — usar o estoque do item já guardado no cupom
 * aceitaria uma soma que o servidor recusaria.
 */
function entrarItemNoCupom(
  estado: EstadoDaVenda,
  item: ItemDoCupom,
  codigoQueEntrou: string | null,
  em: number,
): EstadoDaVenda {
  const existente = estado.itens.find((i) => i.chave === item.chave);
  const quantidadeFinal = (existente?.quantidade ?? 0) + item.quantidade;

  if (quantidadeFinal > item.estoque) {
    // Não muda quantidade nenhuma: o bipe "estourou" o estoque vira aviso,
    // não uma soma parcial silenciosa. O estoque do item que JÁ está no
    // cupom, porém, é atualizado para o número recém-chegado do servidor —
    // é ele o teto do próximo "+" (ressalva da revisão r3).
    const itens = existente
      ? estado.itens.map((i) =>
          i.chave === item.chave ? { ...i, estoque: item.estoque } : i,
        )
      : estado.itens;
    return { ...estado, itens, aviso: { tipo: "esgotado", nome: item.nome } };
  }

  const itemAtualizado: ItemDoCupom = { ...item, quantidade: quantidadeFinal };
  const itens = existente
    ? estado.itens.map((i) => (i.chave === item.chave ? itemAtualizado : i))
    : [...estado.itens, itemAtualizado];

  return {
    ...estado,
    itens,
    aviso: null,
    ultimaEntrada: codigoQueEntrou
      ? { chave: item.chave, codigo: codigoQueEntrou, em }
      : estado.ultimaEntrada,
  };
}

/** Ações que mudam a VENDA (itens, cliente, forma, desconto). Com o PIX
 * aberto elas são ignoradas: a venda já foi gravada com o que estava na tela,
 * e o QR cobra aquele total — o cupom fica só de leitura até o PIX pagar ou
 * ser cancelado. */
const ACOES_QUE_MUDAM_A_VENDA: ReadonlySet<AcaoDaVenda["tipo"]> = new Set([
  "codigo_resolvido",
  "variacao_escolhida",
  "item_adicionado_manualmente",
  "quantidade_alterada",
  "item_removido",
  "cliente_definido",
  "pagamento_escolhido",
  "pagamento_conferido",
  "desconto_alterado",
]);

export function reducerDaVenda(
  estado: EstadoDaVenda,
  acao: AcaoDaVenda,
): EstadoDaVenda {
  if (estado.pix?.orderId && ACOES_QUE_MUDAM_A_VENDA.has(acao.tipo)) {
    return estado;
  }
  switch (acao.tipo) {
    case "codigo_resolvido": {
      // A guarda da leitura repetida vem PRIMEIRO: nenhum dos cinco
      // desfechos abaixo (nem "não cadastrado", nem "esgotado") deveria
      // reaparecer numa leitura que a máquina já processou há menos de
      // 1,5s (o defeito clássico é o mesmo aviso piscando duas vezes por
      // causa de duas respostas da mesma leitura chegando fora de ordem).
      if (deveIgnorarLeitura(estado, acao.codigo, acao.em)) {
        return {
          ...estado,
          aviso: { tipo: "ignorado_repetido", codigo: acao.codigo },
        };
      }

      const resposta = acao.resposta;

      // (1) não cadastrado.
      if (!resposta.encontrado) {
        return {
          ...estado,
          aviso: { tipo: "nao_cadastrado", codigo: acao.codigo },
        };
      }

      // (2) produto inativo — "inativo" é um terceiro caso, diferente de
      // "não cadastrado" e de "esgotado" (a RPC devolve o produto mesmo
      // inativo, de propósito, para a tela distinguir os três).
      if (resposta.produto?.ativo === false) {
        return {
          ...estado,
          aviso: { tipo: "inativo", nome: resposta.produto.nome },
        };
      }

      // (3)+(4) juntos para o caso de MODELO com variações: o critério de
      // aceite exige as DUAS coisas — "abre a folha quando há variações" E
      // "o esgotado, aqui, é decidido pela SOMA de variacoes[].estoque,
      // nunca por resposta.estoque" (PASSO 4). Se a folha abrisse sempre
      // que há variações, sem olhar a soma, a segunda regra nunca teria
      // efeito nenhum (toda combinação zerada abriria uma folha vazia em
      // vez de avisar "esgotado" — pior para o balconista, que teria de
      // clicar em cada opção para descobrir que nenhuma tem estoque). Por
      // isso a soma é calculada ANTES de decidir abrir a folha: só abre
      // quando SOBRA alguma combinação de verdade.
      if (resposta.origem === "produto" && resposta.variacoes.length > 0) {
        const somaDasVariacoes = estoqueEfetivo(resposta);
        if (somaDasVariacoes === 0) {
          return {
            ...estado,
            aviso: { tipo: "esgotado", nome: resposta.produto?.nome ?? "" },
          };
        }
        return {
          ...estado,
          etapa: "escolha_de_variacao",
          escolhaDeVariacao: {
            codigo: acao.codigo,
            produtoId: resposta.produto?.id ?? "",
            produtoNome: resposta.produto?.nome ?? "",
            opcoes: resposta.variacoes,
          },
          aviso: null,
        };
      }

      // (4) os outros dois casos (origem 'variante', ou 'produto' sem
      // variação): esgotado é `resposta.estoque` puro — é exatamente o que
      // `estoqueEfetivo` devolve aqui (PASSO 4).
      const estoque = estoqueEfetivo(resposta);
      if (estoque === 0) {
        return {
          ...estado,
          aviso: { tipo: "esgotado", nome: resposta.produto?.nome ?? "" },
        };
      }

      // (5) entra no cupom — `origem === 'variante'` ou produto sem
      // variação. `resposta.preco` já é o preço certo nos dois casos (a
      // RPC resolve `COALESCE(price_override, preco_venda)` para
      // variante, e `preco_venda` puro para produto sem variação).
      const item: ItemDoCupom = {
        chave: chaveDoItemDoCupom(
          resposta.produto?.id ?? "",
          resposta.origem === "variante"
            ? (resposta.variante?.variant_id ?? null)
            : null,
        ),
        productId: resposta.produto?.id ?? "",
        variantId:
          resposta.origem === "variante"
            ? (resposta.variante?.variant_id ?? null)
            : null,
        nome: resposta.produto?.nome ?? "",
        variacao:
          resposta.origem === "variante" && resposta.variante
            ? `${resposta.variante.nome} ${resposta.variante.valor}`.trim()
            : null,
        preco: resposta.preco ?? 0,
        quantidade: 1,
        estoque,
        imagem:
          (resposta.origem === "variante"
            ? resposta.variante?.imagem
            : resposta.produto?.imagem) ?? "",
      };
      return entrarItemNoCupom(estado, item, acao.codigo, acao.em);
    }

    case "variacao_escolhida": {
      const pendente = estado.escolhaDeVariacao;
      if (!pendente) return estado; // nada pendente: pedido inválido, ignora.

      const opcao = acao.opcao;
      if (opcao.estoque <= 0) {
        // A folha continua aberta: uma combinação esgotada não fecha a
        // escolha, só recusa ESSA opção — outra pode ter estoque.
        return {
          ...estado,
          aviso: { tipo: "esgotado", nome: pendente.produtoNome },
        };
      }

      const item: ItemDoCupom = {
        chave: chaveDoItemDoCupom(pendente.produtoId, opcao.variant_id),
        productId: pendente.produtoId,
        variantId: opcao.variant_id,
        nome: pendente.produtoNome,
        variacao: `${opcao.nome} ${opcao.valor}`.trim(),
        preco: opcao.preco,
        quantidade: 1,
        estoque: opcao.estoque,
        imagem: opcao.imagem ?? "",
      };
      return entrarItemNoCupom(
        { ...estado, escolhaDeVariacao: null, etapa: "cupom" },
        item,
        pendente.codigo,
        acao.em,
      );
    }

    case "variacao_cancelada":
      return { ...estado, etapa: "cupom", escolhaDeVariacao: null };

    case "item_adicionado_manualmente":
      // Mesmo caminho de guardas do bipe (soma de quantidade, teto de
      // estoque) — só não tem um "código" de leitor físico por trás, então
      // não atualiza `ultimaEntrada` por um código de barras (não existe
      // um aqui): usa a própria chave do item, que nunca colide com um
      // código de barras real.
      return entrarItemNoCupom(estado, acao.item, acao.item.chave, acao.em);

    case "quantidade_alterada": {
      const item = estado.itens.find((i) => i.chave === acao.chave);
      if (!item) return estado;

      if (acao.delta === -1 && item.quantidade <= 1) {
        // `-1` em quantidade 1 REMOVE — é o que a mão espera no balcão.
        // `aviso: null` (achado ANOTADO da rodada de correção): se o
        // balconista tinha acabado de estourar o teto do estoque, a tarja
        // "esgotado" não pode continuar acesa depois que o item saiu do
        // cupom — só `entrarItemNoCupom` (que ACRESCENTA) zerava o aviso;
        // os caminhos que TIRAM item também precisam.
        //
        // `ultimaEntrada` (achado ANOTADO): zera SÓ quando é a entrada do
        // item que está saindo. Sem isto, `deveIgnorarLeitura` continuava
        // vendo o código do item removido como "acabado de entrar" pelos
        // próximos 1,5s — rebipar na hora (o operador corrigindo um engano)
        // virava "ignorado_repetido" com o item já fora do cupom, uma
        // mensagem que afirma o oposto do que a tela mostra.
        return {
          ...estado,
          itens: estado.itens.filter((i) => i.chave !== acao.chave),
          aviso: null,
          ultimaEntrada:
            estado.ultimaEntrada?.chave === acao.chave
              ? null
              : estado.ultimaEntrada,
        };
      }

      const novaQuantidade = item.quantidade + acao.delta;
      if (novaQuantidade > item.estoque) {
        return { ...estado, aviso: { tipo: "esgotado", nome: item.nome } };
      }

      return {
        ...estado,
        itens: estado.itens.map((i) =>
          i.chave === acao.chave ? { ...i, quantidade: novaQuantidade } : i,
        ),
        aviso: null,
      };
    }

    case "item_removido":
      // Mesmo motivo do `-1` acima: tirar item tem de limpar um aviso de
      // estoque que não faz mais sentido depois que a folga voltou, e
      // liberar a `ultimaEntrada` do item removido da janela de 1,5s de
      // `deveIgnorarLeitura` (achado ANOTADO).
      return {
        ...estado,
        itens: estado.itens.filter((i) => i.chave !== acao.chave),
        aviso: null,
        ultimaEntrada:
          estado.ultimaEntrada?.chave === acao.chave
            ? null
            : estado.ultimaEntrada,
      };

    case "cupom_limpo":
      // Venda nova de verdade: cliente, pagamento e desconto voltam ao
      // ponto de partida, e a chave de idempotência GIRA — reaproveitar a
      // chave da venda anterior faria a próxima venda ser tratada como
      // reenvio da que já foi registrada.
      return {
        ...estado,
        etapa: "cupom",
        itens: [],
        cliente: { tipo: "sem_cliente" },
        pagamento: null,
        pagamentoConferido: false,
        pix: null,
        desconto: 0,
        motivoDoDesconto: "",
        chaveDeIdempotencia: acao.novaChave,
        escolhaDeVariacao: null,
        ultimaEntrada: null,
        aviso: null,
        recibo: null,
        erro: null,
        // Achado ANOTADO: era o único campo de sessão que sobrevivia à
        // limpeza do cupom — se a RPC de um envio anterior ficasse pendurada
        // (rede caindo, o mesmo cenário que justifica a idempotência) e o
        // balconista desistisse com "limpar cupom", `enviando` continuava
        // `true` no cupom novo, e um botão desabilitado por
        // `estado.enviando` ficava morto até um reload.
        enviando: false,
      };

    case "cliente_definido":
      return { ...estado, cliente: acao.cliente };

    case "pagamento_escolhido":
      return {
        ...estado,
        pagamento: acao.pagamento,
        pagamentoConferido:
          acao.pagamento === estado.pagamento
            ? estado.pagamentoConferido
            : false,
      };

    case "pagamento_conferido":
      return { ...estado, pagamentoConferido: acao.conferido };

    case "pix_preparado":
      return estado.pix
        ? { ...estado, enviando: true, erro: null }
        : {
            ...estado,
            pix: { chave: acao.chave, orderId: null },
            enviando: true,
            erro: null,
          };

    case "pix_aberto":
      if (!estado.pix) return estado;
      return {
        ...estado,
        pix: { ...estado.pix, orderId: acao.orderId },
        etapa: "pix",
        enviando: false,
        erro: null,
      };

    case "pix_encerrado":
      return {
        ...estado,
        pix: null,
        etapa: estado.itens.length > 0 ? "fechamento" : "cupom",
        enviando: false,
      };

    case "desconto_alterado":
      // Achado D6 (28/09): o motivo digitado sobrevivia ao desconto zerado e
      // ia parar nas notas do pedido como se explicasse um desconto que não
      // existe. Sem desconto, sem motivo.
      return {
        ...estado,
        desconto: acao.valor,
        motivoDoDesconto: acao.valor > 0 ? acao.motivo : "",
      };

    case "etapa_pedida":
      // Pedido inválido devolve o estado como está, sem erro: a tela não
      // deveria ter oferecido o botão que levou a isto.
      return podeIrPara(estado, acao.etapa)
        ? { ...estado, etapa: acao.etapa }
        : estado;

    case "aviso_limpo":
      return { ...estado, aviso: null };

    case "envio_iniciado":
      return { ...estado, enviando: true, erro: null };

    case "envio_falhou":
      return { ...estado, enviando: false, erro: acao.mensagem };

    case "venda_registrada":
      return {
        ...estado,
        enviando: false,
        erro: null,
        recibo: acao.recibo,
        etapa: "recibo",
      };

    case "rascunho_restaurado":
      return acao.estado;

    default: {
      // Exaustividade: se um novo `tipo` for adicionado ao union sem um
      // `case` aqui, o TypeScript recusa o build nesta linha.
      const _exaustivo: never = acao;
      return _exaustivo;
    }
  }
}

// ============================================================================
// PASSO 6 — O RASCUNHO
// ============================================================================

/** Mesma família de `admin_banner_form_draft` (src/lib/localStoragePurgeWhitelist.ts). */
export const CHAVE_DO_RASCUNHO_DA_VENDA = "admin_pdv_venda_draft";

type EstadoPersistidoNoRascunho = Omit<
  EstadoDaVenda,
  "recibo" | "enviando" | "erro"
>;

/**
 * `recibo`, `enviando` e `erro` são de SESSÃO, não da venda em si: gravá-los
 * faria um F5 depois de uma venda registrada reabrir a tela de recibo como
 * se a venda ainda estivesse em curso (risco medido na tarefa).
 */
export function serializarRascunho(estado: EstadoDaVenda): string {
  const {
    recibo: _recibo,
    enviando: _enviando,
    erro: _erro,
    ...persistido
  } = estado;
  return JSON.stringify(persistido);
}

/** Type guard defensivo: JSON válido mas com a forma errada (itens não é
 * array, item sem `productId`, `chaveDeIdempotencia` que não é string) NÃO
 * vira um cupom torto na tela — vira `null`, como se não houvesse rascunho
 * nenhum. */
function pareceRascunhoValido(
  valor: unknown,
): valor is EstadoPersistidoNoRascunho {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;

  if (typeof v.etapa !== "string") return false;
  if (typeof v.chaveDeIdempotencia !== "string") return false;
  if (typeof v.desconto !== "number") return false;
  if (typeof v.motivoDoDesconto !== "string") return false;
  if (!Array.isArray(v.itens)) return false;

  // Ressalva da revisão (r3): sem validar `cliente`, um rascunho sem esse
  // campo virava estado e o efeito de gravar/apagar lançava em
  // `estado.cliente.tipo` ANTES do removeItem — o rascunho envenenado
  // ficava em disco e toda abertura seguinte quebrava igual.
  // Campos nascidos depois (28/09): rascunho antigo, sem eles, continua
  // válido (vira `false`/`null` em `lerRascunho`); com eles, têm de ter a
  // forma certa.
  if (
    v.pagamentoConferido !== undefined &&
    typeof v.pagamentoConferido !== "boolean"
  )
    return false;
  if (v.pix !== undefined && v.pix !== null) {
    if (typeof v.pix !== "object") return false;
    const pix = v.pix as Record<string, unknown>;
    if (typeof pix.chave !== "string") return false;
    if (pix.orderId !== null && typeof pix.orderId !== "string") return false;
  }

  if (typeof v.cliente !== "object" || v.cliente === null) return false;
  const tipoDoCliente = (v.cliente as { tipo?: unknown }).tipo;
  if (
    tipoDoCliente !== "sem_cliente" &&
    tipoDoCliente !== "cadastrado" &&
    tipoDoCliente !== "avulso"
  )
    return false;

  for (const item of v.itens) {
    if (typeof item !== "object" || item === null) return false;
    const i = item as Record<string, unknown>;
    if (typeof i.productId !== "string") return false;
    // Preço, quantidade e estoque alimentam o total e o teto do "+": um
    // rascunho com NaN/string aqui produziria um cupom que soma lixo.
    if (typeof i.preco !== "number" || !Number.isFinite(i.preco)) return false;
    if (typeof i.quantidade !== "number" || !Number.isFinite(i.quantidade))
      return false;
    if (typeof i.estoque !== "number" || !Number.isFinite(i.estoque))
      return false;
  }

  return true;
}

/**
 * Lê o rascunho gravado por `serializarRascunho`. NUNCA lança: `JSON.parse`
 * de valor torto (aspas quebradas, cauda cortada por quota estourada) cai
 * no `catch`; JSON válido mas com forma inesperada cai no
 * `pareceRascunhoValido`. As duas rotas devolvem `null`.
 *
 * A etapa restaurada passa por DUAS guardas antes de voltar, nesta ordem:
 *
 * 1. Contra a união FECHADA (`ETAPAS_DA_VENDA`), não só `typeof === "string"`
 *    (achado ANOTADO da rodada de correção): `pareceRascunhoValido` valida a
 *    FORMA (é string?), não o VOCABULÁRIO — storage adulterada no devtools
 *    do balcão, resíduo de uma versão futura que renomeie uma etapa, ou um
 *    deploy que troque o vocabulário produziriam uma etapa que não pertence
 *    a `EtapaDaVenda`. Sem esta guarda, `podeIrPara` (abaixo) cairia no seu
 *    `return true` final para qualquer etapa desconhecida — ela não é
 *    "fechamento" nem "recibo" — e devolveria um `EstadoDaVenda` cujo
 *    `etapa` não pertence ao tipo declarado; a tela de C3.2, que escolhe a
 *    camada por `estado.etapa`, não desenharia camada nenhuma.
 * 2. Contra `podeIrPara`: como o rascunho NUNCA guarda `recibo` (linha
 *    acima), um estado serializado com `etapa: "recibo"` — a venda foi
 *    registrada bem antes do rascunho ter sido apagado, achado BLOQUEIA da
 *    rodada de correção — voltaria com `etapa: "recibo"` e `recibo: null`,
 *    exatamente a combinação que `podeIrPara` declara impossível.
 *    `rascunho_restaurado` troca o estado inteiro sem passar por essa
 *    guarda, então o invariante não pode depender só de quem grava
 *    (`serializarRascunho`/o efeito do hook nunca persistirem uma venda
 *    fechada) — quem LÊ também recusa a combinação, rebaixando para
 *    `cupom`, a única etapa sempre segura.
 */
export function lerRascunho(bruto: string | null): EstadoDaVenda | null {
  if (!bruto) return null;
  try {
    const objeto: unknown = JSON.parse(bruto);
    if (!pareceRascunhoValido(objeto)) return null;
    const restaurado: EstadoDaVenda = {
      ...objeto,
      pagamentoConferido: objeto.pagamentoConferido ?? false,
      pix: objeto.pix ?? null,
      recibo: null,
      enviando: false,
      erro: null,
    };
    const etapaConhecida = ETAPAS_DA_VENDA.includes(restaurado.etapa)
      ? restaurado.etapa
      : "cupom";
    const etapa = podeIrPara(restaurado, etapaConhecida)
      ? etapaConhecida
      : "cupom";
    return { ...restaurado, etapa };
  } catch {
    return null;
  }
}

// ============================================================================
// PASSO 8 — O HOOK (a única parte impura do arquivo)
// ============================================================================

interface ArmazenamentoDoRascunho {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export interface OpcoesDoVendaPresencial {
  /** Injetável para teste; padrão `window.localStorage`. */
  readonly armazenamento?: ArmazenamentoDoRascunho;
  readonly gerarChave?: () => string;
  readonly agora?: () => number;
  /** Debounce da gravação do rascunho — padrão 300ms (mesma ordem de
   * grandeza do `delay` de `LocalBufferedInput`). */
  readonly atrasoDeGravacaoMs?: number;
}

function armazenamentoPadrao(): ArmazenamentoDoRascunho | null {
  // Molde de `useLocalStorage.ts`: em SSR/teste sem DOM, `window` não
  // existe — a ausência de armazenamento vira "sem rascunho", não um
  // `throw` na primeira renderização.
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export interface VendaPresencialEmUso {
  readonly estado: EstadoDaVenda;
  readonly despachar: (acao: AcaoDaVenda) => void;
  readonly subtotal: number;
  readonly total: number;
  readonly podeRegistrar: boolean;
  readonly limparCupom: () => void;
  /** `true` quando o estado inicial veio de um rascunho salvo (F5 no meio
   * de uma venda), não de um cupom novo. */
  readonly restaurado: boolean;
}

/**
 * A máquina de estados do caixa, com rascunho e chave de idempotência.
 * NÃO chama Supabase nem `fetch` — C3.2 injeta as buscas por prop na tela e
 * C3.4 liga o fechamento de verdade.
 */
export function useVendaPresencial(
  opcoes: OpcoesDoVendaPresencial = {},
): VendaPresencialEmUso {
  const gerarChave =
    opcoes.gerarChave ?? (() => globalThis.crypto.randomUUID());
  const atrasoDeGravacaoMs = opcoes.atrasoDeGravacaoMs ?? 300;

  // Refs para não recriar os efeitos a cada render por causa de uma opção
  // que quase sempre é a mesma função com identidade nova. A ESCRITA do
  // ref mora dentro de um `useEffect` sem lista de dependências (roda a
  // cada render, DEPOIS do commit) — nunca durante o corpo da função: é o
  // que a regra `react-hooks/refs` (eslint-plugin-react-hooks, baseada no
  // React Compiler) cobra, e é o mesmo molde de `useLeitorDeCodigo.ts:164`
  // e `useBuscaCep.ts:50-51`.
  const gerarChaveRef = useRef(gerarChave);
  useEffect(() => {
    gerarChaveRef.current = gerarChave;
  });
  const armazenamentoRef = useRef(
    opcoes.armazenamento ?? armazenamentoPadrao(),
  );
  useEffect(() => {
    armazenamentoRef.current = opcoes.armazenamento ?? armazenamentoPadrao();
  });

  // `gerarChave` (a variável, não o ref) — o inicializador do `useReducer`
  // só roda UMA vez, na primeira renderização, então não há closure velha
  // para se preocupar aqui (o ref é para `limparCupom`, mais abaixo, que
  // precisa da versão MAIS RECENTE em uma callback de identidade estável).
  const [estado, despachar] = useReducer(reducerDaVenda, undefined, () =>
    estadoInicialDaVenda(gerarChave),
  );
  const [restaurado, setRestaurado] = useState(false);
  // Achado BLOQUEIA da rodada de correção: sinaliza para o efeito de
  // gravar/apagar (logo abaixo) que o commit de LEITURA do rascunho já
  // aconteceu. Um `useRef` marcado aqui dentro NÃO resolveria — o efeito de
  // gravação roda DEPOIS deste, no MESMO commit (a mesma "flush" de
  // effects), e veria o ref já ligado mesmo com `estado` ainda PRISTINO
  // (a ação `rascunho_restaurado` despachada abaixo só vira `estado` de
  // verdade no PRÓXIMO commit). Só um sinal que force um RE-RENDER —
  // `useState` — garante que o efeito de gravação só comece a agir a
  // partir do commit em que `estado` já é o estado restaurado.
  const [prontoParaGravar, setProntoParaGravar] = useState(false);

  // Lê o rascunho UMA vez, na montagem — um cupom em curso sobrevive ao F5.
  useEffect(() => {
    const armazenamento = armazenamentoRef.current;
    if (!armazenamento) {
      // Sem armazenamento (SSR/teste sem DOM) não há rascunho para esperar:
      // libera a gravação já no primeiro commit (ela também vai encontrar
      // `armazenamento` nulo e não fazer nada).
      setProntoParaGravar(true);
      return;
    }

    let bruto: string | null = null;
    try {
      bruto = armazenamento.getItem(CHAVE_DO_RASCUNHO_DA_VENDA);
    } catch (erro) {
      console.error("Erro ao ler rascunho da venda no balcão:", erro);
    }

    const estadoRestaurado = lerRascunho(bruto);
    if (estadoRestaurado) {
      despachar({ tipo: "rascunho_restaurado", estado: estadoRestaurado });
      setRestaurado(true);
    }
    setProntoParaGravar(true);
    // `despachar` do useReducer é estável entre renders — a lista vazia é
    // mesmo "só na montagem", não uma dependência esquecida.
  }, []);

  // Grava no debounce a cada mudança de estado — OU apaga, quando não há
  // nada que mereça sobreviver a um F5. `serializarRascunho` já recorta o
  // que NÃO é venda (recibo/enviando/erro, Passo 6) antes de escrever —
  // depender do objeto `estado` inteiro (em vez de listar
  // itens/cliente/pagamento/desconto um a um) é o que faz esta lista de
  // dependências ficar exaustiva de verdade: listar os campos à mão aqui
  // duplicaria, fora de vista, a mesma lista que `serializarRascunho` já
  // mantém, e as duas listas divergirem é o defeito clássico de
  // `exhaustive-deps` ignorado.
  //
  // Achado BLOQUEIA da rodada de correção, ainda de pé depois de juntar os
  // dois efeitos num só: no commit da MONTAGEM, este efeito roda no MESMO
  // flush que o efeito de leitura (acima, declarado primeiro) — mas
  // `estado` aqui AINDA é o pristino (o `despachar({tipo:
  // "rascunho_restaurado", ...})` do efeito de leitura só vira `estado` de
  // verdade no commit SEGUINTE). Um cupom vazio é "nada a guardar", então
  // este efeito apagava um rascunho válido em disco antes mesmo de a
  // restauração ser aplicada — o cupom só voltava ao disco
  // `atrasoDeGravacaoMs` depois, quando o re-render com o estado restaurado
  // reagendava a gravação; se a tela remontasse (F5, popstate) DENTRO
  // dessa janela, o cleanup cancelava o `setTimeout` e o rascunho sumia
  // para sempre. A guarda `prontoParaGravar` (setada pelo efeito de
  // leitura, sempre, restaurando ou não) resolve isto: este efeito não
  // toca no armazenamento até o PRÓXIMO commit, o que garante que `estado`
  // já é o estado restaurado quando ele decide gravar ou apagar.
  useEffect(() => {
    if (!prontoParaGravar) return;

    const armazenamento = armazenamentoRef.current;
    if (!armazenamento) return;

    const cupomSemNadaAGuardar =
      estado.pix === null &&
      estado.itens.length === 0 &&
      estado.pagamento === null &&
      estado.desconto === 0 &&
      estado.cliente.tipo === "sem_cliente";

    if (estado.recibo !== null || cupomSemNadaAGuardar) {
      try {
        armazenamento.removeItem(CHAVE_DO_RASCUNHO_DA_VENDA);
      } catch (erro) {
        console.error("Erro ao apagar rascunho da venda no balcão:", erro);
      }
      return;
    }

    const identificador = setTimeout(() => {
      try {
        armazenamento.setItem(
          CHAVE_DO_RASCUNHO_DA_VENDA,
          serializarRascunho(estado),
        );
      } catch (erro) {
        // QuotaExceededError não pode derrubar a venda em curso — mesmo
        // cuidado de src/hooks/useOrders.ts:1291-1302. O cupom continua
        // vivo em memória; só o rascunho em disco fica desatualizado.
        console.error("Erro ao salvar rascunho da venda no balcão:", erro);
      }
    }, atrasoDeGravacaoMs);

    return () => clearTimeout(identificador);
  }, [estado, atrasoDeGravacaoMs, prontoParaGravar]);

  const limparCupom = useCallback(() => {
    despachar({ tipo: "cupom_limpo", novaChave: gerarChaveRef.current() });
    const armazenamento = armazenamentoRef.current;
    if (!armazenamento) return;
    try {
      armazenamento.removeItem(CHAVE_DO_RASCUNHO_DA_VENDA);
    } catch (erro) {
      console.error("Erro ao apagar rascunho da venda no balcão:", erro);
    }
  }, []);

  const subtotal = useMemo(() => subtotalDaVenda(estado.itens), [estado.itens]);
  const total = useMemo(() => totalDaVenda(estado), [estado]);
  const podeRegistrar = useMemo(
    () => vendaPodeSerRegistrada(estado).ok,
    [estado],
  );

  return {
    estado,
    despachar,
    subtotal,
    total,
    podeRegistrar,
    limparCupom,
    restaurado,
  };
}
