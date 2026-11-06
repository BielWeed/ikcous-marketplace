// @vitest-environment jsdom
//
// AVISO COM DESTINO "SOBRE A LOJA", "TERMOS", "PRIVACIDADE" OU "TROCAS" ABRE A
// PÁGINA CERTA NO SINO (caça r21, achado 4).
//
// O painel deixa a lojista digitar qualquer caminho no "Avançado: abrir outra
// página", e o App aceita `about-store`, `terms`, `privacy`, `returns-policy`
// e `recently-viewed` como telas de entrada — o push do celular abre a página
// certa. Mas a lista fixa de `navegarPorUrl` (o toque no aviso DENTRO do sino)
// não as conhecia, e tudo que estava fora dela caía na vitrine em silêncio.
//
// As telas do painel (`admin-*`) continuam FORA da lista de propósito: a
// cliente não vai para o painel pelo sino.
import { describe, expect, it, vi } from "vitest";

// A tela importa o cartão de avisos do aparelho, que lê o hook de push (puxa o
// supabase real, sem variáveis de ambiente aqui); este teste é só da decisão.
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({}),
}));

import { navegarPorUrl } from "@/views/customer/NotificationsView";

function destinoDe(url: string) {
  const navegar = vi.fn<(view: unknown, id?: string) => void>();
  navegarPorUrl(url, navegar);
  return navegar;
}

describe("navegarPorUrl — páginas públicas da loja", () => {
  it.each([
    ["/about-store", "about-store"],
    ["/terms", "terms"],
    ["/privacy", "privacy"],
    ["/returns-policy", "returns-policy"],
    ["/recently-viewed", "recently-viewed"],
  ])("%s abre a tela %s, não a vitrine", (url, tela) => {
    const navegar = destinoDe(url);
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith(tela, undefined);
  });

  it("com barra no fim ou parâmetro solto, a página continua a mesma", () => {
    expect(destinoDe("/about-store/")).toHaveBeenCalledWith(
      "about-store",
      undefined,
    );
    expect(destinoDe("/returns-policy?origem=push")).toHaveBeenCalledWith(
      "returns-policy",
      undefined,
    );
  });

  it("CONTROLE — tela do painel nunca abre pelo sino da cliente", () => {
    expect(destinoDe("/admin-orders")).toHaveBeenCalledWith("home");
    expect(destinoDe("/admin-about-store")).toHaveBeenCalledWith("home");
    expect(destinoDe("/admin")).toHaveBeenCalledWith("home");
  });

  it("CONTROLES — o que já funcionava segue igual", () => {
    expect(destinoDe("/cart")).toHaveBeenCalledWith("cart", undefined);
    expect(destinoDe("/notifications")).toHaveBeenCalledWith(
      "notifications",
      undefined,
    );
    expect(destinoDe("/caminho-que-nao-existe")).toHaveBeenCalledWith("home");
  });
});
