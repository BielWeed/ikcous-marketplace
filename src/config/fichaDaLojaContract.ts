import type { PublicStoreIdentity } from "../lib/storeIdentity";

/**
 * A FICHA DA LOJA — o que o porteiro (middleware.ts, na borda da Vercel)
 * escreve dentro do HTML que serve, e o que o app lê ANTES de qualquer
 * outra coisa para saber QUEM ele é (marca) e ONDE está o banco (conexão).
 *
 * Por que existe (etapa 2 da escala, 11/09/2026): hoje cada loja tem um
 * build próprio com a identidade e a conexão ASSADAS no bundle
 * (`__STORE_IDENTITY__` e os defines `VITE_SUPABASE_*`). Com a ficha, um
 * ÚNICO build serve N lojas — o porteiro decide por HOST o que vai na ficha.
 *
 * Como viaja: `<script type="application/json" id="ikcous-loja">` no
 * `<head>`. É um DATA BLOCK (não executa), então a CSP de `vercel.json`
 * (`script-src` sem `unsafe-inline`, com hash) NÃO o bloqueia. Quem
 * serializa (src/hospedagem/ficha.ts) escapa `</` -> `<\/`, o `<` de `<!--`
 * -> `\u003c` (escape unicode válido em JSON; `<\!--` NÃO é, `JSON.parse`
 * lança), U+2028 e U+2029 -> `\u2028`/`\u2029`; quem lê
 * (src/config/fichaDaLoja.ts) faz `JSON.parse(el.textContent)` — nunca
 * `eval`, nunca `innerHTML`.
 *
 * Regra de FALHA FECHADA: ficha AUSENTE = build antigo, o app cai no que
 * está assado (transição). Ficha PRESENTE mas ilegível ou fora deste
 * contrato = o app PARA com `IDENTITY_FICHA_INVALID` — nunca "tenta o
 * assado", porque o assado pode ser de OUTRA loja num build compartilhado.
 *
 * POR QUE `schemaVersion` VIROU 2 (etapa 3 da escala, 11/09/2026, ADENDO
 * A.6): a ficha ganhou o bloco `configuracao` (chave pública do Mercado
 * Pago, chave VAPID, `pagamentoOnline` e `manutencao` — os 4 valores que
 * antes eram ASSADOS por loja no build). `/identidade.json` sobrevive no
 * cache do service worker entre deploys; um JSON v1 antigo, sem
 * `configuracao`, TEM que ser rejeitado pelo leitor — senão o app leria
 * `configuracao: undefined` e um `pagamentoOnlineLigado()` mal alimentado
 * abriria (ou fecharia) cobrança por um valor que nunca existiu na ficha
 * antiga. Bump de versão em vez de campo opcional é a mesma trava.
 *
 * A REGRA DEV (ADENDO A.2, dinheiro): sem ficha (build de loja única, ou
 * arquivo estático servido cru fora do matcher do porteiro — `/index.html`,
 * `/404.html`, `/offline.html`), o módulo que LÊ este bloco
 * (`src/config/configuracaoDaLoja.ts`) só cai no `import.meta.env` assado
 * quando `import.meta.env.DEV` é verdadeiro. Em produção, ficha ausente
 * devolve `{ mpPublicKey: null, vapidPublicKey: null, pagamentoOnline: false,
 * manutencao: false }` — nunca o valor assado, porque num build
 * compartilhado por N lojas o assado pode ser de OUTRA loja (o mesmo motivo
 * pelo qual a ficha PRESENTE e inválida também não cai no assado).
 */

export const FICHA_DA_LOJA_ID = "ikcous-loja";

/** Caminho (mesma origem) onde o porteiro serve a mesma ficha em JSON puro —
 * o service worker não tem `document` e busca aqui no `install`. */
export const CAMINHO_IDENTIDADE_JSON = "/identidade.json";

export interface ConexaoDaLoja {
  /** `https://<project_ref>.supabase.co` — sem barra final. */
  readonly supabaseUrl: string;
  /** Chave PÚBLICA (publishable `sb_publishable_…` ou a `anon` JWT legada).
   * NUNCA service_role, NUNCA secret: isto vai para o navegador de todo mundo. */
  readonly publishableKey: string;
}

export interface IdentidadeServida {
  readonly identity: PublicStoreIdentity;
  /** URLs ABSOLUTAS dos arquivos de marca no Storage público da loja
   * (`https://<ref>.supabase.co/storage/v1/object/public/branding/<path>`),
   * mesma forma de `PublicStoreIdentity["urls"]` — o build assado usava
   * caminho local `/store-identity/…`; num build compartilhado não existe
   * caminho local por loja. */
  readonly localUrls: PublicStoreIdentity["urls"];
  /** `https://<host>` — o endereço público desta loja, sem barra final. */
  readonly publicUrl: string;
  /** sha256 canônico da identidade (`identityRevision()` de
   * src/lib/storeIdentity.ts). */
  readonly identityRevision: string;
}

/** Os 4 valores públicos por loja que hoje são ASSADOS no build (etapa 3 da
 * escala, 11/09/2026) — chave pública do Mercado Pago, chave VAPID, e as
 * duas flags de operação. São PÚBLICOS por natureza: os 4 vão ao navegador
 * de todo mundo (a chave pública nunca é a secreta; as flags só ligam ou
 * desligam recurso). `null`/`false` desliga o recurso correspondente sem
 * fechar a loja inteira (ADENDO A.5) — só a ficha AUSENTE em produção ou o
 * bloco `configuracao` fora deste contrato falha fechado. */
export interface ConfiguracaoDaLoja {
  /** Chave PÚBLICA do Mercado Pago (`APP_USR-…`/`TEST-…`) desta loja, ou
   * `null` quando o pagamento online não está configurado. */
  readonly mpPublicKey: string | null;
  /** Chave pública VAPID desta loja, ou `null` quando o push não está
   * configurado. */
  readonly vapidPublicKey: string | null;
  /** Falha fechada por desenho: só `true` liga o checkout online. */
  readonly pagamentoOnline: boolean;
  /** `true` = loja em manutenção. */
  readonly manutencao: boolean;
}

export interface FichaDaLoja {
  readonly schemaVersion: 2;
  /** O host que o porteiro atendeu, em minúsculas, sem porta. É contra ELE
   * que o banco da loja tem de concordar (`store_config.dominio_publico`). */
  readonly host: string;
  readonly identidade: IdentidadeServida;
  readonly conexao: ConexaoDaLoja;
  readonly configuracao: ConfiguracaoDaLoja;
}
