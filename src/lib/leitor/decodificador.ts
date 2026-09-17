// Único lugar do app que sabe transformar um quadro em código de barras
// (tarefa C2.1, plano seção 5.3 item 1 / 5.4). Deliberadamente puro: nada de
// `getUserMedia`, `<video>` nem laço de captura aqui — isso é do hook de
// C2.3, que decide QUANDO chamar `detectar`. Por ser puro, este arquivo
// roda inteiro em `environment: "node"` (vitest.config.ts).
//
// Decisão do dono D10: BarcodeDetector nativo quando existir (a maioria dos
// Android já traz), fallback zxing-wasm só quando falta (iPhone), carregado
// LAZY. O fallback NUNCA é citado por especificador de import aqui — nem
// estático, nem dentro de `import(...)` — porque o pacote zxing-wasm só
// entra no repositório em C2.5, depois que a frente `tooling` largar o
// package.json (ver a divergência registrada no plano do lote C2). Em vez
// disso o chamador injeta um `carregarFallback: () => Promise<ModuloZxingReader>`;
// até C2.5 trocar o padrão para `() => import("./fallback-zxing")`, o padrão
// é `null` — sem fallback — e nada quebra o build.

/**
 * Formatos de código de barras que o balcão realmente usa. Nomes iguais aos
 * da spec WICG Shape Detection API (`BarcodeFormat`), que também é o nome
 * que a zxing-wasm aceita como "rótulo HRI" na ENTRADA — mas não na saída
 * (ver `deFormatoZxing` abaixo).
 */
export type FormatoDeLeitura =
  | "ean_13"
  | "ean_8"
  | "upc_a"
  | "upc_e"
  | "code_128"
  | "code_39"
  | "qr_code";

export interface Leitura {
  /** `rawValue`/`text` já com `trim()`; nunca vazio (linha descartada antes). */
  readonly codigo: string;
  readonly formato: FormatoDeLeitura | "desconhecido";
}

/**
 * O que `detectar()` aceita. O nativo lê o `HTMLVideoElement` direto
 * (WICG index.bs:62-66); o zxing-wasm só aceita `ImageData` (README 3.1.4)
 * — quem desenha o quadro num canvas é o hook de C2.3, guiado pela bandeira
 * `entrada` do decodificador escolhido.
 */
export type FonteDeImagem =
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap
  | ImageData;

export interface Decodificador {
  readonly motor: "nativo" | "zxing";
  /** O que `detectar()` espera receber deste motor. */
  readonly entrada: "video" | "imageData";
  readonly formatos: readonly FormatoDeLeitura[];
  detectar(fonte: FonteDeImagem): Promise<readonly Leitura[]>;
  /** Idempotente. */
  encerrar(): void;
}

/** Só o pedaço da API da zxing-wasm 3.1.4 que este módulo usa (README oficial). */
export interface ModuloZxingReader {
  readBarcodes(
    fonte: ImageData | Blob | ArrayBuffer | Uint8Array,
    opcoes?: {
      formats?: readonly string[];
      tryHarder?: boolean;
      maxNumberOfSymbols?: number;
    },
  ): Promise<readonly { readonly text: string; readonly format: string }[]>;
}

export type CarregadorDoFallback = () => Promise<ModuloZxingReader>;

// `BarcodeDetector` não existe na lib DOM do TypeScript (tsconfig.app.json:6
// = ES2022/DOM/DOM.Iterable, sem Shape Detection API). O tipo é nosso,
// copiado da IDL da spec WICG (lida em 16/09/2026). Fica de propósito FORA
// de `declare global`: poluir o global atrapalharia o dublê do teste e
// qualquer outro arquivo que um dia importe `lib.dom` mais nova.
interface CodigoDetectado {
  readonly rawValue: string;
  readonly format: string;
}

export interface ConstrutorDeBarcodeDetector {
  new (opcoes?: {
    formats?: readonly string[];
  }): { detect(fonte: unknown): Promise<readonly CodigoDetectado[]> };
  getSupportedFormats(): Promise<readonly string[]>;
}

export interface OpcoesDoDecodificador {
  /** Padrão: os sete formatos de balcão, na ordem de `FORMATOS_PADRAO`. */
  readonly formatos?: readonly FormatoDeLeitura[];
  /** Padrão: `null` (sem fallback) até C2.5 injetar `() => import("./fallback-zxing")`. */
  readonly carregarFallback?: CarregadorDoFallback | null;
  /** Padrão: `globalThis`. Existe para o teste dublar `BarcodeDetector` sem `declare global`. */
  readonly escopo?: { readonly BarcodeDetector?: ConstrutorDeBarcodeDetector };
}

export type OrigemDoErroDoDecodificador =
  | "sem_suporte"
  | "fonte_invalida"
  | "falha_do_fallback";

// Mesmo molde de src/hooks/usePushNotifications.ts:79-91: a frase JÁ
// traduzida vai em `.message` (o próximo `toast.error(err.message)` não
// pode voltar a vazar texto técnico cru), o erro original fica em `cause`.
function mensagemDaOrigem(origem: OrigemDoErroDoDecodificador): string {
  switch (origem) {
    case "sem_suporte":
      return "Este navegador não consegue ler código de barras pela câmera. Digite o código à mão.";
    case "fonte_invalida":
      return "O leitor recebeu um quadro que não sabe ler.";
    case "falha_do_fallback":
      return "Não foi possível carregar o leitor de código de barras. Verifique a conexão e tente de novo.";
  }
}

export class ErroDoDecodificador extends Error {
  readonly origem: OrigemDoErroDoDecodificador;

  constructor(origem: OrigemDoErroDoDecodificador, cause?: unknown) {
    super(mensagemDaOrigem(origem));
    this.name = "ErroDoDecodificador";
    this.origem = origem;
    this.cause = cause;
  }
}

export const FORMATOS_PADRAO: readonly FormatoDeLeitura[] = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
];

// De-para dos nomes que a zxing-wasm 3.1.4 aceita NA ENTRADA (README:
// "EAN13", "EAN8", "UPCA", "UPCE", "Code128", "Code39", "QRCode"). Mapa
// fechado (não indexado por chave variável) para não acordar
// `security/detect-object-injection` — a mesma razão documentada em
// src/hooks/usePushNotifications.ts:47-52; o teto de warnings do eslint
// não tem folga.
const NOSSO_PARA_ZXING = new Map<FormatoDeLeitura, string>([
  ["ean_13", "EAN13"],
  ["ean_8", "EAN8"],
  ["upc_a", "UPCA"],
  ["upc_e", "UPCE"],
  ["code_128", "Code128"],
  ["code_39", "Code39"],
  ["qr_code", "QRCode"],
]);

function paraFormatoZxing(formato: FormatoDeLeitura): string {
  // O mapa acima cobre as sete variantes de `FormatoDeLeitura` — o `??`
  // é só para o TypeScript, nunca dispara de verdade.
  return NOSSO_PARA_ZXING.get(formato) ?? formato;
}

// De-para de volta (SAÍDA do zxing-wasm -> nosso formato). O README avisa
// que `ReadResult.format` pode vir como nome canônico ("EAN13"), como
// rótulo HRI ("EAN-13") ou como raiz da simbologia ("EANUPC") — a lib
// aceita as três formas na entrada e "devolve a variante detectada" na
// saída, sem garantir qual das três. Normalizamos (minúsculas, sem `-`,
// `_`, `/` nem espaço) e comparamos com um mapa fechado.
//
// "eanupc" é a raiz de simbologia da família EAN/UPC quando o motor não
// distingue EAN-13 de UPC-A/E: mapeamos para "ean_13" porque é o formato de
// balcão mais comum dessa família (e é o que o teste de aceite desta tarefa
// exige) — se um dia aparecer ambiguidade real entre UPC e EAN nessa
// simbologia, revise esta linha antes de confiar cegamente nela.
const MAPA_ZXING_PARA_NOSSO = new Map<string, FormatoDeLeitura>([
  ["ean13", "ean_13"],
  ["ean8", "ean_8"],
  ["upca", "upc_a"],
  ["upce", "upc_e"],
  ["code128", "code_128"],
  ["code39", "code_39"],
  ["qrcode", "qr_code"],
  ["eanupc", "ean_13"],
]);

function normalizarFormatoZxing(formato: string): string {
  return formato.toLowerCase().replace(/[-_/\s]/g, "");
}

function deFormatoZxing(formato: string): FormatoDeLeitura | "desconhecido" {
  return (
    MAPA_ZXING_PARA_NOSSO.get(normalizarFormatoZxing(formato)) ?? "desconhecido"
  );
}

// O nativo já devolve a string da spec ("ean_13"...): só validamos contra
// a lista fechada de formatos que conhecemos.
function deFormatoNativo(formato: string): FormatoDeLeitura | "desconhecido" {
  return (FORMATOS_PADRAO as readonly string[]).includes(formato)
    ? (formato as FormatoDeLeitura)
    : "desconhecido";
}

function ehImageData(fonte: FonteDeImagem): fonte is ImageData {
  return (
    typeof fonte === "object" &&
    fonte !== null &&
    "data" in fonte &&
    "width" in fonte &&
    "height" in fonte
  );
}

interface NativoEscolhido {
  readonly detector: {
    detect(fonte: unknown): Promise<readonly CodigoDetectado[]>;
  };
  readonly formatos: readonly FormatoDeLeitura[];
}

// Regra de escolha do motor (a parte que o teste prende): há nativo se, e
// somente se, o construtor existe E `getSupportedFormats()` resolve com uma
// lista que contém pelo menos `ean_13` E `code_128` — os dois formatos que
// uma loja de verdade usa no balcão. A spec WICG (index.bs:215-219) diz que
// essa lista é dependente de plataforma e PODE vir vazia quando o agente
// não sabe detectar nada; por isso lista vazia (ou promessa rejeitada, ou
// sem os dois formatos) conta como "nativo ausente", não como erro.
async function tentarNativo(
  Ctor: ConstrutorDeBarcodeDetector,
  formatosPedidos: readonly FormatoDeLeitura[],
): Promise<NativoEscolhido | null> {
  let suportados: readonly string[];
  try {
    suportados = await Ctor.getSupportedFormats();
  } catch {
    return null;
  }

  const intersecao = formatosPedidos.filter((formato) =>
    suportados.includes(formato),
  );
  if (!intersecao.includes("ean_13") || !intersecao.includes("code_128")) {
    return null;
  }

  // `formats` vazio ou com "unknown" faz o construtor lançar TypeError
  // (spec WICG) — a checagem acima já garante uma interseção não vazia e
  // sem "unknown" (não está em `FormatoDeLeitura`).
  return { detector: new Ctor({ formats: intersecao }), formatos: intersecao };
}

function criarDecodificadorNativo(escolhido: NativoEscolhido): Decodificador {
  // Um `console.warn` só por instância: o laço de quadros chama `detectar`
  // várias vezes por segundo, e um aviso por quadro ruim entupiria o
  // console à toa.
  let avisoJaEmitido = false;

  return {
    motor: "nativo",
    entrada: "video",
    formatos: escolhido.formatos,
    async detectar(fonte) {
      let achados: readonly CodigoDetectado[];
      try {
        achados = await escolhido.detector.detect(fonte);
      } catch (erro) {
        // A spec (index.bs:76) manda `detect()` REJEITAR com
        // InvalidStateError quando a fonte é um vídeo com readyState
        // HAVE_NOTHING/HAVE_METADATA — condição normal enquanto a câmera
        // ainda está abrindo, não um bug: vira lista vazia em silêncio.
        // Qualquer outro erro também vira lista vazia (a leitura não pode
        // derrubar o laço da câmera), mas avisa uma vez.
        const eEsperado =
          erro instanceof DOMException && erro.name === "InvalidStateError";
        if (!eEsperado && !avisoJaEmitido) {
          avisoJaEmitido = true;
          console.warn(
            "Leitor nativo falhou ao decodificar um quadro; ignorando.",
            erro,
          );
        }
        return [];
      }

      const leituras: Leitura[] = [];
      for (const achado of achados) {
        const codigo = String(achado.rawValue ?? "").trim();
        if (codigo === "") continue;
        leituras.push({ codigo, formato: deFormatoNativo(achado.format) });
      }
      return leituras;
    },
    // Nada para liberar aqui: o `BarcodeDetector` nativo não expõe método
    // de descarte, e a câmera (as tracks do `MediaStream`) é vida do hook
    // de C2.3, não deste módulo. Idempotente por não fazer nada.
    encerrar() {},
  };
}

function criarDecodificadorZxing(
  formatosPedidos: readonly FormatoDeLeitura[],
  carregarFallback: CarregadorDoFallback | null,
): Decodificador {
  if (!carregarFallback) {
    throw new ErroDoDecodificador("sem_suporte");
  }
  // Reatribuído a um `const` próprio: dentro do fecho de `obterModulo` (uma
  // função aninhada, definida mais abaixo) o TypeScript não preserva o
  // estreitamento de `carregarFallback !== null` feito no `if` acima porque
  // é um parâmetro capturado, não uma variável `const` local — sem este
  // passo o `tsc -b` acusa "possibly null" na chamada.
  const carregar: CarregadorDoFallback = carregarFallback;

  const formatosTraduzidos = formatosPedidos.map(paraFormatoZxing);
  let avisoJaEmitido = false;
  // Memoizado no fecho: `carregarFallback()` só roda na PRIMEIRA vez que
  // `detectar()` precisa dele, e nunca de novo depois — é o que prova a
  // regra de "lazy de verdade" do teste (o import dinâmico caro do WASM só
  // paga quando o navegador realmente não tem o nativo).
  // Só a promessa que RESOLVE fica memoizada: se o import dinâmico do WASM
  // rejeitar (rede caiu no meio), a memória é limpa e o próximo `detectar()`
  // tenta carregar de novo — senão uma falha transitória viraria
  // `falha_do_fallback` para sempre naquela instância, contradizendo a
  // mensagem "verifique a conexão e tente de novo" (revisão de C2.1).
  let moduloPromise: Promise<ModuloZxingReader> | null = null;
  function obterModulo(): Promise<ModuloZxingReader> {
    if (!moduloPromise) {
      const tentativa = carregar();
      moduloPromise = tentativa;
      tentativa.catch(() => {
        if (moduloPromise === tentativa) moduloPromise = null;
      });
    }
    return moduloPromise;
  }

  return {
    motor: "zxing",
    entrada: "imageData",
    formatos: formatosPedidos,
    async detectar(fonte) {
      // Erro de programação de quem chamou (C3), não condição de corrida:
      // tem que aparecer alto, nunca virar lista vazia em silêncio.
      if (!ehImageData(fonte)) {
        throw new ErroDoDecodificador("fonte_invalida");
      }

      let modulo: ModuloZxingReader;
      try {
        modulo = await obterModulo();
      } catch (erro) {
        // Rede caiu no meio do import dinâmico do WASM.
        throw new ErroDoDecodificador("falha_do_fallback", erro);
      }

      let resultados: readonly {
        readonly text: string;
        readonly format: string;
      }[];
      try {
        resultados = await modulo.readBarcodes(fonte, {
          formats: formatosTraduzidos,
          tryHarder: true,
          maxNumberOfSymbols: 1,
        });
      } catch (erro) {
        if (!avisoJaEmitido) {
          avisoJaEmitido = true;
          console.warn(
            "Leitor de fallback falhou ao decodificar um quadro; ignorando.",
            erro,
          );
        }
        return [];
      }

      const leituras: Leitura[] = [];
      for (const resultado of resultados) {
        const codigo = resultado.text.trim();
        if (codigo === "") continue;
        leituras.push({ codigo, formato: deFormatoZxing(resultado.format) });
      }
      return leituras;
    },
    // O módulo Emscripten fica memoizado no fecho para reúso entre quadros;
    // este módulo não abre nenhum recurso próprio além dele, então não há
    // nada a fechar aqui (o WASM em si não expõe `dispose` na nossa
    // interface estreita). Idempotente por não fazer nada.
    encerrar() {},
  };
}

export async function criarDecodificador(
  opcoes: OpcoesDoDecodificador = {},
): Promise<Decodificador> {
  const formatosPedidos = opcoes.formatos ?? FORMATOS_PADRAO;
  // Escopo EXPLÍCITO manda, mesmo vazio: `escopo: {}` desliga o nativo (é
  // como um teste força o caminho zxing); só sem `escopo` nenhum é que o
  // `globalThis` do navegador real é consultado.
  const Ctor = opcoes.escopo
    ? opcoes.escopo.BarcodeDetector
    : (globalThis as { BarcodeDetector?: ConstrutorDeBarcodeDetector })
        .BarcodeDetector;

  const escolhido = Ctor ? await tentarNativo(Ctor, formatosPedidos) : null;
  if (escolhido) {
    return criarDecodificadorNativo(escolhido);
  }

  return criarDecodificadorZxing(
    formatosPedidos,
    opcoes.carregarFallback ?? null,
  );
}
