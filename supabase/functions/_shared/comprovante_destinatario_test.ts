import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { enviarComprovantePedido } from "./comprovante.ts";

/**
 * PARA QUEM o comprovante vai — e de quem e' o endereco que ele mostra.
 *
 * O pedido de quem tem conta nasce SEM e-mail dentro dele: o destinatario sai de
 * `auth.admin.getUserById(pedido.user_id)`, e o endereco (quando o pedido nao
 * guarda a copia) de `user_addresses` filtrado por `pedido.address_id`. Se
 * qualquer um desses ids fosse outro (`pedido.id`, `orderId`), o resumo da compra
 * (itens, total, endereco) iria para a caixa de OUTRA pessoa.
 *
 * Os testes vizinhos (`comprovante_test.ts`) nao pegam isso: o `getUserById` de
 * la ignora o id recebido e o `.eq("id", ...)` de `user_addresses` ignora o valor,
 * entao trocar o id deixa tudo verde. Aqui os dubles HONRAM o id: cada id devolve
 * a pessoa/o endereco DELE, o id recebido e' REGISTRADO e o `para`/o endereco do
 * e-mail sao afirmados contra o dono do pedido.
 *
 * Os helpers do vizinho (`clienteFalso`) nao sao exportados; o minimo que este
 * arquivo precisa foi reescrito abaixo, sem mexer nele.
 *
 * Dados inventados: e-mails `@exemplo.com`, UUIDs fictícios.
 */

const REMETENTE_DE_TESTE = {
  origem: "ambiente",
  usuario: "loja@exemplo.com",
  senha: "senha-de-teste",
  motivo: null,
  reserva: null,
};

// Tres pessoas e dois pedidos, todos com ids DIFERENTES entre si: nenhum campo
// pode ser confundido com outro por coincidencia de valor.
const PEDIDO_A = "d77c6616-c389-4caa-b5c1-9a8d7af77f72";
const PEDIDO_B = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const USUARIO_A = "11111111-2222-4333-8444-555555555555";
const USUARIO_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const ENDERECO_A = "aaaaaaaa-1111-4222-8333-444444444444";
const ENDERECO_B = "bbbbbbbb-1111-4222-8333-444444444444";

const EMAIL_DO_USUARIO_A = "dona-a@exemplo.com";
const EMAIL_DO_USUARIO_B = "dono-b@exemplo.com";
// Quem estiver na tabela de contas sob o id do PEDIDO ou do ENDERECO (id errado)
// receberia o resumo de uma terceira pessoa: o duble devolve um e-mail proprio
// para esses ids, para o erro aparecer no `para` e nao como "sem e-mail".
const EMAIL_DE_ID_ERRADO = "id-errado@exemplo.com";

const ENDERECOS: Record<string, Record<string, unknown>> = {
  [ENDERECO_A]: {
    street: "Rua Fixture da Dona A",
    number: "10",
    complement: "",
    neighborhood: "Centro A",
    city: "Cidade A",
    state: "AA",
    cep: "11111111",
  },
  [ENDERECO_B]: {
    street: "Rua Fixture do Dono B",
    number: "20",
    complement: "",
    neighborhood: "Centro B",
    city: "Cidade B",
    state: "BB",
    cep: "22222222",
  },
};

// Pedido de quem tem conta: sem e-mail em `customer_data` e sem copia do endereco
// (pedido anterior a migration 20261229000000) — os dois caminhos que dependem de id.
function pedido(id: string, userId: string, addressId: string | null) {
  return {
    id,
    user_id: userId,
    address_id: addressId,
    customer_data: {},
    subtotal: 100,
    total: 100,
    payment_method: "online",
    payment_status: "pago",
  };
}

type Contas = Record<string, { email: string | null }>;

function bancoFalso(opts: {
  pedidos: Array<Record<string, unknown>>;
  contas: Contas;
}) {
  const idsDeConta: string[] = [];
  const idsDeEndereco: string[] = [];
  const idsDePedido: string[] = [];
  const supabase = {
    rpc: async (nome: string) => ({
      data: nome === "reivindicar_email_de_confirmacao" ? true : null,
      error: null,
    }),
    from(tabela: string) {
      return {
        select(_colunas: string) {
          return {
            eq(_coluna: string, valor: unknown) {
              let resultado: { data: unknown; error: unknown };
              if (tabela === "marketplace_orders") {
                idsDePedido.push(String(valor));
                resultado = {
                  data: opts.pedidos.find((p) => p.id === valor) ?? null,
                  error: null,
                };
              } else if (tabela === "user_addresses") {
                idsDeEndereco.push(String(valor));
                resultado = { data: ENDERECOS[String(valor)] ?? null, error: null };
              } else {
                // itens do pedido e qualquer outra tabela: vazio
                resultado = { data: [], error: null };
              }
              return {
                maybeSingle: async () => resultado,
                then: (resolve: (v: unknown) => void) => resolve(resultado),
              };
            },
            in: () => Promise.resolve({ data: [], error: null }),
            limit: () => ({
              maybeSingle: async () => ({ data: { store_name: "Loja Fixture" }, error: null }),
            }),
          };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          idsDeConta.push(id);
          if (id in opts.contas) {
            // eslint-disable-next-line security/detect-object-injection -- fixture de teste: coluna/id vem do proprio teste
            return { data: { user: { email: opts.contas[id].email } }, error: null };
          }
          // id que nao e' de nenhuma conta real (ex.: id de pedido): e-mail de
          // "terceiro" — se o codigo consultar o id errado, o `para` denuncia.
          return { data: { user: { email: EMAIL_DE_ID_ERRADO } }, error: null };
        },
      },
    },
  };
  return { supabase, idsDeConta, idsDeEndereco, idsDePedido };
}

async function enviar(banco: ReturnType<typeof bancoFalso>, orderId: string) {
  const envios: Array<{ para: string; html: string }> = [];
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  let desfecho;
  try {
    desfecho = await enviarComprovantePedido({
      supabase: banco.supabase as never,
      orderId,
      deps: {
        resolverRemetente: async () => REMETENTE_DE_TESTE,
        enviarEmail: async (args) => {
          envios.push({ para: args.para, html: args.html });
        },
      },
    });
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
  return { desfecho, envios };
}

const CONTAS: Contas = {
  [USUARIO_A]: { email: EMAIL_DO_USUARIO_A },
  [USUARIO_B]: { email: EMAIL_DO_USUARIO_B },
};

Deno.test("destinatario: a conta consultada e' a do user_id DO PEDIDO, e o comprovante vai para o e-mail dela (nunca o de outro)", async () => {
  const banco = bancoFalso({
    pedidos: [pedido(PEDIDO_A, USUARIO_A, null), pedido(PEDIDO_B, USUARIO_B, null)],
    contas: CONTAS,
  });
  const r = await enviar(banco, PEDIDO_A);
  assertEquals(r.desfecho, { ok: true });
  assertEquals(banco.idsDeConta, [USUARIO_A], "getUserById tem de receber o user_id do pedido, e so' ele");
  assertEquals(r.envios.length, 1);
  assertEquals(r.envios[0].para, EMAIL_DO_USUARIO_A);
});

Deno.test("destinatario: dois pedidos, duas contas -> cada comprovante vai para o dono do SEU pedido", async () => {
  const banco = bancoFalso({
    pedidos: [pedido(PEDIDO_A, USUARIO_A, null), pedido(PEDIDO_B, USUARIO_B, null)],
    contas: CONTAS,
  });
  const a = await enviar(banco, PEDIDO_A);
  const b = await enviar(banco, PEDIDO_B);
  assertEquals(a.envios.map((x) => x.para), [EMAIL_DO_USUARIO_A]);
  assertEquals(b.envios.map((x) => x.para), [EMAIL_DO_USUARIO_B]);
  assertEquals(banco.idsDeConta, [USUARIO_A, USUARIO_B]);
});

Deno.test("destinatario: a conta do dono nao tem e-mail -> sem_destinatario; NAO cai no e-mail de outra conta e nao envia nada", async () => {
  const banco = bancoFalso({
    pedidos: [pedido(PEDIDO_A, USUARIO_A, null), pedido(PEDIDO_B, USUARIO_B, null)],
    contas: { ...CONTAS, [USUARIO_A]: { email: null } },
  });
  const r = await enviar(banco, PEDIDO_A);
  assertEquals(r.desfecho, { ok: false, motivo: "sem_destinatario" });
  assertEquals(r.envios.length, 0);
  assertEquals(banco.idsDeConta, [USUARIO_A]);
});

Deno.test("endereco: a linha lida de user_addresses e' a do address_id DO PEDIDO, e e' ela que aparece no e-mail", async () => {
  const banco = bancoFalso({
    pedidos: [pedido(PEDIDO_A, USUARIO_A, ENDERECO_A), pedido(PEDIDO_B, USUARIO_B, ENDERECO_B)],
    contas: CONTAS,
  });
  const r = await enviar(banco, PEDIDO_A);
  assertEquals(r.desfecho, { ok: true });
  assertEquals(banco.idsDeEndereco, [ENDERECO_A], ".eq('id', ...) de user_addresses tem de receber o address_id do pedido");
  assertEquals(r.envios.length, 1);
  assertStringIncludes(r.envios[0].html, "Rua Fixture da Dona A");
  assertEquals(r.envios[0].html.includes("Rua Fixture do Dono B"), false, "o endereco de OUTRO pedido apareceu no e-mail");
});

Deno.test("endereco: o pedido B mostra o endereco de B (a escolha segue o pedido, nao a ordem das linhas)", async () => {
  const banco = bancoFalso({
    pedidos: [pedido(PEDIDO_A, USUARIO_A, ENDERECO_A), pedido(PEDIDO_B, USUARIO_B, ENDERECO_B)],
    contas: CONTAS,
  });
  const r = await enviar(banco, PEDIDO_B);
  assertEquals(banco.idsDeEndereco, [ENDERECO_B]);
  assertStringIncludes(r.envios[0].html, "Rua Fixture do Dono B");
  assertEquals(r.envios[0].html.includes("Rua Fixture da Dona A"), false);
});
