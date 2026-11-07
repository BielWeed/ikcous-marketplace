/**
 * O aparelho consegue abrir esta imagem? Primeiro pelo bitmap; se ele falhar,
 * pelo próprio <img> do navegador (a segunda opinião evita recusar foto boa
 * que o bitmap não pegou). Só diz "não abre" quando as DUAS conferências
 * falham; ambiente sem como conferir segue (fail-open, como o redimensionamento).
 *
 * Existe porque o tipo que o navegador declara vem da extensão: um HEIC ou um
 * arquivo estragado salvo como .jpg diz `image/jpeg` e passa pelas conferências
 * de tipo e peso. Usada pelo banner, pela foto de devolução e pela foto de
 * produto, antes de aceitar o arquivo.
 */
export async function imagemAbre(file: File): Promise<boolean> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close?.();
      return true;
    } catch {
      // cai na segunda opinião
    }
  }
  if (typeof Image === "undefined") return true;
  let endereco: string;
  try {
    endereco = URL.createObjectURL(file);
  } catch {
    return true;
  }
  try {
    return await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = endereco;
    });
  } finally {
    URL.revokeObjectURL(endereco);
  }
}
