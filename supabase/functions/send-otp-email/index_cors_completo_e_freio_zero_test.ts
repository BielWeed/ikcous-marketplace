// @ts-nocheck
/**
 * send-otp-email — dois buracos que a caça por mutação de 25/11/2026 achou
 * depois dos testes `index_nome_da_loja_cors_e_limites_test.ts`:
 *
 *  1. O cabeçalho `Access-Control-Allow-Headers` só era conferido com
 *     `includes("authorization")`. Reduzir a lista inteira a `authorization`
 *     passava na suíte, mas o navegador (supabase-js manda `apikey`,
 *     `x-client-info` e `content-type`) recusaria o pré-voo e a tela de
 *     "acompanhar pedido" nunca chegaria a pedir o código. Aqui a lista é
 *     conferida item a item, no pré-voo E na resposta do POST.
 *  2. `espere_segundos` vindo do banco como 0 vira 0 (`??`), e não 60: o
 *     mutante `?? 60` -> `|| 60` não era notado.
 *  3. Privacidade do log: o log da falha da RPC não pode levar e-mail, WhatsApp
 *     nem fragmento do pedido de quem pediu o código, e o log da falha de envio
 *     só leva o e-mail MASCARADO — nunca o endereço inteiro nem o código de
 *     verificação (que vale 15 min e abre o pedido). Antes, trocar a máscara
 *     ou acrescentar esses campos ao `console.error` passava em toda a suíte.
 *
 * MUTANTE EQUIVALENTE (anotado, não vira teste): em `nomeDaLoja`, trocar
 * `charCodeAt(0) < 32` por `<= 32` só troca o espaço (32) por... um espaço.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const REMETENTE = {
  origem: "ambiente",
  usuario: "ambiente@exemplo.com",
  senha: "senha-do-ambiente",
  motivo: "sem_registro",
  reserva: null,
};

function pedido(metodo = "POST") {
  return new Request("http://local/send-otp-email", {
    method: metodo,
    body: metodo === "POST"
      ? JSON.stringify({ email: "cliente@exemplo.com", whatsapp: "11999999999", orderFragment: "ABC123" })
      : undefined,
  });
}

function banco(rpc: unknown) {
  return {
    rpc: () => Promise.resolve({ data: rpc, error: null }),
    from: () => ({
      select: () => ({
        limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  };
}

const CABECALHOS_QUE_O_NAVEGADOR_MANDA = ["authorization", "x-client-info", "apikey", "content-type"];

function exigirCorsCompleto(r: Response, rotulo: string) {
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*", rotulo);
  const permitidos = (r.headers.get("Access-Control-Allow-Headers") ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase());
  for (const cabecalho of CABECALHOS_QUE_O_NAVEGADOR_MANDA) {
    assert(permitidos.includes(cabecalho), `${rotulo}: o pré-voo recusaria o cabeçalho ${cabecalho} (permitidos: ${permitidos})`);
  }
}

Deno.test("CORS: pré-voo e resposta do POST permitem authorization, x-client-info, apikey e content-type", async () => {
  const deps = {
    supabase: banco({ ok: true, email: "cliente@exemplo.com", otp_code: "654321" }),
    resolverRemetente: () => Promise.resolve(REMETENTE),
    enviarEmail: () => Promise.resolve(),
  };
  exigirCorsCompleto(await handler(pedido("OPTIONS"), deps), "pré-voo");
  const sucesso = await handler(pedido(), deps);
  assertEquals(sucesso.status, 200);
  exigirCorsCompleto(sucesso, "POST ok");
  const semRemetente = await handler(pedido(), {
    ...deps,
    resolverRemetente: () => Promise.resolve({ ...REMETENTE, origem: "nenhum" }),
  });
  assertEquals(semRemetente.status, 502);
  exigirCorsCompleto(semRemetente, "POST sem remetente");
});

Deno.test("freio: o banco diz 0 segundo -> a tela recebe 0 (só o 'não disse nada' vira 60)", async () => {
  const r = await handler(pedido(), {
    supabase: banco({ ok: false, motivo: "muito_recente", espere_segundos: 0 }),
    resolverRemetente: () => Promise.resolve(REMETENTE),
    enviarEmail: () => Promise.reject(new Error("não deveria enviar")),
  });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: false, motivo: "muito_recente", espereSegundos: 0 });
});

// ── O log nunca leva dado de quem comprou nem o código ──────────────────────

async function comLogs(corpo: () => Promise<unknown>) {
  const saiu: string[] = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  const anota = (...args: unknown[]) =>
    saiu.push(args.map((a) => (a instanceof Error ? a.message : typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
  console.error = anota;
  console.warn = anota;
  console.log = anota;
  try {
    await corpo();
  } finally {
    console.error = originais.error;
    console.warn = originais.warn;
    console.log = originais.log;
  }
  return saiu.join("\n");
}

Deno.test("RPC que falha: o log leva o motivo do banco, mas NÃO o e-mail nem o WhatsApp de quem pediu o código", async () => {
  let resposta!: Response;
  const logs = await comLogs(async () => {
    resposta = await handler(pedido(), {
      supabase: {
        rpc: () => Promise.resolve({ data: null, error: { message: "falha simulada da função" } }),
        from: () => ({ select: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      },
      resolverRemetente: () => Promise.resolve(REMETENTE),
      enviarEmail: () => Promise.reject(new Error("não deveria enviar")),
    });
  });
  assertEquals(resposta.status, 502);
  assert(logs.includes("send-otp-email: RPC falhou: falha simulada da função"), logs);
  for (const dado of ["cliente@exemplo.com", "11999999999", "ABC123"]) {
    assertEquals(logs.includes(dado), false, `o log vazou ${dado}`);
  }
});

Deno.test("e-mail que não sai: o log tem o e-mail MASCARADO e o motivo, mas nunca o código de verificação nem o endereço inteiro", async () => {
  let resposta!: Response;
  const logs = await comLogs(async () => {
    resposta = await handler(pedido(), {
      supabase: banco({ ok: true, email: "cliente@exemplo.com", otp_code: "654321" }),
      resolverRemetente: () => Promise.resolve(REMETENTE),
      enviarEmail: () => Promise.reject(new Error("conexão recusada pelo servidor de e-mail")),
    });
  });
  assertEquals(resposta.status, 502);
  assert(logs.includes("send-otp-email: envio falhou para c***e@exemplo.com: conexão recusada pelo servidor de e-mail"), logs);
  assertEquals(logs.includes("654321"), false, "o código de verificação nunca vai para o log");
  assertEquals(logs.includes("cliente@exemplo.com"), false, "o endereço inteiro nunca vai para o log");
});
