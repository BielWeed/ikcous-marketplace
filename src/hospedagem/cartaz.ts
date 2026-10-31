// O CARTAZ PRE-IMPRESSO (lote B, 31/10/2026).
//
// Na primeira visita o banner do topo era o ultimo elo de uma fila em serie
// (JS da vitrine -> pedido dos banners -> foto) e a cliente via so o splash
// por ~7 s. O porteiro ja le a configuracao da loja ANTES de montar o HTML;
// aqui ele tambem le o banner do topo (leitura SEPARADA, que nunca lanca) e
// imprime, como PRIMEIRO FILHO do splash (`#silent-guardian-loader`), uma copia
// da MESMA foto (mesma URL, mesmo srcset, mesma caixa 2:1) para o navegador
// comecar a baixa-la junto com o documento. O cartaz e parte do splash: sai
// JUNTO com ele, pelas saidas que o splash ja tem (App.tsx, main.tsx e o teto
// de 20 s do silent-guardian.js) -- nenhum codigo novo de remocao no app.
// Medido: LCP 7,15 -> 2,0 s.
//
// ESTE ARQUIVO E PURO (sem rede, sem relogio, so modulos puros por caminho
// RELATIVO: o porteiro roda na borda e NAO pode importar `@/`, supabase nem
// nada de navegador). Escolhe o banner, valida a URL e monta o trecho. A
// leitura e a decisao de servir ficam em `porteiro.ts`.
//
// DEFESA, em ordem de importancia:
//   1. A URL da foto e escrita pela lojista e vai parar no HTML de uma loja
//      inteira. So entra se for https, do storage publico da PROPRIA loja
//      (o host do Supabase da ficha, nunca outro), do bucket `banners`, com
//      nome de arquivo e consulta de caracteres seguros. Qualquer duvida =
//      sem cartaz (HTML igual ao de hoje). Alem de validar a entrada,
//      valida-se tambem o que SAI de `atributosDeImagem` (defesa em
//      profundidade) e escapa-se tudo. A CSP bloqueia script inline: o
//      trecho nunca tem `on*=` nem `<script>` (um teste proibe).
//   2. So loja cuja foto passa pelo redimensionamento (`srcSet` nao vazio):
//      sem ele (IKCOUS, foto de 669 KB) o cartaz roubaria o cano do JS.
//   3. So quando a vitrine mostraria a foto CRUA: banner com texto/pelicula
//      ou modelo pronto muda de cara quando o app chega, e um cartaz com a
//      foto limpa seria uma imagem que a loja nunca mostra.
//   4. O banner escolhido tem de ser o MESMO que o app escolheria (ver
//      `escolherBannerDoTopo`); na duvida, nada.
import { escapeHtml } from "../config/identidadeNoHtml";
import { atributosDeImagem } from "../lib/imageUrl";
import { IMAGEM_DO_BANNER } from "../lib/imagem-do-banner";
import { PREFIXO_DO_MODELO } from "../lib/prefixo-do-banner";

/** Id do cartaz no HTML. */
export const ID_DO_CARTAZ = "cartaz-da-loja";

/**
 * Banner que expira (ou comeca) dentro desta margem pode sair (ou entrar) do
 * topo entre o instante do porteiro e o instante em que o app decide: sem
 * cartaz, em vez de apostar.
 */
export const MARGEM_DO_FIM_MS = 120_000;

/** Altura do cabecalho da vitrine (52 px + 1 px de borda), somada a area
 * segura: e onde o carrossel real comeca (medido no Chrome: as caixas coincidem). */
const ALTURA_DO_CABECALHO_PX = 53;

export interface Cartaz {
  readonly html: string;
}

// ─── Quando o pedido pode ter cartaz ────────────────────────────────────────

/** Parametros de campanha: nao mudam o que a vitrine mostra. */
const PARAMETROS_DE_CAMPANHA = /^(source|utm_[a-z0-9_]+|fbclid|gclid)$/;

/**
 * O pedido e uma PRIMEIRA ABERTURA da vitrine por um navegador?
 *
 *  - `Sec-Fetch-Dest: document` E `Sec-Fetch-Mode: navigate`: o navegador
 *    abrindo a pagina. O service worker NAO e visivel ao porteiro, mas os
 *    pedidos dele sao: a instalacao busca `/` com mode=cors/dest=empty e a
 *    revalidacao de navegacao tem mode=navigate com dest=EMPTY (medido no
 *    Chrome). So o `dest` separa as duas; `navigate` sozinho nao serve. Sem
 *    os cabecalhos (navegador antigo, robo, curl) = sem cartaz.
 *  - `Save-Data: on`: quem economiza dados nao ganha uma foto a mais no splash.
 *  - Rota `/` ou `/home` (a barra final e ignorada, como em
 *    `banners-da-vitrine.ts`), so com parametros de campanha: `category`,
 *    `search`, `id` e qualquer outro mudam a vitrine, e o banner do topo nao
 *    e o que a pessoa vai ver.
 * O metodo (so GET) e o estado da loja (manutencao) quem decide e
 * `atenderPorteiro`.
 */
export function pedidoPodeTerCartaz(url: URL, cabecalhos: Headers): boolean {
  if (cabecalhos.get("sec-fetch-dest") !== "document") return false;
  if (cabecalhos.get("sec-fetch-mode") !== "navigate") return false;
  if ((cabecalhos.get("save-data") ?? "").trim().toLowerCase() === "on")
    return false;
  const caminho = url.pathname.replace(/\/+$/, "");
  if (caminho !== "" && caminho !== "/home") return false;
  for (const nome of url.searchParams.keys())
    if (!PARAMETROS_DE_CAMPANHA.test(nome)) return false;
  return true;
}

// ─── Quem aparece no topo ───────────────────────────────────────────────────

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function numeroDaOrdem(valor: unknown): number {
  // Como o app: `b.order || 0` e, na ordenacao, `a.order ?? 0`.
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * O banner que o carrossel do topo mostra primeiro, pela MESMA regra de
 * `getBannersByPosition` (`useBanners.ts`): posicao `home_top`, ativo, dentro
 * da janela de datas, ordenado por `order`. Devolve `null` em qualquer
 * situacao em que o app poderia escolher outro: data ilegivel, janela que
 * abre ou fecha dentro da margem, empate de `order` entre os dois primeiros.
 */
export function escolherBannerDoTopo(
  linhas: unknown,
  agora: number,
): Record<string, unknown> | null {
  if (!Array.isArray(linhas)) return null;
  const candidatos: Record<string, unknown>[] = [];
  for (const bruta of linhas) {
    if (bruta === null || typeof bruta !== "object") continue;
    const linha = bruta as Record<string, unknown>;
    // O app descarta, ja na leitura, o banner sem foto.
    const foto = linha.image_url || linha.imagem_url;
    if (typeof foto !== "string" || foto === "") continue;
    if (linha.position !== "home_top") continue;
    if ((linha.active ?? linha.ativo ?? true) !== true) continue;

    const inicio = linha.start_date;
    if (inicio) {
      const t = typeof inicio === "string" ? Date.parse(inicio) : Number.NaN;
      if (Number.isNaN(t)) return null;
      if (agora < t) {
        if (t - agora < MARGEM_DO_FIM_MS) return null;
        continue;
      }
    }
    const fim = linha.end_date;
    if (fim) {
      const t = typeof fim === "string" ? Date.parse(fim) : Number.NaN;
      if (Number.isNaN(t)) return null;
      if (agora > t) continue;
      if (t - agora < MARGEM_DO_FIM_MS) return null;
    }
    candidatos.push(linha);
  }
  if (candidatos.length === 0) return null;
  // Menor `order`; o `id` so deixa a saida deterministica -- o app desempata
  // sem criterio, entao um empate no topo ja vira "sem cartaz".
  candidatos.sort(
    (a, b) =>
      numeroDaOrdem(a.order) - numeroDaOrdem(b.order) ||
      texto(a.id).localeCompare(texto(b.id)),
  );
  const [primeiro, segundo] = candidatos;
  if (
    segundo !== undefined &&
    numeroDaOrdem(primeiro.order) === numeroDaOrdem(segundo.order)
  )
    return null;
  return primeiro;
}

// ─── A foto ─────────────────────────────────────────────────────────────────

const CAMINHO_DO_BUCKET = "/storage/v1/object/public/banners/";
// Nome de arquivo que o painel gera: `<epoch>-<aleatorio>.<ext>`. Sem barra
// (nada de subpasta), sem `%` (nada de barra escondida), sem ponto na frente.
const NOME_DO_ARQUIVO = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const CONSULTA_SEGURA = /^[A-Za-z0-9._=&-]*$/;
// ASCII visivel, sem espaco: derruba controle, aspas tipograficas, unicode.
const SO_ASCII_VISIVEL = /^[\x21-\x7E]+$/;

/** O host do Supabase da loja, ou `null` se a URL da ficha nao for https puro. */
function hostDaLoja(supabaseUrl: string): string | null {
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:") return null;
    if (u.port !== "" || u.username !== "" || u.password !== "") return null;
    if (u.search !== "" || u.hash !== "") return null;
    if (u.pathname !== "/") return null;
    return u.host;
  } catch {
    return null;
  }
}

/**
 * A loja redimensiona a foto do banner? Decidido pela ORIGEM, antes de ler
 * qualquer banner: a IKCOUS (foto de 669 KB sem redimensionamento) nem chega
 * a consultar o banco por causa do cartaz.
 */
export function lojaRedimensionaFoto(supabaseUrl: string): boolean {
  const host = hostDaLoja(supabaseUrl);
  if (host === null) return false;
  const { srcSet } = atributosDeImagem(
    `https://${host}${CAMINHO_DO_BUCKET}x.webp`,
    IMAGEM_DO_BANNER,
  );
  return Boolean(srcSet);
}

function fotoDoStorageDaLoja(bruta: unknown, host: string): string | null {
  if (typeof bruta !== "string" || !SO_ASCII_VISIVEL.test(bruta)) return null;
  const prefixo = `https://${host}${CAMINHO_DO_BUCKET}`;
  if (!bruta.startsWith(prefixo)) return null;
  const partes = bruta.slice(prefixo.length).split("?");
  if (partes.length > 2) return null;
  const [arquivo, consulta] = partes;
  if (!NOME_DO_ARQUIVO.test(arquivo)) return null;
  if (consulta !== undefined && !CONSULTA_SEGURA.test(consulta)) return null;
  // Cinto e suspensorio: o que o navegador vai pedir (a URL ja normalizada) tem
  // de ser EXATAMENTE o que a lojista gravou. Qualquer reescrita -- caixa do
  // host, `..`, barras duplas, porta padrao -- quer dizer que a string e outra
  // coisa para o navegador, e entao nao entra.
  try {
    if (new URL(bruta).href !== bruta) return null;
  } catch {
    return null;
  }
  return bruta;
}

function escaparParaRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── O trecho de HTML ───────────────────────────────────────────────────────

/** O banner real desenha pelicula e texto em cima da foto nestes casos. */
function bannerTemTextoOuModelo(linha: Record<string, unknown>): boolean {
  if (texto(linha.template_type).startsWith(PREFIXO_DO_MODELO)) return true;
  if (linha.show_text_overlay === false) return false;
  return [
    linha.title,
    linha.subtitle,
    linha.button_text,
    linha.badge_text,
  ].some((campo) => texto(campo).trim() !== "");
}

/**
 * Monta o cartaz da linha de banner, ou `null` se qualquer condicao falhar.
 * `supabaseUrl` e a do banco DA FICHA (a que provou o dominio): e dela que
 * sai o unico host aceito para a foto.
 */
export function montarCartaz(
  linha: Record<string, unknown>,
  supabaseUrl: string,
): Cartaz | null {
  const host = hostDaLoja(supabaseUrl);
  if (host === null) return null;
  if (bannerTemTextoOuModelo(linha)) return null;
  const foto = fotoDoStorageDaLoja(linha.image_url || linha.imagem_url, host);
  if (foto === null) return null;

  // A MESMA funcao que o carrossel e o preload do app usam: o dedupe da foto
  // nao depende de duas copias de uma regra, e a loja sem redimensionamento
  // sai daqui sozinha (`srcSet` vazio).
  const atributos = atributosDeImagem(foto, IMAGEM_DO_BANNER);
  const { src, srcSet, sizes } = atributos;
  if (!srcSet || sizes !== "100vw") return null;

  // eslint-disable-next-line security/detect-non-literal-regexp -- o host sai de `hostDaLoja` (URL https da ficha ja validada, sem porta nem credencial) e entra ESCAPADO por `escaparParaRegex`; o resto do padrao e literal.
  const candidata = new RegExp(
    `^https://${escaparParaRegex(host)}/storage/v1/render/image/public/banners/[A-Za-z0-9_-][A-Za-z0-9._-]*\\?width=\\d{2,4}&resize=contain&quality=\\d{2,3}$`,
  );
  if (!candidata.test(src)) return null;
  const candidatas: string[] = [];
  for (const parte of srcSet.split(", ")) {
    const [url, descritor, resto] = parte.split(" ");
    if (resto !== undefined || !candidata.test(url)) return null;
    if (!/^\d{2,4}w$/.test(descritor ?? "")) return null;
    candidatas.push(`${url} ${descritor}`);
  }

  // Primeiro filho do splash, que e `position: fixed; inset: 0`: o `absolute`
  // daqui fica na mesma caixa do carrossel real (cabecalho + area segura, 2:1,
  // largura total, no maximo 1040 px centralizado). Sem transicao nem fade, sem
  // `crossorigin` (o app nao usa: mudaria a chave do cache de imagem), sem texto
  // da lojista (`alt` vazio). `pointer-events: none`: nunca recebe toque.
  const html = `<img id="${ID_DO_CARTAZ}" src="${escapeHtml(src)}" srcset="${escapeHtml(candidatas.join(", "))}" sizes="100vw" alt="" aria-hidden="true" fetchpriority="high" loading="eager" decoding="sync" style="position:absolute;top:calc(env(safe-area-inset-top,0px) + ${ALTURA_DO_CABECALHO_PX}px);left:0;right:0;z-index:50;display:block;width:100%;max-width:1040px;margin:0 auto;aspect-ratio:2/1;object-fit:cover;pointer-events:none">`;
  return { html };
}

// ─── Onde ele entra ─────────────────────────────────────────────────────────

const MARCA_DO_LOADER = '<div id="silent-guardian-loader">';

/**
 * Coloca o cartaz como PRIMEIRO FILHO do splash, dentro do `<body>`. Experimento
 * (30/10): logo depois de `<head>`, antes da meta viewport, o navegador baixou
 * a foto DUAS vezes (LCP 7,62 s). Devolve `null` se o documento nao tem
 * exatamente um splash depois do `<body>`: HTML desconhecido, nada muda.
 */
export function injetarCartazNoHtml(
  html: string,
  cartaz: Cartaz,
): string | null {
  const i = html.indexOf(MARCA_DO_LOADER);
  if (i < 0) return null;
  if (html.indexOf(MARCA_DO_LOADER, i + 1) >= 0) return null;
  const corpo = html.indexOf("<body");
  if (corpo < 0 || corpo > i) return null;
  // Troca por FUNCAO: `$&`, `$'` e `` $` `` no trecho nunca sao padroes de troca
  // (copiariam pedacos do documento).
  return html.replace(MARCA_DO_LOADER, () => MARCA_DO_LOADER + cartaz.html);
}
