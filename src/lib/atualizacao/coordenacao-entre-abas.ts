/**
 * COORDENAÇÃO ENTRE ABAS da atualização — atualização única e obrigatória,
 * 16/10/2026.
 *
 * Por que existe: o service worker novo, quando assume, recarrega as abas do
 * app. Uma aba que decide instalar enquanto OUTRA está no meio de um
 * pagamento ou de uma venda levaria essa outra junto. Então, antes de
 * instalar, a aba olha o que as demais anunciaram e adia se alguma está
 * ocupada.
 *
 * ISTO É CORTESIA, NÃO SEGURANÇA. A segurança dos dados vem do VETO LOCAL de
 * cada aba (ela só recarrega quando o próprio momento é seguro — ver
 * `instalador.ts` e o `onNeedReload` do useUpdateCheck). Esta conversa só
 * evita que o service worker seja ativado a toa enquanto alguém está ocupado.
 *
 * O protocolo (BroadcastChannel, mesma origem) é de PRESENÇA:
 *   · `estado`   — "estou aqui, e estou livre/ocupada". Enviado ao montar, a
 *                  cada mudança de estado (`anunciar()`), em resposta a uma
 *                  consulta e a cada ~5 s (heartbeat).
 *   · `consulta` — "todos anunciem o estado agora" (antes de instalar).
 *   · `adeus`    — a aba está saindo (pagehide): some do mapa dos pares.
 * Cada aba mantém um MAPA de pares com o último estado conhecido. SILÊNCIO É
 * DESCONHECIDO, NÃO "LIVRE": par cujo último estado foi "ocupada" continua
 * adiando mesmo calado ou congelado (aba em segundo plano pode parar de rodar
 * timers). Só some do mapa com `adeus` ou depois de 10 min sem sinal nenhum
 * (aba que morreu sem despedida não bloqueia para sempre).
 *
 * Sem BroadcastChannel (navegador antigo, construtor lançando): o estado dos
 * pares é DESCONHECIDO e a pergunta devolve `true` — quem decide, então, é só
 * o veto local + a trava, e nada aqui lança erro no import nem no boot.
 */

export const NOME_DO_CANAL_DE_ABAS = "ikcous_atualizacao_abas";

/** Quanto esperar os pares responderem a uma consulta. */
export const JANELA_DE_CONSULTA_MS = 300;

/** De quanto em quanto tempo cada aba repete seu estado. */
export const INTERVALO_DO_HEARTBEAT_MS = 5000;

/** Par sem sinal nenhum por tanto tempo é descartado do mapa. */
export const VALIDADE_DO_PAR_MS = 10 * 60 * 1000;

/** O que usamos do BroadcastChannel (e o que o dublê de teste precisa ter). */
export interface CanalDeAbas {
  onmessage: ((evento: { data: unknown }) => void) | null;
  postMessage(dado: unknown): void;
  close(): void;
}

type Mensagem =
  | { tipo: "estado"; de: string; livre: boolean }
  | { tipo: "consulta"; de: string }
  | { tipo: "adeus"; de: string };

export interface CoordenacaoEntreAbas {
  /** Identidade desta aba no protocolo (também usada na reserva de instalação). */
  readonly id: string;
  /** Publica o estado atual agora (chamar quando ele muda). */
  anunciar(): void;
  /** `true` só se nenhum par conhecido está "ocupada" depois de pedir que
   * todos anunciem e esperar a janela. Depois de `fechar()` devolve `false`
   * (aba fechada não instala). */
  perguntarSeTodasLivres(): Promise<boolean>;
  /** Quantos pares estão conhecidos e ocupados agora (diagnóstico). */
  paresOcupados(): number;
  fechar(): void;
}

export interface OpcoesDaCoordenacao {
  /** A situação desta aba AGORA (sem bloqueio de compra/venda/pagamento). */
  estaLivre: () => boolean;
  janelaMs?: number;
  heartbeatMs?: number;
  validadeDoParMs?: number;
  /** Para teste: devolve o canal (ou null = sem suporte). */
  fabricaDeCanal?: (nome: string) => CanalDeAbas | null;
  /** Onde ouvir `pagehide`/`pageshow`. Padrão: `window`, se existir. */
  alvoDeCicloDeVida?: Pick<
    EventTarget,
    "addEventListener" | "removeEventListener"
  > | null;
}

function criarCanalPadrao(nome: string): CanalDeAbas | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(nome) as unknown as CanalDeAbas;
}

let contador = 0;
function novoId(): string {
  contador += 1;
  const aleatorio = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${contador}-${aleatorio}`;
}

function lerMensagem(dado: unknown): Mensagem | null {
  if (typeof dado !== "object" || dado === null) return null;
  const d = dado as Record<string, unknown>;
  if (typeof d.de !== "string") return null;
  if (d.tipo === "estado" && typeof d.livre === "boolean") {
    return { tipo: "estado", de: d.de, livre: d.livre };
  }
  if (d.tipo === "consulta") return { tipo: "consulta", de: d.de };
  if (d.tipo === "adeus") return { tipo: "adeus", de: d.de };
  return null;
}

function alvoPadraoDeCicloDeVida(): OpcoesDaCoordenacao["alvoDeCicloDeVida"] {
  return typeof window !== "undefined" ? window : null;
}

export function criarCoordenacaoEntreAbas(
  opcoes: OpcoesDaCoordenacao,
): CoordenacaoEntreAbas {
  const janelaMs = opcoes.janelaMs ?? JANELA_DE_CONSULTA_MS;
  const heartbeatMs = opcoes.heartbeatMs ?? INTERVALO_DO_HEARTBEAT_MS;
  const validadeMs = opcoes.validadeDoParMs ?? VALIDADE_DO_PAR_MS;
  const meuId = novoId();
  let fechada = false;

  let canal: CanalDeAbas | null = null;
  try {
    canal = (opcoes.fabricaDeCanal ?? criarCanalPadrao)(NOME_DO_CANAL_DE_ABAS);
  } catch {
    // Sem canal (SecurityError, sem suporte): pares desconhecidos.
    canal = null;
  }

  // O mapa dos pares: último estado conhecido + quando chegou o último sinal.
  const pares = new Map<string, { livre: boolean; em: number }>();
  const aguardando = new Set<() => void>();

  const estaLivreSeguro = (): boolean => {
    try {
      return opcoes.estaLivre();
    } catch {
      // Não conseguir dizer se está livre NÃO é estar livre.
      return false;
    }
  };

  const enviar = (mensagem: Mensagem): void => {
    try {
      canal?.postMessage(mensagem);
    } catch {
      // canal fechado no meio: o próximo heartbeat/consulta tenta de novo.
    }
  };

  const anunciar = (): void => {
    if (fechada || !canal) return;
    enviar({ tipo: "estado", de: meuId, livre: estaLivreSeguro() });
  };

  const podarPares = (): void => {
    const agora = Date.now();
    for (const [id, par] of pares) {
      if (agora - par.em > validadeMs) pares.delete(id);
    }
  };

  const paresOcupados = (): number => {
    podarPares();
    let n = 0;
    for (const par of pares.values()) if (!par.livre) n += 1;
    return n;
  };

  if (canal) {
    canal.onmessage = (evento) => {
      if (fechada) return;
      const mensagem = lerMensagem(evento?.data);
      if (!mensagem || mensagem.de === meuId) return;
      if (mensagem.tipo === "consulta") {
        anunciar();
      } else if (mensagem.tipo === "adeus") {
        pares.delete(mensagem.de);
      } else {
        pares.set(mensagem.de, { livre: mensagem.livre, em: Date.now() });
        if (!mensagem.livre) {
          for (const acordar of [...aguardando]) acordar();
        }
      }
    };
  }

  // Heartbeat + ciclo de vida: só existem com canal.
  let temporizadorDoHeartbeat: ReturnType<typeof setInterval> | null = null;
  const alvo = canal
    ? opcoes.alvoDeCicloDeVida === undefined
      ? alvoPadraoDeCicloDeVida()
      : opcoes.alvoDeCicloDeVida
    : null;
  const aoSair = () => enviar({ tipo: "adeus", de: meuId });
  const aoVoltar = () => anunciar();

  if (canal) {
    temporizadorDoHeartbeat = setInterval(anunciar, heartbeatMs);
    alvo?.addEventListener("pagehide", aoSair);
    alvo?.addEventListener("pageshow", aoVoltar);
    anunciar(); // presença ao montar
  }

  return {
    id: meuId,
    anunciar,
    paresOcupados,

    perguntarSeTodasLivres(): Promise<boolean> {
      if (fechada) return Promise.resolve(false);
      if (!canal) return Promise.resolve(true);

      return new Promise<boolean>((resolve) => {
        let temporizador: ReturnType<typeof setTimeout> | null = null;
        let encerrado = false;
        const encerrar = (livres: boolean) => {
          if (encerrado) return;
          encerrado = true;
          aguardando.delete(adiar);
          if (temporizador !== null) clearTimeout(temporizador);
          resolve(livres);
        };
        // Par que acaba de responder "ocupada", ou `fechar()` no meio da
        // consulta (aba fechada não instala): adia sem esperar a janela.
        const adiar = () => encerrar(false);
        aguardando.add(adiar);
        // A janela termina decidindo pelo MAPA (inclusive pares calados cujo
        // último estado era "ocupada"), não só pelas respostas desta rodada.
        temporizador = setTimeout(
          () => encerrar(paresOcupados() === 0),
          janelaMs,
        );
        enviar({ tipo: "consulta", de: meuId });
      });
    },

    fechar(): void {
      if (fechada) return;
      enviar({ tipo: "adeus", de: meuId });
      fechada = true;
      for (const acordar of [...aguardando]) acordar();
      aguardando.clear();
      pares.clear();
      if (temporizadorDoHeartbeat !== null)
        clearInterval(temporizadorDoHeartbeat);
      alvo?.removeEventListener("pagehide", aoSair);
      alvo?.removeEventListener("pageshow", aoVoltar);
      if (canal) {
        canal.onmessage = null;
        try {
          canal.close();
        } catch {
          // já fechado
        }
      }
    },
  };
}
