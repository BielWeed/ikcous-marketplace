export const config = {
  matcher: ["/product-detail"],
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

  // `x-ikcous-og` diz QUEM respondeu: sem ele, "o middleware não rodou" e
  // "rodou e caiu no pass-through" produzem respostas byte a byte iguais —
  // foi exatamente essa ambiguidade que escondeu a Causa 2 (permission
  // denied na tabela `produtos`) atrás do sintoma de "middleware ausente".
  const passthrough = (motivo: "sem-produto" | "passa") =>
    new Response(null, {
      headers: {
        "x-middleware-next": "1",
        "x-ikcous-og": motivo,
      },
    });

  if (isBot && url.pathname === "/product-detail") {
    const productId = url.searchParams.get("id");
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    // INFRA-260 (#126): a chave `anon` legada dá lugar à `publishable`, e as
    // legadas funcionam só até o dono desligá-las num clique no Dashboard.
    // Mesma precedência de src/lib/env.ts, mas inline: este middleware roda
    // na Vercel Edge, fora do bundle do app, e não importa `src/`. A limpeza
    // (URL/chave do Supabase são sempre ASCII imprimível) também precisa ser
    // replicada ANTES do `||` — sem ela, um valor sujo (BOM, zero-width,
    // espaço colado no `vercel env add`) é não-vazio e vence a legada boa.
    const cleanEnvVar = (val: string) => val.replace(/[^!-~]/g, "");
    const supabaseKey =
      cleanEnvVar(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "") ||
      cleanEnvVar(process.env.VITE_SUPABASE_ANON_KEY || "");

    if (productId && supabaseUrl && supabaseKey) {
      try {
        // Causa 2 (medida): o papel anônimo NÃO tem SELECT na tabela
        // `produtos` (42501 permission denied) — o caminho público de
        // verdade é a VIEW `vw_produtos_public`, a mesma que
        // src/lib/realtimeSyncEngine.ts usa para quem não é admin.
        const response = await fetch(
          `${supabaseUrl}/rest/v1/vw_produtos_public?id=eq.${productId}&select=*`,
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
            const price = product.preco_venda
              ? escaparHtml(
                  `R$ ${Number(product.preco_venda).toFixed(2).replace(".", ",")}`,
                )
              : "";
            const rawImages =
              product.imagem_urls ||
              (product.imagem_url ? [product.imagem_url] : []);
            const images = Array.isArray(rawImages)
              ? rawImages.filter(
                  (img: any) => typeof img === "string" && img.trim() !== "",
                )
              : [];
            const imageUrl = escaparHtml(
              images[0] ||
                `${resolverEnderecoPublico(process.env)}/og-image.png`,
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
  <meta property="og:url" content="${request.url}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="400" />

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

  // Pass-through to original route for normal users
  return passthrough("passa");
}
