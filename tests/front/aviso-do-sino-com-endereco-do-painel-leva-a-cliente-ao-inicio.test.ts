// @vitest-environment jsdom
//
// O TOQUE NO AVISO DO SINO (`navegarPorUrl`) NUNCA LEVA A CLIENTE A UMA TELA DO
// PAINEL. A lista de telas que o sino aceita deixa de fora as `admin-*` de
// propósito (a cliente não vai ao painel pelo sino), mas nenhum teste prendia
// isso: bastava alguém acrescentar uma tela do painel à lista, "porque o push
// da lojista também usa esse endereço", e a cliente cairia na tela de login do
// painel — ou numa tela que carrega dado de loja — a partir de um aviso.
// O destino de um endereço de painel é o Início, igual a qualquer endereço
// desconhecido, e o `id` que vier junto não segue com ele.
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
  return navegar.mock.calls;
}

describe("navegarPorUrl — endereço de tela do painel", () => {
  it.each([
    "/admin",
    "/admin-products",
    "/admin-orders?id=123",
    "/admin-dashboard",
    "/admin-reviews",
    "/ADMIN-QA",
  ])("%s leva ao Início, sem id", (url) => {
    expect(destinoDe(url)).toEqual([["home"]]);
  });

  it("endereço desconhecido também leva ao Início (a mesma saída)", () => {
    expect(destinoDe("/qualquer-coisa")).toEqual([["home"]]);
  });

  it("tela pública conhecida segue o seu caminho (controle)", () => {
    expect(destinoDe("/returns-policy")).toEqual([
      ["returns-policy", undefined],
    ]);
  });
});
