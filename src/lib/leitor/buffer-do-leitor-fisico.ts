// Leitor físico USB/Bluetooth se apresenta ao sistema operacional como
// TECLADO: ele "digita" o código muito rápido e termina com Enter. Este
// módulo acumula essas teclas num buffer e entrega o código pronto pelo
// MESMO caminho da leitura por câmera (tarefa C2.2, plano seção 5.3 item 1).
// Puro de propósito — sem `document`/`window` aqui dentro: quem assina
// `keydown` é o hook de C2.3, e é por isso que este arquivo é testável sem
// DOM nenhum.

/** Acima disso, é gente digitando (nunca leitor físico) — ver regra 5. */
export const INTERVALO_MAXIMO_ENTRE_TECLAS_MS = 50;

/** Abaixo disso, o Enter não confirma leitura (evita ruído de tecla solta). */
export const TAMANHO_MINIMO_DO_CODIGO = 4;

/**
 * A RPC `buscar_por_codigo_barras` (lote C1) recusa código acima de 64
 * caracteres com "Código de barras inválido." — descartar aqui evita mandar
 * lixo acumulado para o servidor.
 */
export const TAMANHO_MAXIMO_DO_CODIGO = 64;

/** O pedaço de `KeyboardEvent` que este módulo usa. */
export interface TeclaDoLeitor {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: EventTarget | null;
  preventDefault?: () => void;
}

export interface OpcoesDoBufferFisico {
  readonly aoLer: (codigo: string) => void;
  /** Relógio injetável — o teste não depende de timer falso. Padrão `Date.now`. */
  readonly agora?: () => number;
  readonly intervaloMaximoMs?: number;
  readonly tamanhoMinimo?: number;
  readonly tamanhoMaximo?: number;
}

export interface BufferDoLeitorFisico {
  aoPressionarTecla(evento: TeclaDoLeitor): void;
  limpar(): void;
}

/**
 * `true` quando o alvo do evento é um campo onde digitar é o próprio ponto
 * (INPUT/TEXTAREA/SELECT ou algo com `contenteditable`). Exportada porque o
 * teste prova a função sozinha, sem passar por `aoPressionarTecla`.
 *
 * POR QUÊ: quem está digitando o preço num `LocalBufferedInput`
 * (src/components/admin/LocalBufferedInput.tsx, usado por 6 telas do admin)
 * não pode ver o próprio Enter virar leitura de produto.
 */
export function focoEstaEmCampoEditavel(
  alvo: EventTarget | null | undefined,
): boolean {
  if (alvo === null || alvo === undefined || !("tagName" in alvo)) {
    return false;
  }
  const elemento = alvo as unknown as {
    readonly tagName?: unknown;
    readonly isContentEditable?: unknown;
    getAttribute?: (nome: string) => string | null;
  };
  const tagName =
    typeof elemento.tagName === "string" ? elemento.tagName.toUpperCase() : "";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (elemento.isContentEditable === true) {
    return true;
  }
  const contentEditableAttr =
    typeof elemento.getAttribute === "function"
      ? elemento.getAttribute("contenteditable")
      : null;
  return contentEditableAttr === "" || contentEditableAttr === "true";
}

export function criarBufferDoLeitorFisico(
  opcoes: OpcoesDoBufferFisico,
): BufferDoLeitorFisico {
  const agora = opcoes.agora ?? Date.now;
  const intervaloMaximoMs =
    opcoes.intervaloMaximoMs ?? INTERVALO_MAXIMO_ENTRE_TECLAS_MS;
  const tamanhoMinimo = opcoes.tamanhoMinimo ?? TAMANHO_MINIMO_DO_CODIGO;
  const tamanhoMaximo = opcoes.tamanhoMaximo ?? TAMANHO_MAXIMO_DO_CODIGO;

  let buffer = "";
  let instanteDaUltimaTecla = 0;
  // Fica `true` quando o BURST atual (a sequência ininterrupta de teclas
  // rápidas que forma UMA leitura) já passou de `tamanhoMaximo`. Sem esta
  // bandeira, descartar só o buffer faria as teclas RESTANTES do mesmo burst
  // formarem um buffer novo e curto — um código de 70 caracteres viraria uma
  // "leitura" de 5 caracteres lixo em vez de nada. Só um novo burst (gap
  // maior que `intervaloMaximoMs`) ou o Enter que fecha este burst tiram o
  // leitor deste estado.
  let burstEmExcesso = false;

  function limpar(): void {
    buffer = "";
    instanteDaUltimaTecla = 0;
    burstEmExcesso = false;
  }

  function aoPressionarTecla(evento: TeclaDoLeitor): void {
    // 1. Atalho de sistema (Ctrl/Cmd/Alt + tecla) não é leitura.
    if (evento.ctrlKey || evento.metaKey || evento.altKey) {
      limpar();
      return;
    }

    // 2. Quem está digitando num formulário do admin tem prioridade sobre
    // o leitor físico — ver `focoEstaEmCampoEditavel`.
    if (focoEstaEmCampoEditavel(evento.target)) {
      limpar();
      return;
    }

    if (evento.key === "Enter") {
      if (!burstEmExcesso && buffer.length >= tamanhoMinimo) {
        // Sem isso o Enter também submeteria o formulário que estiver por
        // perto (o leitor físico manda Enter de verdade, não um evento
        // sintético isolado).
        evento.preventDefault?.();
        opcoes.aoLer(buffer);
      }
      limpar();
      return;
    }

    // 4. Teclas de controle (Shift, Tab, F5, setas...) não fazem parte do
    // código em si, mas Shift PODE preceder uma letra maiúscula (Code 39
    // usa letras) — ignora sem limpar o buffer em andamento.
    if (evento.key.length !== 1) {
      return;
    }

    // 5. Tecla imprimível. Gente digitando nunca fica abaixo de
    // `intervaloMaximoMs` entre teclas; um leitor físico sim — é essa
    // diferença de velocidade que separa "leitura" de "digitação".
    const instante = agora();
    if (instante - instanteDaUltimaTecla > intervaloMaximoMs) {
      // Gap grande: começa um burst NOVO, mesmo que o anterior tivesse
      // estourado o tamanho — o excesso pertence ao burst antigo, não a
      // este.
      buffer = evento.key;
      burstEmExcesso = false;
    } else if (!burstEmExcesso) {
      buffer += evento.key;
      if (buffer.length > tamanhoMaximo) {
        // Estourou o teto que o banco aceita: o que tiver vindo até aqui é
        // ruído (tecla presa, colagem acidental, código maior que o
        // suportado...). Descarta e marca o burst como perdido — as teclas
        // que ainda vierem dentro da MESMA rajada são ignoradas em vez de
        // formar um código curto e falso.
        buffer = "";
        burstEmExcesso = true;
      }
    }
    // `else`: burst já em excesso e ainda dentro da janela — ignora a tecla,
    // continua esperando o Enter (que não lê nada) ou um gap que abra um
    // burst novo.
    instanteDaUltimaTecla = instante;
  }

  return { aoPressionarTecla, limpar };
}
