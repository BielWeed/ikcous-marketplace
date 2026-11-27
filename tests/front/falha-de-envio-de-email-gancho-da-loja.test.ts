// O GANCHO DE E-MAIL DA LOJA FALHOU — categoria própria, separada de "loja sem
// envio" (27/11/2026).
//
// Loja com o "Send Email Hook" ligado manda a confirmação e a recuperação de
// senha pelo Gmail da loja (edge `auth-send-email`, que responde 500 em toda
// falha). O Supabase Auth NÃO repassa o corpo do gancho: conferido na fonte do
// supabase/auth (internal/hooks/hookshttp/hookshttp.go, `runHTTPHook`; o erro
// sobe sem embrulho por internal/api/mail.go, `sendEmail` →
// `sendConfirmation`/`sendPasswordRecovery`, que devolvem o `*HTTPError` como
// veio). O que chega à cliente:
//   - 500 `unexpected_failure` "Unexpected status code returned from hook: 500"
//     (e as irmãs "Service currently unavailable due to hook", "Hook requires
//     authorization token", "Invalid payload sent to hook");
//   - 422 `hook_timeout` "Failed to reach hook within maximum time of N
//     seconds" e 422 `hook_timeout_after_retry` "Failed to reach hook after
//     maximum retries".
// Um 500 do gancho pode ser passageiro (Gmail fora do ar, partida fria), então
// NÃO é "loja sem envio" ("avise a loja para ela resolver"): é "tente de novo
// daqui a pouco; se continuar, avise a loja".
import { describe, expect, it } from "vitest";

import { falhaDeEnvioDeEmail } from "@/lib/falha-de-envio-de-email";

describe("falhaDeEnvioDeEmail — o gancho de e-mail da loja falhou", () => {
  it.each([
    [
      "500 do gancho (Unexpected status code)",
      {
        status: 500,
        code: "unexpected_failure",
        message: "Unexpected status code returned from hook: 500",
      },
    ],
    [
      "gancho indisponível (429/503 sem retry-after)",
      {
        status: 500,
        code: "unexpected_failure",
        message: "Service currently unavailable due to hook",
      },
    ],
    [
      "gancho pediu autorização (401)",
      {
        status: 500,
        code: "unexpected_failure",
        message: "Hook requires authorization token",
      },
    ],
    [
      "gancho estourou o tempo",
      {
        status: 422,
        code: "hook_timeout",
        message: "Failed to reach hook within maximum time of 5.000000 seconds",
      },
    ],
    [
      "gancho estourou o tempo (código sem mensagem conhecida)",
      { status: 422, code: "hook_timeout", message: "x" },
    ],
    [
      "gancho inalcançável depois das novas tentativas",
      {
        status: 422,
        code: "hook_timeout_after_retry",
        message: "Failed to reach hook after maximum retries",
      },
    ],
  ])("%s → envio_da_loja_falhou", (_caso, erro) => {
    expect(falhaDeEnvioDeEmail(erro)).toBe("envio_da_loja_falhou");
  });

  it.each([
    [
      "500 de outra causa (banco)",
      {
        status: 500,
        code: "unexpected_failure",
        message: "Database error saving new user",
      },
    ],
    [
      "unexpected_failure sem mensagem",
      { status: 500, code: "unexpected_failure" },
    ],
    [
      "'hook' na mensagem mas SEM o código unexpected_failure",
      {
        status: 500,
        message: "Unexpected status code returned from hook: 500",
      },
    ],
    [
      "'hook' na mensagem com outro código",
      {
        status: 400,
        code: "validation_failed",
        message: "Invalid payload sent to hook",
      },
    ],
    [
      "palavra que só CONTÉM 'hook' (webhooks) não conta",
      {
        status: 500,
        code: "unexpected_failure",
        message: "Error calling webhooks endpoint",
      },
    ],
  ])("%s continua null", (_caso, erro) => {
    expect(falhaDeEnvioDeEmail(erro)).toBeNull();
  });

  it("as categorias antigas não mudam", () => {
    expect(
      falhaDeEnvioDeEmail({
        code: "email_address_not_authorized",
        message: "x",
      }),
    ).toBe("loja_sem_envio");
    expect(
      falhaDeEnvioDeEmail({
        message:
          'Email address "a@exemplo.test" cannot be used as it is not authorized',
      }),
    ).toBe("loja_sem_envio");
    // O SMTP próprio quebrado continua "loja sem envio", mesmo com o código
    // unexpected_failure: a mensagem não fala de gancho.
    expect(
      falhaDeEnvioDeEmail({
        code: "unexpected_failure",
        message: "Error sending confirmation email",
      }),
    ).toBe("loja_sem_envio");
    expect(
      falhaDeEnvioDeEmail({
        code: "unexpected_failure",
        message: "Error sending recovery email",
      }),
    ).toBe("loja_sem_envio");
    expect(
      falhaDeEnvioDeEmail({
        code: "over_email_send_rate_limit",
        message: "email rate limit exceeded",
      }),
    ).toBe("limite_da_loja");
    expect(
      falhaDeEnvioDeEmail({
        code: "over_email_send_rate_limit",
        message:
          "For security purposes, you can only request this after 42 seconds.",
      }),
    ).toBeNull();
    expect(falhaDeEnvioDeEmail(null)).toBeNull();
    expect(falhaDeEnvioDeEmail(undefined)).toBeNull();
    expect(falhaDeEnvioDeEmail({})).toBeNull();
    expect(
      falhaDeEnvioDeEmail({ code: 42, message: { hook: true } }),
    ).toBeNull();
  });
});
