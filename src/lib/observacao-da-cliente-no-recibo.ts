// O checkout junta observação, variações legadas e a nota automática de entrega.
// O papel já tem um bloco de retirada; estas linhas fixas não são observações.
export function observacaoDaClienteNoRecibo(notes?: string): string {
  const linhas: string[] = [];
  for (const linha of (notes ?? "").split(/\r?\n/)) {
    if (
      /^\s*Frete Escolhido:/.test(linha) ||
      /^\s*Retirada na loja(:|\s*$)/.test(linha)
    ) {
      continue;
    }
    if (linha.trim()) {
      linhas.push(linha);
    } else if (linhas.at(-1)?.trim()) {
      linhas.push("");
    }
  }
  return linhas.join("\n").trim();
}
