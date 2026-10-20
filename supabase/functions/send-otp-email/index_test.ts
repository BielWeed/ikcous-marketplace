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
import { handler, htmlDoCodigo, mascarar, montarResposta } from "./index.ts";

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

// ── O fluxo inteiro, com o remetente resolvido (e-mail da loja, 14/10/2026) ──
//
// O corpo da funcao agora e' exportado (`handler`). O que importa aqui e' o
// LOGIN POR E-MAIL, que nao pode quebrar:
//   * sem remetente nenhum, para ANTES de gerar o codigo (nao queima o codigo
//     nem a janela de 60 s);
//   * loja que so' tem o ambiente (IKCOUS) envia pelo ambiente, igual a antes;
//   * o remetente que o resolvedor devolveu e' o MESMO que chega ao envio.

const REMETENTE_AMBIENTE = {
  origem: "ambiente",
  usuario: "ambiente@exemplo.com",
  senha: "senha-do-ambiente",
  motivo: "sem_registro",
  reserva: null,
};
const REMETENTE_NENHUM = {
  origem: "nenhum",
  usuario: null,
  senha: null,
  motivo: "sem_registro",
  reserva: null,
};

function pedidoDeCodigo(corpo: unknown = {
  email: "cliente@exemplo.com",
  whatsapp: "11999999999",
  orderFragment: "ABC123",
}) {
  return new Request("http://local/send-otp-email", {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

function supabaseDoCodigo(resposta: unknown, chamadas: string[] = []) {
  return {
    rpc: async (nome: string) => {
      chamadas.push(nome);
      return { data: resposta, error: null };
    },
  };
}

const CODIGO_GERADO = { ok: true, email: "cliente@exemplo.com", otp_code: "654321" };

Deno.test("handler: remetente 'nenhum' -> 502 sem_remetente e o codigo NAO e' gerado (nada gasto)", async () => {
  const chamadas: string[] = [];
  const enviados: unknown[] = [];
  const r = await handler(pedidoDeCodigo(), {
    supabase: supabaseDoCodigo(CODIGO_GERADO, chamadas),
    resolverRemetente: async () => REMETENTE_NENHUM,
    enviarEmail: async (...args: unknown[]) => void enviados.push(args),
  });
  assertEquals(r.status, 502);
  assertEquals((await r.json()).motivo, "sem_remetente");
  assertEquals(chamadas, []);
  assertEquals(enviados, []);
});

Deno.test("handler: resolvedor REAL sem cofre e sem SMTP no ambiente -> 502 sem_remetente, codigo nao gerado", async () => {
  const nomes = ["SMTP_USER", "SMTP_PASSWORD", "MP_CHAVES_ENCRYPTION_KEY"];
  const antes = nomes.map((n) => [n, Deno.env.get(n)] as const);
  for (const n of nomes) Deno.env.delete(n);
  try {
    const chamadas: string[] = [];
    const r = await handler(pedidoDeCodigo(), { supabase: supabaseDoCodigo(CODIGO_GERADO, chamadas) });
    assertEquals(r.status, 502);
    assertEquals((await r.json()).motivo, "sem_remetente");
    assertEquals(chamadas, []);
  } finally {
    for (const [n, v] of antes) {
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    }
  }
});

Deno.test("handler: loja so' com o AMBIENTE (IKCOUS) — resolvedor REAL — envia pelo ambiente, com o mesmo assunto e o codigo no corpo", async () => {
  const nomes = ["SMTP_USER", "SMTP_PASSWORD", "MP_CHAVES_ENCRYPTION_KEY"];
  const antes = nomes.map((n) => [n, Deno.env.get(n)] as const);
  Deno.env.set("SMTP_USER", "ambiente@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "senha-do-ambiente");
  Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  try {
    const chamadas: string[] = [];
    const enviados: any[] = [];
    const r = await handler(pedidoDeCodigo(), {
      supabase: supabaseDoCodigo(CODIGO_GERADO, chamadas),
      enviarEmail: async (mensagem: unknown, remetente: unknown) => void enviados.push([mensagem, remetente]),
    });
    assertEquals(r.status, 200);
    assertEquals(await r.json(), { ok: true });
    assertEquals(chamadas, ["generate_order_otp_v2"]);
    assertEquals(enviados.length, 1);
    const [mensagem, remetente] = enviados[0];
    assertEquals(mensagem.para, "cliente@exemplo.com");
    assertEquals(mensagem.assunto, "Seu codigo de verificacao");
    assertStringIncludes(mensagem.html, "654321");
    assertEquals(remetente.origem, "ambiente");
    assertEquals(remetente.usuario, "ambiente@exemplo.com");
    assertEquals(remetente.senha, "senha-do-ambiente");
  } finally {
    for (const [n, v] of antes) {
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    }
  }
});

Deno.test("handler: o remetente resolvido (painel) e' o que chega ao envio, e o resolvedor recebeu o client de servico", async () => {
  const doPainel = { ...REMETENTE_AMBIENTE, origem: "painel", usuario: "painel@gmail.com", motivo: null };
  const supabase = supabaseDoCodigo(CODIGO_GERADO);
  const recebidos: unknown[] = [];
  const enviados: unknown[] = [];
  const r = await handler(pedidoDeCodigo(), {
    supabase,
    resolverRemetente: async (cliente: unknown) => {
      recebidos.push(cliente);
      return doPainel;
    },
    enviarEmail: async (_m: unknown, remetente: unknown) => void enviados.push(remetente),
  });
  assertEquals(r.status, 200);
  assertEquals(recebidos, [supabase]);
  assertEquals(enviados, [doPainel]);
});

Deno.test("handler: corpo incompleto -> 400 pedido_invalido SEM nem resolver o remetente", async () => {
  let resolveu = false;
  const r = await handler(pedidoDeCodigo({ email: "a@b.c" }), {
    supabase: supabaseDoCodigo(CODIGO_GERADO),
    resolverRemetente: async () => {
      resolveu = true;
      return REMETENTE_AMBIENTE;
    },
  });
  assertEquals(r.status, 400);
  assertEquals(resolveu, false);
});

Deno.test("handler: codigo recusado pelo freio ou nao confere NAO envia nada", async () => {
  for (const [resposta, esperado] of [
    [{ ok: false, motivo: "muito_recente", espere_segundos: 42 }, "muito_recente"],
    [{ ok: false }, "nao_confere"],
  ] as const) {
    const enviados: unknown[] = [];
    const r = await handler(pedidoDeCodigo(), {
      supabase: supabaseDoCodigo(resposta),
      resolverRemetente: async () => REMETENTE_AMBIENTE,
      enviarEmail: async (...a: unknown[]) => void enviados.push(a),
    });
    assertEquals(r.status, 200);
    assertEquals((await r.json()).motivo, esperado);
    assertEquals(enviados, []);
  }
});

Deno.test("handler: o envio falha -> 502 envio_falhou, e a resposta nao carrega texto do erro", async () => {
  const r = await handler(pedidoDeCodigo(), {
    supabase: supabaseDoCodigo(CODIGO_GERADO),
    resolverRemetente: async () => REMETENTE_AMBIENTE,
    enviarEmail: async () => {
      throw new Error("SMTP: envio recusado (EAUTH) senha-do-ambiente");
    },
  });
  assertEquals(r.status, 502);
  const texto = JSON.stringify(await r.json());
  assertEquals(texto.includes("senha-do-ambiente"), false);
  assertEquals(JSON.parse(texto).motivo, "envio_falhou");
});
