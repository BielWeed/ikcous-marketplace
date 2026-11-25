// @ts-nocheck
/**
 * credenciais-email — bordas que a suíte principal deixava passar
 * (caça por mutação "só testes", 25/11/2026).
 *
 * Cada teste existe porque uma alteração pequena no `index.ts` mantinha as 46
 * provas verdes:
 *
 *  - corpo que não é JSON é 400 do FORMATO, antes de perguntar quem é o dono;
 *  - o recado do limite fala "1 segundo" (singular) e "2 segundos";
 *  - `salvar`: o Google que PENDURA vira "sem_conexao" (422), e uma recusa que
 *    nem é um Error também vira 422 — nunca um 500 que esconde a causa; e o
 *    prazo padrão é de 25 s, medido com relógio falso (sem dormir);
 *  - a saúde do envio, depois de salvar, não guarda NADA da falha antiga
 *    (nem a origem dela);
 *  - o teste de envio leva assunto fixo e destinatário do REGISTRO — o corpo
 *    da requisição não escolhe nenhum dos dois;
 *  - `status` aguenta registro ilegível e saúde que não lê (a tela abre e diz
 *    o problema, em vez de cair);
 *  - erro inesperado: o log leva só a palavra fixa, nunca o que veio antes de
 *    ":" na mensagem (que pode carregar segredo).
 *
 * Dublês compartilhados de `_shared/email-da-loja_fixtures.ts`; nenhuma rede,
 * nenhum SMTP; toda senha é de mentira.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { FakeTime } from "https://deno.land/std@0.177.0/testing/time.ts";
import {
  CHAVE_SETTINGS_EMAIL,
  CHAVE_SETTINGS_SAUDE,
  lerSaudeDoEnvio,
} from "../_shared/email-da-loja.ts";
import {
  bancoFalso,
  capturandoLogs,
  CHAVE_CIFRA_TESTE,
  env,
  registroCifrado,
  USUARIO_DO_PAINEL,
} from "../_shared/email-da-loja_fixtures.ts";
import { handler } from "./index.ts";

const COFRE = { MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE };
const T0 = Date.parse("2026-11-25T12:00:00.000Z");
const SALVAR_BOM = { acao: "salvar", usuario: "Nova.Loja@Gmail.com", senha: "abcdefghijklmnop" };

function requisicao(corpo: unknown) {
  return new Request("http://local/credenciais-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-de-teste" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

function montar(
  opcoes: {
    banco?: Parameters<typeof bancoFalso>[0];
    verificar?: (remetente: unknown) => Promise<unknown>;
    tempoDoEnvioMs?: number;
    agora?: () => number;
  } = {},
) {
  const banco = bancoFalso(opcoes.banco);
  // O dublê compartilhado não tem UPDATE condicional; o teste de envio grava o
  // resultado por ele (compare-and-swap no registro), então ele entra aqui.
  const fromOriginal = banco.from.bind(banco);
  banco.from = (tabela: string) => ({
    ...fromOriginal(tabela),
    update: (linha: { value: string }) => {
      const filtros = new Map<string, string>();
      const consulta = {
        eq: (coluna: string, valor: string) => {
          filtros.set(coluna, valor);
          return consulta;
        },
        select: () => consulta,
        maybeSingle: () => {
          const chave = filtros.get("key");
          const atual = banco.estado.valores.get(chave);
          if (atual === undefined || atual !== filtros.get("value")) {
            return Promise.resolve({ data: null, error: null });
          }
          banco.estado.escritas.push({ acao: "update", key: chave, value: linha.value });
          banco.estado.valores.set(chave, linha.value);
          return Promise.resolve({ data: { key: chave }, error: null });
        },
      };
      return consulta;
    },
  });
  const enviados: Array<{ mensagem: any; remetente: any }> = [];
  const leiturasDoDono = { n: 0 };
  const deps = {
    supabase: banco,
    adminAtual: () => Promise.resolve("uid-admin"),
    donoAtual: () => {
      leiturasDoDono.n++;
      return Promise.resolve(null);
    },
    env: env(COFRE),
    agora: opcoes.agora ?? (() => T0),
    tempoDoEnvioMs: opcoes.tempoDoEnvioMs,
    enviarEmail: (mensagem: unknown, remetente: unknown) => {
      enviados.push({ mensagem, remetente });
      return Promise.resolve({ origem: "painel" });
    },
    verificarRemetente: (remetente: unknown) => opcoes.verificar?.(remetente) ?? Promise.resolve(),
  };
  return { banco, deps, enviados, leiturasDoDono };
}

async function chamar(c: ReturnType<typeof montar>, corpo: unknown) {
  const resposta = await handler(requisicao(corpo), c.deps);
  const texto = await resposta.text();
  let json: any = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // sem JSON
  }
  return { status: resposta.status, texto, json };
}

const SAUDE_COM_FALHA_DO_PAINEL = {
  ultimo_envio_ok_em: null,
  ultimo_envio_ok_origem: null,
  ultima_falha_em: "2026-11-24T09:00:00.000Z",
  ultima_falha_origem: "painel",
  codigo_falha: "senha_errada",
  tentativas_em: [],
};

// ── Corpo que não é JSON ──────────────────────────────────────────────────

Deno.test("corpo que não é JSON: 400 'Corpo inválido' ANTES de perguntar quem é o dono, sem ler nem gravar nada", async () => {
  for (const corpo of ["isto nao e json", "", "{acao:"]) {
    const c = montar({ banco: { registro: await registroCifrado() } });
    const r = await chamar(c, corpo);
    assertEquals(r.status, 400, JSON.stringify(corpo));
    assertEquals(r.json, { erro: "Corpo inválido: esperado JSON." });
    assertEquals(c.leiturasDoDono.n, 0, "nem perguntou quem é o dono");
    assertEquals(c.banco.estado.leituras, []);
    assertEquals(c.banco.estado.escritas, []);
  }
});

// ── O recado do limite ────────────────────────────────────────────────────

Deno.test("limite: falta 1 segundo -> '1 segundo' (singular); faltam 2 -> '2 segundos'", async () => {
  const tentativaHa = (ms: number) => ({ ...SAUDE_COM_FALHA_DO_PAINEL, tentativas_em: [new Date(T0 - ms).toISOString()] });

  const umSegundo = montar({ banco: { saude: tentativaHa(59_000) } });
  const r1 = await chamar(umSegundo, SALVAR_BOM);
  assertEquals(r1.status, 429);
  assertEquals(r1.json.espere_segundos, 1);
  assert(r1.json.erro.includes("em 1 segundo "), r1.json.erro);
  assertEquals(r1.json.erro.includes("1 segundos"), false);

  const doisSegundos = montar({ banco: { saude: tentativaHa(58_000) } });
  const r2 = await chamar(doisSegundos, SALVAR_BOM);
  assertEquals(r2.status, 429);
  assertEquals(r2.json.espere_segundos, 2);
  assert(r2.json.erro.includes("em 2 segundos "), r2.json.erro);
});

// ── salvar: o Google pendura, ou recusa sem ser um Error ──────────────────

Deno.test("salvar: o Google que PENDURA é cortado e vira 422 'sem_conexao' — e nada é gravado", async () => {
  const c = montar({ verificar: () => new Promise(() => {}), tempoDoEnvioMs: 20 });
  const r = await chamar(c, SALVAR_BOM);
  assertEquals(r.status, 422);
  assertEquals(r.json.motivo, "sem_conexao");
  assertEquals(c.banco.estado.valores.has(CHAVE_SETTINGS_EMAIL), false, "login não verificado = nada gravado");
});

Deno.test("salvar: o Google recusa com algo que NÃO é um Error (texto, nulo): 422 classificado, nunca 500 — e nada é gravado", async () => {
  for (const recusa of ["recusado", undefined, null]) {
    const c = montar({ verificar: () => Promise.reject(recusa) });
    const r = await chamar(c, SALVAR_BOM);
    assertEquals(r.status, 422, String(recusa));
    assert(typeof r.json.motivo === "string" && r.json.motivo.length > 0, String(recusa));
    assertEquals(c.banco.estado.valores.has(CHAVE_SETTINGS_EMAIL), false);
  }
});

Deno.test("salvar: sem tempoDoEnvioMs injetado o prazo do Google é de 25 s (relógio falso, sem dormir)", async () => {
  const tempo = new FakeTime();
  try {
    // 1) o Google responde em 10 s: dentro do prazo, salva.
    const rapido = montar({ verificar: () => new Promise((resolve) => setTimeout(resolve, 10_000)) });
    const pRapido = chamar(rapido, SALVAR_BOM);
    await tempo.tickAsync(10_000);
    const r1 = await pRapido;
    assertEquals(r1.status, 200, "10 s está dentro dos 25 s");
    assert(rapido.banco.estado.valores.has(CHAVE_SETTINGS_EMAIL));

    // 2) o Google nunca responde: aos 24,999 s ainda espera, aos 25 s desiste.
    const preso = montar({ verificar: () => new Promise(() => {}) });
    let resposta: { status: number; json: any } | null = null;
    chamar(preso, SALVAR_BOM).then((r) => {
      resposta = r;
    });
    await tempo.tickAsync(24_999);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assertEquals(resposta, null, "aos 24,999 s ainda aguarda o Google");
    await tempo.tickAsync(1);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assertEquals(resposta?.status, 422);
    assertEquals(resposta?.json.motivo, "sem_conexao");
  } finally {
    tempo.restore();
  }
});

// ── A saúde depois de salvar ──────────────────────────────────────────────

Deno.test("salvar com sucesso limpa a falha antiga do painel por inteiro — inclusive de QUEM falhou", async () => {
  const c = montar({ banco: { registro: await registroCifrado(), saude: SAUDE_COM_FALHA_DO_PAINEL } });
  const r = await chamar(c, SALVAR_BOM);
  assertEquals(r.status, 200);
  const depois = await lerSaudeDoEnvio(c.banco);
  assertEquals(depois.ultima_falha_em, null);
  assertEquals(depois.ultima_falha_origem, null);
  assertEquals(depois.codigo_falha, null);
  assertEquals(r.json.saude?.ultima_falha_origem ?? null, null);
  assertEquals(r.json.saude?.mensagem_da_falha ?? null, null);
});

// ── O teste de envio: assunto e destinatário não vêm do corpo ─────────────

Deno.test("testar: assunto fixo e destinatário do REGISTRO — assunto, para, html e cc do corpo são ignorados", async () => {
  const c = montar({ banco: { registro: await registroCifrado() } });
  const r = await chamar(c, {
    acao: "testar",
    assunto: "Promoção imperdível",
    para: "vitima@exemplo.com",
    cc: "outra@exemplo.com",
    html: "<b>golpe</b>",
  });
  assertEquals(r.status, 200);
  assertEquals(c.enviados.length, 1);
  const { mensagem } = c.enviados[0];
  assertEquals(mensagem.para, USUARIO_DO_PAINEL);
  assertEquals(mensagem.assunto, "Teste do e-mail da loja");
  assertEquals(String(mensagem.html).includes("golpe"), false);
  assertEquals("cc" in mensagem, false);
});

// ── status: a tela abre mesmo com registro ilegível e saúde que não lê ────

Deno.test("status com registro ILEGÍVEL: 200 e o problema nomeado, não uma queda", async () => {
  const c = montar({ banco: { registroCru: "isto-nao-e-json{" } });
  const r = await chamar(c, { acao: "status" });
  assertEquals(r.status, 200);
  assertEquals(r.json.problema, "registro_ilegivel");
  assertEquals(r.json.senha_guardada, false);
});

Deno.test("status com a SAÚDE do envio ilegível/fora do ar: 200 com saude nula, e o resto da tela segue", async () => {
  const c = montar({
    banco: { registro: await registroCifrado(), leitura: "erro", chaveDaFalha: CHAVE_SETTINGS_SAUDE },
  });
  const r = await chamar(c, { acao: "status" });
  assertEquals(r.status, 200);
  assertEquals(r.json.saude, null);
  assertEquals(r.json.usuario, USUARIO_DO_PAINEL);
  assertEquals(r.json.senha_guardada, true);
});

// ── Erro inesperado: o log leva só a palavra fixa ─────────────────────────

Deno.test("erro inesperado: resposta 500 fixa e o log leva 'inesperada' — nunca o texto que veio antes de ':'", async () => {
  const c = montar({
    agora: () => {
      throw new Error("SEGREDO-DO-GMAIL-XYZ: detalhe que nao pode ir ao log");
    },
  });
  let r: Awaited<ReturnType<typeof chamar>>;
  const log = await capturandoLogs(async () => {
    r = await chamar(c, SALVAR_BOM);
  });
  assertEquals(r.status, 500);
  assertEquals(r.texto.includes("SEGREDO-DO-GMAIL-XYZ"), false);
  assert(log.includes("inesperada"), log);
  assertEquals(log.includes("SEGREDO-DO-GMAIL-XYZ"), false);
});
