// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `endpoint-de-push.ts`, a trava contra SSRF
 * cego no envio de push. 28 mutantes plantados; 8 sobreviviam a
 * `endpoint-de-push_test.ts`: 3 são equivalentes (host vazio, IPv6 entre
 * colchetes e `localhost` puro caem todos na regra "rótulo único sem ponto"
 * logo depois) e 5 mudavam o veredito (4 comportamentos):
 *
 *   * a brecha de teste (`aceitarPushServiceLocalSoNosTestes`) devolve o estado
 *     ANTERIOR ao ser desligada: desligar uma ligação aninhada não derruba a de
 *     fora, e desligar a de fora fecha a brecha de novo;
 *   * senha SEM usuário na URL também é recusada (`https://:senha@host/`);
 *   * com a brecha ligada só o host `localhost` EXATO passa — um nome que apenas
 *     começa com "local" (`localhost.exemplo.com`) continua recusado;
 *   * os sufixos de rede interna valem no FIM do nome: um push service legítimo
 *     que só contém `.local` ou `.lan` no meio (`push.local-servicos.exemplo.com`)
 *     é aceito, senão derrubaria cliente real.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  aceitarPushServiceLocalSoNosTestes,
  endpointDePushPermitido,
} from "./endpoint-de-push.ts";

// Montado em tempo de execução: dado de teste, não credencial (o secretlint
// leria o literal `esquema://:senha@host` como BasicAuth).
const URL_SO_COM_SENHA = ["https://", ":", "senha", "@fcm.googleapis.com/x"].join("");

Deno.test("endpoint: senha SEM usuário na URL é recusada", () => {
  assertEquals(endpointDePushPermitido(URL_SO_COM_SENHA), false);
  assertEquals(endpointDePushPermitido("https://fcm.googleapis.com/x"), true);
});

Deno.test("endpoint: sufixo de rede interna só vale no FIM do nome (nome legítimo com '.local' ou '.lan' no meio passa)", () => {
  assertEquals(endpointDePushPermitido("https://push.local-servicos.exemplo.com/x"), true);
  assertEquals(endpointDePushPermitido("https://push.lanes.exemplo.com/x"), true);
  assertEquals(endpointDePushPermitido("https://push.internals.exemplo.com/x"), true);
  assertEquals(endpointDePushPermitido("https://servico.exemplo.local/x"), false);
  assertEquals(endpointDePushPermitido("https://servico.exemplo.lan/x"), false);
});

Deno.test("brecha de teste: liga, desliga e devolve o estado anterior (aninhada não derruba a de fora)", () => {
  const LOCAL = "http://localhost:4321/p/ok";
  assertEquals(endpointDePushPermitido(LOCAL), false);
  const desligarFora = aceitarPushServiceLocalSoNosTestes();
  try {
    assertEquals(endpointDePushPermitido(LOCAL), true);
    const desligarDentro = aceitarPushServiceLocalSoNosTestes();
    assertEquals(endpointDePushPermitido(LOCAL), true);
    desligarDentro();
    // a ligação de fora continua valendo
    assertEquals(endpointDePushPermitido(LOCAL), true);
  } finally {
    desligarFora();
  }
  assertEquals(endpointDePushPermitido(LOCAL), false);
});

Deno.test("brecha de teste: só o host `localhost` EXATO passa, em http ou https; o resto continua recusado", () => {
  const desligar = aceitarPushServiceLocalSoNosTestes();
  try {
    assertEquals(endpointDePushPermitido("http://localhost:4321/x"), true);
    assertEquals(endpointDePushPermitido("https://localhost:4321/x"), true);
    assertEquals(endpointDePushPermitido("http://localhost.exemplo.com/x"), false);
    assertEquals(endpointDePushPermitido("http://localhostx:4321/x"), false);
    assertEquals(endpointDePushPermitido("http://local:4321/x"), false);
    assertEquals(endpointDePushPermitido("http://127.0.0.1:4321/x"), false);
    assertEquals(endpointDePushPermitido("http://fcm.googleapis.com/x"), false);
    assertEquals(endpointDePushPermitido("ftp://localhost/x"), false);
  } finally {
    desligar();
  }
});
