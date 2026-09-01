/**
 * Copia `texto` para a área de transferência e diz se DEU CERTO.
 *
 * Laudo 0109 (A-8): os pontos que copiavam (endereço e rastreio da ficha do
 * pedido, código do cupom) chamavam `navigator.clipboard.writeText(x)` sem
 * await e sem catch — e já mostravam "Copiado!" em verde mesmo quando a
 * cópia falhava (permissão negada, janela sem foco, API ausente). Quem
 * chama decide o que mostrar: `true` = comemorar; `false` = avisar que não
 * copiou.
 */
export async function copiarParaClipboard(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
