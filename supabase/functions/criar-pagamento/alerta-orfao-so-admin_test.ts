// @ts-nocheck
/**
 * O aviso de cartão órfão (dinheiro cobrado no Mercado Pago sem linha no banco)
 * é para o ADMIN e só para ele. Os dois filtros que garantem isso moram em
 * `alertarAdminCartaoOrfaoReal`: `.eq("role", "admin")` em `profiles` e
 * `.in("user_id", ids)` em `push_subscriptions`. Se um deles sumir, o aviso
 * "Cobrança de cartão sem registro" (com o número do pedido) chega ao celular
 * de CLIENTES.
 *
 * O banco falso de `alerta-orfao_test.ts` ignora os argumentos de `eq`/`in`,
 * então apagar qualquer um dos dois filtros não derruba teste nenhum. Este
 * arquivo tem um banco falso que APLICA os filtros: só devolve as linhas que
 * casam com o que a function pediu. Sem o filtro, o falso devolve tudo —
 * exatamente o que o PostgREST faria.
 *
 * Dados inventados: UUIDs fictícios, endpoints de um push service local.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { inscricaoDeTeste, parVapidDeTeste, pushServiceFalso } from "../_shared/webpush_fixtures.ts";
import { alertarAdminCartaoOrfaoReal } from "./index.ts";

const ID_ADMIN = "00000000-0000-4000-8000-0000000000a1";
const ID_CLIENTE_1 = "00000000-0000-4000-8000-0000000000c1";
const ID_CLIENTE_2 = "00000000-0000-4000-8000-0000000000c2";

type Perfil = { id: string; role: string };
type Inscricao = { user_id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Query builder que se comporta como o PostgREST: acumula `eq`/`in`, e ao ser
 * aguardado (thenable) devolve só as linhas que passam em TODOS os filtros
 * acumulados, projetadas nas colunas do `select`. Sem filtro, devolve tudo.
 */
function bancoQueAplicaFiltros(perfis: Perfil[], inscricoes: Inscricao[]) {
  const chamadas = {
    eq: [] as { tabela: string; coluna: string; valor: unknown }[],
    in: [] as { tabela: string; coluna: string; valores: unknown[] }[],
    apagados: [] as string[],
  };

  function consulta(tabela: string, linhas: Record<string, unknown>[], colunas: string[]) {
    const filtros: ((l: Record<string, unknown>) => boolean)[] = [];
    const q = {
      eq(coluna: string, valor: unknown) {
        chamadas.eq.push({ tabela, coluna, valor });
        // eslint-disable-next-line security/detect-object-injection -- fixture de teste: coluna/id vem do proprio teste
        filtros.push((l) => l[coluna] === valor);
        return q;
      },
      in(coluna: string, valores: unknown[]) {
        chamadas.in.push({ tabela, coluna, valores });
        // eslint-disable-next-line security/detect-object-injection -- fixture de teste: coluna/id vem do proprio teste
        filtros.push((l) => valores.includes(l[coluna]));
        return q;
      },
      then(resolve: (r: unknown) => unknown, rejeita?: (e: unknown) => unknown) {
        const data = linhas
          .filter((l) => filtros.every((f) => f(l)))
        // eslint-disable-next-line security/detect-object-injection -- fixture de teste: coluna/id vem do proprio teste
          .map((l) => Object.fromEntries(colunas.map((c) => [c, l[c]])));
        return Promise.resolve({ data, error: null }).then(resolve, rejeita);
      },
    };
    return q;
  }

  const supabase = {
    from(tabela: string) {
      return {
        select(colunas: string) {
          const cols = colunas.split(",").map((c) => c.trim());
          if (tabela === "profiles") return consulta(tabela, perfis, cols);
          if (tabela === "push_subscriptions") return consulta(tabela, inscricoes, cols);
          throw new Error(`tabela inesperada no teste: ${tabela}`);
        },
        delete() {
          return {
            eq(coluna: string, valor: string) {
              chamadas.apagados.push(`${tabela}:${coluna}=${valor}`);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { supabase, chamadas };
}

async function comVapidEPushService<T>(
  statusPorCaminho: Record<string, number>,
  corpo: (service: ReturnType<typeof pushServiceFalso>) => Promise<T>,
): Promise<T> {
  const service = pushServiceFalso(statusPorCaminho);
  const par = await parVapidDeTeste();
  const anteriores = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].map((n) => [n, Deno.env.get(n)]);
  Deno.env.set("VAPID_PUBLIC_KEY", par.publica);
  Deno.env.set("VAPID_PRIVATE_KEY", par.privada);
  try {
    return await corpo(service);
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
    await service.encerrar();
  }
}

async function inscricaoDe(userId: string, base: string, caminho: string): Promise<Inscricao> {
  return { user_id: userId, ...(await inscricaoDeTeste(`${base}${caminho}`)) };
}

const ARGS = {
  orderId: "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  idOrderOrfa: "ORD01JABCDEFGHJKMNPQRSTVWXYZ",
};

const PERFIS: Perfil[] = [
  { id: ID_ADMIN, role: "admin" },
  { id: ID_CLIENTE_1, role: "customer" },
  { id: ID_CLIENTE_2, role: "customer" },
];

Deno.test("cartão órfão: o filtro de profiles chega com role='admin' e o push só sai para o endpoint do admin", async () => {
  await comVapidEPushService({}, async (service) => {
    const inscricoes = [
      await inscricaoDe(ID_ADMIN, service.base, "/p/admin"),
      await inscricaoDe(ID_CLIENTE_1, service.base, "/p/cliente-1"),
      await inscricaoDe(ID_CLIENTE_2, service.base, "/p/cliente-2"),
    ];
    const { supabase, chamadas } = bancoQueAplicaFiltros(PERFIS, inscricoes);

    await alertarAdminCartaoOrfaoReal({ supabase, ...ARGS });

    // (a) o filtro de profiles chegou com role = admin
    assertEquals(
      chamadas.eq.filter((c) => c.tabela === "profiles"),
      [{ tabela: "profiles", coluna: "role", valor: "admin" }],
    );
    // o filtro de inscrições chegou só com o id do admin
    assertEquals(
      chamadas.in.filter((c) => c.tabela === "push_subscriptions"),
      [{ tabela: "push_subscriptions", coluna: "user_id", valores: [ID_ADMIN] }],
    );
    // (b) o push saiu para o admin e para MAIS NINGUÉM
    assertEquals(service.recebidas.map((r) => r.caminho), ["/p/admin"]);
    assertEquals(service.recebidas[0].headers.get("urgency"), "high");
  });
});

Deno.test("cartão órfão: aoDetectarMorta só apaga inscrição do admin (cliente nem é tocado)", async () => {
  // O admin tem um aparelho vivo e um morto (410). Os clientes têm um morto cada:
  // se o filtro vazasse, o envio a eles daria 410 e a function APAGARIA a
  // inscrição de cliente — dado de outra pessoa.
  await comVapidEPushService(
    { "/p/admin-morto": 410, "/p/cliente-1-morto": 410, "/p/cliente-2-morto": 410 },
    async (service) => {
      const inscricoes = [
        await inscricaoDe(ID_ADMIN, service.base, "/p/admin-vivo"),
        await inscricaoDe(ID_ADMIN, service.base, "/p/admin-morto"),
        await inscricaoDe(ID_CLIENTE_1, service.base, "/p/cliente-1-morto"),
        await inscricaoDe(ID_CLIENTE_2, service.base, "/p/cliente-2-morto"),
      ];
      const { supabase, chamadas } = bancoQueAplicaFiltros(PERFIS, inscricoes);

      await alertarAdminCartaoOrfaoReal({ supabase, ...ARGS });

      assertEquals(
        service.recebidas.map((r) => r.caminho).sort(),
        ["/p/admin-morto", "/p/admin-vivo"],
      );
      // (c) só a inscrição morta DO ADMIN foi apagada
      assertEquals(chamadas.apagados, [`push_subscriptions:endpoint=${service.base}/p/admin-morto`]);
      assert(
        !chamadas.apagados.some((a) => a.includes("cliente")),
        "nenhuma inscrição de cliente pode ser apagada pelo aviso ao admin",
      );
    },
  );
});

Deno.test("cartão órfão: sem admin cadastrado, zero envios (clientes inscritos não recebem nada)", async () => {
  await comVapidEPushService({}, async (service) => {
    const inscricoes = [
      await inscricaoDe(ID_CLIENTE_1, service.base, "/p/cliente-1"),
      await inscricaoDe(ID_CLIENTE_2, service.base, "/p/cliente-2"),
    ];
    const soClientes = PERFIS.filter((p) => p.role !== "admin");
    const { supabase, chamadas } = bancoQueAplicaFiltros(soClientes, inscricoes);

    await alertarAdminCartaoOrfaoReal({ supabase, ...ARGS });

    assertEquals(service.recebidas.length, 0);
    assertEquals(chamadas.apagados, []);
    // nem chegou a consultar inscrições: sem admin, a function para antes
    assertEquals(chamadas.in, []);
  });
});

Deno.test("cartão órfão: admin sem nenhum aparelho inscrito, zero envios mesmo com clientes inscritos", async () => {
  await comVapidEPushService({}, async (service) => {
    const inscricoes = [
      await inscricaoDe(ID_CLIENTE_1, service.base, "/p/cliente-1"),
      await inscricaoDe(ID_CLIENTE_2, service.base, "/p/cliente-2"),
    ];
    const { supabase } = bancoQueAplicaFiltros(PERFIS, inscricoes);

    await alertarAdminCartaoOrfaoReal({ supabase, ...ARGS });

    assertEquals(service.recebidas.length, 0);
  });
});
