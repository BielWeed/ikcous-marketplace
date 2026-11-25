// @ts-nocheck
/**
 * send-otp-email — o que a suíte principal deixava passar
 * (caça por mutação "só testes", 25/11/2026).
 *
 * Nada aqui toca rede, banco ou SMTP, e NENHUM teste dorme de verdade: o
 * prazo do banco (700 ms) é medido com relógio falso.
 *
 *  - nome da loja no assunto: caractere de controle no meio, DEL, espaços nas
 *    pontas, nome em branco, coluna que não é texto, erro do banco com dado
 *    parcial, e o prazo exato do banco;
 *  - a resposta da função carrega CORS e JSON (a tela é de outro domínio);
 *  - pré-voo OPTIONS e corpo que não é JSON;
 *  - o freio: quantos segundos esperar quando o banco não diz, e em número
 *    quando ele diz em texto;
 *  - o e-mail mascarado no log tem 3 letras.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { FakeTime } from "https://deno.land/std@0.177.0/testing/time.ts";
import { handler, mascarar, montarResposta, nomeDaLoja } from "./index.ts";

const REMETENTE = {
  origem: "ambiente",
  usuario: "ambiente@exemplo.com",
  senha: "senha-do-ambiente",
  motivo: "sem_registro",
  reserva: null,
};
const CODIGO = { ok: true, email: "cliente@exemplo.com", otp_code: "654321" };

function pedido(corpo: BodyInit | null = JSON.stringify({
  email: "cliente@exemplo.com",
  whatsapp: "11999999999",
  orderFragment: "ABC123",
})) {
  return new Request("http://local/send-otp-email", { method: "POST", body: corpo });
}

/** Banco cuja leitura de store_config devolve exatamente `resposta`. */
function bancoDaLoja(resposta: unknown, rpc: unknown = CODIGO) {
  return {
    rpc: () => Promise.resolve({ data: rpc, error: null }),
    from: () => ({
      select: () => ({
        limit: () => ({ maybeSingle: () => Promise.resolve(resposta) }),
      }),
    }),
  };
}

async function assuntoCom(storeName: unknown, erro: unknown = null) {
  const enviados: any[] = [];
  const r = await handler(pedido(), {
    supabase: bancoDaLoja({ data: { store_name: storeName }, error: erro }),
    resolverRemetente: () => Promise.resolve(REMETENTE),
    enviarEmail: (m: unknown) => {
      enviados.push(m);
      return Promise.resolve();
    },
  });
  assertEquals(r.status, 200);
  return enviados[0].assunto as string;
}

// ── Nome da loja ──────────────────────────────────────────────────────────

Deno.test("nome da loja: DEL (127) e caractere de controle viram espaço; espaços e quebras nas pontas somem", async () => {
  assertEquals(await assuntoCom("Loja\u007fBela"), "Seu código de verificação — Loja Bela");
  assertEquals(await assuntoCom("\t Loja da Ana \n"), "Seu código de verificação — Loja da Ana");
  assertEquals(await assuntoCom("\u007fLoja\u007f"), "Seu código de verificação — Loja");
});

Deno.test("nome da loja em branco, vazio ou que não é texto: cai em 'Nossa loja' (o código sai mesmo assim)", async () => {
  for (const ruim of ["", "   ", "\t\n", "\u007f", ["Loja", "X"], { length: 2, 0: "a", 1: "b" }, 42, null]) {
    assertEquals(
      await assuntoCom(ruim),
      "Seu código de verificação — Nossa loja",
      `store_name ${JSON.stringify(ruim)}`,
    );
  }
});

Deno.test("nome da loja: erro do banco manda 'Nossa loja' mesmo que venha dado parcial junto", async () => {
  assertEquals(
    await assuntoCom("Nome Parcial", { message: "falha" }),
    "Seu código de verificação — Nossa loja",
  );
});

Deno.test("nome da loja: o banco tem EXATOS 700 ms — antes disso o nome vale, depois cai em 'Nossa loja' (relógio falso, sem dormir)", async () => {
  const tempo = new FakeTime();
  try {
    const nuncaResponde = {
      from: () => ({
        select: () => ({
          limit: () => ({ maybeSingle: () => new Promise(() => {}) }),
        }),
      }),
    };
    let nome: string | null = null;
    nomeDaLoja(nuncaResponde).then((n: string) => {
      nome = n;
    });
    await tempo.tickAsync(699);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assertEquals(nome, null, "aos 699 ms ainda se espera o banco");
    await tempo.tickAsync(1);
    // a rejeição do prazo atravessa algumas trocas de promessa até o `catch`
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assertEquals(nome, "Nossa loja", "aos 700 ms desiste do nome");
  } finally {
    tempo.restore();
  }
});

// ── Resposta: CORS e JSON ─────────────────────────────────────────────────

Deno.test("resposta da função: JSON e CORS liberado (a tela fala de outro domínio)", () => {
  for (const desfecho of [{ ok: true }, { ok: false, motivo: "nao_confere" }, { ok: false, motivo: "envio_falhou" }]) {
    const r = montarResposta(desfecho);
    assertEquals(r.headers.get("Content-Type"), "application/json");
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
    assert(r.headers.get("Access-Control-Allow-Headers")?.includes("authorization"));
  }
});

Deno.test("pré-voo OPTIONS: ok com CORS, sem resolver remetente, sem RPC, sem e-mail", async () => {
  let chamadas = 0;
  const conta = () => {
    chamadas++;
    return Promise.resolve(REMETENTE);
  };
  const r = await handler(new Request("http://local/send-otp-email", { method: "OPTIONS" }), {
    supabase: { rpc: conta, from: conta },
    resolverRemetente: conta,
    enviarEmail: conta,
  });
  assertEquals(r.status, 200);
  assertEquals(await r.text(), "ok");
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(chamadas, 0);
});

Deno.test("corpo que não é JSON: 400 pedido_invalido, nada é resolvido nem gravado", async () => {
  for (const corpo of ["isto nao e json", "", "{email:"]) {
    let chamadas = 0;
    const conta = () => {
      chamadas++;
      return Promise.resolve(REMETENTE);
    };
    const r = await handler(pedido(corpo), {
      supabase: { rpc: conta, from: conta },
      resolverRemetente: conta,
      enviarEmail: conta,
    });
    assertEquals(r.status, 400, JSON.stringify(corpo));
    assertEquals((await r.json()).motivo, "pedido_invalido");
    assertEquals(chamadas, 0);
  }
});

// ── O freio de 60 segundos ────────────────────────────────────────────────

Deno.test("freio: o banco não diz quanto esperar -> 60; diz em texto -> vira número", async () => {
  const semNumero = await handler(pedido(), {
    supabase: bancoDaLoja(null, { ok: false, motivo: "muito_recente" }),
    resolverRemetente: () => Promise.resolve(REMETENTE),
    enviarEmail: () => Promise.reject(new Error("não deveria enviar")),
  });
  assertEquals(await semNumero.json(), { ok: false, motivo: "muito_recente", espereSegundos: 60 });

  const emTexto = await handler(pedido(), {
    supabase: bancoDaLoja(null, { ok: false, motivo: "muito_recente", espere_segundos: "42" }),
    resolverRemetente: () => Promise.resolve(REMETENTE),
    enviarEmail: () => Promise.reject(new Error("não deveria enviar")),
  });
  const corpo = await emTexto.json();
  assertEquals(corpo.espereSegundos, 42);
  assertEquals(typeof corpo.espereSegundos, "number");
});

// ── Máscara do e-mail no log ──────────────────────────────────────────────

Deno.test("mascarar: usuário de EXATAMENTE 3 letras mostra a primeira e a última", () => {
  assertEquals(mascarar("ana@teste.com"), "a***a@teste.com");
  assertEquals(mascarar("abc@x.com"), "a***c@x.com");
  assertEquals(mascarar("ab@x.com"), "***@x.com");
});
