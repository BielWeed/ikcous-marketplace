# A tela só diz "enviado" quando enviou — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inverter quem chama o envio do código de verificação de pedido, para que a tela só
prometa "código enviado" depois de o e-mail ter saído de verdade — e, no mesmo movimento, apagar
a fila, o gatilho de banco e o segredo compartilhado que existiam só para sustentar o caminho
antigo.

**Architecture:** Hoje é `tela → RPC → INSERT → gatilho → net.http_post (fila) → edge function →
Resend`. O `net.http_post` **enfileira** e envia depois do commit, então a RPC retorna antes de
qualquer coisa ter acontecido e ninguém jamais sabe se o e-mail saiu. Passa a ser
`tela → edge function → (RPC v2 com service role) → SMTP → resposta`. A função vira o único lugar
que sabe o código, e a resposta HTTP dela é o que a tela usa para decidir o que dizer.

**Tech Stack:** Supabase Edge Functions (Deno), `npm:nodemailer@9.0.5`, SMTP do Gmail em
`smtp.gmail.com:465`, PostgreSQL (migrations), React 19 + Vitest no front, Deno.test nas functions.

## Global Constraints

- **Migration não leva `BEGIN`/`COMMIT`** — com eles o `ROLLBACK` da prova vira no-op e a mudança
  fica gravada mesmo assim.
- **Nenhuma migration é aplicada dentro de uma tarefa.** Escrever, provar com `ROLLBACK`, e parar.
  Quem aplica é a sessão principal, com o ok do Gabriel.
- **Porta 465, nunca 587.** Medido em 19/08/2026 na própria edge function: 465 abre em 48 ms e
  autentica; a doc do Supabase declara a 587 bloqueada.
- **A senha nunca aparece em log, em resposta HTTP ou em mensagem de erro.** Só `Boolean(...)`.
- **Segredos já existentes, não criar novos:** `SMTP_USER`, `SMTP_PASSWORD`.
- **Escopo de commit vem da lista fechada** de `.commitlintrc.json`. Aqui valem `auth`, `edge`,
  `db`, `ui`, `tooling`.
- **Verificação:** o diff toca `src/`, `supabase/functions/` e `tests/` — os sete comandos do CI.
- **Teto do eslint 553 warnings / 0 erros; biome 30 erros.** Medir o biome como o CI mede
  (cópia da árvore em LF), nunca pelo número local em CRLF.

## Por que dá para fazer o corte sem período de convivência

O caminho antigo **não entrega e-mail para ninguém hoje**: `send-otp-email` usa o remetente de
caixa de areia do Resend (`onboarding@resend.dev`), que recusa qualquer destinatário que não seja
o dono da conta (#161). Um shim de compatibilidade existiria para proteger um fluxo que já está
quebrado, e viajaria para toda loja clonada. Não entra.

## Estado medido do banco vivo (19/08/2026)

```
EXECUTE generate_order_otp_v1 -> anon, authenticated, postgres, service_role
EXECUTE get_orders_by_otp_v1  -> anon, authenticated, postgres, service_role
Gatilho vivo em otp_verifications: on_otp_created_send_email (habilitado)
Segredo no Vault: otp_trigger_secret
```

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260820000000_otp_v2_devolve_o_codigo.sql` | **Criar.** RPC `generate_order_otp_v2`, que valida igual à v1 e **devolve** o código para quem tem service role. Aditiva: não mexe na v1. |
| `supabase/migrations/20260820000100_otp_sem_fila_nem_gatilho.sql` | **Criar.** Apaga gatilho, função de gatilho e o EXECUTE de `anon`/`authenticated` na v1. É a migration de corte. |
| `supabase/functions/_shared/smtp.ts` | **Criar.** `enviarEmail()` — único ponto que fala SMTP. Nasce compartilhado porque o #106 (confirmação de pedido) vai precisar do mesmo. |
| `supabase/functions/send-otp-email/index.ts` | **Reescrever.** Recebe do navegador, chama a RPC v2, envia, responde. |
| `supabase/functions/send-otp-email/index_test.ts` | **Criar.** Deno.test do contrato novo. |
| `src/hooks/useOrders.ts:1171-1207` | **Modificar.** `generateOrderOtp` deixa de chamar a RPC e passa a invocar a função. |
| `src/components/ui/custom/OrderSearch.tsx:87-102` | **Modificar.** O toast de sucesso passa a depender do envio. |
| `tests/front/use-orders-otp-so-promete-o-que-enviou.test.ts` | **Criar.** Prova que o hook traduz a resposta HTTP sem inventar sucesso. |
| `tests/front/order-search-nao-avanca-sem-envio.test.tsx` | **Criar.** Prova que a tela não avança de passo sem envio confirmado. |
| `supabase/config.toml` | **Modificar.** `send-otp-email` passa a `verify_jwt = true`. |
| `DEPLOYMENT.md:52` | **Modificar.** A instrução "sempre com `--no-verify-jwt`" passa a estar errada. |

---

### Task 1: A RPC v2 devolve o código para quem tem service role

**Files:**
- Create: `supabase/migrations/20260820000000_otp_v2_devolve_o_codigo.sql`
- Create: `rollback-20260820000000_otp_v2_devolve_o_codigo.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `public.generate_order_otp_v2(p_email text, p_whatsapp text, p_order_fragment text)
  RETURNS jsonb`. Sucesso: `{"ok": true, "email": "...", "otp_code": "123456", "expira_em":
  "<timestamptz>"}`. Recusa: `{"ok": false, "motivo": "nao_confere"}` ou
  `{"ok": false, "motivo": "muito_recente", "espere_segundos": 42}`.

**Por que uma v2 em vez de mudar a v1:** a v1 devolve `boolean` e é chamada pelo front hoje. Mudar
o tipo de retorno de uma função que a produção chama quebra a produção no instante do `apply`.
A v2 nasce ao lado, com `EXECUTE` só para `service_role`.

**Por que a janela de 60 segundos:** a v2 fica atrás de um endpoint que qualquer visitante alcança,
e cada chamada bem-sucedida gasta uma das ~100 mensagens diárias da conta do Gmail. Sem a janela,
quem souber um e-mail, um WhatsApp e um fragmento de pedido válidos esgota a cota da loja num laço.

- [ ] **Passo 1: escrever a migration**

```sql
-- generate_order_otp_v2 — mesma validação da v1, mas DEVOLVE o código.
--
-- POR QUE ELA EXISTE
--   A v1 devolve boolean e enfia o código numa tabela, e quem mandava o e-mail
--   era um gatilho lendo essa tabela. Sem o gatilho, quem envia precisa do
--   código na mão — e é a edge function, com service role, nunca o navegador.
--
-- POR QUE NÃO ALTERAR A v1
--   A produção chama a v1 e espera boolean. Trocar o tipo de retorno derruba a
--   produção no instante do apply. A v2 nasce ao lado; a v1 morre depois, na
--   migration de corte, junto com o gatilho.

CREATE OR REPLACE FUNCTION public.generate_order_otp_v2(
    p_email text,
    p_whatsapp text,
    p_order_fragment text
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_otp text;
    v_order_id uuid;
    v_fragmento text := trim(coalesce(p_order_fragment, ''));
    v_recente timestamptz;
BEGIN
    DELETE FROM public.otp_verifications WHERE expires_at < NOW();

    -- Os dois canais são obrigatórios (mesma regra da v1, AUTH-010/#118).
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = '' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nao_confere');
    END IF;

    IF v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nao_confere');
    END IF;

    SELECT o.id INTO v_order_id
      FROM public.marketplace_orders o
      LEFT JOIN auth.users u ON u.id = o.user_id
     WHERE regexp_replace(
               coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
               '[^0-9]', '', 'g'
           ) = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
       AND (
             LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(trim(p_email))
          OR LOWER(coalesce(u.email, ''))                   = LOWER(trim(p_email))
       )
       AND o.id::text ILIKE '%' || v_fragmento;

    -- Motivo único de propósito: distinguir "pedido não existe" de "e-mail não
    -- bate" diria a quem adivinha qual metade ele já acertou.
    IF NOT FOUND OR v_order_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nao_confere');
    END IF;

    -- Freio de cota: cada sucesso gasta uma das ~100 mensagens diárias da conta
    -- do Gmail da loja, e esta função fica atrás de endpoint público.
    SELECT created_at INTO v_recente
      FROM public.otp_verifications
     WHERE order_id = v_order_id
       AND created_at > NOW() - INTERVAL '60 seconds'
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_recente IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'motivo', 'muito_recente',
            'espere_segundos',
            CEIL(EXTRACT(EPOCH FROM (v_recente + INTERVAL '60 seconds' - NOW())))::int
        );
    END IF;

    v_otp := LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');

    INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at, order_id)
    VALUES (trim(p_email), p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes', v_order_id);

    RETURN jsonb_build_object(
        'ok', true,
        'email', trim(p_email),
        'otp_code', v_otp,
        'expira_em', (NOW() + INTERVAL '15 minutes')::text
    );
END;
$$;

COMMENT ON FUNCTION public.generate_order_otp_v2(text, text, text) IS
'Valida e-mail + WhatsApp + fragmento do pedido e DEVOLVE o código de verificação. Só service_role executa: quem chama é a edge function send-otp-email, nunca o navegador — o código no navegador dispensaria o e-mail inteiro. Substitui o par v1 + gatilho on_otp_created_send_email.';

-- O navegador NÃO pode chamar esta função: ela devolve o código em texto claro.
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v2(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_order_otp_v2(text, text, text) TO service_role;
```

- [ ] **Passo 2: escrever o rollback**

```sql
-- Desfaz 20260820000000. A v2 é aditiva: apagar a função devolve o banco ao
-- estado anterior, sem tocar em otp_verifications nem na v1.
DROP FUNCTION IF EXISTS public.generate_order_otp_v2(text, text, text);
```

- [ ] **Passo 3: provar com `ROLLBACK`, sem gravar**

Rode um script que, numa transação: aplica a migration; chama
`generate_order_otp_v2('x@y.z','34999999999','abcdef')` e confere que volta
`{"ok":false,"motivo":"nao_confere"}`; confere em `information_schema.role_routine_grants` que
`anon` e `authenticated` **não** têm EXECUTE e `service_role` tem; e então `ROLLBACK`. Depois do
rollback, confere que a função não existe mais.

Esperado: as três checagens OK, e a função ausente depois do rollback.

- [ ] **Passo 4: NÃO aplicar**

Esta tarefa termina com a migration em disco e o banco intacto.

- [ ] **Passo 5: registrar a verificação no `db-apply`**

Sem entrada no mapa `VERIFICACOES` de `scripts/db-apply.cjs`, o aplicador pula a conferência em
silêncio e ainda imprime "Tudo aplicado e verificado" (#204). Acrescente:

```js
  "20260820000000_otp_v2_devolve_o_codigo.sql": {
    funcao: "generate_order_otp_v2",
    esperado: [
      // O retorno estruturado, que é a razão de a v2 existir.
      "'otp_code', v_otp",
      // O freio de cota. Sem ele, um laço esgota as ~100 mensagens do dia.
      "INTERVAL '60 seconds'",
      // A regra dos dois canais (AUTH-010 #118) tem de sobreviver ao REPLACE.
      "coalesce(trim(p_whatsapp), '') = ''",
    ],
  },
```

- [ ] **Passo 6: commitar**

```
git add supabase/migrations/20260820000000_otp_v2_devolve_o_codigo.sql rollback-20260820000000_otp_v2_devolve_o_codigo.sql scripts/db-apply.cjs
git commit -F <arquivo-de-mensagem>
```

Mensagem: `feat(db): a validação do código de verificação passa a devolver o código a quem envia`

---

### Task 2: Um lugar só fala SMTP

**Files:**
- Create: `supabase/functions/_shared/smtp.ts`
- Create: `supabase/functions/_shared/smtp_test.ts`

**Interfaces:**
- Consumes: `SMTP_USER` e `SMTP_PASSWORD` do ambiente.
- Produces: `enviarEmail({ para, assunto, html }): Promise<void>` — resolve em sucesso, **lança**
  em falha. E `remetenteConfigurado(): boolean`.

**Por que compartilhado desde já:** o #106 (confirmação de pedido para quem compra) precisa do
mesmo cano. Duplicar a configuração de SMTP em duas functions é garantir que uma delas fique para
trás numa correção futura.

**Por que lança em vez de devolver `false`:** quem chama precisa da causa para decidir o que dizer
na tela, e engolir a exceção aqui recriaria exatamente o defeito que este plano existe para matar.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// supabase/functions/_shared/smtp_test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { remetenteConfigurado, enviarEmail } from "./smtp.ts";

Deno.test("remetenteConfigurado: falso quando falta segredo", () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.delete("SMTP_USER");
  Deno.env.delete("SMTP_PASSWORD");
  try {
    assertEquals(remetenteConfigurado(), false);
  } finally {
    if (user) Deno.env.set("SMTP_USER", user);
    if (pass) Deno.env.set("SMTP_PASSWORD", pass);
  }
});

Deno.test("enviarEmail: recusa antes de abrir conexão quando falta segredo", async () => {
  const user = Deno.env.get("SMTP_USER");
  Deno.env.delete("SMTP_USER");
  try {
    await assertRejects(
      () => enviarEmail({ para: "a@b.c", assunto: "x", html: "<p>x</p>" }),
      Error,
      "SMTP não configurado",
    );
  } finally {
    if (user) Deno.env.set("SMTP_USER", user);
  }
});

Deno.test("enviarEmail: a mensagem de erro nunca contém a senha", async () => {
  Deno.env.set("SMTP_USER", "conta@gmail.com");
  Deno.env.set("SMTP_PASSWORD", "senhasecretissima");
  try {
    await enviarEmail({ para: "", assunto: "x", html: "<p>x</p>" });
    throw new Error("deveria ter falhado com destinatário vazio");
  } catch (e) {
    assertEquals(String(e.message).includes("senhasecretissima"), false);
  }
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx deno test --allow-all supabase/functions/_shared/smtp_test.ts`
Esperado: FAIL — `Module not found "./smtp.ts"`.

- [ ] **Passo 3: implementar**

```ts
// supabase/functions/_shared/smtp.ts
/**
 * O único lugar do projeto que fala SMTP.
 *
 * PORTA 465, E NÃO 587
 *   Medido na própria edge function em 19/08/2026 com uma sonda descartável:
 *   a 465 abre em 48 ms e autentica com a senha de aplicativo do Gmail. A doc
 *   do Supabase declara a 587 bloqueada para conexões de saída, e é justamente
 *   a porta que o painel de Auth usa (o GoTrue não é a edge function).
 *
 * npm:nodemailer@9.0.5
 *   Também medido na mesma sonda: roda neste runtime, importado por
 *   especificador `npm:`. O relato de que "nodemailer não roda em edge
 *   function" é falso para Supabase Edge Functions.
 *
 * A SENHA NUNCA SAI DAQUI
 *   Nem em log, nem em mensagem de erro. `remetenteConfigurado()` devolve
 *   booleano justamente para quem chama poder decidir sem ler o valor.
 */
import nodemailer from "npm:nodemailer@9.0.5";

const HOST = "smtp.gmail.com";
const PORTA = 465;

export function remetenteConfigurado(): boolean {
  return Boolean(Deno.env.get("SMTP_USER")) && Boolean(Deno.env.get("SMTP_PASSWORD"));
}

export async function enviarEmail(
  { para, assunto, html }: { para: string; assunto: string; html: string },
): Promise<void> {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  if (!user || !pass) {
    throw new Error("SMTP não configurado: falta SMTP_USER ou SMTP_PASSWORD");
  }
  if (!para) {
    throw new Error("SMTP: destinatário vazio");
  }

  const transporter = nodemailer.createTransport({
    host: HOST,
    port: PORTA,
    secure: true,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({ from: user, to: para, subject: assunto, html });
  } catch (e) {
    // Reembrulha para garantir que nada do transporte (que carrega a config,
    // e portanto a senha) escape para o log de quem chama.
    throw new Error(`SMTP: envio recusado (${e?.code ?? "sem código"})`);
  } finally {
    transporter.close?.();
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx deno test --allow-all supabase/functions/_shared/smtp_test.ts`
Esperado: 3 passed.

- [ ] **Passo 5: provar que os testes não passam por acaso**

Troque `PORTA = 465` por `587` e rode os testes: eles continuam verdes, porque nenhum deles abre
conexão. **Isso é esperado e é o limite honesto desta suíte** — a porta foi provada pela sonda no
ar, não aqui. Desfaça a troca. Depois apague a linha `if (!para)` e confirme que o terceiro teste
fica vermelho: essa é a asserção viva.

- [ ] **Passo 6: commitar**

Mensagem: `feat(edge): um lugar só do projeto passa a falar SMTP`

---

### Task 3: A função recebe do navegador e responde se enviou

**Files:**
- Modify: `supabase/functions/send-otp-email/index.ts` (reescrita completa, 142 linhas hoje)
- Create: `supabase/functions/send-otp-email/index_test.ts`

**Interfaces:**
- Consumes: `enviarEmail`/`remetenteConfigurado` da Task 2; `generate_order_otp_v2` da Task 1.
- Produces: contrato HTTP novo. Entrada: `{ email, whatsapp, orderFragment }`. Saída 200:
  `{ ok: true }`. Saída 200 com recusa: `{ ok: false, motivo: "nao_confere" }` ou
  `{ ok: false, motivo: "muito_recente", espereSegundos: 42 }`. Saída 502:
  `{ ok: false, motivo: "envio_falhou" }`.

**Por que recusa de validação é 200 e falha de envio é 502:** a tela precisa distinguir "seus
dados não conferem" (o cliente corrige e tenta de novo) de "a loja não conseguiu enviar" (não
adianta ele tentar corrigir nada). Enfiar as duas num 400 obrigaria a tela a ler texto de erro
para adivinhar qual foi.

**O que sai:** a autenticação por segredo compartilhado (`OTP_TRIGGER_SECRET`,
`SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY` aceitos no header) e o Resend inteiro. Quem
autentica agora é o portão de JWT do próprio Supabase — provado em 19/08/2026 que a chave anon
passa por ele.

- [ ] **Passo 1: escrever o teste que falha**

```ts
// supabase/functions/send-otp-email/index_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { montarResposta, htmlDoCodigo } from "./index.ts";

Deno.test("montarResposta: recusa de validação é 200, para a tela poder corrigir o formulário", () => {
  const r = montarResposta({ ok: false, motivo: "nao_confere" });
  assertEquals(r.status, 200);
});

Deno.test("montarResposta: falha de envio é 502, porque não adianta o cliente corrigir nada", () => {
  const r = montarResposta({ ok: false, motivo: "envio_falhou" });
  assertEquals(r.status, 502);
});

Deno.test("montarResposta: sucesso não devolve o código, só o ok", async () => {
  const r = montarResposta({ ok: true });
  const corpo = await r.json();
  assertEquals(corpo, { ok: true });
});

Deno.test("htmlDoCodigo: o código aparece no corpo do e-mail", () => {
  assertEquals(htmlDoCodigo("123456").includes("123456"), true);
});

Deno.test("htmlDoCodigo: não crava cidade nem endereço de loja nenhuma", () => {
  const html = htmlDoCodigo("123456");
  assertEquals(html.includes("Monte Carmelo"), false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx deno test --allow-all supabase/functions/send-otp-email/index_test.ts`
Esperado: FAIL — `montarResposta` não é exportada.

- [ ] **Passo 3: reescrever a função**

```ts
// @ts-nocheck
/**
 * send-otp-email — manda o código de verificação de pedido de convidado.
 *
 * QUEM CHAMA, E POR QUE MUDOU
 *   Até 19/08/2026: tela → RPC → INSERT → gatilho → net.http_post → aqui.
 *   O `net.http_post` ENFILEIRA e envia depois do commit, então a RPC voltava
 *   antes de qualquer coisa acontecer e a tela dizia "código enviado" sem que
 *   ninguém jamais tivesse sabido o resultado (#86). Não era descuido: o banco
 *   era incapaz de saber.
 *
 *   Agora: tela → aqui → RPC v2 (service role) → SMTP → resposta.
 *   A resposta desta função é o que a tela usa para decidir o que dizer.
 *
 * O QUE PROTEGE ESTA FUNÇÃO
 *   O portão de JWT do Supabase (`verify_jwt = true` no config.toml). A chave
 *   anon do app passa por ele — medido em 19/08/2026 — e é isso que filtra
 *   tráfego de fora do projeto. O segredo compartilhado do caminho antigo
 *   (OTP_TRIGGER_SECRET) deixou de existir junto com o gatilho.
 *
 *   Contra abuso de cota, o freio está na própria RPC v2: uma mensagem por
 *   pedido a cada 60 segundos.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarEmail, remetenteConfigurado } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Mascara para log. Nunca logar o endereço inteiro de quem compra. */
function mascarar(email: string): string {
  const [nome, dominio] = String(email).split("@");
  if (!dominio) return "***";
  return `${nome.length > 2 ? `${nome[0]}***${nome[nome.length - 1]}` : "***"}@${dominio}`;
}

export function htmlDoCodigo(codigo: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e4e4e7; border-radius: 24px; color: #18181b;">
      <p style="font-size: 14px; line-height: 20px; color: #3f3f46; margin: 0 0 24px; font-weight: 500;">
        Você pediu para acompanhar seu pedido. Use o código abaixo para continuar:
      </p>
      <div style="background-color: #f4f4f5; border: 1px solid #e4e4e7; padding: 20px; text-align: center; border-radius: 16px; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #09090b; font-family: monospace; margin-bottom: 24px;">
        ${codigo}
      </div>
      <p style="font-size: 11px; line-height: 16px; color: #a1a1aa; text-align: center; margin: 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
        Este código expira em 15 minutos. Se não foi você, ignore este e-mail.
      </p>
    </div>
  `;
}

type Desfecho =
  | { ok: true }
  | { ok: false; motivo: "nao_confere" }
  | { ok: false; motivo: "muito_recente"; espereSegundos: number }
  | { ok: false; motivo: "envio_falhou" }
  | { ok: false; motivo: "pedido_invalido" }
  | { ok: false; motivo: "sem_remetente" };

export function montarResposta(d: Desfecho): Response {
  // 200 = a tela pode agir (corrigir o formulário, esperar).
  // 502 = a loja falhou; não há nada que o cliente possa corrigir.
  // 400 = o corpo da requisição veio malformado; não é caso de cliente.
  const status = d.ok
    ? 200
    : d.motivo === "envio_falhou" || d.motivo === "sem_remetente"
      ? 502
      : d.motivo === "pedido_invalido"
        ? 400
        : 200;
  return new Response(JSON.stringify(d), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let corpo: { email?: string; whatsapp?: string; orderFragment?: string };
  try {
    corpo = await req.json();
  } catch {
    return montarResposta({ ok: false, motivo: "pedido_invalido" });
  }

  const { email, whatsapp, orderFragment } = corpo ?? {};
  if (!email || !whatsapp || !orderFragment) {
    return montarResposta({ ok: false, motivo: "pedido_invalido" });
  }

  // Falha fechada ANTES de gravar código nenhum: gerar um código que não vai
  // ser enviado deixaria o cliente esperando um e-mail que não existe, e ainda
  // gastaria a janela de 60 s do freio de cota.
  if (!remetenteConfigurado()) {
    console.error("send-otp-email: SMTP não configurado");
    return montarResposta({ ok: false, motivo: "sem_remetente" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.rpc("generate_order_otp_v2", {
    p_email: email,
    p_whatsapp: whatsapp,
    p_order_fragment: orderFragment,
  });

  if (error) {
    console.error("send-otp-email: RPC falhou:", error.message);
    return montarResposta({ ok: false, motivo: "envio_falhou" });
  }
  if (!data?.ok) {
    return data?.motivo === "muito_recente"
      ? montarResposta({
          ok: false,
          motivo: "muito_recente",
          espereSegundos: Number(data.espere_segundos ?? 60),
        })
      : montarResposta({ ok: false, motivo: "nao_confere" });
  }

  try {
    await enviarEmail({
      para: data.email,
      assunto: "Seu código de verificação",
      html: htmlDoCodigo(data.otp_code),
    });
  } catch (e) {
    // O código já está gravado e vale 15 minutos. Não apagamos: se o envio
    // falhou por intermitência, uma segunda tentativa depois da janela de 60 s
    // gera outro código e o antigo expira sozinho.
    console.error(`send-otp-email: envio falhou para ${mascarar(data.email)}: ${e?.message}`);
    return montarResposta({ ok: false, motivo: "envio_falhou" });
  }

  console.log(`send-otp-email: enviado para ${mascarar(data.email)}`);
  return montarResposta({ ok: true });
});
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx deno test --allow-all supabase/functions/send-otp-email/index_test.ts`
Esperado: 5 passed.

- [ ] **Passo 5: provar que os testes não passam por acaso**

Troque o `502` de `envio_falhou` por `200` e confirme que o segundo teste fica vermelho. Apague
`${codigo}` do HTML e confirme que o quarto fica vermelho. Desfaça as duas.

- [ ] **Passo 6: NÃO publicar a função**

Publicar é da sessão principal, com o ok do Gabriel, e só depois de o front novo estar junto.

- [ ] **Passo 7: verificação e commit**

Rode os sete comandos: o diff toca `supabase/functions/`, e ali o `lint:ratchet` é o **único** dos
sete que olha essa pasta.

Mensagem: `feat(edge): o envio do código responde se enviou, em vez de sumir numa fila`

---

### Task 4: A tela para de prometer

**Files:**
- Modify: `src/hooks/useOrders.ts:1171-1207` (`generateOrderOtp`)
- Modify: `src/components/ui/custom/OrderSearch.tsx:87-102` (`handleRequestOtp`)
- Create: `tests/front/use-orders-otp-so-promete-o-que-enviou.test.ts`
- Create: `tests/front/order-search-nao-avanca-sem-envio.test.tsx`

**Interfaces:**
- Consumes: o contrato HTTP da Task 3.
- Produces: `generateOrderOtp(email, whatsapp, orderFragment): Promise<boolean>` — mesma
  assinatura de hoje, para não espalhar a mudança pela tela. O que muda é **quando** devolve
  `true`: só depois de o e-mail ter saído.

**Dois arquivos de teste, e não um.** A tela e o hook falham por motivos diferentes: o hook erra
traduzindo a resposta HTTP, a tela erra avançando de passo sem sucesso. Um teste só, montando a
tela de verdade para exercitar o hook, arrastaria junto todo o caminho de boot de
`useOrders(true, false)` — e um `mock` incompleto ali produz vermelho que não é sobre o defeito.

**Fatos da tela, lidos em 19/08/2026 — não invente seletor:**
- Props: `onNavigate` (obrigatória), `title?`, `description?`, `onOrdersFound?`. **Não existe
  `onClose`.**
- **Não há um único `id=` no arquivo.** Os campos se acham pelo `placeholder`, em maiúsculas:
  `SEU E-MAIL`, `SEU WHATSAPP`, `ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO`, `DIGITE O CÓDIGO DE 6 DÍGITOS`.
- O componente abre na aba `login`. Para chegar ao formulário de convidado é preciso clicar no
  botão de texto **`Rastrear sem Conta`**.
- O passo é `step === "request"` → `"verify"`. A prova de que a tela **não** avançou é a ausência
  do campo com placeholder `DIGITE O CÓDIGO DE 6 DÍGITOS`.

- [ ] **Passo 1a: escrever o teste do hook, que falha**

```ts
// tests/front/use-orders-otp-so-promete-o-que-enviou.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke }, rpc: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

// Este projeto NÃO tem @testing-library/react — conferido no package.json em
// 19/08/2026. Os testes de front daqui montam com react-dom/client puro. Então
// o hook se alcança por um componente-sonda de três linhas, que só expõe a
// função e não renderiza nada.
async function chamar() {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useOrders } = await import("@/hooks/useOrders");

  let gerar: (e: string, w: string, f: string) => Promise<boolean>;
  function Sonda() {
    gerar = useOrders(true, false).generateOrderOtp;
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(<Sonda />);
  });
  return gerar!;
}

describe("generateOrderOtp — o retorno segue o envio, não a validação", () => {
  beforeEach(() => {
    invoke.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it("chama a edge function, e NÃO a RPC", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const gerar = await chamar();
    await gerar("a@b.c", "34999999999", "abcdef");
    expect(invoke).toHaveBeenCalledWith("send-otp-email", {
      body: { email: "a@b.c", whatsapp: "34999999999", orderFragment: "abcdef" },
    });
  });

  it("envio falhou: devolve false e avisa que a loja não conseguiu enviar", async () => {
    invoke.mockResolvedValue({ data: { ok: false, motivo: "envio_falhou" }, error: null });
    const gerar = await chamar();
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain("Não conseguimos enviar");
  });

  it("dados não conferem: mensagem única, sem dizer qual metade errou", async () => {
    invoke.mockResolvedValue({ data: { ok: false, motivo: "nao_confere" }, error: null });
    const gerar = await chamar();
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain("e-mail, WhatsApp e ID juntos");
  });

  it("pedido repetido cedo demais: diz quantos segundos esperar", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "muito_recente", espereSegundos: 42 },
      error: null,
    });
    const gerar = await chamar();
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain("42");
  });

  it("enviou: devolve true", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const gerar = await chamar();
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(true);
  });
});
```

- [ ] **Passo 1b: escrever o teste da tela, que falha**

```tsx
// tests/front/order-search-nao-avanca-sem-envio.test.tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateOrderOtp = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp, fetchOrdersByOtp: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const CAMPO_CODIGO = "DIGITE O CÓDIGO DE 6 DÍGITOS";

function porPlaceholder(raiz: HTMLElement, texto: string) {
  return raiz.querySelector<HTMLInputElement>(`[placeholder="${texto}"]`);
}

function digitar(raiz: HTMLElement, placeholder: string, valor: string) {
  const campo = porPlaceholder(raiz, placeholder);
  if (!campo) throw new Error(`campo não encontrado: ${placeholder}`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function clicarPorTexto(raiz: HTMLElement, texto: string) {
  const botao = [...raiz.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!botao) throw new Error(`botão não encontrado: ${texto}`);
  botao.click();
}

async function preencherEEnviar(raiz: HTMLElement) {
  await act(async () => {
    clicarPorTexto(raiz, "Rastrear sem Conta");
  });
  await act(async () => {
    digitar(raiz, "SEU E-MAIL", "cliente@teste.com");
    digitar(raiz, "SEU WHATSAPP", "34999999999");
    digitar(raiz, "ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO", "abcdef");
  });
  await act(async () => {
    raiz.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OrderSearch — a tela só avança quando o código saiu", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    generateOrderOtp.mockReset();
    toastSuccess.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("envio falhou: NÃO diz 'enviado' e continua pedindo os dados", async () => {
    generateOrderOtp.mockResolvedValue(false);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await preencherEEnviar(host);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();
  });

  it("envio deu certo: diz 'enviado' e mostra o campo do código", async () => {
    generateOrderOtp.mockResolvedValue(true);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await preencherEEnviar(host);

    expect(toastSuccess).toHaveBeenCalled();
    expect(porPlaceholder(host, CAMPO_CODIGO)).not.toBeNull();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run tests/front/use-orders-otp-so-promete-o-que-enviou.test.ts tests/front/order-search-nao-avanca-sem-envio.test.tsx`
Esperado: os do hook FALHAM — hoje `generateOrderOtp` chama `supabase.rpc` e `invoke` nunca é
usado. Os da tela **passam desde já**, porque a tela já respeita o booleano; eles existem para
travar essa regra contra regressão, e é honesto dizer que nascem verdes.

- [ ] **Passo 3: trocar a chamada no hook**

Em `src/hooks/useOrders.ts`, substituir o corpo de `generateOrderOtp`:

```ts
  const generateOrderOtp = useCallback(
    async (
      email: string,
      whatsapp: string,
      orderFragment: string,
    ): Promise<boolean> => {
      try {
        // Inversão de 19/08/2026 (#161 + #86): quem envia é a edge function, e
        // ela responde se enviou. Antes isto chamava a RPC, que só gravava o
        // código e deixava um gatilho enfileirar o e-mail — a resposta nunca
        // voltava, e a tela prometia entrega que ninguém sabia se acontecera.
        const { data, error } = await supabase.functions.invoke(
          "send-otp-email",
          { body: { email, whatsapp, orderFragment } },
        );

        // `invoke` transforma 502 em erro; o corpo ainda vem em data quando a
        // função respondeu 200 com ok:false.
        if (error && !data) {
          toast.error(
            "Não conseguimos enviar seu código agora. Tente de novo em alguns minutos.",
          );
          return false;
        }

        if (data?.ok) return true;

        if (data?.motivo === "muito_recente") {
          toast.error(
            `Já enviamos um código há pouco. Espere ${data.espereSegundos ?? 60} segundos e confira sua caixa de entrada.`,
          );
          return false;
        }

        if (data?.motivo === "envio_falhou" || data?.motivo === "sem_remetente") {
          toast.error(
            "Não conseguimos enviar seu código agora. Tente de novo em alguns minutos.",
          );
          return false;
        }

        // Mensagem deliberadamente única para "pedido não existe", "e-mail não
        // bate" e "fragmento curto": distinguir diria a quem está adivinhando
        // qual metade ele já acertou (AUTH-010, #118).
        toast.error(
          "Não encontramos um pedido com esse e-mail, WhatsApp e ID juntos.",
        );
        return false;
      } catch (err: any) {
        console.error("Error generating OTP:", err);
        toast.error(
          "Não conseguimos enviar seu código agora. Tente de novo em alguns minutos.",
        );
        return false;
      }
    },
    [],
  );
```

- [ ] **Passo 4: tirar o toast otimista da tela**

Em `src/components/ui/custom/OrderSearch.tsx`, o `toast.success` dentro de `if (success)`
continua — mas agora `success` só é `true` depois do envio. Nenhuma linha muda ali; **confirme
lendo** que não existe outro `toast.success` no caminho de pedir o código, e que
`setStep("verify")` está dentro do `if (success)`.

- [ ] **Passo 5: rodar e ver passar**

Run: `npx vitest run tests/front/use-orders-otp-so-promete-o-que-enviou.test.ts tests/front/order-search-nao-avanca-sem-envio.test.tsx`
Esperado: 7 passed (5 do hook, 2 da tela).

- [ ] **Passo 6: não quebrar o que já passava**

Run: `npm run test:front`
Esperado: a suíte inteira verde. **Rode com `VITE_PAGAMENTO_ONLINE=false`**, que é como o CI roda:
sem isso, `checkout-view-flag-off` é vermelho estável nesta máquina por causa do `.env.local`.
⚠️ Esse vermelho conhecido já escondeu regressão de verdade em 19/08/2026 — não descarte nenhum
vermelho desse arquivo sem antes rodar com a variável sobreposta.

- [ ] **Passo 7: provar que os testes não passam por acaso**

Três mutações, uma de cada vez, desfazendo depois:
1. Faça `generateOrderOtp` devolver `true` incondicionalmente → os testes de `false` do hook e o
   primeiro da tela ficam vermelhos.
2. Troque a mensagem de `nao_confere` pela de `envio_falhou` → o terceiro teste do hook fica
   vermelho. Isso prova que a asserção olha a mensagem certa, e não só "algum toast de erro".
3. Em `OrderSearch`, mova `setStep("verify")` para fora do `if (success)` → o primeiro teste da
   tela fica vermelho. **Esta é a mutação que importa**, porque é exatamente o defeito que este
   plano existe para impedir.

- [ ] **Passo 8: verificação e commit**

Sete comandos. Mensagem: `fix(auth): a tela só diz que o código foi enviado depois de ele sair`

---

### Task 5: Apagar a máquina antiga

**Files:**
- Create: `supabase/migrations/20260820000100_otp_sem_fila_nem_gatilho.sql`
- Create: `rollback-20260820000100_otp_sem_fila_nem_gatilho.sql`
- Modify: `supabase/config.toml` (bloco `send-otp-email`)
- Modify: `DEPLOYMENT.md:52`

**Interfaces:**
- Consumes: as Tasks 1, 3 e 4 já commitadas.
- Produces: nada que outra tarefa use.

**Esta migration é a de corte, e ela só se aplica DEPOIS de o front novo e a função nova estarem
no ar.** Enquanto a produção rodar o front antigo, é a v1 + gatilho que atendem.

- [ ] **Passo 1: escrever a migration**

```sql
-- O caminho antigo do código de verificação sai de cena.
--
-- O QUE SAI, E POR QUE CADA PEÇA
--   on_otp_created_send_email / handle_new_otp_verification — o gatilho que
--     enfileirava o e-mail com net.http_post. É a peça que tornava impossível
--     saber se o envio aconteceu (#86): a fila envia DEPOIS do commit, e a RPC
--     já retornou. Sem ele, quem envia é quem foi chamado, e responde.
--   EXECUTE de anon/authenticated na v1 — o navegador não chama mais a v1.
--     Deixar o EXECUTE aberto manteria de pé um caminho que grava código sem
--     enviar e-mail nenhum.
--
-- O QUE NÃO SAI
--   A função generate_order_otp_v1 continua existindo, sem grant para o
--   navegador. Apagá-la aqui deixaria a produção sem caminho nenhum caso o
--   deploy do front precise ser revertido. Vira dívida com issue própria.
--   O segredo otp_trigger_secret no Vault e o OTP_TRIGGER_SECRET nos segredos
--   da function também ficam para uma limpeza à parte, pelo mesmo motivo.

DROP TRIGGER IF EXISTS "on_otp_created_send_email" ON public.otp_verifications;
DROP FUNCTION IF EXISTS public.handle_new_otp_verification();

REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v1(text, text, text) FROM anon, authenticated;
```

- [ ] **Passo 2: escrever o rollback**

```sql
-- Desfaz 20260820000100: recria o gatilho e devolve o EXECUTE.
-- O corpo de handle_new_otp_verification é cópia literal do baseline
-- 20260806000000, linhas 2907-2942.
CREATE OR REPLACE FUNCTION public.handle_new_otp_verification() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_chave text;
BEGIN
    SELECT decrypted_secret INTO v_chave
      FROM vault.decrypted_secrets WHERE name = 'otp_trigger_secret';

    IF coalesce(v_chave, '') = '' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Código de verificação não enviado: segredo "otp_trigger_secret" ausente no Vault.',
            HINT    = 'Restaure o segredo. Enquanto ele faltar, o código não chega ao cliente e por isso a solicitação falha aqui, em vez de prometer entrega.';
    END IF;

    PERFORM net.http_post(
        url := 'https://cafkrminfnokvgjqtkle.functions.supabase.co/send-otp-email',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_chave
        ),
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', 'otp_verifications',
            'record', row_to_json(NEW)::jsonb
        )
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER "on_otp_created_send_email"
    AFTER INSERT ON public.otp_verifications
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_otp_verification();

GRANT EXECUTE ON FUNCTION public.generate_order_otp_v1(text, text, text) TO anon, authenticated;
```

⚠️ O rollback recria o gatilho, mas **a função no ar já será a nova**, que não entende o payload
`{record}`. Reverter de verdade exige republicar a função antiga junto. Escrito aqui para quem
precisar não descobrir sozinho.

- [ ] **Passo 3: provar com `ROLLBACK`, sem gravar**

Numa transação: aplicar; conferir que `pg_trigger` não tem mais `on_otp_created_send_email` e que
`anon` perdeu o EXECUTE na v1; `ROLLBACK`; conferir que o gatilho voltou e o grant também.

- [ ] **Passo 4: NÃO aplicar**

- [ ] **Passo 5: corrigir o `config.toml`**

O bloco de `send-otp-email` inteiro é substituído:

```toml
# Com JWT, desde a inversão de 19/08/2026 (#161 + #86). Quem chama agora é o
# NAVEGADOR do cliente, com a chave anon do projeto — e essa chave passa pelo
# portão (medido em 19/08/2026). O gatilho do banco, que se autenticava com um
# segredo opaco e por isso exigia verify_jwt = false, deixou de existir.
[functions."send-otp-email"]
verify_jwt = true
```

- [ ] **Passo 6: corrigir o `DEPLOYMENT.md`**

O parágrafo que manda "sempre deploye a `send-otp-email` com `--no-verify-jwt`" passa a estar
errado e vira o contrário: **deployar sem a flag**, porque o valor agora está versionado no
`config.toml` como `true`. Manter uma linha dizendo o que mudou e quando.

- [ ] **Passo 7: verificação e commit**

Mensagem: `refactor(db): a fila e o gatilho do código de verificação saem de cena`

---

### Task 6: Conferir o conjunto contra o pedido

**Files:** nenhum. É leitura.

Esta tarefa existe porque cinco tarefas passando uma a uma não provam que o conjunto é o que foi
pedido. Ela nasce escrita aqui, junto com as outras, e não lembrada no fim.

⚠️ **Nesta sessão não há revisor de contexto limpo nem `diretor`** — subagentes estão desligados.
Isso é uma perda real de cobertura, e quem executar precisa saber que o CI é a única instância
independente que sobrou.

- [ ] **Passo 1: reler o pedido original**

O que o Gabriel aprovou, nas palavras dele: *"aprovado, pode inverter"* — sobre a proposta de que
a tela só diga "enviado" quando enviou, e de que suma a fila, o gatilho e o segredo compartilhado.

- [ ] **Passo 2: apontar, para cada item, onde ele foi cumprido**

| Pedido | Onde |
|---|---|
| A tela só promete depois do envio | Task 4, teste "envio falhou: NÃO diz 'enviado' e continua pedindo os dados" |
| Some a fila / o gatilho | Task 5, `DROP TRIGGER` + `DROP FUNCTION` |
| Some o segredo compartilhado | Task 3, a autenticação por header sai da função |
| O e-mail sai de verdade | Task 2 + Task 3, SMTP na 465 |

- [ ] **Passo 3: conferir que a verificação teve lastro**

Para cada tarefa: o teste existe em disco, foi rodado, e a prova de mutação foi feita. Saída
colada, não afirmada.

- [ ] **Passo 4: listar o que ficou de fora, com nome**

- `generate_order_otp_v1` continua existindo sem grant para o navegador — dívida com issue.
- `otp_trigger_secret` (Vault) e `OTP_TRIGGER_SECRET` (segredos da function) continuam gravados.
- O `RESEND_API_KEY` deixa de ser usado por esta função, mas continua no cofre.
- A porta 587 abriu no TCP contra o que a doc diz; não foi investigado, e não decide nada.
