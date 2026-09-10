import { buildIdentity } from "./buildIdentity";

export interface Branding {
  appName: string;
  theme: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

// A mesma fotografia validada que preparou o HTML e o manifesto.
export const branding: Branding = {
  appName: buildIdentity.identity.storeName,
  theme: buildIdentity.identity.theme,
};

// Converte Hex (#RRGGBB) para HSL no formato aceito pelo Tailwind (ex: "240 5.9% 10%")
export function hexToTailwindHsl(hex: string): string {
  let cleanHex = hex.replace(/^#/, "");
  if (cleanHex.length === 3) {
    cleanHex =
      cleanHex[0] +
      cleanHex[0] +
      cleanHex[1] +
      cleanHex[1] +
      cleanHex[2] +
      cleanHex[2];
  }
  if (cleanHex.length !== 6) return "0 0% 0%";

  const r = Number.parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = Number.parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = Number.parseInt(cleanHex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// CONTRATO DE COR — precedência: o branding (build) acima é a SEMENTE imediata
// anti-flash no :root (aplicada por main.tsx antes do React montar); o
// primary_color do BANCO vence quando a config chega ou muda (StoreContext
// aplica na --primary; App reflete no meta theme-color). Este helper escreve
// o meta em runtime — cria a tag se ainda não existir.
export function applyThemeColor(colorHex: string): void {
  if (typeof document === "undefined") return;
  let meta: HTMLMetaElement | null = document.querySelector(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", colorHex);
}

// Injeta as configurações de marca no DOM
export function applyBranding(): void {
  if (typeof document === "undefined") return;

  // 1. Injetar Cores no root
  const root = document.documentElement;

  if (branding.theme.primary) {
    root.style.setProperty(
      "--primary",
      hexToTailwindHsl(branding.theme.primary),
    );
  }
  if (branding.theme.secondary) {
    root.style.setProperty(
      "--secondary",
      hexToTailwindHsl(branding.theme.secondary),
    );
  }
  if (branding.theme.accent) {
    root.style.setProperty("--accent", hexToTailwindHsl(branding.theme.accent));
  }

  // Semente do contrato de cor também no meta (janela pré-React): o App
  // assume depois com a cor efetiva (banco > build).
  applyThemeColor(branding.theme.primary);

  // 2. Conservar os papéis e MIME preparados, sem atingir mask-icon ou outro link.
  for (const [rel, href, type] of [
    [
      "icon",
      buildIdentity.localUrls.favicon,
      buildIdentity.identity.assets.favicon.media_type,
    ],
    [
      "apple-touch-icon",
      buildIdentity.localUrls.apple_touch,
      buildIdentity.identity.assets.apple_touch.media_type,
    ],
  ]) {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", rel);
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
    link.setAttribute("type", type);
  }

  // 3. Atualizar o loader silencioso inicial (silent-guardian-loader) se ele ainda estiver no DOM
  const guardianText = document.querySelector(".guardian-brand-text");
  if (guardianText && branding.appName) {
    // Remove o texto fixo "IKCOUS" do loader e põe a primeira palavra da marca ou a marca toda
    const shortName = branding.appName.split("|")[0].trim();
    guardianText.textContent = shortName;
  }
  const guardianLetter = document.querySelector(".guardian-logo-icon span");
  if (guardianLetter && branding.appName) {
    // Pega a inicial da primeira palavra do appName
    const firstLetter = branding.appName.trim().charAt(0).toUpperCase();
    guardianLetter.textContent = firstLetter;
  }
}
