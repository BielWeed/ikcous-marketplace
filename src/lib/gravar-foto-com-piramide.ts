// Grava UMA foto no Storage, com ou sem a pirâmide de cópias (plano das
// miniaturas, 26/11/2026). Usado pelo envio de foto de produto (useProducts) e
// de banner (useBanners); não importa o gerador nem o cliente do Supabase --
// recebe o bucket já aberto e o gerador que a tela do painel entregou.
//
// A INVARIANTE: nunca existe endereço marcado sem as 3 cópias gravadas.
//   1. As 3 cópias sobem primeiro (juntas) e TODAS precisam dar certo.
//   2. A original marcada (`<base>-v<marca>.<ext>`) sobe por ÚLTIMO -- é o
//      registro de commit: a marca só passa a existir com as cópias no lugar.
//   3. Falhou uma cópia: as 3 são apagadas (melhor esforço) e a original sobe
//      SEM marca, com o nome de hoje (`<base>.<ext>`).
//   4. Falhou a original marcada: as 3 são apagadas e o erro sobe, como hoje.
// Sem gerador, gerador que devolve `null`/lança, pirâmide fora do formato ou
// extensão que o leitor da marca não reconhece: só a original, sem marca --
// exatamente o envio de hoje.
import {
  type GerarPiramide,
  LADOS,
  type Piramide,
  nomeMarcado,
  nomesDasCopias,
} from "./piramide-da-foto-nomes";

/** O pedaço do bucket do Storage que o envio usa. */
export interface BucketDoEnvio {
  upload(
    caminho: string,
    arquivo: File,
    opcoes: { cacheControl: string; upsert: boolean; contentType?: string },
  ): PromiseLike<{ error: unknown }>;
  remove(caminhos: string[]): PromiseLike<unknown>;
}

const OPCOES_DO_ENVIO = { cacheControl: "31536000", upsert: false } as const;

/** A pirâmide tem exatamente o formato que os leitores da marca supõem? */
function piramideValida(piramide: Piramide | null): piramide is Piramide {
  return (
    piramide !== null &&
    (piramide.marca === "w" || piramide.marca === "j") &&
    piramide.copias.length === LADOS.length &&
    LADOS.every((lado, i) => piramide.copias.at(i)?.lado === lado) &&
    piramide.copias.every((copia) => copia.arquivo instanceof Blob)
  );
}

async function gravar(
  bucket: BucketDoEnvio,
  caminho: string,
  arquivo: File,
  opcoes: { cacheControl: string; upsert: boolean; contentType?: string },
): Promise<unknown> {
  try {
    const { error } = await bucket.upload(caminho, arquivo, opcoes);
    return error ?? null;
  } catch (erro) {
    return erro ?? new Error("Falha ao enviar.");
  }
}

async function apagarCopias(bucket: BucketDoEnvio, nomes: string[]) {
  try {
    await bucket.remove(nomes);
  } catch (erro) {
    console.warn("[gravarFotoComPiramide] cópias não apagadas:", nomes, erro);
  }
}

/**
 * Grava a foto e devolve o CAMINHO gravado no bucket (marcado ou não).
 * Lança o erro do Storage quando a original não pôde ser gravada.
 */
export async function gravarFotoComPiramide({
  bucket,
  base,
  ext,
  foto,
  piramide: gerar,
}: {
  bucket: BucketDoEnvio;
  base: string;
  ext: string;
  foto: File;
  piramide?: GerarPiramide;
}): Promise<string> {
  const semMarca = `${base}.${ext}`;
  const gravarSemMarca = async () => {
    const { error } = await bucket.upload(semMarca, foto, OPCOES_DO_ENVIO);
    if (error) throw error;
    return semMarca;
  };
  if (!gerar) return gravarSemMarca();

  // O nome marcado tem de ser LIDO de volta como marcado (extensão aceita,
  // base no formato): só então as cópias são as que os leitores procuram.
  if (nomesDasCopias(nomeMarcado(base, "w", ext)) === null)
    return gravarSemMarca();

  let piramide: Piramide | null;
  try {
    piramide = await gerar(foto);
  } catch {
    piramide = null;
  }
  if (!piramideValida(piramide)) return gravarSemMarca();

  const marcado = nomeMarcado(base, piramide.marca, ext);
  const nomes = nomesDasCopias(marcado);
  if (!nomes) return gravarSemMarca();

  const erros = await Promise.all(
    piramide.copias.map((copia, i) => {
      const nome = nomes.at(i) ?? "";
      const tipo = copia.arquivo.type;
      return gravar(
        bucket,
        nome,
        new File([copia.arquivo], nome, { type: tipo }),
        {
          ...OPCOES_DO_ENVIO,
          contentType: tipo,
        },
      );
    }),
  );
  if (erros.some((erro) => erro !== null)) {
    console.warn(
      "[gravarFotoComPiramide] cópia falhou; a foto sobe sem marca:",
      erros,
    );
    await apagarCopias(bucket, nomes);
    return gravarSemMarca();
  }

  const erroDaOriginal = await gravar(bucket, marcado, foto, OPCOES_DO_ENVIO);
  if (erroDaOriginal !== null) {
    await apagarCopias(bucket, nomes);
    throw erroDaOriginal;
  }
  return marcado;
}
