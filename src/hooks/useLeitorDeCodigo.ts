// Costura C2.1 (decodificador) e C2.2 (buffer do leitor físico, debounce e
// feedback) com a câmera de verdade (tarefa C2.3, plano seção 5.3 item 1).
// Único lugar do app que chama `getUserMedia`, monta o laço de quadros e
// decide o ciclo de vida da câmera do balcão.
//
// Um único `useEffect`, com `[ativo, tentativa]` na lista de dependências, é
// dono da câmera inteira (stream, decodificador, laço de quadros e o
// `visibilitychange` que pausa a decodificação). TUDO o mais fica em refs —
// padrão já usado em src/components/admin/LocalBufferedInput.tsx:84-90 e em
// src/hooks/useBuscaCep.ts:50-55 — para o efeito não reiniciar a câmera a
// cada render da tela do PDV (o `aoLer` do chamador quase sempre muda de
// identidade a cada render).
//
// O teclado (leitor físico) mora num efeito SEPARADO, com `[lerTeclado]` na
// lista: ele não depende de `ativo` de propósito. Um leitor USB/Bluetooth
// funciona sem câmera nenhuma — é só um teclado — então continua ouvindo
// mesmo enquanto a câmera está fechada/pausada/com erro. Os dois caminhos
// (câmera e teclado) desembocam na MESMA função `processar`, que já carrega
// o debounce de 1,5s e o bip/vibração de confirmação.

import {
  type FeedbackDoLeitor,
  criarFeedbackDoLeitor,
} from "@/lib/feedback-do-leitor";
import { criarBufferDoLeitorFisico } from "@/lib/leitor/buffer-do-leitor-fisico";
import {
  type DebounceDeLeitura,
  criarDebounceDeLeitura,
} from "@/lib/leitor/debounce-de-leitura";
import {
  type Decodificador,
  ErroDoDecodificador,
  type FonteDeImagem,
  type Leitura,
  criarDecodificador,
} from "@/lib/leitor/decodificador";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export type EstadoDoLeitor =
  | "ocioso"
  | "preparando"
  | "lendo"
  | "pausado"
  | "erro";

export type OrigemDoErroDoLeitor =
  | "permissao_negada"
  | "sem_camera"
  | "camera_ocupada"
  | "sem_suporte"
  | "contexto_inseguro"
  | "desconhecido";

export interface ErroDoLeitor {
  readonly origem: OrigemDoErroDoLeitor;
  readonly mensagem: string;
}

export interface OpcoesDoLeitorDeCodigo {
  /** A tela liga/desliga; `false` solta a câmera. */
  readonly ativo: boolean;
  /** Padrão `"continuo"`. */
  readonly modo?: "continuo" | "unico";
  readonly aoLer: (leitura: Leitura) => void;
  /** Padrão 150ms. */
  readonly intervaloMs?: number;
  /** Padrão `true`: liga o buffer do leitor físico (teclado). */
  readonly lerTeclado?: boolean;
  /** Injeção de teste. Padrão: `criarDecodificador` de @/lib/leitor/decodificador. */
  readonly criarDecodificador?: typeof criarDecodificador;
  /** Injeção de teste. Padrão: `navigator.mediaDevices`. */
  readonly midia?: Pick<MediaDevices, "getUserMedia"> | null;
  /** Injeção de teste. Padrão: `criarFeedbackDoLeitor()`. `null` desliga bip/vibração. */
  readonly feedback?: FeedbackDoLeitor | null;
}

export interface LeitorDeCodigoEmUso {
  readonly estado: EstadoDoLeitor;
  readonly erro: ErroDoLeitor | null;
  readonly motor: "nativo" | "zxing" | null;
  readonly ultimaLeitura: Leitura | null;
  readonly refDoVideo: RefObject<HTMLVideoElement | null>;
  tentarDeNovo(): void;
  /** Caminho manual: passa pelo MESMO debounce e feedback da câmera. */
  lerCodigoDigitado(codigo: string): void;
}

// `HTMLVideoElement.requestVideoFrameCallback` já está tipado nesta versão
// da lib DOM do TypeScript (o texto do plano que dizia o contrário estava
// desatualizado para este repositório) — mas o jsdom não o IMPLEMENTA em
// tempo de execução, daí a checagem `typeof ... === "function"` abaixo em
// vez de confiar cegamente no tipo.
/** A 30-60Hz do `requestVideoFrameCallback` decodificaria demais; este é o teto. */
const INTERVALO_PADRAO_MS = 150;

/** WICG index.bs:76: `detect()` exige pelo menos HAVE_CURRENT_DATA. */
const READY_STATE_MINIMO = 2;

/** O WASM não precisa de 1280x720 a cada quadro — reduz o custo do canvas. */
const LARGURA_MAXIMA_DO_CANVAS = 640;

// Mesmo molde de src/hooks/usePushNotifications.ts:53 e de
// src/lib/leitor/decodificador.ts:108: `switch` exaustivo (não `Record` +
// indexação, que acordaria `security/detect-object-injection`), frase JÁ
// traduzida — nunca uma `DOMException.message` crua na tela.
function mensagemDoErro(origem: OrigemDoErroDoLeitor): string {
  switch (origem) {
    case "permissao_negada":
      return "Você precisa permitir o acesso à câmera para ler o código. Libere a câmera nas configurações do navegador ou do aparelho e toque em Tentar de novo.";
    case "sem_camera":
      return "Nenhuma câmera foi encontrada neste aparelho. Digite o código à mão.";
    case "camera_ocupada":
      return "A câmera já está sendo usada por outro aplicativo. Feche o outro aplicativo e toque em Tentar de novo.";
    case "sem_suporte":
      return "Este navegador não abre a câmera nesta tela. Digite o código à mão.";
    case "contexto_inseguro":
      return "A câmera só funciona em endereço seguro (https). Digite o código à mão.";
    case "desconhecido":
      return "Não foi possível abrir a câmera. Digite o código à mão ou toque em Tentar de novo.";
  }
}

// De-para do `.name` da DOMException que `getUserMedia` rejeita com. Não
// precisa ser exaustivo (a entrada é uma string qualquer do navegador, não
// o enum `OrigemDoErroDoLeitor`) — o `default` cobre o "erro sem nome" e
// qualquer `.name` que a spec não documentou.
function origemDoErroDeCamera(erroBruto: unknown): OrigemDoErroDoLeitor {
  const nome =
    typeof (erroBruto as { name?: unknown } | null)?.name === "string"
      ? (erroBruto as { name: string }).name
      : "";
  switch (nome) {
    case "NotAllowedError":
    case "SecurityError":
      return "permissao_negada";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "sem_camera";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "camera_ocupada";
    case "TypeError":
      return "sem_suporte";
    default:
      return "desconhecido";
  }
}

export function useLeitorDeCodigo(
  opcoes: OpcoesDoLeitorDeCodigo,
): LeitorDeCodigoEmUso {
  const { ativo, lerTeclado = true } = opcoes;

  // Sempre a versão mais recente, sem entrar na lista de dependências do
  // efeito da câmera. Sincronizado num efeito SEM lista de dependências
  // (roda depois de TODO render) — e não direto no corpo do render, como
  // src/hooks/useBuscaCep.ts:50-51 faz — porque a regra `react-hooks/refs`
  // do eslint-plugin-react-hooks (nova, baseada no React Compiler) marca
  // ESCREVER num ref durante o render como erro; escrever dentro de um
  // efeito é o jeito que a própria doc do React recomenda hoje.
  const opcoesRef = useRef(opcoes);
  useEffect(() => {
    opcoesRef.current = opcoes;
  });

  const [estado, setEstado] = useState<EstadoDoLeitor>("ocioso");
  const [erro, setErro] = useState<ErroDoLeitor | null>(null);
  const [motor, setMotor] = useState<"nativo" | "zxing" | null>(null);
  const [ultimaLeitura, setUltimaLeitura] = useState<Leitura | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const refDoVideo = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Debounce (1,5s) e feedback (bip + vibração) são do LEITOR inteiro, não
  // só da câmera: o caminho do teclado (efeito separado, abaixo) também
  // passa por eles. Por isso vivem fora do efeito da câmera e só são
  // encerrados no desmonte completo do hook, não a cada `ativo` que vira
  // `false` — senão o AudioContext fecharia toda vez que a câmera pausa,
  // mesmo com o leitor físico continuando a funcionar sem ela.
  //
  // `useState(() => ...)` em vez de `useRef` + `if (!ref.current) ref.current
  // = ...`: o inicializador roda uma única vez (na montagem) e o valor nunca
  // muda depois — a mesma garantia do padrão de ref lazy, mas sem LER
  // `ref.current` durante o render (a regra `react-hooks/refs` do
  // eslint-plugin-react-hooks trata isso como leitura de ref no render,
  // mesmo dentro de um `if` de inicialização).
  const [debounce] = useState<DebounceDeLeitura>(() =>
    criarDebounceDeLeitura(),
  );
  const [feedback] = useState<FeedbackDoLeitor | null>(() =>
    opcoes.feedback === null
      ? null
      : (opcoes.feedback ?? criarFeedbackDoLeitor()),
  );
  useEffect(() => {
    return () => {
      feedback?.encerrar();
    };
  }, [feedback]);

  // Preenchido pelo efeito da câmera com a função que solta tudo — é assim
  // que `processar` (usada pelo teclado E pela câmera) consegue soltar a
  // câmera no modo "único" sem o efeito da câmera e o de teclado precisarem
  // se conhecer.
  const pararCameraRef = useRef<() => void>(() => {});

  const processar = useCallback(
    (leitura: Leitura) => {
      if (!debounce.aceita(leitura.codigo)) return;
      feedback?.confirmar();
      setUltimaLeitura(leitura);
      opcoesRef.current.aoLer(leitura);
      if ((opcoesRef.current.modo ?? "continuo") === "unico") {
        pararCameraRef.current();
      }
    },
    [debounce, feedback],
  );

  const lerCodigoDigitado = useCallback(
    (codigo: string) => {
      const codigoLimpo = codigo.trim();
      if (codigoLimpo === "") return;
      processar({ codigo: codigoLimpo, formato: "desconhecido" });
    },
    [processar],
  );

  const tentarDeNovo = useCallback(() => {
    setTentativa((t) => t + 1);
  }, []);

  // ===== EFEITO DA CÂMERA =====
  // Só `ativo`, `tentativa` e `processar` (estável, via `useCallback`) na
  // lista de dependências: o resto (aoLer, modo, intervaloMs,
  // criarDecodificador, midia) é lido via `opcoesRef` — que é um `ref` e,
  // por isso, não entra na lista — para não reiniciar a câmera a cada
  // render da tela do PDV.
  useEffect(() => {
    let cancelado = false;
    let laçoAtivo = true;
    let streamAtual: MediaStream | null = null;
    let decodificadorAtual: Decodificador | null = null;
    let cancelarQuadroAgendado: (() => void) | null = null;
    let pausado = false;
    let ultimoQuadroEm = 0;

    function cancelarQuadro(): void {
      cancelarQuadroAgendado?.();
      cancelarQuadroAgendado = null;
    }

    function pararTudo(): void {
      laçoAtivo = false;
      cancelarQuadro();
      if (streamAtual) {
        for (const track of streamAtual.getTracks()) track.stop();
        streamAtual = null;
      }
      if (refDoVideo.current) {
        refDoVideo.current.srcObject = null;
      }
      if (decodificadorAtual) {
        decodificadorAtual.encerrar();
        decodificadorAtual = null;
      }
      setEstado("ocioso");
      setMotor(null);
    }
    // Publicado ANTES de qualquer `return` — `processar()` (câmera OU
    // teclado) precisa dele mesmo quando este efeito nem chega a ligar a
    // câmera (ex.: `ativo === false`).
    pararCameraRef.current = pararTudo;

    function aoMudarVisibilidade(): void {
      pausado = document.hidden;
      // As tracks CONTINUAM VIVAS — só a decodificação pára. Soltar a
      // câmera aqui reabriria o balão de permissão em alguns navegadores no
      // meio de uma venda (divergência registrada no plano do lote C2).
      setEstado((atual) => {
        if (pausado) return atual === "lendo" ? "pausado" : atual;
        return atual === "pausado" ? "lendo" : atual;
      });
    }

    if (!ativo) {
      pararTudo();
      return () => {
        cancelado = true;
      };
    }

    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    setEstado("preparando");
    setErro(null);

    function falhar(origem: OrigemDoErroDoLeitor, causaBruta?: unknown): void {
      if (causaBruta !== undefined) {
        // O texto cru (em inglês, às vezes) nunca vai para a tela — só o
        // console, no molde de src/hooks/usePushNotifications.ts:79-91.
        console.warn(
          "Falha ao abrir a câmera do leitor de código:",
          causaBruta,
        );
      }
      setErro({ origem, mensagem: mensagemDoErro(origem) });
      setEstado("erro");
    }

    function agendarProximoQuadro(
      video: HTMLVideoElement,
      passo: () => void,
    ): void {
      if (typeof video.requestVideoFrameCallback === "function") {
        const id = video.requestVideoFrameCallback(passo);
        cancelarQuadroAgendado = () => video.cancelVideoFrameCallback(id);
        return;
      }
      const intervaloMs = opcoesRef.current.intervaloMs ?? INTERVALO_PADRAO_MS;
      const idDoTimeout = setTimeout(() => {
        const idDoQuadro = requestAnimationFrame(passo);
        cancelarQuadroAgendado = () => cancelAnimationFrame(idDoQuadro);
      }, intervaloMs);
      cancelarQuadroAgendado = () => clearTimeout(idDoTimeout);
    }

    // Desenha o quadro atual num canvas reduzido — o zxing-wasm só aceita
    // `ImageData` (README 3.1.4), nunca um `HTMLVideoElement` (ver
    // src/lib/leitor/decodificador.ts). `"sem_contexto"` cobre tanto o
    // jsdom (sem o pacote `canvas`) quanto um navegador de verdade sem
    // suporte a 2D canvas.
    function obterQuadroImageData(
      video: HTMLVideoElement,
    ): ImageData | "sem_contexto" {
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvasRef.current = canvas;
      }
      const larguraNatural = video.videoWidth || 1;
      const alturaNatural = video.videoHeight || 1;
      const escala = Math.min(1, LARGURA_MAXIMA_DO_CANVAS / larguraNatural);
      const largura = Math.max(1, Math.round(larguraNatural * escala));
      const altura = Math.max(1, Math.round(alturaNatural * escala));
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext("2d", {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D | null;
      if (!ctx) return "sem_contexto";
      ctx.drawImage(video, 0, 0, largura, altura);
      return ctx.getImageData(0, 0, largura, altura);
    }

    async function iniciar(): Promise<void> {
      const midia =
        opcoesRef.current.midia === undefined
          ? typeof navigator === "undefined"
            ? undefined
            : navigator.mediaDevices
          : opcoesRef.current.midia;

      if (
        typeof globalThis.isSecureContext === "boolean" &&
        !globalThis.isSecureContext
      ) {
        if (!cancelado) falhar("contexto_inseguro");
        return;
      }
      if (!midia || typeof midia.getUserMedia !== "function") {
        if (!cancelado) falhar("sem_suporte");
        return;
      }

      let streamObtido: MediaStream;
      try {
        // `facingMode` como `{ ideal: ... }`, nunca `{ exact: ... }`: com
        // `exact` um notebook sem câmera traseira devolve
        // OverconstrainedError e o lojista fica sem leitor por nada.
        streamObtido = await midia.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (erroBruto) {
        if (!cancelado) falhar(origemDoErroDeCamera(erroBruto), erroBruto);
        return;
      }

      if (cancelado) {
        // VAZAMENTO clássico: a resposta chegou depois do desmonte/da
        // desativação — a câmera não pode continuar acesa com o leitor já
        // morto.
        for (const track of streamObtido.getTracks()) track.stop();
        return;
      }

      streamAtual = streamObtido;
      const video = refDoVideo.current;
      if (video) {
        // NUNCA `URL.createObjectURL(stream)`: além de obsoleto, a CSP
        // desta loja tem `media-src 'self'` (vercel.json:36) e não libera
        // `blob:` — só `srcObject` (que não passa pela CSP) funciona.
        video.srcObject = streamObtido;
        try {
          await video.play();
        } catch {
          // A promessa de `play()` rejeita quando a aba perde o foco no
          // meio — não é erro de leitor.
        }
      }

      if (cancelado) {
        pararTudo();
        return;
      }

      let decodificador: Decodificador;
      try {
        const criar =
          opcoesRef.current.criarDecodificador ?? criarDecodificador;
        // `carregarFallback: undefined` é o padrão do módulo até C2.5 ligar
        // o zxing-wasm de verdade.
        decodificador = await criar({ carregarFallback: undefined });
      } catch (erroBruto) {
        if (cancelado) return;
        const origem: OrigemDoErroDoLeitor =
          erroBruto instanceof ErroDoDecodificador &&
          erroBruto.origem === "sem_suporte"
            ? "sem_suporte"
            : "desconhecido";
        pararTudo();
        falhar(origem, erroBruto);
        return;
      }

      if (cancelado) {
        decodificador.encerrar();
        pararTudo();
        return;
      }

      decodificadorAtual = decodificador;
      setMotor(decodificador.motor);
      setEstado("lendo");

      if (!video) return;

      async function passo(): Promise<void> {
        cancelarQuadroAgendado = null;
        if (!laçoAtivo || cancelado) return;

        if (!pausado && video && video.readyState >= READY_STATE_MINIMO) {
          const agoraEm = Date.now();
          const intervaloMs =
            opcoesRef.current.intervaloMs ?? INTERVALO_PADRAO_MS;
          if (agoraEm - ultimoQuadroEm >= intervaloMs) {
            ultimoQuadroEm = agoraEm;

            let fonte: FonteDeImagem;
            if (decodificador.entrada === "video") {
              fonte = video;
            } else {
              const resultado = obterQuadroImageData(video);
              if (resultado === "sem_contexto") {
                pararTudo();
                falhar("sem_suporte");
                return;
              }
              fonte = resultado;
            }

            const leituras = await decodificador.detectar(fonte);
            if (!laçoAtivo || cancelado) return;
            for (const leitura of leituras) {
              processar(leitura);
              // `processar` já chamou `pararTudo()` no modo "único" — não
              // agenda mais nada nem olha as leituras restantes do quadro.
              if (!laçoAtivo) break;
            }
          }
        }

        if (laçoAtivo && !cancelado && video) {
          agendarProximoQuadro(video, passo);
        }
      }

      agendarProximoQuadro(video, passo);
    }

    iniciar();

    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      pararTudo();
    };
  }, [ativo, tentativa, processar]);

  // ===== EFEITO DO TECLADO (leitor físico) =====
  // `[lerTeclado, processar]` — de propósito SEM `ativo`: um leitor
  // USB/Bluetooth é só um teclado, funciona sem câmera nenhuma. Se um dia a
  // tela precisar desligar o teclado junto com a câmera, mude aqui (a
  // decisão de manter separado está registrada nas divergências do plano
  // do lote C2). O buffer nasce DENTRO do efeito (não em `useRef`/`useState`
  // no corpo do render): a regra `react-hooks/refs` do eslint marca como
  // suspeito passar `processar` — que lê refs — para uma fábrica chamada
  // durante o render; criar dentro do efeito é inequivocamente seguro.
  useEffect(() => {
    if (!lerTeclado) return;
    const buffer = criarBufferDoLeitorFisico({
      aoLer: (codigo) => processar({ codigo, formato: "desconhecido" }),
    });
    function aoPressionarTecla(evento: KeyboardEvent): void {
      buffer.aoPressionarTecla(evento);
    }
    document.addEventListener("keydown", aoPressionarTecla);
    return () => {
      document.removeEventListener("keydown", aoPressionarTecla);
    };
  }, [lerTeclado, processar]);

  return {
    estado,
    erro,
    motor,
    ultimaLeitura,
    refDoVideo,
    tentarDeNovo,
    lerCodigoDigitado,
  };
}
