// Funções puras do Financeiro do painel: parsers defensivos das RPCs
// `fin_*`, rótulos em português, conta de período, dinheiro em pt-BR,
// agrupamento do extrato por dia, saldo corrente e validação do lançamento.
//
// Nada aqui toca rede, React ou `localStorage` — tudo é testável em
// tests/front/financeiro-lib.test.ts. O contrato das RPCs é a seção
// "Financeiro" do plano docs/superpowers/plans/2026-09-26-painel-cartao-e-
// devolucoes.md; o supabase-js tipa o retorno como `Json`, então CADA campo
// é lido com guarda (número que chega como texto, lista que chega `null`
// porque `jsonb_agg` de zero linhas é NULL, etc.).
//
// Dinheiro sempre em CENTAVOS inteiros antes de somar/subtrair — `50 - 4.23`
// em ponto flutuante dá `45.769999…`, não `45.77`.

import type {
  CaixaAtual,
  CategoriaFinanceira,
  ContaFinanceira,
  DataIso,
  DiaDaSerie,
  DreFinanceira,
  FechamentoDeCaixa,
  GrupoDaDre,
  IntervaloDeDatas,
  LancamentoPrevisto,
  LinhaDaDre,
  LinhaDoExtrato,
  MovimentoDoCaixa,
  NaturezaDaCategoria,
  PayloadDaCategoria,
  PayloadDaConta,
  PayloadDoLancamento,
  PeriodoEscolhido,
  ResumoFinanceiro,
  SaldoDeConta,
  SessaoDeCaixa,
  StatusDoLancamento,
  TipoDeConta,
  TipoDeLancamento,
  TotaisPrevistos,
} from "@/types/financeiro";

// ---------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------

/** Maior valor que cabe em `numeric(10,2)`. */
export const VALOR_MAXIMO = 99_999_999.99;

export const paraCentavos = (valor: number): number => Math.round(valor * 100);

const deCentavos = (centavos: number): number => centavos / 100;

const FORMATADOR_BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const FORMATADOR_COMPACTO = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const FORMATADOR_PERCENTUAL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "R$ 1.234,56" — sem sinal (o valor absoluto). `-0` vira "R$ 0,00". */
export function formatarBRL(valor: number): string {
  const centavos = Math.abs(paraCentavos(valor));
  return FORMATADOR_BRL.format(deCentavos(centavos));
}

/** Sinal de menos tipográfico (U+2212), o mesmo em toda a tela. */
const SINAL_DE_MENOS = "−";

/**
 * "+R$ 10,00" / "−R$ 10,00" / "R$ 0,00". A cor nunca é a única pista
 * (spec §7): o sinal vem escrito.
 */
export function formatarBRLComSinal(valor: number): string {
  const centavos = paraCentavos(valor);
  if (centavos > 0) return `+${formatarBRL(valor)}`;
  if (centavos < 0) return `${SINAL_DE_MENOS}${formatarBRL(valor)}`;
  return formatarBRL(0);
}

/** Eixo de gráfico: "R$ 1,2 mil". */
export function formatarBRLCompacto(valor: number): string {
  const sinal = valor < 0 ? SINAL_DE_MENOS : "";
  return `${sinal}R$ ${FORMATADOR_COMPACTO.format(Math.abs(valor))}`;
}

/** "12,3%" ou "—" quando não há base. */
export function formatarPercentual(percentual: number | null): string {
  if (percentual === null || !Number.isFinite(percentual)) return "—";
  const texto = FORMATADOR_PERCENTUAL.format(Math.abs(percentual));
  return `${percentual < 0 ? SINAL_DE_MENOS : ""}${texto}%`;
}

const SO_DIGITOS = /^\d+$/;
const UM_A_TRES_DIGITOS = /^\d{1,3}$/;
const TRES_DIGITOS = /^\d{3}$/;
const UM_OU_DOIS_DIGITOS = /^\d{1,2}$/;

/** "1.234.567" — pontos só como separador de milhar bem formado. */
function ehMilharComPonto(texto: string): boolean {
  const [primeiro = "", ...grupos] = texto.split(".");
  return (
    grupos.length > 0 &&
    UM_A_TRES_DIGITOS.test(primeiro) &&
    grupos.every((grupo) => TRES_DIGITOS.test(grupo))
  );
}

/** "1234", "1234,5" ou "1234,56" (até 2 casas depois do separador). */
function ehDecimalComSeparador(texto: string, separador: "." | ","): boolean {
  const partes = texto.split(separador);
  if (partes.length > 2) return false;
  const [inteira = "", decimal] = partes;
  return (
    SO_DIGITOS.test(inteira) &&
    (decimal === undefined || UM_OU_DOIS_DIGITOS.test(decimal))
  );
}

/**
 * Lê dinheiro digitado em pt-BR e devolve reais com 2 casas (ou `null`).
 *
 * - "1.234,56" → 1234.56 (ponto é milhar, vírgula é decimal);
 * - "1234,5"   → 1234.5;
 * - "1.234"    → 1234 (três dígitos depois do ponto = milhar, como no BR);
 * - "1234.56"  → 1234.56 (o que o `LocalBufferedInput` com máscara de
 *   moeda devolve no `onFlush`);
 * - "R$ 10"    → 10; vazio, letras ou mais de 2 casas → `null`.
 */
export function parseValorBR(entrada: string | number | null | undefined) {
  if (typeof entrada === "number") {
    return Number.isFinite(entrada) ? deCentavos(paraCentavos(entrada)) : null;
  }
  if (typeof entrada !== "string") return null;
  let texto = entrada.replace(/R\$/gi, "").replace(/\s/g, "");
  let negativo = false;
  if (texto.startsWith("-") || texto.startsWith(SINAL_DE_MENOS)) {
    negativo = true;
    texto = texto.slice(1);
  }
  if (texto === "") return null;

  let normalizado: string;
  if (texto.includes(",")) {
    const semMilhar = texto.replace(/\./g, "");
    if (!ehDecimalComSeparador(semMilhar, ",")) return null;
    // Pontos só são aceitos como separador de milhar bem formado.
    const [parteInteira = ""] = texto.split(",");
    if (parteInteira.includes(".") && !ehMilharComPonto(parteInteira)) {
      return null;
    }
    normalizado = semMilhar.replace(",", ".");
  } else if (texto.includes(".")) {
    if (ehMilharComPonto(texto)) normalizado = texto.replace(/\./g, "");
    else if (ehDecimalComSeparador(texto, ".")) normalizado = texto;
    else return null;
  } else if (SO_DIGITOS.test(texto)) {
    normalizado = texto;
  } else {
    return null;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return null;
  const reais = deCentavos(paraCentavos(numero));
  return negativo ? -reais : reais;
}

/**
 * Valor de cada parcela, em reais. `exata` diz se a divisão fecha sem
 * centavo sobrando — quando não fecha, a tela avisa que a soma é o total.
 */
export function valorDaParcela(
  total: number,
  parcelas: number,
): { readonly parcela: number; readonly exata: boolean } {
  const n = Math.max(1, Math.trunc(parcelas));
  const centavos = paraCentavos(total);
  return {
    parcela: deCentavos(Math.floor(centavos / n)),
    exata: centavos % n === 0,
  };
}

// ---------------------------------------------------------------------------
// Datas (calendário America/Sao_Paulo, sempre como texto `YYYY-MM-DD`)
// ---------------------------------------------------------------------------

const FUSO_DA_LOJA = "America/Sao_Paulo";

const FORMATADOR_DIA_SP = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_DA_LOJA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FORMATADOR_HORA_SP = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_LOJA,
  hour: "2-digit",
  minute: "2-digit",
});

const FORMATADOR_DATA_HORA_SP = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_LOJA,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const FORMATADOR_DIA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

const FORMATADOR_MES_ANO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const FORMATADOR_MES_CURTO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "short",
});

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** O dia de hoje no calendário da loja (não no do aparelho em UTC). */
export function hojeEmSaoPaulo(agora: Date = new Date()): DataIso {
  let ano = "";
  let mes = "";
  let dia = "";
  for (const parte of FORMATADOR_DIA_SP.formatToParts(agora)) {
    if (parte.type === "year") ano = parte.value;
    else if (parte.type === "month") mes = parte.value;
    else if (parte.type === "day") dia = parte.value;
  }
  return `${ano}-${mes}-${dia}`;
}

function paraDataUtc(iso: DataIso): Date {
  const casamento = DATA_ISO.exec(iso);
  if (!casamento) return new Date(Number.NaN);
  const [, ano, mes, dia] = casamento;
  return new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
}

function deDataUtc(data: Date): DataIso {
  return data.toISOString().slice(0, 10);
}

/** Texto `YYYY-MM-DD` que é uma data de calendário de verdade. */
export function ehDataIso(valor: unknown): valor is DataIso {
  if (typeof valor !== "string" || !DATA_ISO.test(valor)) return false;
  const data = paraDataUtc(valor);
  return !Number.isNaN(data.getTime()) && deDataUtc(data) === valor;
}

function somarDias(iso: DataIso, dias: number): DataIso {
  const data = paraDataUtc(iso);
  data.setUTCDate(data.getUTCDate() + dias);
  return deDataUtc(data);
}

/** `fim - inicio`, em dias inteiros. */
function diasEntre(inicio: DataIso, fim: DataIso): number {
  return Math.round(
    (paraDataUtc(fim).getTime() - paraDataUtc(inicio).getTime()) / 86_400_000,
  );
}

function inicioDoMes(iso: DataIso): DataIso {
  return `${iso.slice(0, 7)}-01`;
}

function fimDoMes(iso: DataIso): DataIso {
  const data = paraDataUtc(inicioDoMes(iso));
  data.setUTCMonth(data.getUTCMonth() + 1);
  data.setUTCDate(0);
  return deDataUtc(data);
}

/** Últimos 30 dias contando hoje — a janela do gráfico de fluxo de caixa. */
export function ultimos30Dias(hoje: DataIso): IntervaloDeDatas {
  return { inicio: somarDias(hoje, -29), fim: hoje };
}

/**
 * Traduz o período escolhido para `{inicio, fim}` (inclusivos). Mês e ano
 * são o CALENDÁRIO inteiro (o extrato mostra o previsto até o fim do mês);
 * 7d/30d terminam hoje. Personalizado inválido → `null`.
 */
export function intervaloDoPeriodo(
  periodo: PeriodoEscolhido,
  hoje: DataIso,
): IntervaloDeDatas | null {
  switch (periodo.preset) {
    case "mes_atual":
      return { inicio: inicioDoMes(hoje), fim: fimDoMes(hoje) };
    case "mes_anterior": {
      const ultimoDiaDoAnterior = somarDias(inicioDoMes(hoje), -1);
      return {
        inicio: inicioDoMes(ultimoDiaDoAnterior),
        fim: ultimoDiaDoAnterior,
      };
    }
    case "7d":
      return { inicio: somarDias(hoje, -6), fim: hoje };
    case "30d":
      return ultimos30Dias(hoje);
    case "ano":
      return {
        inicio: `${hoje.slice(0, 4)}-01-01`,
        fim: `${hoje.slice(0, 4)}-12-31`,
      };
    case "personalizado": {
      const intervalo = periodo.personalizado;
      if (!intervalo) return null;
      return validarIntervalo(intervalo.inicio, intervalo.fim) === null
        ? { inicio: intervalo.inicio, fim: intervalo.fim }
        : null;
    }
    default:
      return null;
  }
}

/** Máximo de dias de um período personalizado (5 anos). */
const MAXIMO_DE_DIAS_DO_PERIODO = 366 * 5;

/** `null` quando o intervalo serve; senão a frase do erro. */
export function validarIntervalo(inicio: string, fim: string): string | null {
  if (!ehDataIso(inicio)) return "Informe a data de início.";
  if (!ehDataIso(fim)) return "Informe a data de fim.";
  if (fim < inicio) return "A data de fim vem antes da data de início.";
  if (diasEntre(inicio, fim) > MAXIMO_DE_DIAS_DO_PERIODO) {
    return "Escolha um período de até 5 anos.";
  }
  return null;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "26/09/2026" */
export function formatarData(iso: DataIso | null | undefined): string {
  if (!iso || !ehDataIso(iso)) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "26/09" */
export function formatarDataCurta(iso: DataIso): string {
  if (!ehDataIso(iso)) return iso;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "Sexta-feira, 26 de setembro" */
export function formatarDiaPorExtenso(iso: DataIso): string {
  if (!ehDataIso(iso)) return iso;
  return capitalizar(FORMATADOR_DIA_POR_EXTENSO.format(paraDataUtc(iso)));
}

/** "set" — rótulo curto de mês para colunas. */
function rotuloDoMesCurto(iso: DataIso): string {
  if (!ehDataIso(iso)) return iso;
  const mes = FORMATADOR_MES_CURTO.format(paraDataUtc(iso)).replace(".", "");
  return `${mes}/${iso.slice(2, 4)}`;
}

/** Hora local da loja ("09:12") de um instante ISO. */
export function formatarHora(instante: string | null | undefined): string {
  if (!instante) return "—";
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return "—";
  return FORMATADOR_HORA_SP.format(data);
}

/** "26/09, 09:12" de um instante ISO (data sem hora vira só a data). */
export function formatarDataHora(instante: string | null | undefined): string {
  if (!instante) return "—";
  if (ehDataIso(instante)) return formatarData(instante);
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return "—";
  return FORMATADOR_DATA_HORA_SP.format(data);
}

/** Rótulo do período para o cabeçalho ("Setembro de 2026", "01/09 a 26/09/2026"). */
export function rotuloDoPeriodo(
  periodo: PeriodoEscolhido,
  intervalo: IntervaloDeDatas | null,
): string {
  if (!intervalo) return "Escolha as datas";
  switch (periodo.preset) {
    case "mes_atual":
    case "mes_anterior":
      return capitalizar(
        FORMATADOR_MES_ANO.format(paraDataUtc(intervalo.inicio)),
      );
    case "7d":
      return "Últimos 7 dias";
    case "30d":
      return "Últimos 30 dias";
    case "ano":
      return `Ano de ${intervalo.inicio.slice(0, 4)}`;
    default:
      return `${formatarData(intervalo.inicio)} a ${formatarData(intervalo.fim)}`;
  }
}

interface MesDoIntervalo extends IntervaloDeDatas {
  readonly rotulo: string;
}

/** Os meses (recortados ao intervalo) que um período atravessa. */
export function mesesDoIntervalo(
  intervalo: IntervaloDeDatas,
): MesDoIntervalo[] {
  const meses: MesDoIntervalo[] = [];
  let cursor = inicioDoMes(intervalo.inicio);
  // Trava contra laço sem fim com datas corrompidas (e contra 5 anos de colunas).
  for (let volta = 0; volta < 120 && cursor <= intervalo.fim; volta += 1) {
    const inicio = cursor < intervalo.inicio ? intervalo.inicio : cursor;
    const fimDoCursor = fimDoMes(cursor);
    const fim = fimDoCursor > intervalo.fim ? intervalo.fim : fimDoCursor;
    meses.push({ inicio, fim, rotulo: rotuloDoMesCurto(cursor) });
    cursor = somarDias(fimDoCursor, 1);
  }
  return meses;
}

// ---------------------------------------------------------------------------
// Rótulos em português
// ---------------------------------------------------------------------------

export function rotuloDaOrigem(origem: string): string {
  switch (origem) {
    case "venda_online":
      return "Venda online";
    case "venda_balcao":
      return "Venda no balcão";
    case "venda_entrega":
      return "Venda na entrega";
    case "estorno":
      return "Estorno";
    case "estorno_externo":
      return "Estorno fora do app";
    case "devolucao":
      return "Devolução";
    case "sangria":
      return "Sangria";
    case "suprimento":
      return "Suprimento";
    case "ajuste_caixa":
      return "Ajuste de caixa";
    case "manual":
      return "Lançamento manual";
    default:
      return "Lançamento";
  }
}

/** Origens que nascem de pedido (a fonte é o pedido, não `fin_lancamentos`). */
export function origemVemDoPedido(origem: string): boolean {
  return (
    origem === "venda_online" ||
    origem === "venda_balcao" ||
    origem === "venda_entrega" ||
    origem === "estorno" ||
    origem === "estorno_externo" ||
    origem === "devolucao"
  );
}

export function rotuloDoTipoDeConta(tipo: string): string {
  switch (tipo) {
    case "caixa":
      return "Caixa físico";
    case "banco":
      return "Conta bancária";
    case "mercado_pago":
      return "Mercado Pago";
    default:
      return "Outra";
  }
}

export const TIPOS_DE_CONTA: readonly TipoDeConta[] = [
  "caixa",
  "banco",
  "mercado_pago",
  "outro",
];

export function rotuloDoStatus(status: string): string {
  switch (status) {
    case "previsto":
      return "Previsto";
    case "realizado":
      return "Realizado";
    case "cancelado":
      return "Cancelado";
    default:
      return status;
  }
}

/**
 * Formas que o lançamento manual oferece — exatamente o CHECK de
 * fin_lancamentos.forma_pagamento (migration 20261177000000). O vocabulário
 * dos pedidos (cash/card) NÃO passa nesse CHECK.
 */
export const FORMAS_DO_LANCAMENTO: readonly string[] = [
  "pix",
  "dinheiro",
  "credito",
  "debito",
  "boleto",
  "transferencia",
  "outro",
];

export function rotuloDaForma(forma: string | null | undefined): string {
  switch (forma) {
    case "online":
      return "Online (Mercado Pago)";
    case "pix":
      return "PIX";
    case "cash":
    case "dinheiro":
      return "Dinheiro";
    case "card":
    case "cartao":
      return "Cartão";
    case "credito":
    case "cartao_credito":
      return "Cartão de crédito";
    case "debito":
    case "cartao_debito":
      return "Cartão de débito";
    case "boleto":
      return "Boleto";
    case "transferencia":
      return "Transferência / TED";
    case "outro":
      return "Outra";
    case null:
    case undefined:
    case "":
      return "Não informada";
    default:
      return forma;
  }
}

export function rotuloDoGrupoDre(grupo: string): string {
  switch (grupo) {
    case "receita":
      return "Receita";
    case "deducao":
      return "Dedução da receita";
    case "custo_variavel":
      return "Custo variável";
    case "despesa_fixa":
      return "Despesa fixa";
    case "financeiro":
      return "Financeiro";
    case "fora_dre":
      return "Fora da DRE";
    default:
      return grupo;
  }
}

/** Ajuda em linguagem simples para quem escolhe o grupo de uma categoria. */
export function ajudaDoGrupoDre(grupo: string): string {
  switch (grupo) {
    case "receita":
      return "Dinheiro que entra pela atividade da loja: vendas, serviços, outras receitas.";
    case "deducao":
      return "Sai da venda antes de tudo: devoluções, estornos, impostos sobre a venda.";
    case "custo_variavel":
      return "Cresce junto com as vendas: taxa do cartão e do Mercado Pago, frete pago pela loja, embalagem.";
    case "despesa_fixa":
      return "Paga todo mês, vendendo ou não: aluguel, salários, internet, contador, sistema.";
    case "financeiro":
      return "Juros, tarifas do banco e rendimento de aplicação.";
    case "fora_dre":
      return "Não é lucro nem prejuízo: compra de mercadoria para o estoque, aporte ou retirada do dono.";
    default:
      return "";
  }
}

/** Grupos da DRE que combinam com a natureza da categoria. */
export function gruposDaNatureza(
  natureza: NaturezaDaCategoria,
): readonly GrupoDaDre[] {
  return natureza === "receita"
    ? ["receita", "financeiro", "fora_dre"]
    : ["deducao", "custo_variavel", "despesa_fixa", "financeiro", "fora_dre"];
}

// ---------------------------------------------------------------------------
// Parsers defensivos (Json → domínio)
// ---------------------------------------------------------------------------

/** A RPC respondeu algo fora do contrato. */
export class ErroDeFormatoFinanceiro extends Error {
  constructor(rpc: string) {
    super(`Resposta fora do formato esperado em ${rpc}.`);
    this.name = "ErroDeFormatoFinanceiro";
  }
}

type Objeto = Record<string, unknown>;

function comoObjeto(valor: unknown): Objeto | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Objeto)
    : null;
}

/** Lista do contrato: `null` é lista vazia (`jsonb_agg` de zero linhas). */
function comoLista(valor: unknown, rpc: string): unknown[] {
  if (valor === null || valor === undefined) return [];
  if (!Array.isArray(valor)) throw new ErroDeFormatoFinanceiro(rpc);
  return valor;
}

function numero(valor: unknown): number {
  const n =
    typeof valor === "number"
      ? valor
      : typeof valor === "string" && valor.trim() !== ""
        ? Number(valor)
        : Number.NaN;
  return Number.isFinite(n) ? deCentavos(paraCentavos(n)) : 0;
}

function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? deCentavos(paraCentavos(n)) : null;
}

function inteiroOuNulo(valor: unknown): number | null {
  const n = numeroOuNulo(valor);
  return n === null ? null : Math.trunc(n);
}

function texto(valor: unknown, padrao = ""): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return padrao;
}

function textoOuNulo(valor: unknown): string | null {
  const t = texto(valor).trim();
  return t === "" ? null : t;
}

function dataOuNula(valor: unknown): DataIso | null {
  const t = textoOuNulo(valor);
  if (!t) return null;
  const dia = t.slice(0, 10);
  return ehDataIso(dia) ? dia : null;
}

function booleano(valor: unknown): boolean {
  return valor === true || valor === "true" || valor === 1;
}

function tipoDeConta(valor: unknown): TipoDeConta {
  return valor === "caixa" || valor === "banco" || valor === "mercado_pago"
    ? valor
    : "outro";
}

function natureza(valor: unknown): NaturezaDaCategoria {
  return valor === "receita" ? "receita" : "despesa";
}

function grupoDre(valor: unknown): GrupoDaDre {
  switch (valor) {
    case "receita":
    case "deducao":
    case "custo_variavel":
    case "despesa_fixa":
    case "financeiro":
    case "fora_dre":
      return valor;
    default:
      return "fora_dre";
  }
}

function statusDoLancamento(valor: unknown): StatusDoLancamento {
  return valor === "previsto" || valor === "cancelado" ? valor : "realizado";
}

function tipoDoLancamento(tipo: unknown, valorBruto: number): TipoDeLancamento {
  if (tipo === "entrada" || tipo === "saida" || tipo === "transferencia") {
    return tipo;
  }
  return valorBruto < 0 ? "saida" : "entrada";
}

function totaisPrevistos(valor: unknown): TotaisPrevistos {
  const o = comoObjeto(valor) ?? {};
  return {
    total: numero(o.total),
    vencido: numero(o.vencido),
    proximos7Dias: numero(o.proximos_7_dias),
  };
}

function saldoDeConta(valor: unknown): SaldoDeConta | null {
  const o = comoObjeto(valor);
  if (!o) return null;
  const id = textoOuNulo(o.id);
  if (!id) return null;
  return {
    id,
    nome: texto(o.nome, "Conta"),
    tipo: tipoDeConta(o.tipo),
    saldo: numero(o.saldo),
  };
}

function naoNulos<T>(lista: readonly (T | null)[]): T[] {
  return lista.filter((item): item is T => item !== null);
}

export function parseResumo(json: unknown): ResumoFinanceiro {
  const o = comoObjeto(json);
  if (!o) throw new ErroDeFormatoFinanceiro("fin_resumo");
  const periodo = comoObjeto(o.periodo) ?? {};
  const canal = comoObjeto(o.por_canal) ?? {};
  const caixa = comoObjeto(o.caixa_aberto);
  const serie: DiaDaSerie[] = naoNulos(
    comoLista(o.serie, "fin_resumo").map((item) => {
      const d = comoObjeto(item);
      const dia = d ? dataOuNula(d.dia) : null;
      if (!d || !dia) return null;
      return {
        dia,
        entradas: Math.abs(numero(d.entradas)),
        saidas: Math.abs(numero(d.saidas)),
      };
    }),
  );
  return {
    periodo: {
      inicio: dataOuNula(periodo.inicio) ?? "",
      fim: dataOuNula(periodo.fim) ?? "",
    },
    saldoTotal: numero(o.saldo_total),
    contas: naoNulos(comoLista(o.contas, "fin_resumo").map(saldoDeConta)),
    entradas: Math.abs(numero(o.entradas)),
    saidas: Math.abs(numero(o.saidas)),
    resultado: numero(o.resultado),
    aReceber: totaisPrevistos(o.a_receber),
    aPagar: totaisPrevistos(o.a_pagar),
    porForma: naoNulos(
      comoLista(o.por_forma, "fin_resumo").map((item) => {
        const f = comoObjeto(item);
        if (!f) return null;
        return {
          forma: textoOuNulo(f.forma),
          valor: Math.abs(numero(f.valor)),
        };
      }),
    ),
    porCanal: {
      online: Math.abs(numero(canal.online)),
      presencial: Math.abs(numero(canal.presencial)),
    },
    serie: [...serie].sort((a, b) =>
      a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0,
    ),
    caixaAberto:
      caixa && textoOuNulo(caixa.id)
        ? {
            id: texto(caixa.id),
            contaId: texto(caixa.conta_id),
            abertoEm: texto(caixa.aberto_em),
            valorAbertura: numero(caixa.valor_abertura),
          }
        : null,
  };
}

export function parseExtrato(json: unknown): LinhaDoExtrato[] {
  return naoNulos(
    comoLista(json, "fin_extrato").map((item): LinhaDoExtrato | null => {
      const o = comoObjeto(item);
      if (!o) return null;
      const id = textoOuNulo(o.id);
      const data = dataOuNula(o.data);
      if (!id || !data) return null;
      const valorBruto = numero(o.valor);
      return {
        id,
        origem: texto(o.origem, "manual"),
        tipo: tipoDoLancamento(o.tipo, valorBruto),
        status: statusDoLancamento(o.status),
        valor: Math.abs(valorBruto),
        data,
        contaId: textoOuNulo(o.conta_id),
        contaNome: textoOuNulo(o.conta_nome),
        contaDestinoId: textoOuNulo(o.conta_destino_id),
        contaDestinoNome: textoOuNulo(o.conta_destino_nome),
        categoriaId: textoOuNulo(o.categoria_id),
        categoriaNome: textoOuNulo(o.categoria_nome),
        descricao: texto(o.descricao).trim() || rotuloDaOrigem(texto(o.origem)),
        formaPagamento: textoOuNulo(o.forma_pagamento),
        pedidoId: textoOuNulo(o.pedido_id),
        vencimento: dataOuNula(o.vencimento),
        editavel: booleano(o.editavel),
      };
    }),
  );
}

export function parsePrevistos(json: unknown): LancamentoPrevisto[] {
  return naoNulos(
    comoLista(json, "fin_previstos").map((item): LancamentoPrevisto | null => {
      const o = comoObjeto(item);
      if (!o) return null;
      const id = textoOuNulo(o.id);
      if (!id) return null;
      const origem = texto(o.origem, "manual");
      return {
        id,
        descricao: texto(o.descricao).trim() || rotuloDaOrigem(origem),
        valor: Math.abs(numero(o.valor)),
        vencimento: dataOuNula(o.vencimento),
        vencido: booleano(o.vencido),
        contaId: textoOuNulo(o.conta_id),
        contaNome: textoOuNulo(o.conta_nome),
        categoriaId: textoOuNulo(o.categoria_id),
        categoriaNome: textoOuNulo(o.categoria_nome),
        parcela: inteiroOuNulo(o.parcela),
        parcelas: inteiroOuNulo(o.parcelas),
        origem,
        pedidoId: textoOuNulo(o.pedido_id),
      };
    }),
  );
}

export function parseDre(json: unknown): DreFinanceira {
  const o = comoObjeto(json);
  if (!o) throw new ErroDeFormatoFinanceiro("fin_dre");
  return {
    receitaBruta: numero(o.receita_bruta),
    receitaOnline: numero(o.receita_online),
    receitaBalcao: numero(o.receita_balcao),
    deducoes: numero(o.deducoes),
    receitaLiquida: numero(o.receita_liquida),
    cmv: numero(o.cmv),
    cmvEstimado: booleano(o.cmv_estimado),
    lucroBruto: numero(o.lucro_bruto),
    custosVariaveis: numero(o.custos_variaveis),
    margemContribuicao: numero(o.margem_contribuicao),
    despesasFixas: numero(o.despesas_fixas),
    resultadoOperacional: numero(o.resultado_operacional),
    resultadoFinanceiro: numero(o.resultado_financeiro),
    lucroLiquido: numero(o.lucro_liquido),
    linhas: naoNulos(
      comoLista(o.linhas, "fin_dre").map((item): LinhaDaDre | null => {
        const l = comoObjeto(item);
        if (!l) return null;
        return {
          grupo: texto(l.grupo),
          categoria: texto(l.categoria).trim() || "Sem categoria",
          valor: numero(l.valor),
        };
      }),
    ),
  };
}

export function parseContas(json: unknown): ContaFinanceira[] {
  const contas = naoNulos(
    comoLista(json, "fin_contas_listar").map((item): ContaFinanceira | null => {
      const o = comoObjeto(item);
      if (!o) return null;
      const id = textoOuNulo(o.id);
      if (!id) return null;
      return {
        id,
        nome: texto(o.nome, "Conta"),
        tipo: tipoDeConta(o.tipo),
        saldoInicial: numero(o.saldo_inicial),
        saldoInicialEm: dataOuNula(o.saldo_inicial_em),
        ativa: o.ativa === undefined ? true : booleano(o.ativa),
        ordem: numeroOuNulo(o.ordem) ?? 0,
        sistema: booleano(o.sistema),
        saldo: numero(o.saldo),
      };
    }),
  );
  return contas.sort((a, b) => a.ordem - b.ordem);
}

export function parseCategorias(json: unknown): CategoriaFinanceira[] {
  return naoNulos(
    comoLista(json, "fin_categorias_listar").map(
      (item): CategoriaFinanceira | null => {
        const o = comoObjeto(item);
        if (!o) return null;
        const id = textoOuNulo(o.id);
        if (!id) return null;
        return {
          id,
          nome: texto(o.nome, "Categoria"),
          natureza: natureza(o.natureza),
          grupoDre: grupoDre(o.grupo_dre),
          ativa: o.ativa === undefined ? true : booleano(o.ativa),
          sistema: booleano(o.sistema),
        };
      },
    ),
  );
}

function movimentoDoCaixa(valor: unknown): MovimentoDoCaixa | null {
  const o = comoObjeto(valor);
  if (!o) return null;
  const origem = textoOuNulo(o.origem);
  const valorBruto = numero(o.valor);
  const saida =
    o.tipo === "saida" ||
    origem === "sangria" ||
    (o.tipo !== "entrada" && valorBruto < 0);
  return {
    id: texto(o.id) || `${texto(o.created_at)}-${valorBruto}`,
    tipo: saida ? "saida" : "entrada",
    origem,
    valor: Math.abs(valorBruto),
    descricao:
      texto(o.descricao).trim() ||
      (origem ? rotuloDaOrigem(origem) : "Movimento"),
    em:
      textoOuNulo(o.em) ??
      textoOuNulo(o.created_at) ??
      textoOuNulo(o.data_realizacao) ??
      textoOuNulo(o.data),
  };
}

export function parseCaixaAtual(json: unknown): CaixaAtual | null {
  if (json === null || json === undefined) return null;
  const o = comoObjeto(json);
  if (!o) throw new ErroDeFormatoFinanceiro("fin_caixa_atual");
  const id = textoOuNulo(o.id);
  if (!id) return null;
  return {
    id,
    contaId: texto(o.conta_id),
    contaNome: texto(o.conta_nome, "Caixa da loja"),
    abertoEm: texto(o.aberto_em),
    valorAbertura: numero(o.valor_abertura),
    vendasDinheiro: Math.abs(numero(o.vendas_dinheiro)),
    devolucoesDinheiro: Math.abs(numero(o.devolucoes_dinheiro)),
    entradasManuais: Math.abs(numero(o.entradas_manuais)),
    saidasManuais: Math.abs(numero(o.saidas_manuais)),
    esperado: numero(o.esperado),
    movimentos: naoNulos(
      comoLista(o.movimentos, "fin_caixa_atual").map(movimentoDoCaixa),
    ),
  };
}

export function parseCaixaHistorico(json: unknown): SessaoDeCaixa[] {
  return naoNulos(
    comoLista(json, "fin_caixa_historico").map((item): SessaoDeCaixa | null => {
      const o = comoObjeto(item);
      if (!o) return null;
      const id = textoOuNulo(o.id);
      if (!id) return null;
      return {
        id,
        contaNome: texto(o.conta_nome, "Caixa"),
        abertoEm: texto(o.aberto_em),
        fechadoEm: textoOuNulo(o.fechado_em),
        valorAbertura: numero(o.valor_abertura),
        esperado: numeroOuNulo(o.esperado),
        contado: numeroOuNulo(o.contado),
        diferenca: numeroOuNulo(o.diferenca),
        status: texto(o.status, "fechado"),
      };
    }),
  );
}

export function parseFechamento(json: unknown): FechamentoDeCaixa {
  const o = comoObjeto(json);
  if (!o) throw new ErroDeFormatoFinanceiro("fin_caixa_fechar");
  return {
    id: texto(o.id),
    esperado: numero(o.esperado),
    contado: numero(o.contado),
    diferenca: numero(o.diferenca),
  };
}

/** `{ids: uuid[]}` de `fin_lancamento_salvar`. */
export function parseIdsSalvos(json: unknown): string[] {
  const o = comoObjeto(json);
  if (!o) throw new ErroDeFormatoFinanceiro("fin_lancamento_salvar");
  return comoLista(o.ids, "fin_lancamento_salvar")
    .map((id) => texto(id))
    .filter((id) => id !== "");
}

// ---------------------------------------------------------------------------
// Extrato: sinal, agrupamento por dia e saldo corrente
// ---------------------------------------------------------------------------

/**
 * Efeito do lançamento no saldo, em reais com sinal. Só o REALIZADO mexe no
 * saldo (previsto e cancelado valem 0). Sem conta filtrada, transferência é
 * neutra (sai de uma conta da loja e entra em outra); com conta filtrada,
 * vale o sentido para ESSA conta.
 */
export function efeitoNoSaldo(
  linha: Pick<
    LinhaDoExtrato,
    "tipo" | "status" | "valor" | "contaId" | "contaDestinoId"
  >,
  contaFiltrada: string | null = null,
): number {
  if (linha.status !== "realizado") return 0;
  return sentidoDoLancamento(linha, contaFiltrada) * Math.abs(linha.valor);
}

/** 1 entra, −1 sai, 0 transferência neutra (sem filtro de conta). */
export function sentidoDoLancamento(
  linha: Pick<LinhaDoExtrato, "tipo" | "contaId" | "contaDestinoId">,
  contaFiltrada: string | null = null,
): 1 | -1 | 0 {
  if (linha.tipo === "entrada") return 1;
  if (linha.tipo === "saida") return -1;
  if (!contaFiltrada) return 0;
  if (linha.contaDestinoId === contaFiltrada) return 1;
  if (linha.contaId === contaFiltrada) return -1;
  return 0;
}

export interface DiaDoExtrato {
  readonly dia: DataIso;
  readonly linhas: readonly LinhaDoExtrato[];
  /** Entradas − saídas REALIZADAS do dia. */
  readonly resultado: number;
  readonly entradas: number;
  readonly saidas: number;
  /** Saldo da conta filtrada ao fim do dia, quando dá para reconstruir. */
  readonly saldoAoFim: number | null;
}

/**
 * Agrupa o extrato por dia (do mais recente para o mais antigo), com o
 * resultado realizado de cada dia. A ordem das linhas dentro do dia é a do
 * servidor.
 *
 * `saldoAtual`: quando a tela sabe o saldo de HOJE da conta filtrada e o
 * período termina hoje ou depois, o saldo ao fim de cada dia é reconstruído
 * de trás para frente (`saldo(dia) = saldo(dia seguinte) − resultado(dia
 * seguinte)`). Sem isso, `saldoAoFim` fica `null` — nunca um número
 * inventado.
 */
export function agruparExtratoPorDia(
  linhas: readonly LinhaDoExtrato[],
  opcoes: { contaFiltrada?: string | null; saldoAtual?: number | null } = {},
): DiaDoExtrato[] {
  const contaFiltrada = opcoes.contaFiltrada ?? null;
  const porDia = new Map<DataIso, LinhaDoExtrato[]>();
  for (const linha of linhas) {
    const doDia = porDia.get(linha.data);
    if (doDia) doDia.push(linha);
    else porDia.set(linha.data, [linha]);
  }
  const dias = [...porDia.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const grupos: DiaDoExtrato[] = [];
  let saldoCorrente =
    opcoes.saldoAtual === null || opcoes.saldoAtual === undefined
      ? null
      : paraCentavos(opcoes.saldoAtual);
  for (const dia of dias) {
    const doDia = porDia.get(dia) ?? [];
    let entradas = 0;
    let saidas = 0;
    for (const linha of doDia) {
      const efeito = paraCentavos(efeitoNoSaldo(linha, contaFiltrada));
      if (efeito > 0) entradas += efeito;
      else saidas -= efeito;
    }
    const resultado = entradas - saidas;
    grupos.push({
      dia,
      linhas: doDia,
      resultado: deCentavos(resultado),
      entradas: deCentavos(entradas),
      saidas: deCentavos(saidas),
      saldoAoFim: saldoCorrente === null ? null : deCentavos(saldoCorrente),
    });
    if (saldoCorrente !== null) saldoCorrente -= resultado;
  }
  return grupos;
}

/**
 * Saldo ao fim de cada passo, reconstruído a partir do saldo FINAL:
 * `saldo[i] = saldoFinal − Σ deltas[j>i]`. Os deltas vêm em ordem
 * cronológica (o último é o mais recente).
 */
export function saldoCorrenteRetroativo(
  saldoFinal: number,
  deltas: readonly number[],
): number[] {
  const resultado: number[] = [];
  let corrente = paraCentavos(saldoFinal);
  for (let i = deltas.length - 1; i >= 0; i -= 1) {
    resultado.push(deCentavos(corrente));
    corrente -= paraCentavos(deltas.at(i) ?? 0);
  }
  return resultado.reverse();
}

export interface PontoDoFluxo {
  readonly dia: DataIso;
  readonly entradas: number;
  readonly saidas: number;
  readonly resultado: number;
  readonly saldo: number;
}

/**
 * Série diária completa do intervalo (dia sem movimento vale zero), com o
 * saldo ao fim de cada dia reconstruído a partir do saldo de hoje.
 */
export function serieDoFluxoDeCaixa(
  serie: readonly DiaDaSerie[],
  intervalo: IntervaloDeDatas,
  saldoAtual: number,
): PontoDoFluxo[] {
  const porDia = new Map<DataIso, DiaDaSerie>();
  for (const dia of serie) porDia.set(dia.dia, dia);
  const dias: DataIso[] = [];
  for (
    let dia = intervalo.inicio, volta = 0;
    dia <= intervalo.fim && volta < 400;
    dia = somarDias(dia, 1), volta += 1
  ) {
    dias.push(dia);
  }
  const deltas = dias.map((dia) => {
    const d = porDia.get(dia);
    return d
      ? deCentavos(paraCentavos(d.entradas) - paraCentavos(d.saidas))
      : 0;
  });
  const saldos = saldoCorrenteRetroativo(saldoAtual, deltas);
  return dias.map((dia, i) => {
    const d = porDia.get(dia);
    return {
      dia,
      entradas: d?.entradas ?? 0,
      saidas: d?.saidas ?? 0,
      resultado: deltas.at(i) ?? 0,
      saldo: saldos.at(i) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// A pagar / a receber
// ---------------------------------------------------------------------------

export type SituacaoDoVencimento =
  | "vencido"
  | "hoje"
  | "semana"
  | "depois"
  | "sem_data";

export function situacaoDoVencimento(
  vencimento: DataIso | null,
  hoje: DataIso,
): SituacaoDoVencimento {
  if (!vencimento) return "sem_data";
  if (vencimento < hoje) return "vencido";
  if (vencimento === hoje) return "hoje";
  return diasEntre(hoje, vencimento) <= 7 ? "semana" : "depois";
}

export function textoDoVencimento(
  vencimento: DataIso | null,
  hoje: DataIso,
): string {
  if (!vencimento) return "Sem vencimento";
  const dias = diasEntre(hoje, vencimento);
  if (dias < -1) return `Venceu há ${-dias} dias`;
  if (dias === -1) return "Venceu ontem";
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  if (dias <= 7) return `Vence em ${dias} dias`;
  return `Vence em ${formatarData(vencimento)}`;
}

/** Vencidos primeiro (o mais antigo no topo), depois por data; sem data no fim. */
export function ordenarPorVencimento<
  T extends { readonly vencimento: DataIso | null },
>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => {
    if (a.vencimento === b.vencimento) return 0;
    if (a.vencimento === null) return 1;
    if (b.vencimento === null) return -1;
    return a.vencimento < b.vencimento ? -1 : 1;
  });
}

export function totaisDosPrevistos(
  lista: readonly LancamentoPrevisto[],
  hoje: DataIso,
): TotaisPrevistos {
  let total = 0;
  let vencido = 0;
  let proximos = 0;
  for (const item of lista) {
    const centavos = paraCentavos(item.valor);
    total += centavos;
    const situacao = situacaoDoVencimento(item.vencimento, hoje);
    if (situacao === "vencido") vencido += centavos;
    else if (situacao === "hoje" || situacao === "semana") proximos += centavos;
  }
  return {
    total: deCentavos(total),
    vencido: deCentavos(vencido),
    proximos7Dias: deCentavos(proximos),
  };
}

/** Só o que nasceu à mão em `fin_lancamentos` se baixa ou cancela na tela. */
export function previstoEhEditavel(item: Pick<LancamentoPrevisto, "origem">) {
  return item.origem === "manual";
}

// ---------------------------------------------------------------------------
// DRE
// ---------------------------------------------------------------------------

export type ChaveDaDre =
  | "receita_bruta"
  | "deducoes"
  | "receita_liquida"
  | "cmv"
  | "lucro_bruto"
  | "custos_variaveis"
  | "margem_contribuicao"
  | "despesas_fixas"
  | "resultado_operacional"
  | "resultado_financeiro"
  | "lucro_liquido";

export interface LinhaDaCascata {
  readonly chave: ChaveDaDre;
  readonly rotulo: string;
  /** Com o sinal de exibição: dedução/custo/despesa sempre negativos. */
  readonly valor: number;
  readonly subtotal: boolean;
  readonly final: boolean;
  /** Grupo das `linhas` que abrem por baixo desta. */
  readonly grupo: GrupoDaDre | null;
}

const negativo = (valor: number) => -Math.abs(valor);

/** A cascata clássica da DRE simplificada (spec §4), na ordem da tela. */
export function cascataDaDre(dre: DreFinanceira): LinhaDaCascata[] {
  const linha = (
    chave: ChaveDaDre,
    rotulo: string,
    valor: number,
    extra: Partial<Pick<LinhaDaCascata, "subtotal" | "final" | "grupo">> = {},
  ): LinhaDaCascata => ({
    chave,
    rotulo,
    valor,
    subtotal: extra.subtotal ?? false,
    final: extra.final ?? false,
    grupo: extra.grupo ?? null,
  });
  return [
    linha("receita_bruta", "Receita bruta", dre.receitaBruta, {
      grupo: "receita",
    }),
    linha("deducoes", "(−) Deduções", negativo(dre.deducoes), {
      grupo: "deducao",
    }),
    linha("receita_liquida", "(=) Receita líquida", dre.receitaLiquida, {
      subtotal: true,
    }),
    linha("cmv", "(−) CMV", negativo(dre.cmv)),
    linha("lucro_bruto", "(=) Lucro bruto", dre.lucroBruto, { subtotal: true }),
    linha(
      "custos_variaveis",
      "(−) Custos variáveis",
      negativo(dre.custosVariaveis),
      { grupo: "custo_variavel" },
    ),
    linha(
      "margem_contribuicao",
      "(=) Margem de contribuição",
      dre.margemContribuicao,
      { subtotal: true },
    ),
    linha("despesas_fixas", "(−) Despesas fixas", negativo(dre.despesasFixas), {
      grupo: "despesa_fixa",
    }),
    linha(
      "resultado_operacional",
      "(=) Resultado operacional",
      dre.resultadoOperacional,
      { subtotal: true },
    ),
    linha(
      "resultado_financeiro",
      "(±) Resultado financeiro",
      dre.resultadoFinanceiro,
      { grupo: "financeiro" },
    ),
    linha("lucro_liquido", "(=) Lucro líquido", dre.lucroLiquido, {
      subtotal: true,
      final: true,
    }),
  ];
}

interface SublinhaDaDre {
  readonly rotulo: string;
  readonly valor: number;
}

/**
 * O que abre por baixo de uma linha da cascata: a receita bruta separa app
 * e loja física; os grupos listam as categorias de `linhas` (com o mesmo
 * sinal de exibição da linha-mãe).
 */
export function sublinhasDaDre(
  dre: DreFinanceira,
  chave: ChaveDaDre,
): SublinhaDaDre[] {
  const cascata = cascataDaDre(dre).find((l) => l.chave === chave);
  if (!cascata) return [];
  const sublinhas: SublinhaDaDre[] = [];
  if (chave === "receita_bruta") {
    sublinhas.push(
      { rotulo: "App (vendas online)", valor: dre.receitaOnline },
      { rotulo: "Loja física (balcão e entrega)", valor: dre.receitaBalcao },
    );
  }
  if (cascata.grupo) {
    for (const l of dre.linhas) {
      if (l.grupo !== cascata.grupo) continue;
      const valor =
        cascata.grupo === "financeiro" || cascata.grupo === "receita"
          ? l.valor
          : negativo(l.valor);
      sublinhas.push({ rotulo: l.categoria, valor });
    }
  }
  return sublinhas;
}

/** % da receita líquida (base da análise vertical); sem base → `null`. */
export function percentualDaReceita(
  valor: number,
  receitaLiquida: number,
): number | null {
  if (paraCentavos(receitaLiquida) === 0) return null;
  return (valor / receitaLiquida) * 100;
}

// ---------------------------------------------------------------------------
// Caixa
// ---------------------------------------------------------------------------

type SituacaoDoFechamento = "bateu" | "sobra" | "quebra";

export function diferencaDoFechamento(
  esperado: number,
  contado: number,
): { readonly diferenca: number; readonly situacao: SituacaoDoFechamento } {
  const diferenca = paraCentavos(contado) - paraCentavos(esperado);
  return {
    diferenca: deCentavos(diferenca),
    situacao: diferenca === 0 ? "bateu" : diferenca > 0 ? "sobra" : "quebra",
  };
}

// ---------------------------------------------------------------------------
// Formulários (validação + payload)
// ---------------------------------------------------------------------------

export type SituacaoDoLancamento = "realizado" | "previsto";

export interface FormularioDoLancamento {
  readonly tipo: TipoDeLancamento;
  /** Texto digitado (pt-BR ou o "1234.56" da máscara). */
  readonly valor: string;
  readonly descricao: string;
  readonly categoriaId: string;
  readonly contaId: string;
  readonly contaDestinoId: string;
  /** "" = não informar. */
  readonly formaPagamento: string;
  readonly dataCompetencia: string;
  readonly situacao: SituacaoDoLancamento;
  readonly dataRealizacao: string;
  readonly dataVencimento: string;
  readonly parcelas: string;
  readonly observacao: string;
}

type CampoDoLancamento =
  | "valor"
  | "descricao"
  | "categoriaId"
  | "contaId"
  | "contaDestinoId"
  | "dataCompetencia"
  | "dataRealizacao"
  | "dataVencimento"
  | "parcelas"
  | "observacao";

type ErrosDoFormulario<C extends string> = Partial<Record<C, string>>;

type ResultadoDaValidacao<P, C extends string> =
  | { readonly ok: true; readonly payload: P }
  | { readonly ok: false; readonly erros: ErrosDoFormulario<C> };

export const MAXIMO_DE_PARCELAS = 48;

export function formularioInicialDoLancamento(
  hoje: DataIso,
  inicial: Partial<FormularioDoLancamento> = {},
): FormularioDoLancamento {
  return {
    tipo: "saida",
    valor: "",
    descricao: "",
    categoriaId: "",
    contaId: "",
    contaDestinoId: "",
    formaPagamento: "",
    dataCompetencia: hoje,
    situacao: "realizado",
    dataRealizacao: hoje,
    dataVencimento: hoje,
    parcelas: "1",
    observacao: "",
    ...inicial,
  };
}

/**
 * Valida o "Novo lançamento" e monta o corpo de `fin_lancamento_salvar`.
 * Transferência é sempre realizada, sem categoria e sem parcelas (não é
 * receita nem despesa — fica fora da DRE). Parcelar só vale para o que
 * ainda vai ser pago/recebido.
 */
export function validarLancamento(
  form: FormularioDoLancamento,
  hoje: DataIso,
): ResultadoDaValidacao<PayloadDoLancamento, CampoDoLancamento> {
  const erros: ErrosDoFormulario<CampoDoLancamento> = {};
  const transferencia = form.tipo === "transferencia";
  const situacao: SituacaoDoLancamento = transferencia
    ? "realizado"
    : form.situacao;

  const valor = parseValorBR(form.valor);
  if (valor === null || valor <= 0) {
    erros.valor = "Informe um valor maior que zero.";
  } else if (valor > VALOR_MAXIMO) {
    erros.valor = "Valor acima do limite de R$ 99.999.999,99.";
  }

  const descricao = form.descricao.trim();
  if (descricao === "") erros.descricao = "Descreva o lançamento.";
  else if (descricao.length > 200) {
    erros.descricao = "Use no máximo 200 caracteres.";
  }

  if (!form.contaId) {
    erros.contaId = transferencia
      ? "Escolha a conta de onde sai o dinheiro."
      : "Escolha a conta.";
  }
  if (transferencia) {
    if (!form.contaDestinoId) {
      erros.contaDestinoId = "Escolha a conta que recebe.";
    } else if (form.contaDestinoId === form.contaId) {
      erros.contaDestinoId = "A conta de destino precisa ser outra.";
    }
  } else if (!form.categoriaId) {
    erros.categoriaId = "Escolha a categoria (é ela que monta a DRE).";
  }

  if (!ehDataIso(form.dataCompetencia)) {
    erros.dataCompetencia = "Informe a data de competência.";
  }

  if (situacao === "realizado") {
    if (!ehDataIso(form.dataRealizacao)) {
      erros.dataRealizacao = "Informe a data do pagamento.";
    } else if (form.dataRealizacao > hoje) {
      erros.dataRealizacao =
        "Data no futuro: se ainda vai acontecer, marque como a pagar/receber.";
    }
  } else if (!ehDataIso(form.dataVencimento)) {
    erros.dataVencimento = "Informe o vencimento.";
  }

  const parcelasTexto =
    form.parcelas.trim() === "" ? "1" : form.parcelas.trim();
  const parcelas = SO_DIGITOS.test(parcelasTexto)
    ? Number(parcelasTexto)
    : Number.NaN;
  if (
    !Number.isInteger(parcelas) ||
    parcelas < 1 ||
    parcelas > MAXIMO_DE_PARCELAS
  ) {
    erros.parcelas = `De 1 a ${MAXIMO_DE_PARCELAS} parcelas.`;
  } else if (parcelas > 1 && (transferencia || situacao === "realizado")) {
    erros.parcelas =
      "Parcelar só vale para o que ainda vai ser pago ou recebido.";
  } else if (parcelas > 1 && valor !== null && paraCentavos(valor) < parcelas) {
    erros.parcelas = "Cada parcela precisa de pelo menos R$ 0,01.";
  }

  const observacao = form.observacao.trim();
  if (observacao.length > 500)
    erros.observacao = "Use no máximo 500 caracteres.";

  if (Object.keys(erros).length > 0 || valor === null) {
    return { ok: false, erros };
  }

  const forma = form.formaPagamento.trim();
  const payload: PayloadDoLancamento = {
    tipo: form.tipo,
    valor,
    conta_id: form.contaId,
    ...(transferencia
      ? { conta_destino_id: form.contaDestinoId }
      : { categoria_id: form.categoriaId }),
    descricao,
    ...(forma && !transferencia ? { forma_pagamento: forma } : {}),
    data_competencia: form.dataCompetencia,
    status: situacao,
    ...(situacao === "realizado"
      ? { data_realizacao: form.dataRealizacao }
      : { data_vencimento: form.dataVencimento }),
    ...(parcelas > 1 ? { parcelas } : {}),
    ...(observacao ? { observacao } : {}),
  };
  return { ok: true, payload };
}

export interface FormularioDaConta {
  readonly id?: string;
  readonly nome: string;
  readonly tipo: TipoDeConta;
  readonly saldoInicial: string;
  readonly saldoInicialEm: string;
  readonly ativa: boolean;
}

type CampoDaConta = "nome" | "saldoInicial" | "saldoInicialEm";

export function validarConta(
  form: FormularioDaConta,
): ResultadoDaValidacao<PayloadDaConta, CampoDaConta> {
  const erros: ErrosDoFormulario<CampoDaConta> = {};
  const nome = form.nome.trim();
  if (nome === "") erros.nome = "Dê um nome para a conta.";
  else if (nome.length > 60) erros.nome = "Use no máximo 60 caracteres.";
  const saldo =
    form.saldoInicial.trim() === "" ? 0 : parseValorBR(form.saldoInicial);
  if (saldo === null) erros.saldoInicial = "Valor inválido.";
  else if (Math.abs(saldo) > VALOR_MAXIMO) {
    erros.saldoInicial = "Valor acima do limite.";
  }
  if (!ehDataIso(form.saldoInicialEm)) {
    erros.saldoInicialEm = "Informe a data do saldo inicial.";
  }
  if (Object.keys(erros).length > 0 || saldo === null) {
    return { ok: false, erros };
  }
  return {
    ok: true,
    payload: {
      ...(form.id ? { id: form.id } : {}),
      nome,
      tipo: form.tipo,
      saldo_inicial: saldo,
      saldo_inicial_em: form.saldoInicialEm,
      ativa: form.ativa,
    },
  };
}

export interface FormularioDaCategoria {
  readonly id?: string;
  readonly nome: string;
  readonly natureza: NaturezaDaCategoria;
  readonly grupoDre: GrupoDaDre;
  readonly ativa: boolean;
}

type CampoDaCategoria = "nome" | "grupoDre";

export function validarCategoria(
  form: FormularioDaCategoria,
): ResultadoDaValidacao<PayloadDaCategoria, CampoDaCategoria> {
  const erros: ErrosDoFormulario<CampoDaCategoria> = {};
  const nome = form.nome.trim();
  if (nome === "") erros.nome = "Dê um nome para a categoria.";
  else if (nome.length > 60) erros.nome = "Use no máximo 60 caracteres.";
  if (!gruposDaNatureza(form.natureza).includes(form.grupoDre)) {
    erros.grupoDre = "Esse grupo não combina com a natureza escolhida.";
  }
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return {
    ok: true,
    payload: {
      ...(form.id ? { id: form.id } : {}),
      nome,
      natureza: form.natureza,
      grupo_dre: form.grupoDre,
      ativa: form.ativa,
    },
  };
}

// ---------------------------------------------------------------------------
// Erros do servidor → frase para a lojista
// ---------------------------------------------------------------------------

/** O supabase-js devolve `{code, message}` (PostgrestError e o PGRST202 de
 * função ausente) sem tipo público — lido pela FORMA, com guarda. */
function codigoEMensagem(erro: unknown): {
  codigo: string | null;
  mensagem: string | null;
} {
  const o = comoObjeto(erro);
  if (!o) return { codigo: null, mensagem: null };
  return {
    codigo: typeof o.code === "string" && o.code !== "" ? o.code : null,
    mensagem:
      typeof o.message === "string" && o.message.trim() !== ""
        ? o.message
        : null,
  };
}

/**
 * Traduz a falha de uma RPC `fin_*`. As recusas de negócio das RPCs
 * (`RAISE EXCEPTION` com texto em português: "já existe um caixa aberto",
 * "lançamento realizado não se edita"…) chegam como P0001/22023 e são
 * mostradas como o banco escreveu; o resto vira frase fixa, sem SQLSTATE nem
 * texto técnico em inglês na tela.
 */
export function mensagemDeErroFinanceiro(erro: unknown): string {
  if (erro instanceof ErroDeFormatoFinanceiro) {
    return "O servidor respondeu num formato que esta versão do app não entende. Atualize o app.";
  }
  const { codigo, mensagem } = codigoEMensagem(erro);
  if (!codigo) {
    return "Não consegui falar com o servidor. Confira a conexão e tente de novo.";
  }
  if (codigo === "PGRST202" || codigo === "42883" || codigo === "42P01") {
    return "O Financeiro ainda não foi instalado no banco desta loja.";
  }
  if (codigo === "42501" || codigo === "PGRST301") {
    return "Só o administrador da loja mexe no Financeiro. Entre de novo com a conta de administrador.";
  }
  if ((codigo === "P0001" || codigo === "22023") && mensagem) {
    return mensagem;
  }
  if (codigo.startsWith("23") || codigo === "22P02") {
    return "O banco recusou os dados. Confira os campos e tente de novo.";
  }
  return "Algo deu errado no servidor. Tente de novo em instantes.";
}
