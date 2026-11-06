// @vitest-environment jsdom
//
// O aparelho tem DOIS "Agora não" de 7 dias: o do cartão de avisos do Início do
// painel e o do convite flutuante (`PushNotificationBanner`). Quem sai da conta
// (ou troca de conta) é descadastrado do aparelho; se o adiamento do convite
// sobrevivesse, a próxima pessoa ficaria até 7 dias sem ser convidada a ligar
// os avisos. `esquecerAdiamentoDosAvisos` tem de apagar os dois.
import {
  CHAVE_DO_ADIAMENTO_DOS_AVISOS,
  CHAVE_DO_ADIAMENTO_DO_CONVITE,
  esquecerAdiamentoDosAvisos,
} from "@/lib/avisos-do-aparelho";
import { afterEach, describe, expect, it } from "vitest";

describe("esquecerAdiamentoDosAvisos — os dois adiamentos do aparelho", () => {
  afterEach(() => {
    localStorage.removeItem(CHAVE_DO_ADIAMENTO_DOS_AVISOS);
    localStorage.removeItem(CHAVE_DO_ADIAMENTO_DO_CONVITE);
  });

  it("a chave do convite é a que o PushNotificationBanner grava", () => {
    expect(CHAVE_DO_ADIAMENTO_DO_CONVITE).toBe(
      "ikcous_push_banner_dismissed_until",
    );
  });

  it("apaga o adiamento do cartão do Início E o do convite flutuante", () => {
    const ate = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
    localStorage.setItem(CHAVE_DO_ADIAMENTO_DOS_AVISOS, ate);
    localStorage.setItem(CHAVE_DO_ADIAMENTO_DO_CONVITE, ate);

    esquecerAdiamentoDosAvisos();

    expect(localStorage.getItem(CHAVE_DO_ADIAMENTO_DOS_AVISOS)).toBeNull();
    expect(localStorage.getItem(CHAVE_DO_ADIAMENTO_DO_CONVITE)).toBeNull();
  });
});
