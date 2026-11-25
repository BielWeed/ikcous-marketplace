// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) em `navegarPorUrl` (NotificationsView.tsx), o
// leitor do endereço do aviso do sino. Os testes vizinhos já prendem a maior
// parte; estas são as bordas que defeitos de UMA linha atravessavam:
//   - o prefixo `/product/` é de CAMINHO: `/product-detail/abc` ou
//     `/product-x/abc` NÃO são "produto abc" (o prefixo exige a barra);
//   - id vazio no caminho (`/product//x`) ou na consulta (`/product?id=`) não
//     abre produto vazio: cai na Início;
//   - o id vem do parâmetro `id` (e de nenhum outro nome).
//
// Decisão registrada (não pinada de propósito): `/product-detail` SEM id vai
// hoje a "product-detail" sem id (é tela conhecida, como `/order-details`, que
// tem teste próprio). Tirar "product-detail" da lista de telas conhecidas
// mandaria esse caso à Início — mudança de produto, não de código; por isso
// nenhum teste aqui o fixa em nenhuma direção.
import { describe, expect, it, vi } from "vitest";

// A tela importa o cartão de avisos do aparelho, que lê o hook de push (puxa o
// supabase real, sem variáveis de ambiente aqui); este teste é só da decisão.
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({}),
}));

import { navegarPorUrl } from "@/views/customer/NotificationsView";

function abrir(url: string) {
  const navegar = vi.fn<(view: unknown, id?: string) => void>();
  navegarPorUrl(url, navegar);
  return navegar;
}

describe("navegarPorUrl — o prefixo /product/ exige a barra", () => {
  it.each([
    "/product-detail/abc",
    "/product-x/abc",
    "/products/abc",
    "/productabc/def",
  ])("%s NÃO vira produto: cai na Início", (url) => {
    const navegar = abrir(url);
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("a barra faz parte do prefixo mesmo em maiúsculas: /PRODUCT/Abc abre o produto 'Abc'", () => {
    expect(abrir("/PRODUCT/Abc")).toHaveBeenCalledWith("product-detail", "Abc");
  });
});

describe("navegarPorUrl — id vazio ou com outro nome não abre produto vazio", () => {
  it.each(["/product//x", "/product///", "/product?id="])(
    "%s cai na Início, sem abrir produto sem id",
    (url) => {
      const navegar = abrir(url);
      expect(navegar).not.toHaveBeenCalledWith(
        "product-detail",
        expect.anything(),
      );
    },
  );

  it("/product//x e /product?id= vão para a Início, uma navegação só", () => {
    for (const url of ["/product//x", "/product?id="]) {
      const navegar = abrir(url);
      expect(navegar).toHaveBeenCalledTimes(1);
      expect(navegar).toHaveBeenCalledWith("home");
    }
  });

  it("o id é o parâmetro `id`: `?codigo=` e `?code=` não valem", () => {
    for (const url of ["/product?codigo=abc", "/product?code=abc"]) {
      const navegar = abrir(url);
      expect(navegar).toHaveBeenCalledTimes(1);
      expect(navegar).toHaveBeenCalledWith("home");
    }
  });

  it("pedido: o id também é o parâmetro `id` — `/order?codigo=1` cai na Início", () => {
    const navegar = abrir("/order?codigo=1");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("home");
  });
});
