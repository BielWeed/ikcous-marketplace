// O rascunho do formulário de banner (o que a lojista editou e não salvou).
//
// Mesmas duas regras do rascunho de produto (`rascunho-do-produto.ts`), fora da
// tela para serem provadas sem montá-la:
//
// 1. O RASCUNHO NÃO DESFAZ O QUE MUDOU DEPOIS. Ele guarda como o banner estava
//    quando a lojista abriu o editor (`base`). Ao recuperar, só volta o campo
//    que ela de fato editou (rascunho diferente da `base`); o resto fica como o
//    banner está HOJE. Sem isso, "Recuperar" + "Salvar" reativava o banner que
//    ela tinha pausado depois e trazia de volta a foto, as datas e a ordem de
//    semanas atrás.
//
// 2. O RASCUNHO VENCE. Passados 7 dias, o rascunho é descartado ao abrir: não é
//    "onde ela parou", é um formulário de outra época.
import type { Banner } from "@/types";

/** Validade do rascunho: 7 dias, contados do ÚLTIMO salvamento automático. */
export const PRAZO_DO_RASCUNHO_DO_BANNER_MS = 7 * 24 * 60 * 60 * 1000;

/** O recado quando o banner mudou depois do rascunho e parte dele não volta. */
export const AVISO_BANNER_ALTERADO_DEPOIS =
  "Este banner foi alterado depois deste rascunho: o que você não editou ficou como está hoje.";

/** Os campos do formulário que o rascunho compara (os mesmos do salvar). */
const CAMPOS = [
  "title",
  "imageUrl",
  "link",
  "position",
  "active",
  "order",
  "subtitle",
  "titleColor",
  "subtitleColor",
  "buttonText",
  "buttonBgColor",
  "buttonTextColor",
  "fontFamily",
  "overlayColor",
  "overlayOpacity",
  "badgeText",
  "templateType",
  "productId",
  "startDate",
  "endDate",
  "showTextOverlay",
] as const;

type CampoDoBanner = (typeof CAMPOS)[number];

/**
 * O valor do campo do jeito que o formulário o enxerga: vazio, nulo e ausente
 * são o mesmo "sem valor" (igual ao `isBannerFormDirty` e ao salvar), então
 * comparar o banner cru do banco com o formulário não acusa diferença à toa.
 */
function comparavel(
  campo: CampoDoBanner,
  banner: Partial<Banner> | null | undefined,
): string | number | boolean | null {
  // Mapa em vez de acesso por chave variável: a lista de campos é fixa.
  const valor = new Map(Object.entries(banner ?? {})).get(campo);
  switch (campo) {
    case "active":
      return valor ?? true;
    case "showTextOverlay":
      return valor !== false;
    case "order":
      return Number(valor || 0);
    case "overlayOpacity":
      return Number(valor ?? 40);
    case "startDate":
    case "endDate":
      return (valor as string | null | undefined) || null;
    case "templateType":
      return (valor as string | undefined) || "default";
    default:
      return (valor as string | null | undefined) || "";
  }
}

/** Só os campos do formulário, para o rascunho não carregar o banner inteiro. */
export function baseDoRascunho(banner: Partial<Banner>): Partial<Banner> {
  const doBanner = new Map(Object.entries(banner));
  return Object.fromEntries(
    CAMPOS.map((campo) => [campo, doBanner.get(campo) ?? null]),
  ) as Partial<Banner>;
}

/** Os campos em que `a` e `b` diferem (já normalizados). */
function camposDiferentes(
  a: Partial<Banner> | null | undefined,
  b: Partial<Banner> | null | undefined,
): CampoDoBanner[] {
  return CAMPOS.filter(
    (campo) => !Object.is(comparavel(campo, a), comparavel(campo, b)),
  );
}

export interface RascunhoDoBanner {
  formData: Partial<Banner>;
  editingBannerId?: string;
  /** O banner como estava ao abrir o editor (ausente: rascunho anterior a esta regra). */
  base?: Partial<Banner>;
  imagemEnviadaNaoSalva?: string | null;
  savedAt: string;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** O rascunho passou do prazo? Sem carimbo legível não dá para provar que vale: venceu. */
export function rascunhoDoBannerVenceu(
  rascunho: { savedAt?: unknown } | null | undefined,
  agora: number = Date.now(),
): boolean {
  const salvoEm =
    typeof rascunho?.savedAt === "string"
      ? Date.parse(rascunho.savedAt)
      : Number.NaN;
  if (!Number.isFinite(salvoEm)) return true;
  return agora - salvoEm > PRAZO_DO_RASCUNHO_DO_BANNER_MS;
}

/**
 * O que fazer com o rascunho guardado ao abrir o editor:
 *  - `usar`: é deste banner e vale — oferece recuperar;
 *  - `descartar`: venceu, ou é de edição e não traz a `base` (gravado antes
 *    desta regra: não dá para saber o que ela editou, e devolvê-lo inteiro é
 *    justamente o defeito) — apaga;
 *  - `ignorar`: é de OUTRO banner (ou ilegível) — não oferece e não apaga.
 */
export function situacaoDoRascunhoDoBanner(
  rascunho: unknown,
  idAtual: string | undefined,
  agora: number = Date.now(),
): "usar" | "descartar" | "ignorar" {
  if (!ehObjeto(rascunho)) return "ignorar";
  if (rascunhoDoBannerVenceu(rascunho, agora)) return "descartar";
  if (rascunho.editingBannerId !== idAtual) return "ignorar";
  if (idAtual !== undefined && !ehObjeto(rascunho.base)) return "descartar";
  return "usar";
}

/**
 * O formulário depois de recuperar o rascunho: o banner de AGORA (`atual`) com
 * só os campos que a lojista editou no rascunho por cima. Rascunho de banner
 * NOVO sem `base` (anterior a esta regra) volta inteiro, como sempre foi: não
 * há banner existente que ele possa desfazer.
 */
export function rascunhoSobreOBannerDeHoje(
  rascunho: Pick<RascunhoDoBanner, "formData" | "base">,
  atual: Partial<Banner>,
): Partial<Banner> {
  if (!ehObjeto(rascunho.base)) return { ...atual, ...rascunho.formData };
  const editados = camposDiferentes(rascunho.formData, rascunho.base);
  const resultado = new Map<string, unknown>(Object.entries(atual));
  const doRascunho = new Map(Object.entries(rascunho.formData));
  for (const campo of editados) {
    resultado.set(campo, doRascunho.get(campo));
  }
  return Object.fromEntries(resultado) as Partial<Banner>;
}

/** O banner mudou depois do rascunho (em algum campo que o formulário mostra)? */
export function bannerMudouDepoisDoRascunho(
  base: Partial<Banner> | undefined,
  bannerAtual: Partial<Banner> | null | undefined,
): boolean {
  if (!ehObjeto(base) || !bannerAtual) return false;
  return camposDiferentes(base, bannerAtual).length > 0;
}
