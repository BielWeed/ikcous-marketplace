// A CHAVE DA DEVOLUÇÃO — idempotência do lado do painel (migration
// 20261640000000). A metade que DECIDE é o servidor
// (`solicitar_estorno_com_chave` + o índice único parcial de
// `order_refunds.chave_da_solicitacao`): a mesma chave devolve a linha que já
// existe em vez de criar outra. Este arquivo só garante que a RETENTATIVA da
// mesma intenção repita a chave em vez de inventar outra.
//
// POR QUE A CHAVE PERTENCE À INTENÇÃO (pedido + valor), NÃO AO TOQUE: a trava
// do hook (`enviandoRef`) já fecha o duplo toque. O que ela não fecha é o toque
// DEPOIS do "não dá para saber": a tela desistiu em 20 s, o servidor ainda vai
// gravar, a releitura mostra o saldo cheio e a lojista devolve o MESMO valor de
// novo. Com a mesma chave, o servidor reconhece a intenção e devolve a linha
// que já existe; o cliente recebe uma vez só.
//
// POR QUE localStorage, COM VALIDADE: fechar e reabrir a ficha, ou recarregar a
// página, é retentativa real (o mesmo motivo de `chave-do-pedido.ts`). A
// validade de 30 min (criação + 30 min, nunca estendida) impede que a
// devolução de amanhã, de igual valor, herde a de hoje. Sem localStorage
// (navegador que recusa), a chave ainda vale na aba.
//
// UMA CHAVE POR VALOR (pedido + centavos), não uma por pedido: R$ 50 presa na
// trava do pedido, depois R$ 60, depois R$ 50 de novo — se a de R$ 60
// apagasse a de R$ 50, a terceira levaria chave nova e, se a primeira ainda
// gravasse, nasceriam duas linhas de R$ 50.
//
// Intenção NOVA = chave nova: outro valor (centavos), outro pedido, ou depois
// de a intenção ser CONFIRMADA — pela resposta do servidor
// (`encerrarChaveDaDevolucao`) ou pela LISTA que a lojista vê, quando ela já
// mostra a linha criada com a chave (`confirmadas` em `chaveDaDevolucao`). Sem
// a segunda, a resposta perdida deixava a chave viva por 30 min e a segunda
// devolução legítima de igual valor (outro item) voltava como "já registrada":
// o cliente deixava de receber. A lista decide no TOQUE, com o que a tela
// mostra: se ela ainda não mostra a linha, o toque é retentativa e repete a
// chave (o servidor devolve a linha que já existe, se existir).

import { PRAZO_DA_RETENTATIVA_MS } from "./pedido-sem-resposta";
import { gerarUuidV4 } from "./uuid-v4";

const PREFIXO = "ikcous-chave-da-devolucao:";

interface RegistroDaDevolucao {
  centavos: number;
  chave: string;
  /** Epoch ms em que a chave deixa de valer (criação + 30 min). */
  expiraEm: number;
}

/** Plano B quando o localStorage não existe ou recusa (SecurityError, cota). */
const naMemoria = new Map<string, RegistroDaDevolucao>();
let armazenamentoRecusou = false;

function armazenamento(): Storage | null {
  if (armazenamentoRecusou) return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Onde mora a intenção de um valor do pedido. */
function enderecoDe(orderId: string, centavos: number): string {
  return `${orderId}:${centavos}`;
}

/** O formato da 1.5.244 (UM registro por pedido): lido só para a intenção que
 * ficou presa durante a atualização do app não virar chave nova. Nunca gravado. */
function enderecoAntigoDe(orderId: string): string {
  return orderId;
}

// Vencido, malformado, de outro valor ou com validade além do prazo que este
// código dá = registro que não é nosso: não vale.
function valido(
  registro: unknown,
  centavos: number,
  agora: number,
): RegistroDaDevolucao | null {
  const r = registro as Partial<RegistroDaDevolucao> | null | undefined;
  if (
    !r ||
    typeof r.chave !== "string" ||
    !Number.isInteger(r.centavos) ||
    r.centavos !== centavos ||
    typeof r.expiraEm !== "number" ||
    !Number.isFinite(r.expiraEm) ||
    r.expiraEm <= agora ||
    r.expiraEm > agora + PRAZO_DA_RETENTATIVA_MS
  ) {
    return null;
  }
  return r as RegistroDaDevolucao;
}

function lerDoStorage(endereco: string): unknown {
  const s = armazenamento();
  if (!s) return undefined;
  try {
    const cru = s.getItem(PREFIXO + endereco);
    return cru ? JSON.parse(cru) : null;
  } catch {
    // ilegível: cai na memória
    return undefined;
  }
}

function apagarDoStorage(endereco: string, chave: string): void {
  const s = armazenamento();
  if (!s) return;
  try {
    const cru = s.getItem(PREFIXO + endereco);
    if (!cru) return;
    const registro = JSON.parse(cru) as Partial<RegistroDaDevolucao> | null;
    if (registro?.chave === chave) s.removeItem(PREFIXO + endereco);
  } catch {
    // Sem apagar, o registro vence sozinho em 30 min.
  }
}

function ler(
  orderId: string,
  centavos: number,
  agora: number,
): RegistroDaDevolucao | null {
  const endereco = enderecoDe(orderId, centavos);
  return (
    valido(lerDoStorage(endereco), centavos, agora) ??
    valido(naMemoria.get(endereco), centavos, agora) ??
    valido(lerDoStorage(enderecoAntigoDe(orderId)), centavos, agora)
  );
}

function gravar(orderId: string, registro: RegistroDaDevolucao): void {
  const endereco = enderecoDe(orderId, registro.centavos);
  naMemoria.set(endereco, registro);
  const s = armazenamento();
  if (!s) return;
  try {
    s.setItem(PREFIXO + endereco, JSON.stringify(registro));
  } catch {
    // Sem gravar, a leitura do storage não acharia a chave: a memória manda.
    armazenamentoRecusou = true;
  }
}

/** Valor em centavos: 50 e 50,00 são a mesma intenção; 50,01 não é. */
function centavosDe(valor: number): number {
  return Math.round(valor * 100);
}

const NENHUMA: ReadonlySet<string> = new Set();

/**
 * A chave da intenção "devolver `valor` do pedido `orderId`": a mesma enquanto
 * a intenção não for encerrada (até 30 min); cada valor tem a sua. `confirmadas`
 * = as chaves das linhas que a lista em tela JÁ mostra: se a chave guardada
 * está ali, a intenção chegou e a lojista a vê — este toque é intenção nova.
 */
export function chaveDaDevolucao(
  orderId: string,
  valor: number,
  agora: number = Date.now(),
  confirmadas: ReadonlySet<string> = NENHUMA,
): string {
  const centavos = centavosDe(valor);
  const atual = ler(orderId, centavos, agora);
  if (atual && !confirmadas.has(atual.chave)) return atual.chave;
  // A confirmada não pode ressurgir por baixo da nova (o formato antigo é lido
  // por último): sai antes.
  if (atual) apagarDoStorage(enderecoAntigoDe(orderId), atual.chave);
  const novo: RegistroDaDevolucao = {
    centavos,
    chave: gerarUuidV4(),
    expiraEm: agora + PRAZO_DA_RETENTATIVA_MS,
  };
  gravar(orderId, novo);
  return novo.chave;
}

/**
 * O servidor confirmou a intenção da chave `chave` (linha criada ou já
 * registrada): a próxima devolução de `valor` no pedido é intenção NOVA. Só
 * apaga se a chave guardada para esse valor ainda for ESTA — a resposta tardia
 * de uma intenção antiga não apaga a da intenção em curso.
 */
export function encerrarChaveDaDevolucao(
  orderId: string,
  valor: number,
  chave: string,
): void {
  const endereco = enderecoDe(orderId, centavosDe(valor));
  if (naMemoria.get(endereco)?.chave === chave) naMemoria.delete(endereco);
  apagarDoStorage(endereco, chave);
  apagarDoStorage(enderecoAntigoDe(orderId), chave);
}
