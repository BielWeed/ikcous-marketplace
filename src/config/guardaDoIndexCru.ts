// Páginas servidas CRUAS: "/index.html", "/404.html" (cópia do índice feita no
// build) e qualquer arquivo que não existe dentro de uma pasta estática
// (/icons, /images, /fonts...) — a Vercel responde esses caminhos com o índice
// do build, sem passar pelo porteiro (middleware.ts os tira do matcher, senão
// ele entraria em recursão ao baixar o próprio índice). Sem a ficha da loja,
// o app cairia na marca e no banco assados no build (os da loja principal, ou
// os do projeto ANTIGO dela) dentro do endereço de outra loja.
//
// A guarda decide, sem tocar em nada, o que fazer com o app que sobe SEM
// ficha em produção:
//   - fora de "/": o destino é "/" (o porteiro entrega a ficha certa ali);
//   - já em "/": não há para onde ir (o porteiro não entregou a ficha), então
//     a tela segura — nunca o assado. É isso que impede o laço: "/" nunca
//     redireciona.
// Em desenvolvimento, em endereço local (preview e testes de jornada, sem
// porteiro) e fora de um navegador nada muda.

type EntradaDoBoot = {
  ficha: unknown;
  pathname: string;
  hostname: string;
  dev: boolean;
  search: string;
  hash: string;
};

export type DecisaoDoBootSemFicha =
  | { tipo: "seguir" }
  | { tipo: "redirecionar"; destino: string }
  | { tipo: "tela-segura" };

// Só os nomes que o navegador entrega para a máquina do próprio dev. Sufixo
// ".localhost" exige o ponto, para "meulocalhost.com" não passar por local.
function enderecoLocal(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h === "::1" ||
    h.endsWith(".localhost")
  );
}

export function decidirBootSemFicha(
  entrada: EntradaDoBoot,
): DecisaoDoBootSemFicha {
  // pathname vazio = não há navegador (testes em ambiente node): nada a guardar.
  if (
    entrada.dev ||
    entrada.ficha ||
    entrada.pathname === "" ||
    enderecoLocal(entrada.hostname)
  ) {
    return { tipo: "seguir" };
  }
  if (entrada.pathname === "/") return { tipo: "tela-segura" };
  return { tipo: "redirecionar", destino: `/${entrada.search}${entrada.hash}` };
}
