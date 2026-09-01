/**
 * Laudo 0109 (A2): duplicar produto reusava as MESMAS URLs do Storage — do
 * produto e das variações dele. Semanas depois, excluir a cópia movia os
 * arquivos físicos para `backup/` (`backupStorageFile` usa `.move`) e
 * reescrevia só as URLs DA CÓPIA: o ORIGINAL continuava apontando para
 * caminhos que ficaram vazios, e as fotos sumiam da vitrine e do painel sem
 * erro em lugar nenhum.
 *
 * A cura é no NASCIMENTO da cópia: cada imagem ganha arquivo próprio, com
 * sufixo `_copia_` + uuid no lugar da extensão — apagar uma das partes
 * nunca mais toca no arquivo da outra.
 *
 * Este módulo é SÓ geometria de caminho (puro, sem importar cliente
 * Supabase — importar aqui faria toda view que o toca puxar o cliente de
 * banco e quebrar testes que montam a tela sem o mock). A operação de
 * storage que usa estas funções mora em `useProducts.ts`:
 * `copiarImagemParaDuplicacao`.
 */

/** Caminho do arquivo no bucket `products` atrás da URL — null se a URL
 * não tem arquivo nosso (placeholder, domínio externo, outro bucket). */
export function caminhoDaImagemDoProduto(url: string): string | null {
  if (!url) return null;
  if (url.includes("placehold.co") || url.includes("placeholder")) return null;
  const parts = url.split("/public/products/");
  if (parts.length < 2) return null;
  return decodeURIComponent(parts[1]);
}

/** Caminho único da cópia: o sufixo `_copia_<uuid>` entra no lugar da
 * extensão (a extensão reaparece no fim). */
export function caminhoDaCopia(caminho: string): string {
  const fileParts = caminho.split(".");
  const ext = fileParts.pop();
  const baseName = fileParts.join(".");
  return `${baseName}_copia_${crypto.randomUUID()}.${ext}`;
}
