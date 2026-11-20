// EXIF sintético: a IFD principal aponta para a latitude 12°34'56".
export function exifComGps(orientacao = 1, little = true) {
  const app1 = new Uint8Array(90);
  app1.set([0xff, 0xe1, 0, 88, 69, 120, 105, 102, 0, 0]);
  const tiff = new DataView(app1.buffer, 10);
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, little);
  tiff.setUint32(4, 8, little);
  tiff.setUint16(8, 2, little);
  tiff.setUint16(10, 0x0112, little); // Orientation, SHORT
  tiff.setUint16(12, 3, little);
  tiff.setUint32(14, 1, little);
  tiff.setUint16(18, orientacao, little);
  tiff.setUint16(22, 0x8825, little); // GPSInfo, LONG
  tiff.setUint16(24, 4, little);
  tiff.setUint32(26, 1, little);
  tiff.setUint32(30, 38, little);
  tiff.setUint16(38, 1, little);
  tiff.setUint16(40, 2, little); // GPSLatitude, três RATIONAL
  tiff.setUint16(42, 5, little);
  tiff.setUint32(44, 3, little);
  tiff.setUint32(48, 56, little);
  [12, 34, 56].forEach((valor, i) => {
    tiff.setUint32(56 + i * 8, valor, little);
    tiff.setUint32(60 + i * 8, 1, little);
  });
  return app1;
}

// JPEG baseline de 1×1, cinza, com um bloco de coeficientes zerados.
export const cabecalhoJpegSintetico = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xdb,
  0,
  67,
  0,
  ...Array<number>(64).fill(7),
  // SOF0: 8 bits, 1×1, um componente.
  0xff,
  0xc0,
  0,
  11,
  8,
  0,
  1,
  0,
  1,
  1,
  1,
  0x11,
  0,
  // DHT: um código de 1 bit em cada tabela (DC zero e AC fim do bloco).
  0xff,
  0xc4,
  0,
  38,
  0,
  1,
  ...Array<number>(15).fill(0),
  0,
  0x10,
  1,
  ...Array<number>(15).fill(0),
  0,
]);

export const jpegSintetico = new Uint8Array([
  ...cabecalhoJpegSintetico,
  // SOS: um componente; dados 00 seguidos de seis bits de preenchimento.
  0xff,
  0xda,
  0,
  8,
  1,
  1,
  0,
  0,
  63,
  0,
  0x3f,
  0xff,
  0xd9,
]);

export function comExif(jpeg: Uint8Array, ...segmentos: Uint8Array[]) {
  return new Uint8Array([
    ...jpeg.subarray(0, 2),
    ...segmentos.flatMap((segmento) => Array.from(segmento)),
    ...jpeg.subarray(2),
  ]);
}

/** jsdom ainda não oferece Blob.arrayBuffer, disponível no navegador. */
export function lerBytesNoJsdom(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result as ArrayBuffer);
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsArrayBuffer(blob);
  });
}

export function arquivoJpegComGps(type = "image/jpeg") {
  const original = new File(
    [comExif(jpegSintetico, exifComGps())],
    "foto.jpg",
    {
      type,
      lastModified: 42,
    },
  );
  original.arrayBuffer = () => lerBytesNoJsdom(original);
  const slice = original.slice.bind(original);
  original.slice = (...args) => {
    const parte = slice(...args);
    parte.arrayBuffer = () => lerBytesNoJsdom(parte);
    return parte;
  };
  return original;
}
