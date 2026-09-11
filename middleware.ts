import type {
  AmbientePorteiro,
  EntradaCachePorteiro,
  ResolverLojaNaCaderneta,
} from "./src/hospedagem/porteiro.ts";
import {
  atenderPorteiro,
  obterFichaValidada,
} from "./src/hospedagem/porteiro.ts";

// O `matcher` PRECISA ser um array-LITERAL bem aqui — a Vercel/Next lê
// `config.matcher` por ANÁLISE ESTÁTICA em tempo de build; qualquer valor
// que não seja um literal (import, variável, chamada de função) É IGNORADO
// e a rota vira `/(.*)` (doc oficial Next.js `proxy.mdx`, seção
// "Matcher > Good to know": "The matcher values need to be constants so
// they can be statically analyzed at build-time. Dynamic values such as
// variables will be ignored" — conferido via context7, `/vercel/next.js`,
// 11/09/2026). Matcher ignorado = o porteiro passaria a rodar em TODA
// requisição, inclusive `/assets/*.js` (que receberia o HTML injetado com
// content-type errado — app quebrado) e `/index.html` (recursão no
// self-fetch de `atenderPorteiro`, `src/hospedagem/porteiro.ts:497-498`).
//
// Por isso NUNCA se importa este array de `src/hospedagem/porteiro.ts` —
// ele exporta uma CÓPIA (`matcher`) só para o teste comparar
// (`tests/front/porteiro-middleware-matcher.test.ts`, que lê ESTE arquivo
// do disco e confere igualdade byte a byte com essa cópia). Rodada B
// (11/09/2026, brief T3b item 6): o primeiro padrão trocou a exclusão por
// EXTENSÃO por uma LISTA NOMEADA de prefixos (`assets/`, `store-identity/`,
// `icons/`, `images/`, `fonts/`) e arquivos de raiz que o build sempre
// produz (`sw.js`, `version.json`, `favicon.ico`/`.svg`, `logo.svg`,
// `apple-touch-icon.png`, `robots.txt`, `sitemap.xml`, `og-image.png`,
// `silent-guardian.js`, `loading.css`, `404.html`, `index.html`,
// `registerSW.js`, `workbox-*.js`) — qualquer OUTRO documento sem extensão
// reservada agora casa o primeiro padrão (ex.: `/qualquer.txt` passa a
// CASAR, `/assets/x.js` continua NÃO casando). Rodada 2 (achado 1 do
// revisor): a lista também precisa de `offline.html` (asset estático de
// `public/offline.html`) e do arquivo de verificação do Google Search
// Console (`google<hash>.html`, por PREFIXO — o nome muda a cada
// reverificação) — os dois EXISTEM em `dist-test/` e, sem entrar na lista,
// eram tratados como documento (self-fetch de `/index.html` no lugar do
// arquivo pedido). `/index.html` continua fora
// da lista de documentos (o self-fetch de `atenderPorteiro`,
// `src/hospedagem/porteiro.ts`, depende disso). `/identidade.json` e
// `/manifest.webmanifest` continuam como entradas SEPARADAS por clareza,
// ainda que a lista nomeada já não precise excluí-los para o primeiro
// padrão também os casar (nenhum dos dois nomes está na lista de raiz).
// `/product-detail` casa o primeiro padrão (sem nome reservado), então o
// caminho de robô abaixo continua funcionando sem entrada própria no
// matcher.
export const config = {
  matcher: [
    "/((?!assets/|store-identity/|icons/|images/|fonts/|sw\\.js$|workbox-[^/]*\\.js$|version\\.json$|favicon\\.ico$|favicon\\.svg$|logo\\.svg$|apple-touch-icon\\.png$|robots\\.txt$|sitemap\\.xml$|og-image\\.png$|silent-guardian\\.js$|loading\\.css$|404\\.html$|index\\.html$|registerSW\\.js$|offline\\.html$|google[A-Za-z0-9]*\\.html$).*)",
    "/identidade.json",
    "/manifest.webmanifest",
  ],
};

// `Map` de módulo: vive uma vez por isolate da Vercel Edge e sobrevive entre
// invocações — é o que faz o cache de 60s/1h do porteiro valer a pena
// (`src/hospedagem/porteiro.ts`, `CACHE_FRESCO_MS`/`CACHE_STALE_MAX_MS`).
const cachePorteiro = new Map<string, EntradaCachePorteiro>();

// Caminho (a) do porteiro — a caderneta central (`resolver_loja`, T5,
// `supabase/migrations/20261141000000_caderneta_da_frota.sql`). Convenção de
// chamada (rodada B, decisão da hub, 11/09/2026): TRÊS variáveis no
// hospedeiro — `IKCOUS_FROTA_URL` (a origem do projeto da PRINCIPAL),
// `IKCOUS_FROTA_APIKEY` (a chave PÚBLICA publishable/anon do projeto da
// PRINCIPAL — é o que o PostgREST exige em `apikey` para sequer alcançar
// QUALQUER RPC, mesmo com `GRANT EXECUTE TO anon`) e `IKCOUS_FROTA_CHAVE`
// (o segredo cujo hash vive em `frota_segredo`; viaja SÓ no corpo JSON como
// `p_chave`, por `POST`, NUNCA em cabeçalho nem em URL). `resolver_loja` é
// quem recusa de verdade se `p_chave` não bater — sem oráculo, devolve zero
// linhas. `AbortController` com prazo de 5s: uma RPC pendurada não pode
// atrasar o porteiro além disso — o `catch` cobre tanto o aborto quanto
// qualquer outra falha de rede, sempre caindo em `"erro"` (nunca lança).
const PRAZO_CADERNETA_MS = 5_000;

export const resolverNaCaderneta: ResolverLojaNaCaderneta = async (
  host,
  frotaUrl,
  frotaApikey,
  frotaChave,
) => {
  const controller = new AbortController();
  const temporizador = setTimeout(() => controller.abort(), PRAZO_CADERNETA_MS);
  try {
    const resposta = await fetch(`${frotaUrl}/rest/v1/rpc/resolver_loja`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: frotaApikey,
        Authorization: `Bearer ${frotaApikey}`,
      },
      body: JSON.stringify({ p_host: host, p_chave: frotaChave }),
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });
    if (!resposta.ok) return { tipo: "erro" };
    const linhas: unknown = await resposta.json();
    if (!Array.isArray(linhas)) return { tipo: "erro" };
    if (linhas.length === 0) return { tipo: "miss" };
    if (linhas.length !== 1) return { tipo: "erro" };
    const linha = linhas[0] as {
      supabase_url?: unknown;
      publishable_key?: unknown;
    };
    if (
      typeof linha.supabase_url !== "string" ||
      typeof linha.publishable_key !== "string"
    )
      return { tipo: "erro" };
    return {
      tipo: "hit",
      conexao: {
        supabaseUrl: linha.supabase_url,
        publishableKey: linha.publishable_key,
        origem: "caderneta",
      },
    };
  } catch {
    return { tipo: "erro" };
  } finally {
    clearTimeout(temporizador);
  }
};

// Nome da marca no HTML servido a crawlers. Env de projeto na Vercel chega em
// process.env com o nome exato (mesmo canal dos VITE_SUPABASE_* abaixo);
// sem nada configurado, o texto continua como sempre foi.
const APP_NAME = process.env.VITE_APP_NAME || "IKCOUS Marketplace";

// Endereço público de CADA loja — nunca o host do deploy (`VERCEL_URL` muda a
// cada publicação e, em preview/produção protegida, exige login da Vercel:
// o robô do WhatsApp recebe 302 e não baixa a foto). Ordem de precedência,
// parando no primeiro valor não-vazio: `VITE_APP_URL` (configurado por loja)
// > `VERCEL_PROJECT_PRODUCTION_URL` (variável oficial da Vercel para "domínio
// público de produção", existe até em preview) > `VERCEL_URL` (o próprio
// deploy, último recurso) > o literal fixo da IKCOUS. As duas variáveis da
// Vercel chegam SEM protocolo.
type AmbienteEnderecoPublico = {
  VITE_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
};

const ENDERECO_PUBLICO_PADRAO = "https://ickous-marketplace.vercel.app";

export function resolverEnderecoPublico(env: AmbienteEnderecoPublico): string {
  const candidatos = [
    env.VITE_APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ];

  for (const candidato of candidatos) {
    const valor = (candidato ?? "").trim();
    if (valor === "") continue;
    const comProtocolo = /^https?:\/\//.test(valor)
      ? valor
      : `https://${valor}`;
    return comProtocolo.replace(/\/+$/, "");
  }

  return ENDERECO_PUBLICO_PADRAO;
}

// Escape mínimo para não quebrar o HTML servido ao robô: nome/descrição vêm
// do banco (o lojista escreve), e um `"` ou `<` cru fecha o atributo da meta
// tag no meio da string, vazando o resto como HTML solto.
export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") || "";

  // Detect if the request is from a crawler bot (WhatsApp, Facebook, Twitter, Telegram, etc.)
  const isBot =
    /whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|googlebot|bingbot|baiduspider|yandexbot/i.test(
      userAgent,
    );

  if (isBot && url.pathname === "/product-detail") {
    // Rodada C (11/09/2026, achado do revisor Opus): o ramo de robô
    // chamava `resolverConexao` POR FORA do porteiro, pulando
    // `decidirConcordancia` — com a caderneta apontando o host A para o
    // banco de B, o robô servia o catálogo de B enquanto o navegador no
    // MESMO host recebia 503 ("loja A com dado de loja B" pelo caminho que
    // ninguém tinha revisado). `obterFichaValidada` é a MESMA trava que o
    // documento usa (resolver + concordar + cachear, "uma trava, um
    // lugar") — a conexão do robô é SEMPRE `ficha.conexao`, nunca
    // `resolverConexao` isolado.
    const resultado = await obterFichaValidada(
      request,
      process.env as AmbientePorteiro,
      { fetchImpl: fetch, resolverNaCaderneta, cache: cachePorteiro },
    );
    // Ficha ausente (sem-loja/discorda/banco-indisponivel) -> a MESMA 503
    // de manutenção do documento. Nunca passthrough para o HTML assado
    // aqui: no build compartilhado o assado é "a loja de ninguém", e
    // servi-lo ao robô sem ficha validada é o MESMO vazamento que a
    // concordância existe para impedir no documento.
    if (resultado.tipo === "manutencao") return resultado.resposta;
    const { ficha, caderneta: estadoCaderneta } = resultado;
    const { supabaseUrl, publishableKey: supabaseKey } = ficha.conexao;
    const productId = url.searchParams.get("id");

    // `x-ikcous-og` diz QUEM respondeu: sem ele, "o middleware não rodou" e
    // "rodou e caiu no pass-through" produzem respostas byte a byte iguais
    // — foi exatamente essa ambiguidade que escondeu a Causa 2 (permission
    // denied na tabela `produtos`) atrás do sintoma de "middleware
    // ausente". `x-ikcous-caderneta` (rodada B/C): "cair em (b)" nunca é
    // silencioso em NENHUMA resposta do ramo de robô, nem no sucesso, nem
    // no sem-produto (item 2 do brief T3c) — o 503 acima já leva o header
    // por dentro de `resultado.resposta` (`respostaManutencao`).
    const passthrough = (motivo: "sem-produto") =>
      new Response(null, {
        headers: {
          "x-middleware-next": "1",
          "x-ikcous-og": motivo,
          "x-ikcous-caderneta": estadoCaderneta,
        },
      });

    if (productId) {
      try {
        // Causa 2 (medida): o papel anônimo NÃO tem SELECT na tabela
        // `produtos` (42501 permission denied) — o caminho público de
        // verdade é a VIEW `vw_produtos_public`, a mesma que
        // src/lib/realtimeSyncEngine.ts usa para quem não é admin.
        const response = await fetch(
          `${supabaseUrl}/rest/v1/vw_produtos_public?id=eq.${encodeURIComponent(productId)}&select=*`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          },
        );

        if (response.ok) {
          const products = await response.json();
          if (Array.isArray(products) && products.length > 0) {
            const product = products[0];

            // Resolve values (escapados: nome/descrição vêm do banco, o
            // lojista escreve, e um `"` ou `<` cru quebraria a meta tag).
            const name = escaparHtml(product.nome || `Produto - ${APP_NAME}`);
            const description = escaparHtml(
              product.descricao ||
                `Confira os detalhes do produto no ${APP_NAME}.`,
            );
            // Só número > 0 aparece: 0, negativo ou não numérico ficam sem
            // preço na prévia (decisão do dono, 11/09/2026).
            const precoNumerico = Number(product.preco_venda);
            const price =
              Number.isFinite(precoNumerico) && precoNumerico > 0
                ? escaparHtml(
                    `R$ ${precoNumerico.toFixed(2).replace(".", ",")}`,
                  )
                : "";
            // `imagem_urls` é o DEFAULT `[]` da coluna com frequência — um
            // array vazio é truthy e não pode apagar `imagem_url` (decisão do
            // dono, 11/09/2026). Ordem: cada item de `imagem_urls`, DEPOIS
            // `imagem_url`.
            const rawImages = [
              ...(Array.isArray(product.imagem_urls)
                ? product.imagem_urls
                : []),
              product.imagem_url,
            ];
            const images = rawImages.filter(
              (img: any) => typeof img === "string" && img.trim() !== "",
            );
            // Só o fallback (${publicUrl}/og-image.png) tem dimensão fixa: é
            // a arte de compartilhamento da identidade, sempre PNG 1200x630.
            // A foto do produto não tem tamanho conhecido — declarar 600x400
            // pra qualquer imagem distorcia a prévia; sem as duas metas, o
            // robô mede a imagem sozinho.
            const ehFallback = images.length === 0;
            const imageUrl = escaparHtml(
              images[0] ||
                // `as unknown as`: TS2559 (weak type) não conta o índice de
                // `ProcessEnv` como propriedade em comum com um tipo só de
                // campos opcionais; `AmbienteEnderecoPublico` continua com o
                // formato certo.
                `${resolverEnderecoPublico(process.env as unknown as AmbienteEnderecoPublico)}/og-image.png`,
            );

            const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${name} | ${APP_NAME}</title>
  <meta name="description" content="${description}">

  <!-- Open Graph -->
  <meta property="og:title" content="${name} ${price ? `- ${price}` : ""} | ${APP_NAME}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="product" />
  <meta property="og:url" content="${escaparHtml(request.url)}" />
  <meta property="og:image" content="${imageUrl}" />${
    ehFallback
      ? `
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />`
      : ""
  }

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${name} | ${APP_NAME}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${imageUrl}" />
</head>
<body>
  <h1>${name}</h1>
  <p>${description}</p>
  <img src="${imageUrl}" alt="${name}">
</body>
</html>`;

            return new Response(html, {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "x-ikcous-og": "produto",
                "x-ikcous-caderneta": estadoCaderneta,
              },
            });
          }
        }
      } catch (error) {
        console.error("[Middleware] Error fetching product:", error);
      }
    }

    // É robô, é /product-detail, mas a consulta não devolveu produto
    // (fetch falhou, resposta não-ok — ex.: a Causa 2 acima — ou lista
    // vazia). Regressão do defeito original: isto NÃO pode virar "produto".
    return passthrough("sem-produto");
  }

  // Todo o resto (não é robô no caminho de produto) é um DOCUMENTO — o
  // porteiro monta a página na borda, por host, com a ficha da loja
  // (etapa 2 da escala). `passthrough`/`x-ikcous-og` seguem existindo só
  // no ramo de robô acima; o porteiro tem o próprio cabeçalho de motivo
  // (`x-ikcous-porteiro`) para quando recusa (503).
  return atenderPorteiro(request, process.env as AmbientePorteiro, {
    fetchImpl: fetch,
    resolverNaCaderneta,
    cache: cachePorteiro,
  });
}
