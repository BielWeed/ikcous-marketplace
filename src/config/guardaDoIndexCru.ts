// "/index.html" não passa pelo porteiro (middleware.ts o tira do matcher, senão
// o porteiro entraria em recursão ao baixar esse mesmo arquivo): quem abre esse
// endereço numa loja cliente recebe o HTML CRU, sem a ficha da loja, e o app
// cairia na marca e no banco assados no build (os da loja principal).
//
// A guarda decide, sem tocar em nada: em produção, sem ficha e em exatamente
// "/index.html", o destino é "/" (o porteiro entrega a ficha certa ali). Em
// qualquer outro caminho devolve null, então "/" nunca volta para "/index.html"
// e não existe laço. Em desenvolvimento (servidor local, sem porteiro) e nos
// testes (jsdom em "/") nada muda.

export function destinoDoIndexCru(entrada: {
  ficha: unknown;
  pathname: string;
  dev: boolean;
  search: string;
  hash: string;
}): string | null {
  if (entrada.dev || entrada.ficha || entrada.pathname !== "/index.html") {
    return null;
  }
  return `/${entrada.search}${entrada.hash}`;
}
