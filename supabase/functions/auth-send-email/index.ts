import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { Webhook } from "https://esm.sh/standardwebhooks@1.1.1?target=deno";
import { montarEmailsAuth } from "../_shared/auth-email.ts";
import type { AmbienteLeitura } from "../_shared/credenciais-mp.ts";
import {
  classificarFalhaDeEnvio,
  comTempoLimite,
  resolverRemetente,
  type ResultadoDoEnvio,
} from "../_shared/email-da-loja.ts";
import { enviarEmail } from "../_shared/smtp.ts";
import { readKey } from "../_shared/webpush.ts";

// Auth permite cinco segundos INCLUINDO partida fria. O processamento usa no
// máximo 3,5 s; o prazo real (rede/partida fria) ainda exige medição na loja.
const ORCAMENTO_MS = 3500;
const BANCO_MS = 700;
const MENSAGEM =
  "Não foi possível enviar o e-mail agora. Tente de novo em instantes.";
type Codigo =
  | "metodo_invalido"
  | "segredo_ausente"
  | "assinatura_invalida"
  | "payload_invalido"
  | "sem_remetente"
  | "envio_falhou"
  | "tempo_esgotado";
class FalhaDoHook extends Error {
  constructor(readonly codigo: Codigo) {
    super(codigo);
  }
}

type Dependencias = {
  env?: AmbienteLeitura;
  criarCliente?: () => any;
  smtp?: { carregarNodemailer?: () => Promise<any> };
  waitUntil?: (tarefa: Promise<unknown>) => void;
};

function resposta(status: number): Response {
  return new Response(
    JSON.stringify(
      status === 200 ? {} : { error: { http_code: 500, message: MENSAGEM } },
    ),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

async function nomeDaLoja(cliente: any): Promise<string> {
  try {
    const { data, error } = await comTempoLimite(
      Promise.resolve(
        cliente.from("store_config").select("store_name").limit(1)
          .maybeSingle(),
      ),
      BANCO_MS,
    ) as { data: { store_name?: unknown } | null; error: unknown };
    if (
      !error && typeof data?.store_name === "string" && data.store_name.trim()
    ) {
      return data.store_name;
    }
  } catch { /* Identidade indisponível não impede o e-mail de acesso. */ }
  return "Nossa loja";
}

/** Sem JWT de usuário: SÓ a assinatura Standard Webhooks abre esta porta.
 * Nada de banco, cofre ou SMTP antes da verificação do corpo BRUTO. */
export async function handler(
  req: Request,
  deps: Dependencias = {},
): Promise<Response> {
  const inicio = performance.now();
  const prazoFinalMs = inicio + ORCAMENTO_MS;
  const restante = () => {
    const ms = prazoFinalMs - performance.now();
    if (ms <= 0) throw new FalhaDoHook("tempo_esgotado");
    return ms;
  };
  const env = deps.env ?? Deno.env;
  const processar = async () => {
    if (req.method !== "POST") throw new FalhaDoHook("metodo_invalido");
    const segredo = env.get("SEND_EMAIL_HOOK_SECRET");
    if (!segredo) throw new FalhaDoHook("segredo_ausente");
    let corpo: unknown;
    try {
      const bruto = await req.text();
      if (new TextEncoder().encode(bruto).byteLength > 20 * 1024) {
        throw new Error("payload_grande");
      }
      const wh = new Webhook(segredo.replace(/^v1,whsec_/, ""));
      corpo = wh.verify(bruto, Object.fromEntries(req.headers));
    } catch {
      throw new FalhaDoHook("assinatura_invalida");
    }
    restante();
    const url = env.get("SUPABASE_URL") ?? "";
    // Valida inclusive ação e destinatários ANTES do acesso privilegiado.
    try {
      montarEmailsAuth(corpo, url, "Nossa loja");
    } catch {
      throw new FalhaDoHook("payload_invalido");
    }
    const cliente = deps.criarCliente?.() ?? createClient(
      url,
      readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const [remetente, nome] = await Promise.all([
      resolverRemetente(cliente, {
        env,
        tempoMs: Math.min(BANCO_MS, restante()),
      }),
      nomeDaLoja(cliente),
    ]);
    restante();
    if (remetente.origem === "nenhum") throw new FalhaDoHook("sem_remetente");
    const emails = montarEmailsAuth(corpo, url, nome);
    const runtime = (globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil: (tarefa: Promise<unknown>) => void };
    }).EdgeRuntime;
    const adiar = deps.waitUntil ??
      (runtime ? runtime.waitUntil.bind(runtime) : undefined);
    const registrarDepois = (resultado: ResultadoDoEnvio) => {
      // Sem waitUntil (por exemplo, runner local) omite saúde. Nunca solta
      // envio em segundo plano: apenas a observação, após o SMTP aceitar.
      if (!adiar || !remetente.registrarSaude) return;
      try {
        adiar(
          Promise.resolve().then(() => remetente.registrarSaude!(resultado))
            .catch(() => {}),
        );
      } catch { /* Saúde não pode transformar envio aceito em falha. */ }
    };
    for (const email of emails) {
      restante();
      try {
        // Sem retentativa e sem escrita de saúde no caminho crítico do Auth.
        // A reserva do AMBIENTE ainda é usada pelo resolvedor quando o painel
        // está ausente/ilegível; recusa SMTP não gera outro envio aqui.
        await enviarEmail(email, {
          ...remetente,
          reserva: null,
          registrarSaude: undefined,
        }, { ...deps.smtp, prazoFinalMs });
      } catch (erro) {
        registrarDepois({
          ok: false,
          origem: remetente.origem,
          motivo: classificarFalhaDeEnvio(erro),
        });
        throw new FalhaDoHook("envio_falhou");
      }
    }
    restante();
    registrarDepois({ ok: true, origem: remetente.origem });
  };
  try {
    await comTempoLimite(processar(), restante());
    console.log(
      `auth-send-email: enviado ${Math.round(performance.now() - inicio)}ms`,
    );
    return resposta(200);
  } catch (erro) {
    const codigo: Codigo = erro instanceof FalhaDoHook
      ? erro.codigo
      : performance.now() >= prazoFinalMs
      ? "tempo_esgotado"
      : "envio_falhou";
    // Nunca imprime erro bruto: pode conter usuário, senha, token e link.
    console.error(
      `auth-send-email: ${codigo} ${Math.round(performance.now() - inicio)}ms`,
    );
    return resposta(500);
  }
}

if (import.meta.main) Deno.serve((req) => handler(req));
