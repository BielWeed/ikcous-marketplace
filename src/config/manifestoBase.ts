import type { ManifestOptions } from "vite-plugin-pwa";

/**
 * MANIFESTO_BASE — os campos do manifest PWA que NUNCA variam por loja
 * (etapa 2 da escala, rodada B, 11/09/2026). Ponto único de troca entre
 * `vite.config.ts` (o manifest ASSADO no build, "a loja de ninguém") e
 * `src/hospedagem/porteiro.ts` (o manifest que o porteiro monta em tempo
 * real, por host) — antes desta extração, os dois listavam os MESMOS campos
 * em dois arquivos, e um comentário em `porteiro.ts` já registrava isso como
 * dívida deliberada ("se um campo mudar lá, tem de mudar aqui também").
 *
 * Os campos que VARIAM por loja (`name`, `short_name`, `description`,
 * `theme_color`, `background_color`, `icons`) continuam decididos por quem
 * importa isto — este arquivo nunca os declara.
 *
 * `satisfies Partial<ManifestOptions>` em vez de `as const`: `as const`
 * tornaria `categories`/`shortcuts` `readonly`, e `vite.config.ts` precisa
 * de arrays MUTÁVEIS para `VitePWAOptions["manifest"]`. `satisfies` valida
 * a forma contra o tipo da biblioteca sem alargar os literais (`display`
 * continua sendo o literal `"standalone"`, não `string`) nem travar os
 * arrays em `readonly`. O `import type` é apagado na compilação — não entra
 * no bundle do porteiro (Edge) nem no do app.
 */
export const MANIFESTO_BASE = {
  display: "standalone",
  orientation: "portrait",
  scope: "/",
  id: "/?source=pwa",
  start_url: "/?source=pwa",
  launch_handler: { client_mode: ["focus-existing", "auto"] },
  categories: ["shopping", "lifestyle"],
  shortcuts: [
    {
      name: "Carrinho",
      short_name: "Carrinho",
      description: "Ver itens no carrinho",
      url: "/?view=cart",
      icons: [{ src: "/icons/cart-96x96.png", sizes: "96x96" }],
    },
    {
      name: "Favoritos",
      short_name: "Favoritos",
      description: "Ver lista de desejos",
      url: "/?view=favorites",
      icons: [{ src: "/icons/heart-96x96.png", sizes: "96x96" }],
    },
  ],
} satisfies Partial<ManifestOptions>;
