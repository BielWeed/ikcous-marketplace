const EXIF = [69, 120, 105, 102, 0, 0]; // "Exif\0\0"

function lerOrientacao(tiff: DataView): number | undefined {
  if (tiff.byteLength < 8) return;
  const ordem = tiff.getUint16(0);
  const little = ordem === 0x4949;
  if ((!little && ordem !== 0x4d4d) || tiff.getUint16(2, little) !== 42) return;

  const inicio = tiff.getUint32(4, little);
  if (inicio < 8 || inicio + 2 > tiff.byteLength) return;
  const fim = inicio + 2 + tiff.getUint16(inicio, little) * 12;
  if (fim + 4 > tiff.byteLength) return;
  for (let pos = inicio + 2; pos < fim; pos += 12) {
    if (
      tiff.getUint16(pos, little) === 0x0112 &&
      tiff.getUint16(pos + 2, little) === 3 &&
      tiff.getUint32(pos + 4, little) === 1
    ) {
      const valor = tiff.getUint16(pos + 8, little);
      if (valor >= 1 && valor <= 8) return valor;
    }
  }
}

function exifSoComOrientacao(valor: number) {
  // TIFF novo: uma entrada SHORT inline, sem ponteiro GPS, miniatura ou outra IFD.
  const app1 = [0xff, 0xe1, 0, 34, ...EXIF];
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8];
  const ifd = [0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, valor, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([...app1, ...tiff, ...ifd]);
}

/** Tira APP1 Exif sem recodificar a foto; mantém só a orientação se necessária. */
export function limparExifJpeg(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const remocoes: Array<{ inicio: number; fim: number }> = [];
  let orientacao: number | undefined;
  let tamanho = bytes.length;
  let pos = 2;
  let emScan = false;
  while (pos < bytes.length) {
    if (emScan) pos = bytes.indexOf(0xff, pos);
    if (pos < 0 || bytes.at(pos) !== 0xff) break;
    while (bytes.at(pos) === 0xff) pos++;
    const marcador = bytes.at(pos++);
    if (marcador === undefined) break;
    if (marcador === 0xd9) {
      if (remocoes.length === 0) return bytes;
      const exif =
        orientacao && orientacao !== 1
          ? exifSoComOrientacao(orientacao)
          : undefined;
      const limpo = new Uint8Array(tamanho + (exif?.length ?? 0));
      let lido = 0;
      let escrito = 0;
      for (const { inicio, fim } of remocoes) {
        limpo.set(bytes.subarray(lido, inicio), escrito);
        escrito += inicio - lido;
        if (lido === 0 && exif) {
          limpo.set(exif, escrito);
          escrito += exif.length;
        }
        lido = fim;
      }
      limpo.set(bytes.subarray(lido), escrito);
      return limpo;
    }
    // Em dados comprimidos, FF00 é um byte escapado; RST não encerra o scan.
    if (emScan && (marcador === 0 || (marcador >= 0xd0 && marcador <= 0xd7)))
      continue;
    if (marcador === 1) continue; // TEM é um marcador sem comprimento.
    if (
      marcador < 0xc0 ||
      marcador === 0xd8 ||
      (marcador >= 0xd0 && marcador <= 0xd7)
    )
      break;
    if (pos + 2 > bytes.length) break;
    const comprimento = view.getUint16(pos);
    const fim = pos + comprimento;
    if (comprimento < 2 || fim > bytes.length) break;
    const dados = pos + 2;

    if (
      marcador === 0xe1 &&
      dados + EXIF.length <= fim &&
      EXIF.every((valor, i) => bytes.at(dados + i) === valor)
    ) {
      const tiff = dados + EXIF.length;
      orientacao ??= lerOrientacao(
        new DataView(bytes.buffer, bytes.byteOffset + tiff, fim - tiff),
      );
      const inicio = pos - 2;
      remocoes.push({ inicio, fim });
      tamanho -= fim - inicio;
    }
    emScan = marcador === 0xda;
    pos = fim;
  }
  // Estrutura malformada: não troca o original por uma foto parcialmente limpa.
  return bytes;
}

export async function arquivoJpegSemExif(file: File): Promise<File> {
  if (file.type !== "image/jpeg") return file;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const limpo = limparExifJpeg(bytes);
    if (limpo === bytes) return file;
    return new File([limpo], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch {
    // Se não deu para ler ou limpar, o upload mantém o comportamento anterior.
    return file;
  }
}
