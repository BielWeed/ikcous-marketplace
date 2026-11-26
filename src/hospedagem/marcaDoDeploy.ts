// A MARCA DO DEPLOY no index.html (ressalva do revisor Opus no PR #1910,
// 26/11/2026).
//
// O porteiro guarda o `/index.html` em memória por 5 min (`baixarIndexHtml`,
// `porteiro.ts`). O self-fetch vai ao DOMÍNIO PÚBLICO, que serve o deploy para
// onde o domínio aponta naquele instante, e o projeto não tem Skew Protection:
// numa troca de domínio (ou rollback instantâneo) uma instância do deploy D1
// pode receber o HTML do D2, cujos `/assets/` não existem para quem o domínio
// manda ao D1 -- tela branca. Sem cache isso custava um pedido; guardado,
// custaria 5 min. Por isso o build grava o próprio id na página e o porteiro
// só GUARDA o HTML cuja marca é a do deploy em que ele roda.
//
// O id: `VERCEL_DEPLOYMENT_ID`, que a doc da Vercel ("System environment
// variables") dá como disponível "no build e no runtime" -- é o identificador
// que a própria Skew Protection usa. Num deploy, o build e o porteiro leem o
// MESMO valor; promover ou fazer rollback instantâneo reaproveita o deploy
// (marca e runtime continuam iguais); redeploy gera id novo nos dois.
//
// FALHA SEGURA, sempre para o lado "não guardar": sem id (build local, CI,
// `vercel --prebuilt`, que a doc diz não ter as variáveis de sistema no
// build), id com caractere fora de [A-Za-z0-9_-], marca ausente, duplicada ou
// torta -- o HTML é servido como antes e só não entra no cache.
//
// ESTE ARQUIVO É PURO (sem rede, sem relógio, sem `@/`): roda na borda, dentro
// do porteiro, e também no build (plugin do Vite em
// `scripts/marcaDoDeployNoHtml.ts`).

export const NOME_DA_MARCA_DO_DEPLOY = "ikcous-deploy";

const ID_SEGURO = /^[A-Za-z0-9_-]{1,128}$/;
const MARCA = /<meta name="ikcous-deploy" content="([^"]*)">/g;

/** O id do deploy, se for um id seguro para ir ao HTML; senão `null`. */
export function idDoDeploy(bruto: string | undefined): string | null {
  const valor = (bruto ?? "").trim();
  return ID_SEGURO.test(valor) ? valor : null;
}

/** Grava a marca logo antes do `</head>`. Sem id válido (ou sem `</head>`),
 * devolve o HTML byte a byte igual. */
export function marcarDeployNoHtml(
  html: string,
  bruto: string | undefined,
): string {
  const id = idDoDeploy(bruto);
  const fimDoHead = html.indexOf("</head>");
  if (id === null || fimDoHead === -1) return html;
  return `${html.slice(0, fimDoHead)}<meta name="${NOME_DA_MARCA_DO_DEPLOY}" content="${id}">\n${html.slice(fimDoHead)}`;
}

/** O id gravado no HTML, ou `null` se não houver exatamente UMA marca com um
 * id seguro (nunca adivinha qual de duas vale). */
export function deployDoHtml(html: string): string | null {
  const achadas = [...html.matchAll(MARCA)];
  if (achadas.length !== 1) return null;
  const valor = achadas[0]?.[1];
  return valor !== undefined && ID_SEGURO.test(valor) ? valor : null;
}
