// @ts-nocheck
/**
 * Testes da notify-new-order (PEDIDO-020, #89).
 *
 * Nada aqui toca rede nem banco. O que se prova é a parte que decide SE o aviso
 * sai e O QUE ele diz — que é onde os erros custam caro: aviso com valor errado
 * manda o lojista conferir o pedido errado, e janela mal calculada transforma
 * uma função sem `verify_jwt` em canal de spam.
 *
 * O envio em si já é coberto pelos testes da send-push, que exercitam o mesmo
 * `enviarParaInscritos` de `_shared/webpush.ts` contra um push service local.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  JANELA_MINUTOS,
  dentroDaJanela,
  formatarBRL,
  handler,
  montarAviso,
  numeroDoPedido,
  pareceUuid,
} from "./index.ts";

const UUID_VALIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

Deno.test("aceita UUID e recusa o que não é", () => {
  assert(pareceUuid(UUID_VALIDO));
  assert(pareceUuid(UUID_VALIDO.toUpperCase()));

  for (const ruim of [
    "",
    null,
    undefined,
    42,
    "1; DROP TABLE marketplace_orders",
    "3f2a1b8c4d5e4f609a7b1c2d3e4f5a6b",
    `${UUID_VALIDO} `,
  ]) {
    assertEquals(pareceUuid(ruim), false, `deveria recusar: ${String(ruim)}`);
  }
});

Deno.test("número do pedido são os 6 últimos, em maiúscula", () => {
  assertEquals(numeroDoPedido(UUID_VALIDO), "#4F5A6B");
});

Deno.test("valor sai em pt-BR, com milhar", () => {
  assertEquals(formatarBRL(129.8), "R$ 129,80");
  assertEquals(formatarBRL(1234.5), "R$ 1.234,50");
  assertEquals(formatarBRL(0), "R$ 0,00");
  assertEquals(formatarBRL("59.90"), "R$ 59,90");
});

Deno.test("valor ausente ou inválido não vira NaN na tela do lojista", () => {
  assertEquals(formatarBRL(null), "R$ 0,00");
  assertEquals(formatarBRL(undefined), "R$ 0,00");
  assertEquals(formatarBRL("abacaxi"), "R$ 0,00");
});

Deno.test("o aviso traz os três dados que o critério 2 exige", () => {
  const aviso = montarAviso({
    id: UUID_VALIDO,
    customer_name: "Maria Silva",
    total: 129.8,
    total_amount: null,
    created_at: new Date().toISOString(),
  });

  assertStringIncludes(aviso.body, "#4F5A6B"); // número do pedido
  assertStringIncludes(aviso.body, "R$ 129,80"); // valor
  assertStringIncludes(aviso.body, "Maria Silva"); // nome do cliente
});

Deno.test("usa total, não total_amount — medido: 18 de 64 pedidos têm total_amount NULL", () => {
  const aviso = montarAviso({
    id: UUID_VALIDO,
    customer_name: "João",
    total: 99.9,
    total_amount: 1,
    created_at: new Date().toISOString(),
  });
  assertStringIncludes(aviso.body, "R$ 99,90");
});

Deno.test("cai para total_amount quando total é nulo", () => {
  const aviso = montarAviso({
    id: UUID_VALIDO,
    customer_name: "João",
    total: null,
    total_amount: 42.5,
    created_at: new Date().toISOString(),
  });
  assertStringIncludes(aviso.body, "R$ 42,50");
});

Deno.test("pedido sem nome não vira 'undefined' na notificação", () => {
  for (const nome of [null, undefined, "", "   "]) {
    const aviso = montarAviso({
      id: UUID_VALIDO,
      customer_name: nome,
      total: 10,
      created_at: new Date().toISOString(),
    });
    assertStringIncludes(aviso.body, "cliente sem nome");
    assertEquals(aviso.body.includes("undefined"), false);
  }
});

Deno.test("janela: pedido recente passa, pedido velho não", () => {
  const agora = Date.parse("2026-08-05T12:00:00.000Z");

  const minutosAtras = (m: number) =>
    new Date(agora - m * 60000).toISOString();

  assert(dentroDaJanela(minutosAtras(0), agora), "agora mesmo");
  assert(dentroDaJanela(minutosAtras(1), agora), "1 min");
  assert(
    dentroDaJanela(minutosAtras(JANELA_MINUTOS), agora),
    "exatamente no limite",
  );
  assertEquals(
    dentroDaJanela(minutosAtras(JANELA_MINUTOS + 1), agora),
    false,
    "1 min depois do limite",
  );
  assertEquals(dentroDaJanela(minutosAtras(60 * 24), agora), false, "ontem");
});

Deno.test("janela tolera relógio adiantado, mas não o futuro distante", () => {
  const agora = Date.parse("2026-08-05T12:00:00.000Z");
  const emMinutos = (m: number) => new Date(agora + m * 60000).toISOString();

  assert(dentroDaJanela(emMinutos(1), agora), "1 min no futuro: relógio");
  assertEquals(
    dentroDaJanela(emMinutos(10), agora),
    false,
    "10 min no futuro não é desvio de relógio",
  );
});

Deno.test("data ilegível não passa pela janela", () => {
  assertEquals(dentroDaJanela("nunca", Date.now()), false);
  assertEquals(dentroDaJanela("", Date.now()), false);
});

// ---------------------------------------------------------------------------
// O aviso de pedido novo sai UMA vez por pedido (12/10/2026)
//
// O handler usa a reserva que o webhook e a reconciliação já usam
// (`avisarAdminUmaVez`, `_shared/aviso-ao-lojista.ts`), com a chave
// `pedido_novo:<id>`. O dublê da RPC imita as três funções da migration
// 20261191000000: reservar (INSERT … ON CONFLICT, atômico), confirmar
// (enviado = true) e liberar (apaga a reserva não enviada).
// ---------------------------------------------------------------------------

const AGORA = Date.parse("2026-10-12T12:00:00.000Z");
const PEDIDO_RECENTE = {
  id: UUID_VALIDO,
  customer_name: "Maria Silva",
  total: 129.8,
  total_amount: null,
  created_at: new Date(AGORA - 2 * 60000).toISOString(),
};
const OUTRO_PEDIDO = {
  ...PEDIDO_RECENTE,
  id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  customer_name: "João",
};

type Avisos = Map<string, { enviado: boolean }>;

function bancoDoAviso(opts: {
  pedidos?: any[];
  avisos?: Avisos;
  rpcComErro?: boolean;
} = {}) {
  const avisos: Avisos = opts.avisos ?? new Map();
  const pedidos = opts.pedidos ?? [PEDIDO_RECENTE];
  const rpcs: Array<{ nome: string; chave: string }> = [];
  const leiturasDePedido: string[] = [];
  const cliente = {
    from: (tabela: string) => {
      let id: unknown = null;
      const b: any = {
        select: () => b,
        eq: (_coluna: string, valor: unknown) => {
          id = valor;
          return b;
        },
        maybeSingle: () => {
          leiturasDePedido.push(String(id));
          if (tabela !== "marketplace_orders") {
            return Promise.resolve({ data: null, error: { message: `tabela inesperada ${tabela}` } });
          }
          return Promise.resolve({ data: pedidos.find((p) => p.id === id) ?? null, error: null });
        },
      };
      return b;
    },
    rpc: async (nome: string, args: { p_chave: string }) => {
      const chave = args.p_chave;
      rpcs.push({ nome, chave });
      if (opts.rpcComErro) {
        await Promise.resolve();
        return { data: null, error: { message: "function reservar_aviso_ao_lojista does not exist" } };
      }
      // O efeito é aplicado NO INSTANTE da chamada (como a linha do Postgres)
      // e a resposta volta depois de um tique — é isso que deixa duas
      // chamadas em `Promise.all` se cruzarem de verdade.
      let data: unknown = null;
      if (nome === "reservar_aviso_ao_lojista") {
        const linha = avisos.get(chave);
        if (!linha) {
          avisos.set(chave, { enviado: false });
          data = "reservado";
        } else {
          data = linha.enviado ? "enviado" : "em_envio";
        }
      } else if (nome === "confirmar_aviso_ao_lojista") {
        const linha = avisos.get(chave);
        if (linha) linha.enviado = true;
        data = !!linha;
      } else if (nome === "liberar_aviso_ao_lojista") {
        const linha = avisos.get(chave);
        if (linha && !linha.enviado) avisos.delete(chave);
        data = !!linha;
      }
      await new Promise((r) => setTimeout(r, 1));
      return { data, error: null };
    },
  };
  return { cliente, avisos, rpcs, leiturasDePedido };
}

function pushContado(entregues = 1, demoraMs = 5) {
  const avisos: any[] = [];
  const fn = async (a: { aviso: any }) => {
    avisos.push(a.aviso);
    await new Promise((r) => setTimeout(r, demoraMs));
    return entregues;
  };
  return { fn, avisos };
}

function pedirAviso(orderId: unknown) {
  return new Request("http://local/notify-new-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
}

async function avisar(
  orderId: unknown,
  banco: ReturnType<typeof bancoDoAviso>,
  push: ReturnType<typeof pushContado>,
) {
  const resposta = await handler(pedirAviso(orderId), {
    supabase: banco.cliente,
    enviarPushContado: push.fn,
    agora: () => AGORA,
  });
  return { resposta, corpo: await resposta.json() };
}

Deno.test("aviso: duas chamadas seguidas do MESMO pedido mandam UM push", async () => {
  const banco = bancoDoAviso();
  const push = pushContado();
  const primeira = await avisar(UUID_VALIDO, banco, push);
  const segunda = await avisar(UUID_VALIDO, banco, push);
  assertEquals(push.avisos.length, 1);
  assertEquals(primeira.resposta.status, 200);
  assertEquals(primeira.corpo, { ok: true });
  assertEquals(segunda.resposta.status, 200);
  assertEquals(banco.avisos.get(`pedido_novo:${UUID_VALIDO}`), { enviado: true });
});

Deno.test("aviso: duas chamadas AO MESMO TEMPO do mesmo pedido mandam UM push", async () => {
  const banco = bancoDoAviso();
  const push = pushContado(1, 20);
  await Promise.all([avisar(UUID_VALIDO, banco, push), avisar(UUID_VALIDO, banco, push)]);
  assertEquals(push.avisos.length, 1);
  assertEquals(banco.avisos.get(`pedido_novo:${UUID_VALIDO}`), { enviado: true });
});

Deno.test("aviso: push que não chegou a ninguém libera a reserva e a chamada seguinte tenta de novo", async () => {
  const banco = bancoDoAviso();
  const push = pushContado(0);
  await avisar(UUID_VALIDO, banco, push);
  assertEquals(
    banco.rpcs.map((r) => r.nome),
    ["reservar_aviso_ao_lojista", "liberar_aviso_ao_lojista"],
  );
  assertEquals(banco.avisos.has(`pedido_novo:${UUID_VALIDO}`), false);
  await avisar(UUID_VALIDO, banco, push);
  assertEquals(push.avisos.length, 2);
});

Deno.test("aviso: a reserva falhou -> o push sai mesmo assim (falha aberta, a mesma de antes da reserva)", async () => {
  const banco = bancoDoAviso({ rpcComErro: true });
  const push = pushContado();
  const r = await avisar(UUID_VALIDO, banco, push);
  assertEquals(r.resposta.status, 200);
  assertEquals(push.avisos.length, 1);
});

Deno.test("aviso: pedido fora da janela -> nenhuma reserva e nenhum push", async () => {
  const velho = { ...PEDIDO_RECENTE, created_at: new Date(AGORA - (JANELA_MINUTOS + 1) * 60000).toISOString() };
  const banco = bancoDoAviso({ pedidos: [velho] });
  const push = pushContado();
  const r = await avisar(UUID_VALIDO, banco, push);
  assertEquals(r.corpo, { ok: false, ignorado: "pedido fora da janela" });
  assertEquals(banco.rpcs.length, 0);
  assertEquals(push.avisos.length, 0);
});

Deno.test("aviso: pedido inexistente -> 200 ignorado, nenhuma reserva e nenhum push", async () => {
  const banco = bancoDoAviso({ pedidos: [] });
  const push = pushContado();
  const r = await avisar(UUID_VALIDO, banco, push);
  assertEquals(r.resposta.status, 200);
  assertEquals(r.corpo, { ok: false, ignorado: "pedido não encontrado" });
  assertEquals(banco.rpcs.length, 0);
  assertEquals(push.avisos.length, 0);
});

Deno.test("aviso: id fora do formato UUID -> 400 sem tocar o banco", async () => {
  const banco = bancoDoAviso();
  const push = pushContado();
  const r = await avisar("p1", banco, push);
  assertEquals(r.resposta.status, 400);
  assertEquals(banco.leiturasDePedido.length, 0);
  assertEquals(banco.rpcs.length, 0);
  assertEquals(push.avisos.length, 0);
});

Deno.test("aviso: dois pedidos DIFERENTES ganham um aviso cada (a chave leva o id do pedido)", async () => {
  const banco = bancoDoAviso({ pedidos: [PEDIDO_RECENTE, OUTRO_PEDIDO] });
  const push = pushContado();
  await avisar(UUID_VALIDO, banco, push);
  await avisar(OUTRO_PEDIDO.id, banco, push);
  await avisar(OUTRO_PEDIDO.id, banco, push);
  assertEquals(push.avisos.length, 2);
  assertEquals(
    [...banco.avisos.keys()].sort(),
    [`pedido_novo:${OUTRO_PEDIDO.id}`, `pedido_novo:${UUID_VALIDO}`].sort(),
  );
});

Deno.test("aviso: o push leva o texto montado do BANCO e a resposta não expõe contagem de inscrições", async () => {
  const banco = bancoDoAviso();
  const push = pushContado();
  const r = await avisar(UUID_VALIDO, banco, push);
  assertEquals(push.avisos[0], montarAviso(PEDIDO_RECENTE));
  assertEquals("total" in r.corpo, false);
  assertEquals("enviados" in r.corpo, false);
});
