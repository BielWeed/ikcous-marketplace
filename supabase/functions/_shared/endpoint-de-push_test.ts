// @ts-nocheck
/**
 * Testes de `endpointDePushPermitido` — a trava contra SSRF cego no envio de
 * push (achado da caça estática de 17/11/2026).
 *
 * O defeito: qualquer conta autenticada grava em `push_subscriptions` (policy
 * `push_subscriptions_all_policy`: a linha é dela) um `endpoint` ARBITRÁRIO, e a
 * edge function dava `fetch(endpoint)` direto — `http://127.0.0.1:porta/x`,
 * host interno, metadata de nuvem. A função pura é testada sem rede.
 *
 * Por que NÃO é lista fechada de hosts: os serviços de push dos navegadores
 * variam (FCM, Mozilla, Apple, Windows, e os que ainda vão aparecer), e uma
 * lista derrubaria cliente legítimo. A regra recusa o que NUNCA é serviço de
 * push público: esquema sem TLS, credencial na URL, porta fora da padrão, IP
 * literal e nome de rede interna.
 */
import { assertEquals, assertThrows } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  aceitarPushServiceLocalSoNosTestes,
  endpointDePushPermitido,
} from "./endpoint-de-push.ts";

// Montadas em tempo de execução: dado de teste, não credencial (o secretlint
// leria o literal `esquema://usuario:senha@host` como BasicAuth).
const URL_COM_USUARIO_E_SENHA = ["https://", "user", ":", "senha", "@fcm.googleapis.com/x"].join("");
const URL_LOCALHOST_COM_USUARIO_E_SENHA = ["http://", "user", ":", "senha", "@localhost:4321/x"].join("");

const LEGITIMOS = [
  "https://fcm.googleapis.com/fcm/send/abc",
  "https://updates.push.services.mozilla.com/wpush/v2/abc",
  "https://web.push.apple.com/abc",
  "https://wns2-par02p.notify.windows.com/w/?token=abc",
  // porta 443 explícita é a padrão: a URL normaliza e aceita
  "https://fcm.googleapis.com:443/fcm/send/abc",
  // host em maiúsculas é o mesmo host
  "https://FCM.GoogleAPIs.com/fcm/send/abc",
];

for (const endpoint of LEGITIMOS) {
  Deno.test(`endpointDePushPermitido: aceita o push service real ${endpoint}`, () => {
    assertEquals(endpointDePushPermitido(endpoint), true);
  });
}

const RECUSADOS: [string, unknown][] = [
  ["esquema http", "http://fcm.googleapis.com/fcm/send/abc"],
  ["esquema ftp", "ftp://fcm.googleapis.com/x"],
  ["esquema file", "file:///etc/passwd"],
  ["esquema javascript", "javascript:alert(1)"],
  ["IPv4 de loopback", "https://127.0.0.1/x"],
  ["IPv4 de loopback com porta", "https://127.0.0.1:8080/x"],
  ["IPv6 de loopback", "https://[::1]/x"],
  ["IPv6 mapeado em IPv4 de loopback", "https://[::ffff:127.0.0.1]/x"],
  ["IPv6 público (também é IP literal)", "https://[2001:4860:4860::8888]/x"],
  ["IPv4 de rede privada", "https://10.0.0.5/x"],
  ["IPv4 de metadata de nuvem", "https://169.254.169.254/latest/meta-data"],
  ["IPv4 público (IP literal nunca é push service)", "https://8.8.8.8/x"],
  ["IPv4 em decimal (a URL normaliza para 127.0.0.1)", "https://2130706433/x"],
  ["IPv4 em hexadecimal", "https://0x7f.0.0.1/x"],
  ["IPv4 abreviado", "https://127.1/x"],
  ["localhost", "https://localhost/x"],
  ["localhost em maiúsculas", "https://LOCALHOST/x"],
  ["localhost com ponto final", "https://localhost./x"],
  ["subdomínio de localhost", "https://api.localhost/x"],
  ["sufixo .internal", "https://servico.internal/x"],
  ["sufixo .local", "https://impressora.local/x"],
  ["sufixo .local com ponto final", "https://impressora.local./x"],
  ["sufixo .lan", "https://roteador.lan/x"],
  ["rótulo único sem ponto", "https://intranet/x"],
  ["rótulo único com ponto final", "https://intranet./x"],
  ["porta diferente da padrão", "https://fcm.googleapis.com:8443/x"],
  ["porta 80 em https", "https://fcm.googleapis.com:80/x"],
  ["usuário e senha na URL", URL_COM_USUARIO_E_SENHA],
  ["só usuário na URL", "https://user@fcm.googleapis.com/x"],
  ["usuário disfarçando o host real", "https://fcm.googleapis.com@127.0.0.1/x"],
  ["string vazia", ""],
  ["só espaços", "   "],
  ["lixo", "não é url"],
  ["sem esquema", "fcm.googleapis.com/fcm/send/abc"],
  ["undefined", undefined],
  ["null", null],
  ["número", 123],
  // `String(["https://..."])` seria uma URL válida: o tipo precisa ser string.
  ["array com uma URL boa dentro", ["https://fcm.googleapis.com/fcm/send/abc"]],
  ["objeto", { endpoint: "https://fcm.googleapis.com/x" }],
];

for (const [nome, endpoint] of RECUSADOS) {
  Deno.test(`endpointDePushPermitido: recusa ${nome}`, () => {
    assertEquals(endpointDePushPermitido(endpoint), false);
  });
}

Deno.test("aceitarPushServiceLocalSoNosTestes: libera só o localhost, só até desfazer, e nada mais", () => {
  assertEquals(endpointDePushPermitido("http://localhost:4321/p/ok"), false);

  const desfazer = aceitarPushServiceLocalSoNosTestes();
  try {
    assertEquals(endpointDePushPermitido("http://localhost:4321/p/ok"), true);
    // A brecha de teste é estreita: o resto da regra continua valendo.
    assertEquals(endpointDePushPermitido("http://127.0.0.1:4321/p/ok"), false);
    assertEquals(endpointDePushPermitido("http://10.0.0.5/x"), false);
    assertEquals(endpointDePushPermitido("http://servico.internal/x"), false);
    assertEquals(endpointDePushPermitido(URL_LOCALHOST_COM_USUARIO_E_SENHA), false);
    assertEquals(endpointDePushPermitido("ftp://localhost/x"), false);
  } finally {
    desfazer();
  }

  assertEquals(
    endpointDePushPermitido("http://localhost:4321/p/ok"),
    false,
    "depois de desfazer, o localhost volta a ser recusado",
  );
});

Deno.test("aceitarPushServiceLocalSoNosTestes: dentro do Edge Runtime (produção) recusa ligar a brecha", () => {
  (globalThis as Record<string, unknown>).EdgeRuntime = {};
  try {
    assertThrows(() => aceitarPushServiceLocalSoNosTestes(), Error, "só nos testes");
  } finally {
    delete (globalThis as Record<string, unknown>).EdgeRuntime;
  }
  assertEquals(endpointDePushPermitido("http://localhost:4321/p/ok"), false);
});
