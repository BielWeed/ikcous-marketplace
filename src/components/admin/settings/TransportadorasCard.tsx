import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type ProvedorDeFrete = "flat_fee" | "melhor_envio" | "frenet";

interface TransportadorasSectionProps {
  /**
   * Avisar o pai quando a seção tem alteração não salva. Em Ajustes, o pai
   * usa isto para BLOQUEAR o fechamento da seção colapsável — fechar
   * desmonta o card e descartaria o token digitado sem aviso (a trava que
   * a tela de Frete tinha via guarda de navegação do painel; aqui o
   * "sair" é o clique no cabeçalho da própria seção).
   */
  readonly onDirtyMudou?: (dirty: boolean) => void;
}

/**
 * Card "Transportadoras e cotação de frete" da tela de Ajustes.
 *
 * ESTE CONTEÚDO MODOU DE TELA (frente glm-visual-admin-0209, pedido do
 * Gabriel em 02/09/2026): o token da transportadora, o teste de conexão e
 * os serviços habilitados viviam DENTRO da tela de Frete, misturados com as
 * regras de cobrança. Configuração de API é ajuste raro — aqui virou uma
 * seção colapsável, nascida fechada como as demais da tela. A tela de Frete
 * segue dona das REGRAS (frete grátis, taxa, origem, cobertura); esta seção
 * é a dona de `shippingProvider`, `enabledShippingMethods` e das credenciais
 * — salvar Frete não toca nelas, e salvar aqui não toca nas regras.
 *
 * Todas as travas auditadas vieram junto, sem reescrita do comportamento:
 * - PAINEL-01: sem `credsLoaded`, o save NÃO grava credencial (não apaga o
 *   token real com `{}`), avisa no toast o que ficou de fora;
 * - erro de leitura vira mensagem na tela com "Tentar de novo" — nunca
 *   "Recarregando…" nem estado morto sem saída;
 * - falha do `updateConfig` para o fluxo ANTES do upsert (ADMIN-010);
 * - mudança de config vinda de fora não sobrescreve escolha não salva
 *   (guarda "já sincronizou E está sujo" — a primeira carga sempre passa).
 */

const OPCOES: ReadonlyArray<{
  readonly id: ProvedorDeFrete;
  readonly nome: string;
  readonly descricao: string;
  readonly detalhe: string;
}> = [
  {
    id: "flat_fee",
    nome: "Taxa única fixa",
    descricao:
      "Sem transportadora: quem compra em qualquer CEP do Brasil paga a taxa fixa que você definir na tela de Frete.",
    detalhe: "Não precisa de conta em transportadora",
  },
  {
    id: "melhor_envio",
    nome: "Melhor Envio",
    descricao:
      "O frete é cotado na hora com Correios, Jadlog e Azul Cargo. Precisa de uma conta no Melhor Envio e da chave de acesso dela.",
    detalhe: "Cotação automática",
  },
  {
    id: "frenet",
    nome: "Frenet",
    descricao:
      "O frete é cotado na hora com as transportadoras conectadas à sua conta Frenet. Precisa da chave de acesso dela.",
    detalhe: "Cotação automática",
  },
];

const SERVICOS = ["sedex", "pac", "jadlog"] as const;

export const TransportadorasSection = memo(function TransportadorasSection({
  onDirtyMudou,
}: TransportadorasSectionProps) {
  const { config, isLoaded, updateConfig } = useStore();
  const isOffline = useOnlineStatus();

  // Escolha local: só vira config de verdade quando o lojista salva.
  const [escolha, setEscolha] = useState<{
    provider: ProvedorDeFrete;
    methods: string[];
  }>({ provider: "flat_fee", methods: ["sedex", "pac"] });

  // Credenciais (mesmos estados da tela de Frete de onde vieram).
  const [shippingCreds, setShippingCreds] = useState<{ [key: string]: any }>(
    {},
  );
  const [originalShippingCreds, setOriginalShippingCreds] = useState<{
    [key: string]: any;
  }>({});
  // PAINEL-01: `credsLoaded` só vira true quando o fetch devolveu dados de
  // verdade — é a guarda que impede o save de apagar o token real.
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [credsError, setCredsError] = useState(false);

  const [isTestingCreds, setIsTestingCreds] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  const fetchShippingCreds = useCallback(async () => {
    // Limpa o erro da rodada anterior no início de CADA busca — um "Tentar
    // de novo" que deu certo precisa tirar o aviso vermelho da tela.
    setCredsError(false);
    try {
      const { data, error } = await supabase
        .from("store_shipping_credentials")
        .select("*");
      if (!error && data) {
        const credsMap: { [key: string]: any } = {};
        data.forEach((row: { provider: string; credentials: any }) => {
          credsMap[row.provider] = row.credentials;
        });
        setShippingCreds(credsMap);
        setOriginalShippingCreds(JSON.parse(JSON.stringify(credsMap)));
        setCredsLoaded(true);
      } else if (error) {
        console.error(
          "[TransportadorasCard] Credenciais não carregaram:",
          error,
        );
        setCredsError(true);
      }
    } catch (err) {
      console.error("Error fetching shipping credentials:", err);
      setCredsError(true);
    }
  }, []);

  // Guarda de sincronização (mesma da tela de Frete): a primeira carga
  // sempre passa; depois, config nova de fora não apaga escolha não salva.
  // A seção é montada sob demanda (nasce fechada dentro de Ajustes), então
  // o efeito dispara no primeiro render com config já carregada — mas a
  // guarda de duas condições continua correta e barata.
  const jaSincronizouRef = useRef(false);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (isLoaded && config) {
      if (jaSincronizouRef.current && isDirtyRef.current) {
        return;
      }
      jaSincronizouRef.current = true;
      setEscolha({
        provider: (config.shippingProvider || "flat_fee") as ProvedorDeFrete,
        methods: config.enabledShippingMethods || ["sedex", "pac"],
      });
      fetchShippingCreds();
    }
  }, [isLoaded, config, fetchShippingCreds]);

  const isDirty = useMemo(() => {
    if (!config) return false;
    if (
      escolha.provider !==
      ((config.shippingProvider || "flat_fee") as ProvedorDeFrete)
    ) {
      return true;
    }

    const methodsA = escolha.methods || [];
    const methodsB = config.enabledShippingMethods || [];
    if (methodsA.length !== methodsB.length) return true;
    const sortedA = [...methodsA].sort();
    const sortedB = [...methodsB].sort();
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return true;
    }

    const provider = escolha.provider;
    if (provider !== "flat_fee") {
      const tokenA = shippingCreds[provider]?.token || "";
      const tokenB = originalShippingCreds[provider]?.token || "";
      if (tokenA !== tokenB) return true;

      if (provider === "melhor_envio") {
        const sandboxA = !!shippingCreds[provider]?.sandbox;
        const sandboxB = !!originalShippingCreds[provider]?.sandbox;
        if (sandboxA !== sandboxB) return true;
      }
    }

    return false;
  }, [escolha, config, shippingCreds, originalShippingCreds]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
    onDirtyMudou?.(isDirty);
  }, [isDirty, onDirtyMudou]);

  const handleTestCredentials = useCallback(async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }

    const provider = escolha.provider;
    const creds = shippingCreds[provider];
    if (!creds || !creds.token) {
      toast.error("Informe o token de acesso para testar.");
      return;
    }

    setIsTestingCreds(true);
    setTestResult(null);
    haptic.light();

    try {
      const { data, error } = await supabase.functions.invoke(
        "calculate-shipping",
        {
          body: {
            action: "test_credentials",
            provider,
            credentials: creds,
          },
        },
      );

      if (error) throw error;

      if (data?.success) {
        setTestResult({
          success: true,
          message: data.message || "Credenciais válidas e conectadas!",
        });
        toast.success("Integração de frete validada com sucesso!");
      } else {
        setTestResult({
          success: false,
          message: data?.error || "Falha na validação das credenciais.",
        });
        toast.error("Falha ao validar credenciais de frete");
      }
    } catch (err: any) {
      console.error("[TestCredentials] Error:", err);
      setTestResult({
        success: false,
        message: mensagemAmigavelErroEdgeFunction(err, {
          mensagemGenerica:
            "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
        }),
      });
      toast.error("Erro ao testar credenciais");
    } finally {
      setIsTestingCreds(false);
    }
  }, [isOffline, escolha.provider, shippingCreds]);

  const handleSave = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar.",
      });
      return;
    }
    if (isSaving || !isDirty) return;

    setIsSaving(true);
    haptic.medium();

    try {
      // 1. A escolha (transportadora + serviços) grava no store_config.
      // Falhou? PARA AQUI — antes de tocar em credencial (ADMIN-010).
      const salvou = await updateConfig({
        shippingProvider: escolha.provider,
        enabledShippingMethods: escolha.methods,
      });
      if (!salvou) {
        haptic.error();
        return;
      }

      // 2. Credenciais só com carga bem-sucedida (PAINEL-01).
      const provider = escolha.provider;
      if (provider !== "flat_fee" && credsLoaded) {
        const creds = shippingCreds[provider] || {};
        const { error: erroCreds } = await supabase
          .from("store_shipping_credentials")
          .upsert(
            {
              provider,
              credentials: creds,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "provider" },
          );

        if (erroCreds) throw erroCreds;
      }

      setOriginalShippingCreds(JSON.parse(JSON.stringify(shippingCreds)));
      haptic.success();
      const credsPuladas = provider !== "flat_fee" && !credsLoaded;
      toast.success("Transportadora salva!", {
        description: credsPuladas
          ? "A escolha foi salva. As chaves de acesso NÃO foram salvas (falha na leitura)."
          : provider === "flat_fee"
            ? "O cálculo pela taxa fixa está salvo."
            : "A escolha e as chaves de acesso foram salvas.",
      });
    } catch (err) {
      console.error("[TransportadorasCard] Error saving:", err);
      haptic.error();
      toast.error("Erro ao salvar as transportadoras.");
    } finally {
      setIsSaving(false);
    }
  };

  const opcaoAtiva = OPCOES.find((o) => o.id === escolha.provider);

  return (
    <div className="space-y-3">
      <div className="admin-glass border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4">
        <div className="flex flex-col gap-3">
          <p className="text-left text-[9.5px] leading-snug text-zinc-400">
            Escolha como o frete é calculado fora da sua cidade: pela taxa fixa
            que você define na tela de Frete, ou cotado na hora por uma
            transportadora. Quem compra vê o resultado no fechamento do pedido.
          </p>

          {/* Escolha da transportadora — cartões selecionáveis, um por
                opção. Selecionado = borda e fundo na cor da opção; o
                botão inteiro é o alvo de toque (área generosa no celular). */}
          <div
            role="radiogroup"
            aria-label="Transportadora para cotação de frete"
            className="space-y-2"
          >
            {OPCOES.map((opcao) => {
              const ativa = escolha.provider === opcao.id;
              return (
                <button
                  key={opcao.id}
                  type="button"
                  role="radio"
                  aria-checked={ativa}
                  disabled={isOffline}
                  onClick={() => {
                    setEscolha((prev) => ({ ...prev, provider: opcao.id }));
                    // Trocar de transportadora invalida o teste anterior:
                    // ele pertencia à chave da opção de antes.
                    setTestResult(null);
                    haptic.light();
                  }}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all active:scale-[0.99] disabled:opacity-40 ${
                    ativa
                      ? "border-admin-gold/40 bg-admin-gold/5"
                      : "border-white/10 bg-black/40 hover:border-white/20"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all ${
                      ativa
                        ? "border-admin-gold/30 bg-admin-gold/15 text-admin-gold"
                        : "border-white/10 bg-zinc-800/80 text-zinc-500"
                    }`}
                  >
                    {opcao.id === "flat_fee" ? (
                      <Tag className="size-4" strokeWidth={2.2} />
                    ) : opcao.id === "melhor_envio" ? (
                      <Truck className="size-4" strokeWidth={2.2} />
                    ) : (
                      <Sparkles className="size-4" strokeWidth={2.2} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-xs font-bold ${ativa ? "text-white" : "text-zinc-300"}`}
                    >
                      {opcao.nome}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-400">
                      {opcao.descricao}
                    </span>
                  </span>
                  {ativa && (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-admin-gold" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Chave de acesso — só existe quando a transportadora é real. */}
          {escolha.provider !== "flat_fee" && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/60 p-3.5">
              {credsError && (
                <div className="flex flex-col gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-px size-3.5 shrink-0 text-red-400" />
                    <p className="text-[11px] font-semibold leading-snug text-red-300">
                      Não foi possível carregar as chaves de frete.
                      <span className="mt-0.5 block font-normal text-red-300/70">
                        O token e o modo Sandbox ficam bloqueados até a leitura
                        funcionar — assim nada é gravado por cima do que já está
                        salvo.
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      fetchShippingCreds();
                    }}
                    className="self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:border-admin-gold/30"
                  >
                    Tentar de novo
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <Lock className="size-3.5 text-admin-gold" />
                  <span>
                    Chave de acesso —{" "}
                    {escolha.provider === "melhor_envio"
                      ? "Melhor Envio"
                      : "Frenet"}
                  </span>
                </div>

                {escolha.provider === "melhor_envio" && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-zinc-400">
                      Modo de testes (Sandbox)
                    </span>
                    {!credsLoaded ? (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-admin-gold">
                        {credsError ? "Indisponível" : "Carregando…"}
                      </span>
                    ) : (
                      <Switch
                        checked={!!shippingCreds.melhor_envio?.sandbox}
                        disabled={!credsLoaded}
                        onCheckedChange={(checked) => {
                          setShippingCreds((prev) => ({
                            ...prev,
                            melhor_envio: {
                              ...prev.melhor_envio,
                              sandbox: checked,
                            },
                          }));
                        }}
                        className="scale-75 data-[state=checked]:bg-admin-gold"
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  disabled={!credsLoaded}
                  value={shippingCreds[escolha.provider]?.token || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setShippingCreds((prev) => ({
                      ...prev,
                      [escolha.provider]: {
                        ...prev[escolha.provider],
                        token: val,
                      },
                    }));
                  }}
                  placeholder="Cole seu Bearer/API Token aqui..."
                  className="h-9 flex-1 rounded-lg border border-white/10 bg-black/60 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                />
                <button
                  type="button"
                  disabled={
                    isTestingCreds || !shippingCreds[escolha.provider]?.token
                  }
                  onClick={handleTestCredentials}
                  className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-1.5 text-xs font-bold text-admin-gold hover:bg-admin-gold/20 active:scale-95 disabled:opacity-40"
                >
                  {isTestingCreds ? (
                    <RefreshCw className="size-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                  <span>Testar</span>
                </button>
              </div>

              {testResult && (
                <div
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
                    testResult.success
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-red-500/30 bg-red-500/10 text-red-300"
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <AlertCircle className="size-4 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Serviços habilitados: o que o cliente pode escolher na
                    hora de pagar o frete cotado. */}
              <div className="space-y-1.5 pt-1">
                <span className="block text-[11px] font-semibold text-zinc-400">
                  Serviços que o cliente pode escolher
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {SERVICOS.map((method) => {
                    const selecionado = escolha.methods.some(
                      (m) => m.toLowerCase() === method,
                    );
                    return (
                      <button
                        key={method}
                        type="button"
                        disabled={isOffline}
                        onClick={() => {
                          setEscolha((prev) => {
                            const tem = prev.methods.some(
                              (m) => m.toLowerCase() === method,
                            );
                            return {
                              ...prev,
                              methods: tem
                                ? prev.methods.filter(
                                    (m) => m.toLowerCase() !== method,
                                  )
                                : [...prev.methods, method],
                            };
                          });
                          haptic.light();
                        }}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-bold capitalize transition-all ${
                          selecionado
                            ? "border-admin-gold/50 bg-admin-gold/15 text-admin-gold"
                            : "border-white/10 bg-zinc-900 text-zinc-500 hover:text-white"
                        }`}
                      >
                        {method}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Rodapé do card: o que está ativo agora + Salvar. */}
          <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
            <span className="min-w-0 text-[10px] leading-snug text-zinc-500">
              Ativo agora:{" "}
              <span className="font-bold text-zinc-300">
                {opcaoAtiva?.nome}
              </span>
            </span>
            <button
              type="button"
              disabled={!isDirty || isSaving || isOffline}
              onClick={handleSave}
              className="flex shrink-0 select-none items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-3.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-admin-gold/30 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {isSaving ? (
                <RefreshCw className="size-3 animate-spin text-admin-gold" />
              ) : (
                <Save className="size-3 text-admin-gold" />
              )}
              <span>{isSaving ? "Salvando..." : "Salvar"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
