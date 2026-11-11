// O CPF MORA NA CONTA (23/09/2026) — PENDENTE DE CADASTRO.
//
// O DEFEITO QUE ISTO RESOLVE: `signUp` só devolve sessão imediata quando o
// e-mail já está confirmado (ou a confirmação está desligada). Com
// confirmação por e-mail (o caso normal), `set_my_cpf` não tem sessão
// nenhuma para gravar NA HORA do cadastro — e o link de confirmação, no
// Android, abre em uma ABA NOVA; a aba do cadastro pode já ter fechado
// quando a pessoa confirma. `sessionStorage` (por aba) não sobrevive a
// isso; por isso o pendente mora em `localStorage`, sob uma chave
// EXCLUSIVA (nunca reaproveitada por outra feature), com TTL curto.
//
// RISCO ACEITO (documentar, não esconder): o CPF fica em texto plano no
// `localStorage` do aparelho por até 24h. Isso expõe o CPF a quem tiver
// acesso ao MESMO navegador/usuário do aparelho, ou a um XSS na origem do
// app — os dois já seriam comprometimentos graves por conta própria (um
// XSS na origem já lê cookie de sessão, carrinho, etc.). Mitigado por: (1)
// TTL de 24h — depois disso o registro se autodestrói na próxima leitura;
// (2) chave EXCLUSIVA, nunca lida por código que não seja este módulo; (3)
// limpeza em TRÊS gatilhos — sucesso da gravação, expiração, e sessão de
// OUTRA conta; (4) o campo é OPT-IN — quem não preenche CPF no cadastro
// nunca cria este registro. Sem isso, a alternativa seria pedir para a
// pessoa redigitar o CPF depois de confirmar o e-mail — pior experiência
// por um ganho de segurança marginal (o mesmo aparelho/navegador
// comprometido já vê o resto da sessão).
//
// NUNCA logar o conteúdo deste módulo (nem o pendente inteiro, nem o CPF
// isolado) — só o NOME do evento, se precisar.
import { cpfValido, somenteDigitosDoCpf } from "@/lib/cpf";
import { gravarCpfDaConta } from "@/lib/cpf-da-conta";

/** Chave EXCLUSIVA — nenhum outro módulo lê nem escreve aqui. */
export const CHAVE_CPF_PENDENTE = "ikcous:cpf-pendente-cadastro";

const TTL_MS = 24 * 60 * 60 * 1000;
const VERSAO_ATUAL = 1;

export interface PendenteCpf {
  v: 1;
  userId: string;
  email: string;
  cpf: string;
  expiraEm: number;
  /** A cliente já viu o aviso de falha deste pendente (uma vez só). */
  avisado?: boolean;
}

function armazem(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Grava o pendente depois de um `signUp` sem sessão imediata. Devolve
 * `false` (sem lançar) se o storage estiver indisponível/cheio/privado —
 * quem chama decide o aviso ("o CPF não ficou guardado, informe depois").
 */
export function salvarPendente(params: {
  userId: string;
  email: string;
  cpf: string;
}): boolean {
  try {
    const store = armazem();
    if (!store) return false;
    const registro: PendenteCpf = {
      v: VERSAO_ATUAL,
      userId: params.userId,
      email: params.email.trim().toLowerCase(),
      cpf: somenteDigitosDoCpf(params.cpf),
      expiraEm: Date.now() + TTL_MS,
    };
    store.setItem(CHAVE_CPF_PENDENTE, JSON.stringify(registro));
    return true;
  } catch {
    return false;
  }
}

export function removerPendente(): void {
  try {
    armazem()?.removeItem(CHAVE_CPF_PENDENTE);
  } catch {
    // Storage indisponível — nada para limpar mesmo.
  }
}

/**
 * A conta `userId` acabou de gravar ou limpar o CPF por OUTRO caminho
 * (Minha conta, checkout): o pendente do cadastro deixa de valer, senão a
 * próxima abertura do app o gravaria POR CIMA do que a cliente digitou.
 * Só apaga o pendente DESTA conta — o de outra pessoa que se cadastrou no
 * mesmo aparelho continua esperando a confirmação do e-mail dela.
 */
export function descartarPendenteDaConta(userId: string): void {
  try {
    if (lerRegistroValido()?.userId === userId) removerPendente();
  } catch {
    // Storage indisponível — nada para limpar mesmo.
  }
}

/**
 * Lê o registro cru, validando FORMATO (versão, campos, CPF) mas SEM
 * checar o TTL — quem chama decide o que fazer com um registro estrutural-
 * mente válido porém vencido. Qualquer lixo de formato (JSON quebrado,
 * versão desconhecida, CPF corrompido) é removido na hora.
 */
function lerRegistroValido(): PendenteCpf | null {
  try {
    const store = armazem();
    const bruto = store?.getItem(CHAVE_CPF_PENDENTE);
    if (!bruto) return null;

    const dado = JSON.parse(bruto);
    const valido =
      typeof dado === "object" &&
      dado !== null &&
      dado.v === VERSAO_ATUAL &&
      typeof dado.userId === "string" &&
      dado.userId.length > 0 &&
      typeof dado.email === "string" &&
      dado.email.length > 0 &&
      typeof dado.cpf === "string" &&
      cpfValido(dado.cpf) &&
      typeof dado.expiraEm === "number";

    if (!valido) {
      removerPendente();
      return null;
    }
    return dado as PendenteCpf;
  } catch {
    removerPendente();
    return null;
  }
}

/**
 * Lê o pendente válido E dentro do TTL, ou `null`. TTL vencido também
 * remove (nunca fica lixo acumulando na chave) — quem precisa DISTINGUIR
 * "nunca existiu" de "expirou" usa `retomarCpfPendente`, que checa o TTL
 * por conta própria antes de descartar.
 */
export function lerPendente(): PendenteCpf | null {
  const dado = lerRegistroValido();
  if (!dado) return null;
  const agora = Date.now();
  if (agora > dado.expiraEm || dado.expiraEm > agora + TTL_MS) {
    removerPendente();
    return null;
  }
  return dado;
}

function marcarAvisado(pendente: PendenteCpf): void {
  try {
    // Relê ANTES de gravar: durante o voo da RPC a cliente pode ter salvo o CPF
    // em Minha conta (o pendente foi descartado) ou outra pessoa pode ter se
    // cadastrado neste aparelho. Regravar o registro lido antes do `await`
    // ressuscitaria um CPF velho. Só marca se ainda for o MESMO pendente.
    const atual = lerRegistroValido();
    if (
      !atual ||
      atual.userId !== pendente.userId ||
      atual.cpf !== pendente.cpf
    ) {
      return;
    }
    armazem()?.setItem(
      CHAVE_CPF_PENDENTE,
      JSON.stringify({ ...atual, avisado: true }),
    );
  } catch {
    // Sem storage o aviso pode repetir — melhor que perder o pendente.
  }
}

export type ResultadoRetomada =
  | "gravado"
  | "sem_pendente"
  | "outra_conta"
  | "expirado"
  | "falhou"
  | "falhou_ja_avisado"
  | "sem_sessao"
  | "ja_em_curso";

// Dedupe de evento duplicado (SIGNED_IN + INITIAL_SESSION quase
// simultâneos, mesma aba): enquanto uma chamada está em voo para um
// userId, a próxima chamada para o MESMO userId devolve "ja_em_curso" sem
// tocar a RPC. Chamadas SEQUENCIAIS (uma termina antes da outra começar)
// não precisam desta trava — a primeira já removeu o pendente, então a
// segunda encontra `lerPendente() === null` e sai em "sem_pendente".
let emVooPara: string | null = null;

/**
 * Tenta gravar o CPF pendente na conta da sessão que acabou de logar.
 * Chamado no boot (sessão inicial) e em todo `SIGNED_IN`/`INITIAL_SESSION`
 * — de QUALQUER aba, sem depender de estado da aba do cadastro.
 */
export async function retomarCpfPendente(sessao: {
  userId: string;
  email: string;
}): Promise<ResultadoRetomada> {
  const pendente = lerRegistroValido();
  if (!pendente) return "sem_pendente";

  const emailSessao = sessao.email.trim().toLowerCase();
  if (pendente.userId !== sessao.userId || pendente.email !== emailSessao) {
    // Sessão de OUTRA conta (ou pendente órfão de um cadastro anterior no
    // mesmo aparelho) — remove sem gravar, nunca no lugar errado.
    removerPendente();
    return "outra_conta";
  }
  const agora = Date.now();
  if (agora > pendente.expiraEm || pendente.expiraEm > agora + TTL_MS) {
    removerPendente();
    return "expirado";
  }
  if (emVooPara === pendente.userId) return "ja_em_curso";

  emVooPara = pendente.userId;
  try {
    const resultado = await gravarCpfDaConta(pendente.cpf, pendente.userId);
    if (resultado.ok) {
      removerPendente();
      return "gravado";
    }
    if (resultado.motivo === "conta_trocada") {
      // A sessão do evento ainda era a do cadastro, mas outra aba entrou
      // em outra conta antes do envio: mesma limpeza da divergência acima.
      removerPendente();
      return "outra_conta";
    }
    if (resultado.motivo === "cpf_invalido") {
      // O servidor recusou o CPF: tentar de novo nunca vai passar. Descarta
      // agora (nada de ficar até o TTL) — este "falhou" é o único aviso.
      removerPendente();
      return "falhou";
    }
    if (resultado.motivo === "sem_sessao") {
      // Saiu da conta no meio da gravação: não há ninguém para avisar e o
      // CPF segue guardado para o próximo login.
      return "sem_sessao";
    }
    // Falha genuína (rede, servidor fora): MANTÉM o pendente até o TTL
    // vencer — a próxima retomada (próximo login, próxima aba) tenta de
    // novo. Só a PRIMEIRA falha devolve "falhou" (quem chama avisa a
    // cliente); as seguintes devolvem "falhou_ja_avisado", sem aviso.
    if (pendente.avisado) return "falhou_ja_avisado";
    marcarAvisado(pendente);
    return "falhou";
  } finally {
    emVooPara = null;
  }
}
