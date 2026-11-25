// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `email-da-loja.ts` — o Gmail que a lojista
 * cadastra para enviar os e-mails de login e de troca de senha da loja, e o
 * limite que impede o botão "testar" de virar disparador de e-mail. 40
 * mutantes plantados; 12 sobreviviam a `email-da-loja_test.ts`: 2 são
 * equivalentes (`!usuario ||` — o formato já recusa texto vazio — e o `>=` da
 * janela no limite de teste, que dá espera zero de qualquer jeito) e 10 viram os
 * casos abaixo (o limite de 24 h da lista guardada, que não é equivalente, fecha o conjunto):
 *
 *   * a senha de app colada do Google chega com espaço invisível e traço
 *     "bonito": junção de largura zero (U+200D) e barra horizontal (U+2015)
 *     também saem;
 *   * o endereço tem no máximo 254 caracteres (254 passa, 255 não);
 *   * a janela de 24 h é aberta no limite: tentativa de exatamente 24 h atrás
 *     NÃO conta, nem no limite de teste nem na lista guardada;
 *   * o intervalo de 1 minuto conta da ÚLTIMA tentativa, e a espera sobe (nunca
 *     desce) para o próximo segundo inteiro;
 *   * os cinco códigos 4xx do Google que significam "acesso bloqueado" (421, 450,
 *     451, 452, 454) e os cinco códigos de rede que significam "sem conexão"
 *     (ECONNECTION, ETIMEDOUT, ESOCKET, EDNS, ECONNRESET);
 *   * a lista de tentativas guardadas mantém as 20 MAIS RECENTES, na ordem.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avaliarLimiteDeTeste,
  classificarFalhaDeEnvio,
  normalizarSenhaDeApp,
  tentativasQueContam,
  validarUsuarioGmail,
} from "./email-da-loja.ts";

const AGORA = Date.parse("2026-11-25T12:00:00.000Z");
const antes = (ms: number) => new Date(AGORA - ms).toISOString();

Deno.test("senha de app: junção de largura zero (U+200D) e barra horizontal (U+2015) colados saem; o resto continua letra", () => {
  const colada = "abcd\u200d efgh\u2015ijkl\u200b\u200cmnop";
  assertEquals(normalizarSenhaDeApp(colada), { ok: true, senha: "abcdefghijklmnop" });
  assertEquals(normalizarSenhaDeApp("abcd\u2010efgh\u2011ijkl\u2012mnop"), { ok: true, senha: "abcdefghijklmnop" });
  assertEquals(normalizarSenhaDeApp("abcd\u2013efgh\u2014ijkl\u2015mnop"), { ok: true, senha: "abcdefghijklmnop" });
});

Deno.test("Gmail: o endereço tem no máximo 254 caracteres (254 passa; 255 não)", () => {
  const com = (tamanho: number) => "a".repeat(tamanho - "@gmail.com".length) + "@gmail.com";
  assertEquals(validarUsuarioGmail(com(254)).ok, true);
  assertEquals(validarUsuarioGmail(com(255)).ok, false);
  assertEquals(validarUsuarioGmail("").ok, false);
  assertEquals(validarUsuarioGmail(undefined).ok, false);
});

Deno.test("limite de teste: tentativa de exatamente 24 h atrás não conta (a janela é aberta no limite)", () => {
  // Uma tentativa em cima do limite de 24 h, e nenhuma depois: nada a esperar.
  assertEquals(avaliarLimiteDeTeste([antes(86_400_000)], AGORA), { permitido: true });
  // Dez tentativas na janela travam; com uma delas no limite exato são só nove.
  const nove = Array.from({ length: 9 }, (_, i) => antes(120_000 + i * 60_000));
  assertEquals(avaliarLimiteDeTeste([...nove, antes(86_400_000)], AGORA), { permitido: true });
  assertEquals(avaliarLimiteDeTeste([...nove, antes(86_399_000)], AGORA).permitido, false);
});

Deno.test("limite de teste: o intervalo de 1 minuto conta da ÚLTIMA tentativa, e a espera sobe para o próximo segundo", () => {
  // última há 10 s (a mais antiga, há 30 min, não decide nada): faltam 50 s
  assertEquals(
    avaliarLimiteDeTeste([antes(1_800_000), antes(10_000)], AGORA),
    { permitido: false, esperaSegundos: 50 },
  );
  // faltam 49,5 s: espera 50, nunca 49
  assertEquals(
    avaliarLimiteDeTeste([antes(10_500)], AGORA),
    { permitido: false, esperaSegundos: 50 },
  );
  // a tentativa mais velha, mesmo fora do minuto, não segura quem já esperou
  assertEquals(avaliarLimiteDeTeste([antes(1_800_000), antes(61_000)], AGORA), { permitido: true });
});

Deno.test("falha de envio: cada código 4xx de bloqueio do Google vira 'acesso_bloqueado'", () => {
  for (const respostaSmtp of [421, 450, 451, 452, 454]) {
    assertEquals(classificarFalhaDeEnvio({ respostaSmtp }), "acesso_bloqueado", String(respostaSmtp));
  }
  for (const respostaSmtp of [420, 422, 453, 455, 535, 550]) {
    assertEquals(classificarFalhaDeEnvio({ respostaSmtp }), "recusado", String(respostaSmtp));
  }
});

Deno.test("falha de envio: cada código de rede vira 'sem_conexao'; outro código solto é 'recusado'", () => {
  for (const codigo of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET"]) {
    assertEquals(classificarFalhaDeEnvio({ codigo }), "sem_conexao", codigo);
  }
  assertEquals(classificarFalhaDeEnvio({ codigo: "EAUTH" }), "senha_errada");
  assertEquals(classificarFalhaDeEnvio({ codigo: "EMESSAGE" }), "recusado");
  assertEquals(classificarFalhaDeEnvio(undefined), "recusado");
});

Deno.test("tentativas guardadas: só as da janela de 24 h (aberta no limite), e as 20 MAIS RECENTES na ordem", () => {
  assertEquals(tentativasQueContam([antes(86_400_000), antes(86_399_000)], AGORA), [antes(86_399_000)]);
  const trinta = Array.from({ length: 30 }, (_, i) => antes((30 - i) * 60_000));
  const guardadas = tentativasQueContam(trinta, AGORA);
  assertEquals(guardadas.length, 20);
  assertEquals(guardadas[0], trinta[10]);
  assertEquals(guardadas[19], trinta[29]);
  assertEquals(tentativasQueContam(["lixo", antes(60_000)], AGORA), [antes(60_000)]);
});
