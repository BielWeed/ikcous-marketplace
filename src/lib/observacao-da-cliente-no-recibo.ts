// O checkout junta observação, variações legadas e a nota automática de entrega.
// O papel já tem um bloco de retirada; estas linhas fixas não são observações.
export function observacaoDaClienteNoRecibo(
  notes?: string,
  enderecoDeRetirada?: string,
): string {
  let texto = notes ?? "";
  const endereco = enderecoDeRetirada?.replace(/\r\n/g, "\n").trim();
  if (endereco) {
    texto = texto.replace(/\r\n/g, "\n").trimEnd();
    const rotulo = "Retirada na loja";
    // O checkout acrescenta a nota automática por último, em um bloco próprio.
    // Aceita também o formato sem endereço; o prefixo sozinho não identifica a nota.
    for (const nota of [`${rotulo}: ${endereco}`, rotulo]) {
      const sufixo = `\n\n${nota}`;
      // Uma observação única idêntica à nota automática é indistinguível.
      if (texto === nota) {
        texto = "";
        break;
      }
      if (texto.endsWith(sufixo)) {
        texto = texto.slice(0, -sufixo.length);
        break;
      }
    }
  }

  const linhas: string[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    if (
      /^\s*Frete Escolhido:/.test(linha) ||
      (!endereco && /^\s*Retirada na loja(:|\s*$)/.test(linha))
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
