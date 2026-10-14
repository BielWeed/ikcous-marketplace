// Os atalhos do ícone instalado (segurar o ícone do app no celular: "Carrinho"
// e "Favoritos") mandavam para `/?view=cart` e `/?view=favorites`. O app só
// decide a tela pelo CAMINHO da URL (`/cart`, `/favorites`: App.tsx lê o
// `pathname` e confere em TELAS_DE_ENTRADA); de parâmetros só entende
// `category` e `id`. Então o `?view=` era ignorado e o atalho abria a vitrine.
//
// O teste lê o manifesto de verdade e confere cada atalho contra a MESMA lista
// de rotas que o app usa. Não mede o toque num celular real.
import { MANIFESTO_BASE } from "@/config/manifestoBase";
import { TELAS_DE_ENTRADA } from "@/config/rotas";
import { describe, expect, it } from "vitest";

// Mesma leitura do App.tsx (syncWithUrl): pathname sem a barra inicial e sem
// barra final; vazio = home.
function telaQueOAppAbre(url: string): string {
  const { pathname } = new URL(url, "https://loja.exemplo");
  const caminho = pathname.slice(1).replace(/\/$/, "") || "home";
  return caminho;
}

describe("atalhos do ícone instalado", () => {
  const atalhos = MANIFESTO_BASE.shortcuts;

  it("existem os dois atalhos esperados", () => {
    expect(atalhos.map((a) => a.short_name)).toEqual(["Carrinho", "Favoritos"]);
  });

  it("nenhum atalho depende de ?view= (o app ignora esse parâmetro)", () => {
    for (const atalho of atalhos) {
      expect(atalho.url).not.toContain("view=");
    }
  });

  it("cada atalho cai numa tela que o app resolve pelo caminho", () => {
    for (const atalho of atalhos) {
      const tela = telaQueOAppAbre(atalho.url);
      expect(TELAS_DE_ENTRADA as readonly string[]).toContain(tela);
    }
  });

  it("e cai na tela CERTA: Carrinho abre cart, Favoritos abre favorites", () => {
    const porNome = Object.fromEntries(
      atalhos.map((a) => [a.short_name, telaQueOAppAbre(a.url)]),
    );
    expect(porNome).toEqual({ Carrinho: "cart", Favoritos: "favorites" });
  });
});
