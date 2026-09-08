import { describe, expect, it } from "vitest";

const fontes = import.meta.glob<string>(
  [
    "/src/components/layouts/AdminLayout.tsx",
    "/src/views/customer/AddressFormView.tsx",
    "/src/components/ui/custom/Header.tsx",
    "/src/components/pwa/PushNotificationBanner.tsx",
    "/src/components/pwa/UpdateNotification.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);
const offline = import.meta.glob<string>("/public/offline.html", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("critério 1 — uma regra de nome para as cinco telas", () => {
  it("encontra exatamente os cinco arquivos", () => {
    expect(Object.keys(fontes)).toHaveLength(5);
  });

  for (const [arquivo, fonte] of Object.entries(fontes)) {
    it(`${arquivo} importa a regra e não fixa marca`, () => {
      expect(fonte).toMatch(
        /import\s*\{\s*nomeDaLoja\s*\}\s*from\s*["']@\/lib\/nome-da-loja["']/,
      );
      expect(fonte).not.toContain("IKCOUS");
      expect(fonte).not.toContain("branding.appName");
    });
  }
});

describe("critério 4 — tela estática sem conexão", () => {
  it("usa a logo da loja e texto independente de marca", () => {
    expect(Object.keys(offline)).toHaveLength(1);
    const html = Object.values(offline)[0];
    expect(html).not.toContain("IKCOUS");
    expect(html).not.toContain("imports");
    expect(html).toContain("<title>Sem conexão</title>");
    expect(html).toMatch(
      /<img[^>]+src="\/branding\/logo.svg"[^>]+alt=""[^>]+onerror="this.hidden=true"/,
    );
    expect(html).toContain(
      "Você está offline. Reconecte para continuar navegando.",
    );
  });
});
