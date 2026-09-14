import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  PASSOS_DO_GUIA,
  PROMPT_PARA_AGENTE_MP,
  RECADO_DE_SEGURANCA,
} from "./mercado-pago-conteudo";

/**
 * Card "Mercado Pago" da tela de Ajustes — peça 20 (14/09/2026, pedido do
 * dono por voz): o LOJISTA cadastra as chaves do Mercado Pago dele, guiado
 * pelo passo a passo com prompt pronto para o agente de IA do app do MP, e
 * testa a conexão ali mesmo.
 *
 * SEGURANÇA (desenho desta peça, mais forte que o precedente das
 * transportadoras, que expõe o token):
 * - O Access Token NUNCA volta para a tela: o servidor só devolve MÁSCARA
 *   ("••••1234"). O campo de token nasce vazio; vazio ao salvar = mantém a
 *   chave já salva.
 * - O teste de conexão roda NO SERVIDOR (edge credenciais-mercado-pago) —
 *   a chave real nunca chega ao navegador, nem no teste.
 * - O Pix de hoje (checkout) não passa por aqui: esta seção só guarda,
 *   esconde e testa. Plugar no checkout é frente futura.
 *
 * Fluxo do dono, ditado por voz: a lojista cola as chaves, ELA SALVA e ELA
 * TESTA. Por isso "Testar conexão" fica bloqueado enquanto houver coisa
 * não salva — testar outra coisa diferente do que está na tela enganaria.
 */

/** O que a edge devolve no "ler"/"salvar" — segredo JAMAIS está aqui. */
type ConfiguracaoMp = {
  configurado: boolean;
  public_key: string | null;
  mascara_token: string | null;
  mascara_webhook: string | null;
  ultimo_teste: {
    quando: string;
    conectado: boolean;
    mensagem: string;
    ambiente: "producao" | "teste" | null;
    conta: string | null;
  } | null;
  atualizado_em: string | null;
};

const VAZIA: ConfiguracaoMp = {
  configurado: false,
  public_key: null,
  mascara_token: null,
  mascara_webhook: null,
  ultimo_teste: null,
  atualizado_em: null,
};

/**
 * Recado amigável do erro de invoke: o corpo `{ erro }` vem da NOSSA edge
 * (frases escritas aqui do lado de cá do negócio, sem jargão e sem segredo)
 * e por isso pode ir direto para a tela. Todo o resto passa pelo tradutor
 * da casa, que só conhece causas fixas do SDK.
 */
async function erroAmigavel(error: unknown, generico: string): Promise<string> {
  try {
    const detalhes = error as { name?: unknown; context?: unknown };
    if (
      detalhes?.name === "FunctionsHttpError" &&
      detalhes.context instanceof Response
    ) {
      const corpo = (await detalhes.context.clone().json().catch(() => null)) as
        | { erro?: unknown }
        | null;
      if (corpo && typeof corpo.erro === "string" && corpo.erro) {
        return corpo.erro;
      }
    }
  } catch {
    // cai no tradutor da casa
  }
  return mensagemAmigavelErroEdgeFunction(error, {
    mensagemGenerica: generico,
  });
}

export const MercadoPagoSection = memo(function MercadoPagoSection({
  onDirtyMudou,
}: {
  /** Mesma trava das demais seções: avisa o pai para BLOQUEAR o fecho da
   * seção colapsável enquanto houver chave digitada e não salva. */
  readonly onDirtyMudou?: (dirty: boolean) => void;
}) {
  const isOffline = useOnlineStatus();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfiguracaoMp>(VAZIA);

  // Formulário: segredos nascem VAZIOS de propósito (mostrar o salvo
  // seria exibi-lo); a Public Key não é segredo e volta preenchida.
  const [publicKey, setPublicKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const copiadoTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiadoTimer.current !== null) {
        window.clearTimeout(copiadoTimer.current);
      }
    },
    [],
  );

  const ler = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: "ler" } },
      );
      if (error) throw error;
      const lida = (data ?? {}) as ConfiguracaoMp;
      setConfig(lida);
      setPublicKey(lida.public_key ?? "");
    } catch (err) {
      setErroCarga(
        await erroAmigavel(
          err,
          "Não consegui ler as chaves salvas agora. Tente de novo em instantes.",
        ),
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    ler();
  }, [ler]);

  // Sujo = algo na tela que ainda não é verdade no servidor. Public Key
  // diferente da salva OU qualquer segredo digitado.
  const dirty =
    publicKey !== (config.public_key ?? "") ||
    accessToken.length > 0 ||
    webhookSecret.length > 0;

  useEffect(() => {
    onDirtyMudou?.(dirty);
  }, [dirty, onDirtyMudou]);

  const salvar = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar.",
      });
      return;
    }
    if (salvando) return;
    if (!publicKey.trim()) {
      toast.error("Cole a Public Key do Mercado Pago.");
      return;
    }
    if (!config.configurado && !accessToken.trim()) {
      toast.error("Cole também o Access Token — é a chave que processa os pagamentos.");
      return;
    }

    setSalvando(true);
    haptic.medium();
    try {
      // Segredo vazio NÃO vai na carga: servidor interpreta ausência como
      // "mantém a salva" — o campo vazio nunca apaga chave de verdade.
      const corpo: Record<string, unknown> = {
        acao: "salvar",
        public_key: publicKey.trim(),
      };
      if (accessToken.trim()) corpo.access_token = accessToken.trim();
      if (webhookSecret.trim()) corpo.webhook_secret = webhookSecret.trim();

      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: corpo },
      );
      if (error) throw error;

      const salva = (data ?? {}) as ConfiguracaoMp;
      setConfig(salva);
      setPublicKey(salva.public_key ?? "");
      setAccessToken("");
      setWebhookSecret("");
      haptic.success();
      toast.success("Chaves do Mercado Pago salvas!", {
        description: 'Agora toque em "Testar conexão" para conferir.',
      });
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(err, "Não consegui salvar as chaves agora. Tente de novo."),
      );
    } finally {
      setSalvando(false);
    }
  };

  const testarConexao = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    if (testando || dirty || !config.configurado) return;

    setTestando(true);
    haptic.light();
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: "testar" } },
      );
      if (error) throw error;
      const resultado = (data ?? {}) as {
        conectado: boolean;
        mensagem: string;
      };
      setConfig((antes) => ({
        ...antes,
        ultimo_teste: {
          quando: new Date().toISOString(),
          conectado: resultado.conectado,
          mensagem: resultado.mensagem,
          ambiente: null,
          conta: null,
        },
      }));
      if (resultado.conectado) haptic.success();
      else haptic.error();
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(err, "Não consegui testar a conexão agora. Tente de novo."),
      );
    } finally {
      setTestando(false);
    }
  };

  const copiarPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT_PARA_AGENTE_MP);
      setCopiado(true);
      haptic.light();
      if (copiadoTimer.current !== null) window.clearTimeout(copiadoTimer.current);
      copiadoTimer.current = window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(
        "Não consegui copiar agora. Toque no texto e copie manualmente.",
      );
    }
  };

  const teste = config.ultimo_teste;

  return (
    <div className="space-y-4">
      {/* ── Estado da conexão ─────────────────────────────────────────── */}
      {carregando ? (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="size-3.5 animate-spin" /> Lendo as chaves salvas…
        </p>
      ) : erroCarga ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" /> {erroCarga}
          </span>
          <button
            type="button"
            onClick={ler}
            className="shrink-0 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-2.5 py-1 font-bold text-admin-gold hover:bg-admin-gold/20"
          >
            Tentar de novo
          </button>
        </div>
      ) : teste ? (
        <div
          className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
            teste.conectado
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {teste.conectado ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertCircle className="size-4 shrink-0" />
          )}
          <span>{teste.mensagem}</span>
        </div>
      ) : config.configurado ? (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <ShieldCheck className="size-4 shrink-0 text-admin-gold" /> Chaves
          salvas. Falta testar a conexão.
        </p>
      ) : null}

      {/* ── Guia passo a passo com o prompt pronto ────────────────────── */}
      <div className="space-y-3 rounded-2xl border border-white/5 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-admin-gold" />
          <h4 className="text-xs font-black uppercase tracking-[0.2em] text-white">
            Como pegar suas chaves
          </h4>
        </div>

        <ol className="space-y-3">
          {PASSOS_DO_GUIA.map((passo, indice) => (
            <li key={passo.titulo} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-admin-gold/15 text-[11px] font-black text-admin-gold ring-1 ring-admin-gold/30">
                {indice + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-white">
                  {passo.titulo}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
                  {passo.descricao}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {/* O prompt pronto: o texto vive no arquivo de conteúdo; aqui só a
            caixa e o botão de copiar, com o feedback "Copiado!". */}
        <div className="space-y-2">
          <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            Pedido pronto para colar no agente
          </span>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {PROMPT_PARA_AGENTE_MP}
          </pre>
          <button
            type="button"
            onClick={copiarPrompt}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
              copiado
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-admin-gold/30 bg-admin-gold/10 text-admin-gold hover:bg-admin-gold/20"
            }`}
          >
            {copiado ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            <span>{copiado ? "Copiado!" : "Copiar prompt"}</span>
          </button>
        </div>
      </div>

      {/* ── Formulário das chaves ─────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor="mp-public-key"
            className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
          >
            Public Key
          </label>
          <input
            id="mp-public-key"
            type="text"
            disabled={carregando}
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="APP_USR-…"
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="mp-access-token"
            className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
          >
            <span>Access Token</span>
            {config.mascara_token && (
              <span className="font-mono normal-case tracking-normal text-zinc-400">
                salva: {config.mascara_token}
              </span>
            )}
          </label>
          <input
            id="mp-access-token"
            type="password"
            disabled={carregando}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={
              config.mascara_token
                ? "Deixe vazio para manter a chave salva"
                : "Cole aqui o Access Token de produção…"
            }
            autoComplete="new-password"
            className="h-9 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="mp-webhook-secret"
            className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
          >
            <span>Chave de notificações (opcional)</span>
            {config.mascara_webhook && (
              <span className="font-mono normal-case tracking-normal text-zinc-400">
                salva: {config.mascara_webhook}
              </span>
            )}
          </label>
          <input
            id="mp-webhook-secret"
            type="password"
            disabled={carregando}
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={
              config.mascara_webhook
                ? "Deixe vazio para manter a salva"
                : "Opcional: a chave de validação de notificações do MP"
            }
            autoComplete="new-password"
            className="h-9 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={salvando || carregando || isOffline}
            onClick={salvar}
            className="flex items-center gap-1.5 rounded-lg bg-admin-gold px-4 py-2 text-xs font-black text-zinc-950 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {salvando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>Salvar chaves</span>
          </button>

          <button
            type="button"
            disabled={testando || carregando || isOffline || dirty || !config.configurado}
            onClick={testarConexao}
            title={
              dirty
                ? "Salve as chaves primeiro — o teste fala com o Mercado Pago usando o que está salvo."
                : undefined
            }
            className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-2 text-xs font-bold text-admin-gold hover:bg-admin-gold/20 active:scale-95 disabled:opacity-40"
          >
            {testando ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            <span>Testar conexão</span>
          </button>

          {dirty && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
              Salve para testar
            </span>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
          <Lock className="mt-0.5 size-3 shrink-0" /> {RECADO_DE_SEGURANCA}
        </p>
      </div>
    </div>
  );
});
