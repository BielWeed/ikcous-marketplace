// Assinatura real com segredo fictício; banco e SMTP usam os dublês vizinhos.
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.1.1?target=deno";
import {
  AMBIENTE_HOOK,
  payload,
  requisicaoAssinada,
} from "../_shared/auth-email_fixtures.ts";
import {
  AMBIENTE_COMPLETO,
  bancoFalso,
  capturandoLogs,
  env,
} from "../_shared/email-da-loja_fixtures.ts";
import { handler } from "./index.ts";

const FALHA = {
  error: {
    http_code: 500,
    message:
      "Não foi possível enviar o e-mail agora. Tente de novo em instantes.",
  },
};

function cenario() {
  const banco = bancoFalso();
  const chamadas = {
    clientes: 0,
    consultas: [] as string[],
    carregamentosSmtp: 0,
    transportes: 0,
    enviados: [] as unknown[],
  };
  const cliente = {
    from(tabela: string) {
      chamadas.consultas.push(tabela);
      if (tabela !== "store_config") return banco.from(tabela);
      return {
        select: (colunas: string) => {
          assertEquals(colunas, "store_name");
          return {
            limit: (quantidade: number) => {
              assertEquals(quantidade, 1);
              return {
                maybeSingle: async () => ({
                  data: { store_name: "Loja fictícia" },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  return {
    banco,
    chamadas,
    deps: {
      env: env({ ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO }),
      criarCliente: () => {
        chamadas.clientes++;
        return cliente;
      },
      smtp: {
        carregarNodemailer: async () => {
          chamadas.carregamentosSmtp++;
          return {
            default: {
              createTransport() {
                chamadas.transportes++;
                return {
                  sendMail(mensagem: unknown) {
                    chamadas.enviados.push(mensagem);
                    return Promise.resolve({
                      accepted: ["cliente@example.com"],
                      rejected: [],
                    });
                  },
                  close() {},
                };
              },
            },
          };
        },
      },
    },
  };
}

function exigirSemEfeitos(s: ReturnType<typeof cenario>) {
  assertEquals(s.chamadas, {
    clientes: 0,
    consultas: [],
    carregamentosSmtp: 0,
    transportes: 0,
    enviados: [],
  });
  assertEquals(s.banco.estado.leituras, []);
  assertEquals(s.banco.estado.escritas, []);
}

async function exigirEnvio(req: Request) {
  const s = cenario();
  const r = await handler(req, s.deps);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), {});
  assertEquals(s.chamadas.clientes, 1);
  assertEquals(s.chamadas.consultas.includes("store_config"), true);
  assertEquals(s.banco.estado.leituras, ["email_da_loja"]);
  assertEquals(s.chamadas.carregamentosSmtp, 1);
  assertEquals(s.chamadas.transportes, 1);
  assertEquals(s.chamadas.enviados.length, 1);
}

for (const metodo of ["GET", "PUT"]) {
  Deno.test(`hook recusa ${metodo} com corpo assinado antes do banco e SMTP`, async () => {
    await exigirEnvio(requisicaoAssinada());
    const assinada = requisicaoAssinada();
    // Fetch proíbe construir GET com body. Preserva corpo/assinatura reais e
    // expõe apenas o método ao handler; text() continua sendo o nativo.
    const req = metodo === "GET"
      ? Object.defineProperty(assinada, "method", { value: metodo })
      : new Request(assinada, { method: metodo });
    const s = cenario();
    let r!: Response;
    const logs = await capturandoLogs(async () => {
      r = await handler(req, s.deps);
    });
    exigirSemEfeitos(s);
    assertEquals(r.status, 500);
    assertEquals(await r.json(), FALHA);
    assertStringIncludes(logs, "metodo_invalido");
  });
}

function corpoComBytes(bytes: number) {
  const corpo = { ...payload(), preenchimento: "" };
  const tamanhoBase =
    new TextEncoder().encode(JSON.stringify(corpo)).byteLength;
  corpo.preenchimento = "x".repeat(bytes - tamanhoBase);
  const texto = JSON.stringify(corpo);
  assertEquals(new TextEncoder().encode(texto).byteLength, bytes);
  return requisicaoAssinada(corpo, { texto });
}

for (const bytes of [20 * 1024 - 1, 20 * 1024]) {
  Deno.test(`hook aceita corpo válido assinado com ${bytes} bytes`, async () => {
    await exigirEnvio(corpoComBytes(bytes));
  });
}

Deno.test("hook recusa corpo válido assinado acima de 20 KiB antes da criptografia, banco e SMTP", async () => {
  const req = corpoComBytes(20 * 1024 + 1);
  // Prova independente: não é assinatura inválida nem JSON inválido.
  const verificador = new Webhook(
    AMBIENTE_HOOK.SEND_EMAIL_HOOK_SECRET.replace(/^v1,whsec_/, ""),
  );
  verificador.verify(
    await req.clone().text(),
    Object.fromEntries(req.headers),
  );
  const s = cenario();
  const verificarOriginal = Webhook.prototype.verify;
  let verificacoes = 0;
  Webhook.prototype.verify = function (...args) {
    verificacoes++;
    return verificarOriginal.apply(this, args);
  };
  let r!: Response;
  let logs: string;
  try {
    logs = await capturandoLogs(async () => {
      r = await handler(req, s.deps);
    });
  } finally {
    Webhook.prototype.verify = verificarOriginal;
  }
  assertEquals(
    verificacoes,
    0,
    "corpo grande chegou à verificação criptográfica",
  );
  exigirSemEfeitos(s);
  assertEquals(r.status, 500);
  assertEquals(await r.json(), FALHA);
  assertStringIncludes(logs, "assinatura_invalida");
});
