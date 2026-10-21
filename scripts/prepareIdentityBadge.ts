/* eslint-disable security/detect-object-injection -- Indices are bounded RGBA pixel offsets in the decoded 192×192 icon, never object keys from input. */
import sharp from "sharp";

/**
 * Só raster já verificado pelo preparo, nunca SVG/original arbitrário.
 * Alpha com borda transparente: conserva a silhueta e a antialias original.
 * Fundo opaco: só remove cor UNIFORME (tolerância 8/255) ligada à borda.
 * Não segmenta foto/gradiente nem adivinha marca: ambiguidade/vazio retorna
 * undefined e o chamador usa o badge neutro, nunca o quadrado colorido.
 * Regiões fechadas da mesma cor do fundo continuam parte da silhueta.
 */
export async function prepararBadgeDaIdentidade(
  bytes: Uint8Array,
): Promise<Buffer | undefined> {
  const { data, info } = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 192 * 192,
  })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 192 || info.height !== 192 || info.channels !== 4)
    throw new Error("IDENTITY_BADGE_INVALID");
  const largura = info.width;
  const total = largura * info.height;
  const borda: number[] = [];
  for (let i = 0; i < largura; i++) {
    borda.push(i, total - largura + i);
    if (i > 0 && i < info.height - 1)
      borda.push(i * largura, i * largura + largura - 1);
  }
  if (borda.some((p) => data[p * 4 + 3] !== 0)) {
    const amostra = borda.find((p) => data[p * 4 + 3] === 255);
    if (amostra === undefined) return undefined;
    const fundo = data.subarray(amostra * 4, amostra * 4 + 3);
    const ehFundo = (p: number) =>
      data[p * 4 + 3] === 0 ||
      [0, 1, 2].every((c) => Math.abs(data[p * 4 + c] - fundo[c]) <= 8);
    if (!borda.every(ehFundo)) return undefined;
    const visitados = new Uint8Array(total);
    const fila: number[] = [];
    const visitar = (p: number) => {
      if (!visitados[p] && ehFundo(p)) {
        visitados[p] = 1;
        fila.push(p);
      }
    };
    for (const p of borda) visitar(p);
    for (let i = 0; i < fila.length; i++) {
      const p = fila[i];
      data[p * 4 + 3] = 0;
      if (p % largura > 0) visitar(p - 1);
      if (p % largura < largura - 1) visitar(p + 1);
      if (p >= largura) visitar(p - largura);
      if (p < total - largura) visitar(p + largura);
    }
  }
  let visiveis = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] > 0) visiveis++;
    data[p] = data[p + 1] = data[p + 2] = 255;
  }
  if (visiveis === 0) return undefined;
  const reduzida = await sharp(data, {
    raw: { width: 192, height: 192, channels: 4 },
  })
    .resize(96, 96)
    .raw()
    .toBuffer();
  // O resize pode arredondar RGB ao premultiplicar alpha. Só o alpha é a
  // silhueta: garante branco exato DEPOIS da redução, sem alterar a máscara.
  for (let p = 0; p < reduzida.length; p += 4)
    reduzida[p] = reduzida[p + 1] = reduzida[p + 2] = 255;
  return sharp(reduzida, {
    raw: { width: 96, height: 96, channels: 4 },
  })
    .png()
    .toBuffer();
}
