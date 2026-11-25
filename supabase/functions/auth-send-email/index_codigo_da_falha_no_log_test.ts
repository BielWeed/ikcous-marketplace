// Caça por mutação (25/11/2026) no hook `auth-send-email`: o corpo da resposta de
// falha é SEMPRE o mesmo 500 genérico, então quem diagnostica um e-mail de
// login que não saiu só tem o CÓDIGO da linha de log (`auth-send-email: <codigo>
// <ms>ms`). Os testes antigos conferiam o código de 4 dos 7 motivos
// (`metodo_invalido`, `assinatura_invalida`, `envio_falhou` e `tempo_esgotado`).
// Faltavam `segredo_ausente`, `payload_invalido` e `sem_remetente` — e, sem
// `segredo_ausente`, apagar a guarda do segredo continuava com a suíte verde
// (o `replace` de `undefined` lança e cai em `assinatura_invalida`, também 500).
// Também faltava a regra de quando uma exceção qualquer vira `tempo_esgotado` e
// quando vira `envio_falhou`, e que nenhum dos dois imprime o erro bruto.
// Os dois últimos testes cobrem o REGISTRO DE SAÚDE (a faixa do painel que diz
// se o Gmail da loja está funcionando): um `waitUntil` que lança não pode
// derrubar um envio já aceito, e uma recusa do SMTP grava FALHA com o motivo —
// nunca "envio ok".
//
// MUTANTES EQUIVALENTES (anotados, não viram teste):
//  - `nomeDaLoja`: tirar o `.trim()` da conferência ou do retorno não muda nada
//    observável, porque `renderizarEmailAuth` (auth-email-modelos.ts) aparece
//    DEPOIS e já apara o nome e cai em "Nossa loja" quando sobra vazio.
//  - `restante()`: trocar `ms <= 0` por `ms < 0` só difere se o relógio parar
//    exatamente no milissegundo do prazo (float de `performance.now`).
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
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

type Ambiente = Record<string, string>;

function cenario(opcoes: { ambiente?: Ambiente; criarCliente?: () => unknown; falhaDoSmtp?: unknown } = {}) {
  const banco = bancoFalso();
  const enviados: unknown[] = [];
  let clientes = 0;
  const cliente = {
    from(tabela: string) {
      if (tabela !== "store_config") return banco.from(tabela);
      return {
        select: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: { store_name: "Loja fictícia" }, error: null }),
          }),
        }),
      };
    },
  };
  const deps = {
    env: env(opcoes.ambiente ?? { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO }),
    criarCliente: () => {
      clientes++;
      return opcoes.criarCliente ? opcoes.criarCliente() : cliente;
    },
    smtp: {
      carregarNodemailer: async () => ({
        default: {
          createTransport: () => ({
            sendMail(mensagem: unknown) {
              enviados.push(mensagem);
              if (opcoes.falhaDoSmtp) return Promise.reject(opcoes.falhaDoSmtp);
              return Promise.resolve({ accepted: ["cliente@example.com"], rejected: [] });
            },
            close() {},
          }),
        },
      }),
    },
  };
  return { deps, banco, enviados, clientes: () => clientes };
}

async function rodar(s: ReturnType<typeof cenario>, req: Request) {
  let resposta!: Response;
  const logs = await capturandoLogs(async () => {
    resposta = await handler(req, s.deps);
  });
  return { resposta, logs };
}

function exigirFalha500(resposta: Response) {
  assertEquals(resposta.status, 500);
}

Deno.test("sem SEND_EMAIL_HOOK_SECRET: 500 com o código segredo_ausente (não assinatura_invalida) e nada é aberto", async () => {
  for (const ambiente of [{ ...AMBIENTE_COMPLETO }, { ...AMBIENTE_HOOK, SEND_EMAIL_HOOK_SECRET: "" }]) {
    const s = cenario({ ambiente });
    const { resposta, logs } = await rodar(s, requisicaoAssinada());
    exigirFalha500(resposta);
    assertStringIncludes(logs, "auth-send-email: segredo_ausente");
    assertEquals(logs.includes("assinatura_invalida"), false);
    assertEquals(s.clientes(), 0);
    assertEquals(s.enviados, []);
  }
});

Deno.test("corpo assinado mas com ação desconhecida, destinatário inválido ou campo faltando: payload_invalido e o client do banco nem é criado", async () => {
  const acaoDesconhecida = payload();
  acaoDesconhecida.email_data.email_action_type = "acao_que_nao_existe";
  const semDestinatario = payload();
  semDestinatario.user.email = "dois@example.com, tres@example.com";
  const semToken = payload();
  semToken.email_data.token = "";
  for (const corpo of [acaoDesconhecida, semDestinatario, semToken]) {
    const s = cenario();
    const { resposta, logs } = await rodar(s, requisicaoAssinada(corpo));
    exigirFalha500(resposta);
    assertStringIncludes(logs, "auth-send-email: payload_invalido");
    assertEquals(logs.includes("assinatura_invalida"), false);
    assertEquals(s.clientes(), 0, "validar o corpo vem ANTES do acesso privilegiado");
    assertEquals(s.enviados, []);
  }
});

Deno.test("loja sem painel e sem SMTP no ambiente: sem_remetente (não envio_falhou), nada é enviado", async () => {
  const s = cenario({ ambiente: { ...AMBIENTE_HOOK } });
  const { resposta, logs } = await rodar(s, requisicaoAssinada());
  exigirFalha500(resposta);
  assertStringIncludes(logs, "auth-send-email: sem_remetente");
  assertEquals(logs.includes("envio_falhou"), false);
  assertEquals(s.enviados, []);
});

Deno.test("exceção inesperada DENTRO do prazo é envio_falhou, não tempo_esgotado, e o texto do erro nunca vai para o log", async () => {
  const s = cenario({
    criarCliente: () => {
      throw new Error("senha-do-banco-hunter2 token=abc123 destinatario=cliente@example.com");
    },
  });
  const { resposta, logs } = await rodar(s, requisicaoAssinada());
  exigirFalha500(resposta);
  assertStringIncludes(logs, "auth-send-email: envio_falhou");
  assertEquals(logs.includes("tempo_esgotado"), false);
  for (const segredo of ["hunter2", "abc123", "cliente@example.com"]) {
    assertEquals(logs.includes(segredo), false, `o log vazou ${segredo}`);
  }
  assertEquals(await resposta.json(), {
    error: {
      http_code: 500,
      message: "Não foi possível enviar o e-mail agora. Tente de novo em instantes.",
    },
  });
});

Deno.test("exceção inesperada que estoura o prazo é tempo_esgotado (o relógio decide, não o tipo do erro)", async () => {
  const original = performance.now;
  const base = original.bind(performance);
  let salto = 0;
  performance.now = () => base() + salto;
  try {
    const s = cenario({
      criarCliente: () => {
        salto += 4000; // passa dos 3,5 s do orçamento e só então falha
        throw new Error("falha qualquer");
      },
    });
    const { resposta, logs } = await rodar(s, requisicaoAssinada());
    exigirFalha500(resposta);
    assertStringIncludes(logs, "auth-send-email: tempo_esgotado");
    assertEquals(logs.includes("envio_falhou"), false);
    assert(s.clientes() === 1);
  } finally {
    performance.now = original;
  }
});

Deno.test("waitUntil que lança ao registrar a saúde NÃO derruba um envio já aceito pelo SMTP (200, uma mensagem só)", async () => {
  const s = cenario();
  let tentativas = 0;
  const resposta = await handler(requisicaoAssinada(), {
    ...s.deps,
    waitUntil: () => {
      tentativas++;
      throw new Error("waitUntil indisponível neste runtime");
    },
  });
  assertEquals(resposta.status, 200);
  assertEquals(await resposta.json(), {});
  assertEquals(s.enviados.length, 1);
  assertEquals(tentativas, 1, "o registro de saúde foi tentado");
});

Deno.test("SMTP recusou: a saúde registrada diz FALHA com o motivo (nunca 'ok') e fica na origem de quem tentou", async () => {
  const s = cenario({ falhaDoSmtp: Object.assign(new Error("recusado"), { code: "EAUTH" }) });
  const tarefas: Promise<unknown>[] = [];
  const resposta = await handler(requisicaoAssinada(), {
    ...s.deps,
    waitUntil: (t: Promise<unknown>) => tarefas.push(t),
  });
  assertEquals(resposta.status, 500);
  assertEquals(s.enviados.length, 1, "sem retentativa");
  assertEquals(tarefas.length, 1);
  await Promise.all(tarefas);
  assertEquals(s.banco.estado.escritas.length, 1);
  const saude = JSON.parse(s.banco.estado.escritas[0].value!);
  assertEquals(saude.codigo_falha, "senha_errada");
  assert(typeof saude.ultima_falha_em === "string" && saude.ultima_falha_em.length > 0);
  assertEquals(saude.ultimo_envio_ok_em ?? null, null, "falha nunca grava 'envio ok'");
  assertEquals(saude.ultimo_envio_ok_origem ?? null, null);
});
