// SEO (issue #117): robots.txt e sitemap.xml da LOJA que está sendo construída.
//
// Desenho:
// - As sementes vivem versionadas em public/ (para o `vite dev` e para o
//   critério 1 da issue) e o build REGENERA os dois arquivos no outDir,
//   depois do gerarHospedagem e antes do version.json — é o caminho definido
//   para o sitemap não envelhecer (critério 3), porque cada build fala com o
//   catálogo vivo da loja.
// - Em modo database, os ids de produto vêm da MESMA vista pública e com os
//   MESMOS cabeçalhos que o worker de compartilhamento usa
//   (src/hospedagem/compartilhamento.ts) — o confronto entre os dois lados
//   está em tests/front/sitemap-seo.test.ts. Em modo fixture, NADA sai para a
//   rede: o build de ensaio do CI não tem banco e não pode depender dele.
// - A URL de produto é a canônica do compartilhamento (a og:url): o sitemap
//   e a prévia social precisam anunciar a mesma página.
// - As 4 entradas estáticas preservam o retrato do public/sitemap.xml
//   versionado (lastmod 2024-03-21 etc.), só reescrevendo a origem para a
//   publicUrl da loja. Entrada de produto entra SÓ com <loc>: lastmod,
//   changefreq e priority são política de SEO que a issue #117 não define, e
//   inventá-los é exatamente o que a peça manda não fazer.
//
// Falha SEMPRE é alta (throw): um sitemap velho servido em silêncio é pior
// que um build vermelho — por isso aqui não existe o "devolve null" do
// consultarProduto.

import fs from "node:fs/promises";
import path from "node:path";

export const PRAZO_MS = 20000; // build aguenta esperar mais que a prévia de 2,5 s
export const PAGINA = 1000; // teto de linhas por página do PostgREST
export const MAX_PRODUTOS = 10000; // acima disso o build reprova em vez de truncar
const CORPO_MAXIMO = 512 * 1024; // select=id + limit=PAGINA bornam o corpo por construção

// publicUrl tem o mesmo contrato do snapshot (HTTPS, raiz, sem barra final).
// A guarda mora aqui, e não só no buildStore, porque as funções puras abaixo
// são exportadas: quem chamá-las direto não pode gerar Sitemap relativo — o
// defeito que abriu a issue era exatamente um "Sitemap: /sitemap.xml".
export function publicUrlValido(publicUrl) {
  const reprovado = () =>
    new Error(`SITEMAP_PUBLIC_URL (${String(publicUrl)})`);
  if (typeof publicUrl !== "string") throw reprovado();
  let url;
  try {
    url = new URL(publicUrl);
  } catch {
    throw reprovado();
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    // Barra final na raiz também devolve pathname "/" — o confronto com o
    // origin pega ela e o subcaminho de uma vez: o publicUrl da loja é
    // exatamente scheme://host, nada mais.
    publicUrl !== url.origin
  )
    throw reprovado();
  return publicUrl;
}

// Espelho da URL canônica de produto de src/hospedagem/compartilhamento.ts
// (og:url do montarHtml). encodeURIComponent já neutraliza & < > " para
// XML e URL — tests/front/sitemap-seo.test.ts pina essa propriedade e
// confronta os dois lados.
export function urlDeProduto(publicUrl, id) {
  return `${publicUrl}/product-detail?id=${encodeURIComponent(id)}`;
}

export function robotsTxt(publicUrl) {
  const origem = publicUrlValido(publicUrl);
  return `User-agent: *\nAllow: /\n\nSitemap: ${origem}/sitemap.xml\n`;
}

const entradaEstatica = (loc, prioridade) =>
  `  <url>\n    <loc>${loc}</loc>\n    <lastmod>2024-03-21</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${prioridade}</priority>\n  </url>\n`;

export function sitemapXml(publicUrl, ids) {
  const origem = publicUrlValido(publicUrl);
  let xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += entradaEstatica(`${origem}/`, "1.0");
  xml += entradaEstatica(`${origem}/?view=cart`, "0.8");
  xml += entradaEstatica(`${origem}/?view=favorites`, "0.8");
  xml += entradaEstatica(`${origem}/?view=orders`, "0.8");
  const vistos = new Set();
  for (const id of ids) {
    if (vistos.has(id)) continue; // a vista é a fonte, mas o arquivo sai deduplicado
    vistos.add(id);
    xml += `  <url>\n    <loc>${urlDeProduto(origem, id)}</loc>\n  </url>\n`;
  }
  xml += "</urlset>\n";
  return xml;
}

// Espelho de cabecalhosDaConsulta() em src/hospedagem/compartilhamento.ts:
// publishable vai só em apikey (não é JWT); o JWT anon legado precisa do
// Bearer. Objeto simples (não Headers) porque viaja em RequestInit.
export function cabecalhosDaConsulta(conexao) {
  const cabecalhos = { apikey: conexao.key, Accept: "application/json" };
  if (conexao.keyClass === "anon-jwt")
    cabecalhos.Authorization = `Bearer ${conexao.key}`;
  return cabecalhos;
}

// Keyset (id=gt.) e nunca offset: com offset, página virada durante o build
// duplica ou engole produto; com keyset, cada página continua da última vista.
export function montarConsulta(origin, depoisDe, limite = PAGINA) {
  const partes = ["select=id", "order=id.asc", `limit=${limite}`];
  if (depoisDe !== null) partes.push(`id=gt.${encodeURIComponent(depoisDe)}`);
  return `${origin}/rest/v1/vw_produtos_public?${partes.join("&")}`;
}

export async function buscarIdsDeProdutos(connection, opcoes = {}) {
  if (connection?.kind !== "database") throw new Error("SITEMAP_CONNECTION");
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const prazoMs = opcoes.prazoMs ?? PRAZO_MS;
  const limite = opcoes.pagina ?? PAGINA;
  const maxProdutos = opcoes.maxProdutos ?? MAX_PRODUTOS;
  if (!Number.isInteger(limite) || limite < 1)
    throw new Error(`SITEMAP_PAGINA (${limite})`);
  if (!Number.isInteger(maxProdutos) || maxProdutos < 1)
    throw new Error(`SITEMAP_MAX_PRODUTOS (${maxProdutos})`);
  const ids = [];
  let depoisDe = null;
  for (;;) {
    const resposta = await fetchImpl(
      montarConsulta(connection.origin, depoisDe, limite),
      {
        headers: cabecalhosDaConsulta(connection),
        redirect: "manual",
        signal: AbortSignal.timeout(prazoMs),
      },
    );
    if (!resposta.ok) throw new Error(`SITEMAP_HTTP_${resposta.status}`);
    const texto = await resposta.text();
    if (texto.length > CORPO_MAXIMO) throw new Error("SITEMAP_CORPO");
    let lista;
    try {
      lista = JSON.parse(texto);
    } catch {
      throw new Error("SITEMAP_SHAPE");
    }
    if (!Array.isArray(lista)) throw new Error("SITEMAP_SHAPE");
    for (const item of lista) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof item.id !== "string" ||
        item.id === ""
      )
        throw new Error("SITEMAP_SHAPE");
      ids.push(item.id);
    }
    if (lista.length < limite) break; // última página
    depoisDe = lista[lista.length - 1].id;
    if (ids.length > maxProdutos) throw new Error("SITEMAP_LIMITE");
  }
  return ids;
}

// Chamado pelo buildStore logo após gerarHospedagem. Sobrescreve as sementes
// que o Vite copiou de public/ — o wx da hospedagem não se aplica aqui: este
// arquivo PRECISA substituir o retrato velho pelo catálogo vivo. Falha aqui
// deixa a saída sem version.json, como qualquer falha tardia do build.
export async function gerarSitemap(outDir, delivery, opcoes = {}) {
  if (delivery?.connection?.kind !== "database") return [];
  const publicUrl = publicUrlValido(delivery.snapshot?.publicUrl);
  const ids = await buscarIdsDeProdutos(delivery.connection, opcoes);
  const arquivos = [
    ["robots.txt", robotsTxt(publicUrl)],
    ["sitemap.xml", sitemapXml(publicUrl, ids)],
  ];
  for (const [nome, conteudo] of arquivos) {
    const destino = path.join(outDir, nome);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- outDir já validado por localDirectory() (buildStore.mjs:305); "nome" vem dos dois literais fechados acima.
    await fs.writeFile(destino, conteudo, "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- mesmo destino recém-gravado nesta linha; releitura de conferência, não entrada externa.
    const relido = await fs.readFile(destino, "utf8");
    if (relido !== conteudo) throw new Error(`SITEMAP_WRITE_MISMATCH ${nome}`);
  }
  return arquivos.map(([nome]) => nome);
}
