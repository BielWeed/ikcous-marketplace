import { destinoPosLogin } from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * src/lib/destinoPosLogin.ts — para onde o cliente vai depois de entrar.
 *
 * PR #220 fez "Pagar agora com PIX" exigir conta. Quem estava no checkout ou
 * no carrinho e foi mandado para o login, depois de entrar caía sempre no
 * perfil — longe de onde estava. Esta função decide o destino certo a partir
 * do `history.state` que o App.tsx já grava em toda navegação.
 *
 * `destinoPosLogin` devolve sempre uma `View` — navegação ABSOLUTA
 * (`handleNavigate(view)`), nunca "volte uma entrada no histórico"
 * (`history.back()`). Uma versão anterior tinha um `{tipo:"voltar"}` que
 * exigia uma trava de idempotência porque `AuthView.tsx` dispara `onSuccess`
 * duas vezes por login e `history.back()` não perdoa a segunda chamada.
 * Devolver a própria view ("checkout" ou "cart") em vez de "voltar" torna a
 * ação idempotente por construção — não há mais trava para testar aqui.
 *
 * A ORDEM DAS REGRAS IMPORTA, e é o ponto frágil desta função: `requested`
 * (a view que a pessoa pediu e foi barrada por falta de conta) tem que
 * vencer `from` (de onde ela veio). Quem está no CARRINHO e toca na aba
 * PERFIL sem conta tem `from === "cart"` E `requested === "profile"` ao
 * mesmo tempo — sem essa precedência, essa pessoa cairia de volta no
 * carrinho, não no perfil que pediu. Ver o teste de precedência abaixo.
 */
describe("destinoPosLogin", () => {
  it("from checkout, sem requested, manda para checkout (quem apertou 'Pagar agora com PIX' no checkout)", () => {
    expect(destinoPosLogin({ view: "auth", from: "checkout" })).toBe(
      "checkout",
    );
  });

  it("from cart, sem requested, manda para cart (quem apertou 'Identificar-se e Entrar' no carrinho)", () => {
    expect(destinoPosLogin({ view: "auth", from: "cart" })).toBe("cart");
  });

  it("PRECEDÊNCIA: from cart + requested profile manda para profile, não volta ao carrinho", () => {
    // Se as regras estivessem na ordem errada (from antes de requested), este
    // caso devolveria "cart" e a pessoa cairia no carrinho em vez do perfil
    // que ela pediu — uma regressão do comportamento de hoje.
    expect(
      destinoPosLogin({ view: "auth", from: "cart", requested: "profile" }),
    ).toBe("profile");
  });

  it("requested address-form, from irrelevante, manda para address-form", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        from: "home",
        requested: "address-form",
      }),
    ).toBe("address-form");
  });

  it("state nulo (carregamento novo, ex.: link de confirmação de e-mail em outra aba) cai no perfil", () => {
    expect(destinoPosLogin(null)).toBe("profile");
  });

  it("from desconhecido, sem requested, cai no perfil (comportamento de hoje)", () => {
    expect(destinoPosLogin({ view: "auth", from: "home" })).toBe("profile");
  });

  it("requested fora do conjunto de três (profile/account-settings/address-form) é ignorado — cai no from", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        from: "checkout",
        requested: "admin-settings",
      }),
    ).toBe("checkout");
  });

  it("formato lixo (string, número, objeto sem os campos certos) cai no perfil sem lançar exceção", () => {
    expect(destinoPosLogin("lixo")).toBe("profile");
    expect(destinoPosLogin(42)).toBe("profile");
    expect(destinoPosLogin({})).toBe("profile");
    expect(destinoPosLogin({ outraCoisa: true })).toBe("profile");
  });

  describe("já saiu da tela de login: ignora a chamada (devolve null)", () => {
    // `AuthView` chama `onSuccess` duas vezes por login (uma pelo `useEffect`
    // que reage a `user` sair de `null`, outra depois do `await login()`).
    // Entre a primeira chamada e a segunda, `handleNavigate` já navegou e já
    // gravou o `pushState` do DESTINO — não mais o do login. A segunda
    // chamada recebe exatamente esse payload pós-navegação, e tem que ser
    // um no-op: navegar de novo é o bug que esta rodada corrige (a pessoa
    // via o checkout por uma fração de segundo e era jogada no perfil).
    for (const destino of [
      "checkout",
      "cart",
      "profile",
      "address-form",
      "account-settings",
    ] as const) {
      it(`payload pós-navegação para "${destino}" (view !== "auth") devolve null`, () => {
        expect(
          destinoPosLogin({ view: destino, id: undefined, from: "auth" }),
        ).toBeNull();
      });
    }
  });

  it("FRONTEIRA: `view` presente mas não-string não aciona a regra nova — segue para as regras de hoje", () => {
    // A regra nova só vale quando `view` é uma STRING diferente de "auth".
    // Um valor de outro tipo não é "já saiu da tela de login" — é dado
    // estranho, e cai no comportamento de sempre (aqui, `from: "checkout"`).
    expect(destinoPosLogin({ view: 42, from: "checkout" })).toBe("checkout");
  });

  it("PROPRIEDADE (o bug desta rodada, escrito como teste): duas chamadas seguidas — a primeira navega, a segunda mutou o estado e é ignorada", () => {
    // Simula exatamente a mutação que `handleNavigate` faz no `history.state`
    // entre a chamada #1 e a chamada #2 de `AuthView.onSuccess`.
    const estadoNoLogin = { view: "auth", from: "checkout" };
    const destino1 = destinoPosLogin(estadoNoLogin);
    expect(destino1).toBe("checkout");

    // App.tsx grava isto via pushState ao concluir a navegação para "checkout".
    const estadoAposNavegar = {
      view: destino1,
      id: undefined,
      from: "auth",
    };
    const destino2 = destinoPosLogin(estadoAposNavegar);
    expect(destino2).toBeNull();
  });
});
