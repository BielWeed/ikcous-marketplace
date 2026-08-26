// @ts-nocheck
/**
 * Testes da send-otp-email depois da inversao (#161 + #86).
 *
 * Nada aqui toca rede nem banco. O que se prova e' a parte que decide O QUE a
 * tela vai poder dizer — que e' exatamente onde o defeito antigo morava: a tela
 * dizia "codigo enviado" porque ninguem tinha como saber o contrario.
 *
 * O envio em si e' coberto por _shared/smtp_test.ts nas recusas, e foi medido
 * no ar pela sonda de 19/08/2026 no caminho feliz.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { htmlDoCodigo, mascarar, montarResposta } from "./index.ts";

Deno.test("montarResposta: recusa de validacao e' 200, para a tela poder mandar corrigir o formulario", () => {
  assertEquals(montarResposta({ ok: false, motivo: "nao_confere" }).status, 200);
});

Deno.test("montarResposta: pedido repetido cedo demais tambem e' 200 — nao e' falha da loja", () => {
  assertEquals(
    montarResposta({ ok: false, motivo: "muito_recente", espereSegundos: 42 })
      .status,
    200,
  );
});

Deno.test("montarResposta: falha de envio e' 502, porque nao adianta o cliente corrigir nada", () => {
  assertEquals(montarResposta({ ok: false, motivo: "envio_falhou" }).status, 502);
});

Deno.test("montarResposta: loja sem remetente configurado tambem e' 502", () => {
  assertEquals(montarResposta({ ok: false, motivo: "sem_remetente" }).status, 502);
});

Deno.test("montarResposta: corpo malformado e' 400 — nao e' caso de cliente nenhum", () => {
  assertEquals(
    montarResposta({ ok: false, motivo: "pedido_invalido" }).status,
    400,
  );
});

Deno.test("montarResposta: sucesso nao devolve o codigo, so' o ok", async () => {
  const corpo = await montarResposta({ ok: true }).json();
  assertEquals(corpo, { ok: true });
});

Deno.test("montarResposta: o freio diz quantos segundos esperar, para a tela nao chutar", async () => {
  const corpo = await montarResposta({
    ok: false,
    motivo: "muito_recente",
    espereSegundos: 42,
  }).json();
  assertEquals(corpo.espereSegundos, 42);
});

Deno.test("htmlDoCodigo: o codigo aparece no corpo do e-mail", () => {
  assertStringIncludes(htmlDoCodigo("123456"), "123456");
});

Deno.test("htmlDoCodigo: nao crava cidade nem nome de loja nenhuma", () => {
  // Este arquivo e' o molde que se clona por cliente: qualquer coisa cravada
  // aqui viaja para toda loja que existir.
  const html = htmlDoCodigo("123456");
  assertEquals(html.includes("Monte Carmelo"), false);
  assertEquals(html.includes("IKCOUS"), false);
});

Deno.test("mascarar: o log nunca carrega o endereco inteiro de quem compra", () => {
  assertEquals(mascarar("cliente@teste.com"), "c*****e@teste.com".replace("*****", "***"));
  assertEquals(mascarar("ab@teste.com"), "***@teste.com");
  assertEquals(mascarar("sem-arroba"), "***");
});

// --- PEDIDO-07 (auditoria de 26/08/2026): migração para readKey ---
//
// A logica de requisicao real fica dentro de `if (!emTeste) { serve(...) }`
// — nao ha um `handler` exportado como em criar-pagamento/index.ts (ver o
// comentario grande de `deps` la, sobre por que essa costura existe). Sem
// extrair um seam novo (refatoracao maior que o pedido desta correcao, e
// fora do escopo: so' a troca da chave foi pedida), a chamada a
// createClient() dentro do serve() nao e' alcancavel por teste de
// comportamento. A prova possivel, honesta sobre o que prova, e' textual:
// confirma que o codigo fonte migrou para o MESMO padrao que
// webhook-mercadopago, reconciliar-pagamentos, notify-new-order e send-push
// ja usam, e que a leitura DIRETA da chave legada (o sintoma do defeito —
// no dia em que SUPABASE_SERVICE_ROLE_KEY for desligada, createClient(url,
// undefined) lanca e o login por codigo de e-mail para) nao sobrevive ao
// lado dela.

Deno.test("index.ts usa readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY') para montar o client — não lê a chave legada direto", async () => {
  const fonte = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  assertStringIncludes(
    fonte,
    'readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")',
  );

  // A leitura direta da variável legada é o sintoma do defeito original —
  // ela não pode sobreviver ao lado da chamada nova acima.
  assertEquals(fonte.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'), false);
});
