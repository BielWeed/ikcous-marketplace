export const config = {
  matcher: ["/product-detail"],
};

// Nome da marca no HTML servido a crawlers. Env de projeto na Vercel chega em
// process.env com o nome exato (mesmo canal dos VITE_SUPABASE_* abaixo);
// sem nada configurado, o texto continua como sempre foi.
const APP_NAME = process.env.VITE_APP_NAME || "IKCOUS Marketplace";

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") || "";

  // Detect if the request is from a crawler bot (WhatsApp, Facebook, Twitter, Telegram, etc.)
  const isBot =
    /whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|googlebot|bingbot|baiduspider|yandexbot/i.test(
      userAgent,
    );

  if (isBot && url.pathname === "/product-detail") {
    const productId = url.searchParams.get("id");
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (productId && supabaseUrl && supabaseKey) {
      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/produtos?id=eq.${productId}&select=*`,
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

            // Resolve values
            const name = product.nome || `Produto - ${APP_NAME}`;
            const description =
              product.descricao ||
              `Confira os detalhes do produto no ${APP_NAME}.`;
            const price = product.preco_venda
              ? `R$ ${Number(product.preco_venda).toFixed(2).replace(".", ",")}`
              : "";
            const rawImages =
              product.imagem_urls ||
              (product.imagem_url ? [product.imagem_url] : []);
            const images = Array.isArray(rawImages)
              ? rawImages.filter(
                  (img: any) => typeof img === "string" && img.trim() !== "",
                )
              : [];
            const imageUrl =
              images[0] || "https://ickous-marketplace.vercel.app/og-image.png";

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
              },
            });
          }
        }
      } catch (error) {
        console.error("[Middleware] Error fetching product:", error);
      }
    }
  }

  // Pass-through to original route for normal users
  return new Response(null, {
    headers: {
      "x-middleware-next": "1",
    },
  });
}
