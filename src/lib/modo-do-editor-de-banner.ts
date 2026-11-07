/**
 * Modo do editor de banner (Simples / Completo), lembrado NO APARELHO.
 *
 * É conveniência de quem usa o painel naquele aparelho — não é configuração
 * da loja e não vai para o banco. Mesma família de chave do rascunho do
 * formulário (`admin_banner_form_draft`).
 *
 * Simples esconde os textos sem apagar o conteúdo da campanha. Banner com
 * textos escondidos reabre em Simples; com textos visíveis, em Completo.
 * Banner novo ou sem texto segue a preferência deste aparelho.
 *
 * `localStorage` pode lançar (modo privado, cota, política do navegador) ou
 * nem existir: leitura e gravação nunca quebram a tela.
 */

export type ModoDoEditor = "simple" | "complete";

export const CHAVE_DO_MODO_DO_EDITOR = "admin_banner_modo";

/** O modo lembrado neste aparelho. Sem valor, valor estranho ou erro: Simples. */
export function lerModoDoEditor(): ModoDoEditor {
  try {
    return localStorage.getItem(CHAVE_DO_MODO_DO_EDITOR) === "complete"
      ? "complete"
      : "simple";
  } catch {
    return "simple";
  }
}

/** Lembra o modo escolhido. Só o toque do lojista no alternador chama isto. */
export function gravarModoDoEditor(modo: ModoDoEditor): void {
  try {
    localStorage.setItem(CHAVE_DO_MODO_DO_EDITOR, modo);
  } catch {
    // Sem armazenamento a preferência só não é lembrada.
  }
}

interface BannerComTexto {
  readonly title?: string | null;
  readonly subtitle?: string | null;
  readonly buttonText?: string | null;
  readonly badgeText?: string | null;
  readonly showTextOverlay?: boolean | null;
}

/** O banner tem algum dos quatro textos da campanha? */
export function bannerTemTexto(banner: BannerComTexto): boolean {
  return Boolean(
    banner.title?.trim() ||
      banner.subtitle?.trim() ||
      banner.buttonText?.trim() ||
      banner.badgeText?.trim(),
  );
}

/**
 * Em que modo o editor abre. Banner novo (ou sem texto) segue o modo
 * lembrado; banner com texto abre em Completo, salvo se os textos estão escondidos.
 */
export function modoAoAbrirOBanner(
  banner: BannerComTexto | null | undefined,
  modoLembrado: ModoDoEditor,
): ModoDoEditor {
  if (banner?.showTextOverlay === false) return "simple";
  if (banner && bannerTemTexto(banner)) return "complete";
  return modoLembrado;
}
