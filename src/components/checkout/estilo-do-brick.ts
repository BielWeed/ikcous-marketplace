/**
 * Aparência do Card Payment Brick com as cores da loja (redesenho de
 * 16/10/2026).
 *
 * O formulário e o botão "Pagar" continuam sendo do Mercado Pago; aqui só se
 * monta o `customization.visual` que o SDK aceita (`style.customVariables`,
 * https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md).
 * A cor vem do MESMO lugar que pinta o resto do app: as variáveis CSS
 * `--primary` e `--primary-foreground` do `:root`, escritas por
 * `aplicarCorDaLoja` (`config/branding.ts`) com a cor da loja e o texto de
 * maior contraste sobre ela. Ler o DOM (e não o contexto da loja) mantém esta
 * tela independente do provider.
 *
 * O que NÃO se mede aqui: a altura real dos campos. `inputVerticalPadding`
 * mira os 48 px de alvo de toque, mas o miolo dos campos é um iframe do
 * Mercado Pago — conferir em tela no teste de sandbox.
 */

type Hsl = { h: number; s: number; l: number };

// Só dígitos, sinal e ponto; o `Number` rejeita o resto ("1.2.3", "-").
const NUMERO = /^-?[0-9.]+$/;

/** "240 5.9% 10%" (formato Tailwind das variáveis) → HSL; outra forma = null. */
function lerHslDoTailwind(valor: string): Hsl | null {
  const partes = valor.trim().split(/\s+/);
  if (partes.length !== 3) return null;
  const [hTexto, sTexto, lTexto] = partes;
  if (!sTexto.endsWith("%") || !lTexto.endsWith("%")) return null;
  const textos = [hTexto, sTexto.slice(0, -1), lTexto.slice(0, -1)];
  if (!textos.every((t) => NUMERO.test(t) && Number.isFinite(Number(t)))) {
    return null;
  }
  const [h, s, l] = textos.map(Number);
  if (s < 0 || s > 100 || l < 0 || l > 100) return null;
  return { h: ((h % 360) + 360) % 360, s, l };
}

function hslParaHex({ h, s, l }: Hsl): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const canal = (n: number): string => {
    const k = (n + h / 30) % 12;
    const valor = ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(valor * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${canal(0)}${canal(8)}${canal(4)}`;
}

/** "240 5.9% 10%" → "#18181b" (ou `null` se a variável não é HSL legível). */
export function hslDoTailwindParaHex(valor: string): string | null {
  const hsl = lerHslDoTailwind(valor);
  return hsl ? hslParaHex(hsl) : null;
}

/** Escurece a cor tirando `pontos` de luminosidade (as variantes de hover). */
function escurecer(valor: string, pontos: number): string | null {
  const hsl = lerHslDoTailwind(valor);
  return hsl ? hslParaHex({ ...hsl, l: Math.max(0, hsl.l - pontos) }) : null;
}

function lerVariavel(raiz: HTMLElement, nome: string): string {
  const calculada = globalThis
    .getComputedStyle(raiz)
    .getPropertyValue(nome)
    .trim();
  return calculada || raiz.style.getPropertyValue(nome).trim();
}

export type VisualDoBrick = {
  readonly hideFormTitle: true;
  readonly style: {
    readonly customVariables: Readonly<Record<string, string>>;
  };
};

/**
 * O `customization.visual` do Brick. Sem as variáveis de cor (teste, SSR, valor
 * ilegível) devolve só o que é tamanho e legibilidade — o Brick fica com a cor
 * padrão dele, nunca com uma cor inventada.
 */
export function estiloDoBrick(
  raiz: HTMLElement | null = typeof document === "undefined"
    ? null
    : document.documentElement,
): VisualDoBrick {
  const variaveis: Record<string, string> = {
    // Uma moldura só: o card é da nossa tela, o Brick não desenha outro por
    // dentro (era card-dentro-de-card, 315 px úteis em 375 px).
    formBackgroundColor: "#ffffff",
    inputBackgroundColor: "#ffffff",
    formPadding: "0px",
    // Contraste AA sobre branco: zinc-900 / zinc-600 / red-700.
    textPrimaryColor: "#18181b",
    textSecondaryColor: "#52525b",
    errorColor: "#b91c1c",
    // 16 px: abaixo disso o iOS dá zoom ao tocar no campo.
    fontSizeSmall: "16px",
    fontSizeMedium: "16px",
    // Alvo de toque de ~48 px (16 px de texto + 2 × 14 px + borda).
    inputVerticalPadding: "14px",
    inputHorizontalPadding: "12px",
    inputBorderWidth: "1px",
    inputFocusedBorderWidth: "2px",
    borderRadiusMedium: "12px",
  };

  if (raiz) {
    const primaria = lerVariavel(raiz, "--primary");
    const sobreAPrimaria = lerVariavel(raiz, "--primary-foreground");
    const cor = hslDoTailwindParaHex(primaria);
    const texto = hslDoTailwindParaHex(sobreAPrimaria);
    if (cor && texto) {
      variaveis.baseColor = cor;
      variaveis.baseColorFirstVariant = escurecer(primaria, 8) ?? cor;
      variaveis.baseColorSecondVariant = escurecer(primaria, 16) ?? cor;
      variaveis.outlinePrimaryColor = cor;
      variaveis.buttonTextColor = texto;
    }
  }

  return { hideFormTitle: true, style: { customVariables: variaveis } };
}
