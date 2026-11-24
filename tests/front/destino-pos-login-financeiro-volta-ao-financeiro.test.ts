import {
  destinoPosLogin,
  idDoDestinoPosLogin,
  painelSemContaPedeEntrada,
} from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * O Financeiro é uma das telas do painel que a lojista consulta com a sessão
 * aberta e que podem ser retomadas depois de a sessão vencer (a lista fechada
 * de `destinoPosLogin` o cita, e os testes vizinhos cobrem as demais telas do
 * painel, mas nenhum cobria esta). Sem o Financeiro na lista, a lojista que
 * entrasse de novo caía no Perfil de cliente em vez de voltar ao Financeiro.
 */
describe("destinoPosLogin — Financeiro do painel", () => {
  it("requested admin-financeiro manda para admin-financeiro: sessão vencida no Financeiro não cai no Perfil de cliente", () => {
    expect(
      destinoPosLogin({ view: "auth", requested: "admin-financeiro" }),
    ).toBe("admin-financeiro");
  });

  it("PRECEDÊNCIA: o pedido do Financeiro vence o 'de onde veio'", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        from: "cart",
        requested: "admin-financeiro",
      }),
    ).toBe("admin-financeiro");
  });

  it("LIMITE: quem já saiu do login (view do destino no state) não navega de novo", () => {
    // É a segunda chamada de `onSuccess` do mesmo login: o state já é o do
    // destino, e a regra de "já saiu da tela de login" vence o `requested`.
    expect(
      destinoPosLogin({
        view: "admin-financeiro",
        requested: "admin-financeiro",
      }),
    ).toBeNull();
  });

  it("LIMITE: variações do nome não viram destino (nada fora da lista fechada)", () => {
    for (const lixo of [
      "admin-financeiro ",
      "Admin-Financeiro",
      "admin-financeiro/",
      "admin-financeiro?id=1",
    ]) {
      expect(destinoPosLogin({ view: "auth", requested: lixo })).toBe(
        "profile",
      );
    }
  });

  it("LIMITE: o Financeiro NUNCA recebe id (a tela não tem ficha), mesmo com uuid válido no state", () => {
    expect(
      idDoDestinoPosLogin("admin-financeiro", {
        view: "auth",
        requested: "admin-financeiro",
        id: "9a1c4e7b-2d3f-4a56-8b90-1c2d3e4f5a6b",
      }),
    ).toBeUndefined();
    expect(
      idDoDestinoPosLogin("admin", {
        view: "auth",
        requested: "admin",
        id: "9a1c4e7b-2d3f-4a56-8b90-1c2d3e4f5a6b",
      }),
    ).toBeUndefined();
  });

  it("o painel sem conta pede entrada também no Financeiro; com sessão ou durante a checagem, não", () => {
    expect(
      painelSemContaPedeEntrada("admin-financeiro", {
        authLoading: false,
        user: null,
      }),
    ).toBe(true);
    expect(
      painelSemContaPedeEntrada("admin-financeiro", {
        authLoading: true,
        user: null,
      }),
    ).toBe(false);
    expect(
      painelSemContaPedeEntrada("admin-financeiro", {
        authLoading: false,
        user: { id: "u1" },
      }),
    ).toBe(false);
  });
});
