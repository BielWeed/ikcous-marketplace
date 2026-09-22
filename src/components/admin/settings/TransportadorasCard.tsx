import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  chavesDeTransportadoraDaLista,
  listaComRetirada,
  retiradaLigadaNaLista,
} from "@/lib/guarda-de-frete";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import type { StoreConfig } from "@/types";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Lock,
  Package,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type ProvedorDeFrete = NonNullable<StoreConfig["shippingProvider"]>;

/**
 * Provedores cuja chave tem AMBIENTE (Sandbox x produção). As duas
 * documentações dizem o mesmo: a chave de um ambiente não vale no outro —
 * por isso trocar o modo de testes exige colar a chave do ambiente novo.
 */
const PROVEDORES_COM_SANDBOX: ReadonlySet<ProvedorDeFrete> = new Set([
  "melhor_envio",
  "superfrete",
]);

const NOME_DA_CHAVE: Readonly<Record<string, string>> = {
  melhor_envio: "Melhor Envio",
  frenet: "Frenet",
  superfrete: "SuperFrete",
};

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
 * - PAINEL-01: sem `credsLoaded`, o campo da chave fica travado — nada é
 *   gravado por cima do que já está salvo;
 * - erro de leitura vira mensagem na tela com "Tentar de novo" — nunca
 *   "Recarregando…" nem estado morto sem saída;
 * - falha do `updateConfig` para o fluxo ANTES do upsert (ADMIN-010);
 * - mudança de config vinda de fora não sobrescreve escolha não salva
 *   (guarda "já sincronizou E está sujo" — a primeira carga sempre passa).
 *
 * LOTE E (13/09/2026, peça C — salão e porão): o conteúdo veste o idioma
 * visual do novo Ajustes. O card `rounded-3xl border-white/5` passou a ser
 * da casca (SecaoColapsavel — mesma divisão da seção de Identidade, que
 * sempre foi conteúdo puro), então aqui sobra conteúdo: rótulos font-black
 * uppercase tracking-[0.2em], blocos internos em zinc-950/900, admin-gold
 * como único acento.
 *
 * RELEASE 1.5.4 — A CHAVE VIRA SÓ-ESCRITA (e chega a SuperFrete). Esta seção
 * era a última porta por onde o token da conta real da transportadora
 * descia ao navegador (`select("*")` + campo de senha preenchido com o
 * salvo). Agora ela sabe só SE há chave e SE o modo de testes está ligado —
 * os dois perguntados ao Postgres por FILTRO (`credentials->>token`,
 * `credentials->>sandbox`), com `select("provider")`: a coluna
 * `credentials` nunca é pedida (mesmo molde da tela de Frete,
 * AdminShippingView-126). O campo nasce vazio com o selo "chave salva";
 * Salvar só grava credencial quando uma chave NOVA foi digitada
 * (`{ token, sandbox }`); "Testar" sem chave digitada pede à edge que use a
 * SALVA (`usarCredencialSalva`), que ela lê com a service role depois de
 * conferir que quem pede é admin.
 */

const OPCOES: ReadonlyArray<{
  readonly id: ProvedorDeFrete;
  readonly nome: string;
  readonly descricao: string;
  readonly detalhe: string;
}> = [
  {
    id: "flat_fee",
    // TEXTOS ajustados pela frete-v2-0309 (frente A — permissão do dossiê:
    // só texto, sem lógica nova): a taxa fixa foi aposentada na edge
    // (calculate-shipping deixa de cotar por ela). Escolher esta opção
    // agora significa, honestamente, "sem cotação de fora".
    nome: "Sem cotação automática",
    descricao:
      "Sem transportadora: a loja entrega apenas na sua cidade. Para vender para todo o Brasil, conecte uma transportadora.",
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
  {
    id: "superfrete",
    nome: "SuperFrete",
    descricao:
      "O frete é cotado na hora com Correios (PAC e SEDEX) e, onde houver ponto de postagem perto da loja, Jadlog. Precisa de uma conta na SuperFrete e da chave de acesso dela. A etiqueta é feita no site da SuperFrete.",
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

  // Credenciais — SÓ-ESCRITA (1.5.4). O que o banco conta ao navegador:
  // quais provedores TÊM chave e quais estão no modo de testes. A chave em si
  // só existe aqui enquanto a lojista digita uma NOVA (`chaveDigitada`), e
  // some do estado assim que é salva.
  const [comChaveSalva, setComChaveSalva] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [sandboxSalvo, setSandboxSalvo] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [chaveDigitada, setChaveDigitada] = useState<Record<string, string>>(
    {},
  );
  // Escolha do modo de testes ainda não salva, por provedor (ausente = o
  // salvo vale).
  const [sandboxEscolhido, setSandboxEscolhido] = useState<
    Record<string, boolean>
  >({});
  // PAINEL-01: `credsLoaded` só vira true quando a leitura devolveu dados de
  // verdade — sem ela o campo da chave fica travado.
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
      // Duas perguntas, as duas respondidas pelo Postgres por FILTRO: a
      // coluna `credentials` nunca entra no `select` (o token não sai do
      // banco). RLS já restringe as linhas ao admin da loja.
      const [comToken, emSandbox] = await Promise.all([
        supabase
          .from("store_shipping_credentials")
          .select("provider")
          .not("credentials->>token", "is", null)
          .neq("credentials->>token", ""),
        supabase
          .from("store_shipping_credentials")
          .select("provider")
          .eq("credentials->>sandbox", "true"),
      ]);
      const erro = comToken.error ?? emSandbox.error;
      if (!erro && comToken.data && emSandbox.data) {
        setComChaveSalva(
          new Set(
            comToken.data.map((row: { provider: string }) => row.provider),
          ),
        );
        setSandboxSalvo(
          new Set(
            emSandbox.data.map((row: { provider: string }) => row.provider),
          ),
        );
        setSandboxEscolhido({});
        setCredsLoaded(true);
      } else {
        console.error(
          "[TransportadorasCard] Credenciais não carregaram:",
          erro,
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

    // Só os SERVIÇOS de transportadora contam: a chave `store-pickup` é da
    // tela de Frete (retirada na loja) e ligá-la lá não pode sujar esta seção.
    const methodsA = chavesDeTransportadoraDaLista(escolha.methods);
    const methodsB = chavesDeTransportadoraDaLista(
      config.enabledShippingMethods,
    );
    if (methodsA.length !== methodsB.length) return true;
    const sortedA = [...methodsA].sort();
    const sortedB = [...methodsB].sort();
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return true;
    }

    const provider = escolha.provider;
    if (provider !== "flat_fee") {
      // Chave NOVA digitada = há o que salvar. (A salva não está aqui para
      // comparar — e não precisa: campo vazio = "mantém a salva".)
      if ((chaveDigitada[provider] ?? "").trim() !== "") return true;
      if (
        PROVEDORES_COM_SANDBOX.has(provider) &&
        provider in sandboxEscolhido &&
        sandboxEscolhido[provider] !== sandboxSalvo.has(provider)
      ) {
        return true;
      }
    }

    return false;
  }, [escolha, config, chaveDigitada, sandboxEscolhido, sandboxSalvo]);

  // O modo de testes que a tela mostra: a escolha pendente, ou o salvo.
  const sandboxDe = useCallback(
    (provider: string) =>
      provider in sandboxEscolhido
        ? sandboxEscolhido[provider]
        : sandboxSalvo.has(provider),
    [sandboxEscolhido, sandboxSalvo],
  );

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
    const digitada = (chaveDigitada[provider] ?? "").trim();
    if (!digitada && !comChaveSalva.has(provider)) {
      toast.error("Informe a chave de acesso para testar.");
      return;
    }

    setIsTestingCreds(true);
    setTestResult(null);
    haptic.light();

    // Chave digitada (ainda não salva) vai no corpo — é a lojista testando o
    // que acabou de colar. Sem ela, a edge usa a SALVA: o navegador não tem
    // (nem precisa ter) o token.
    const corpo = digitada
      ? {
          action: "test_credentials",
          provider,
          credentials:
            provider === "frenet"
              ? { token: digitada }
              : { token: digitada, sandbox: sandboxDe(provider) },
        }
      : { action: "test_credentials", provider, usarCredencialSalva: true };

    try {
      const { data, error } = await supabase.functions.invoke(
        "calculate-shipping",
        { body: corpo },
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
  }, [isOffline, escolha.provider, chaveDigitada, comChaveSalva, sandboxDe]);

  const handleSave = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar.",
      });
      return;
    }
    if (isSaving || !isDirty) return;

    const provider = escolha.provider;
    const chaveNova = (chaveDigitada[provider] ?? "").trim();
    const sandboxNovo = sandboxDe(provider);
    const temAmbiente =
      provider !== "flat_fee" && PROVEDORES_COM_SANDBOX.has(provider);
    // A chave é POR AMBIENTE (Sandbox x produção): mudar só o interruptor,
    // sem colar a chave do ambiente novo, deixaria a chave velha apontada
    // para o ambiente errado. Recusa ANTES de gravar qualquer coisa.
    if (
      temAmbiente &&
      !chaveNova &&
      sandboxNovo !== sandboxSalvo.has(provider)
    ) {
      toast.error("Cole a chave do ambiente escolhido", {
        description:
          "Sandbox e produção usam chaves diferentes: para trocar o modo de testes, cole a chave de acesso do ambiente novo e salve.",
      });
      return;
    }

    setIsSaving(true);
    haptic.medium();

    try {
      // 1. A escolha (transportadora + serviços) grava no store_config.
      // Falhou? PARA AQUI — antes de tocar em credencial (ADMIN-010).
      // A retirada na loja (`store-pickup`) vem do config ATUAL, nunca da
      // escolha local: a tela de Frete pode tê-la ligado/desligado depois que
      // esta seção sincronizou — gravar a lista local a desfaria em silêncio.
      const salvou = await updateConfig({
        shippingProvider: escolha.provider,
        enabledShippingMethods: listaComRetirada(
          escolha.methods,
          retiradaLigadaNaLista(config?.enabledShippingMethods),
        ),
      });
      if (!salvou) {
        haptic.error();
        return;
      }

      // 2. Credencial SÓ quando há chave NOVA (1.5.4). Campo vazio = a salva
      // continua valendo; nada é regravado a partir do navegador.
      if (provider !== "flat_fee" && chaveNova) {
        const credentials =
          provider === "frenet"
            ? { token: chaveNova }
            : { token: chaveNova, sandbox: sandboxNovo };
        const { error: erroCreds } = await supabase
          .from("store_shipping_credentials")
          .upsert(
            {
              provider,
              credentials,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "provider" },
          );

        if (erroCreds) throw erroCreds;

        // A chave sai do estado: daqui em diante a tela só sabe que ela existe.
        setComChaveSalva((prev) => new Set(prev).add(provider));
        setSandboxSalvo((prev) => {
          const proximo = new Set(prev);
          if (credentials.sandbox === true) proximo.add(provider);
          else proximo.delete(provider);
          return proximo;
        });
        setChaveDigitada((prev) => ({ ...prev, [provider]: "" }));
        setSandboxEscolhido((prev) => {
          const { [provider]: _descartado, ...resto } = prev;
          return resto;
        });
      }

      haptic.success();
      toast.success("Transportadora salva!", {
        description:
          provider === "flat_fee"
            ? "Preferência salva: sem cotação automática."
            : chaveNova
              ? "A escolha e a chave de acesso foram salvas."
              : comChaveSalva.has(provider)
                ? "A escolha foi salva. A chave de acesso já salva continua valendo."
                : "A escolha foi salva, mas ainda falta a chave de acesso: sem ela o frete de fora da cidade não é cotado.",
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
    <div className="flex flex-col gap-3 text-zinc-200">
      {/* Rótulo em linguagem de gente (lote E): a pergunta que o lojista
              responde aqui — o título da seção é da casca. */}
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
        Como sua loja envia
      </p>
      <p className="text-xs leading-relaxed text-zinc-400">
        Escolha como o frete é calculado fora da sua cidade: cotado na hora por
        uma transportadora, ou sem cotação automática (a loja entrega apenas na
        sua cidade). Quem compra vê o resultado no fechamento do pedido.
      </p>

      {/* Escolha da transportadora — cartões selecionáveis, um por
                opção. Selecionado = borda e fundo na cor da opção; o
                botão inteiro é o alvo de toque (área generosa no celular). */}
      <div
        role="radiogroup"
        aria-label="Como sua loja envia"
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
                  : "border-white/5 bg-zinc-900/40 hover:border-white/20"
              }`}
            >
              <span
                className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all ${
                  ativa
                    ? "border-admin-gold/30 bg-admin-gold/15 text-admin-gold"
                    : "border-white/5 bg-zinc-900 text-zinc-500"
                }`}
              >
                {opcao.id === "flat_fee" ? (
                  <Tag className="size-4" strokeWidth={2.2} />
                ) : opcao.id === "melhor_envio" ? (
                  <Truck className="size-4" strokeWidth={2.2} />
                ) : opcao.id === "superfrete" ? (
                  <Package className="size-4" strokeWidth={2.2} />
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
                <span className="mt-0.5 block text-xs leading-snug text-zinc-400">
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
        <div className="space-y-3 rounded-2xl border border-white/5 bg-zinc-950/60 p-3.5">
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
                className="self-start rounded-lg border border-white/5 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:border-admin-gold/30"
              >
                Tentar de novo
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              <Lock className="size-3.5 text-admin-gold" />
              <span>
                Chave de acesso — {NOME_DA_CHAVE[escolha.provider] ?? ""}
              </span>
            </div>

            {PROVEDORES_COM_SANDBOX.has(escolha.provider) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">
                  Modo de testes (Sandbox)
                </span>
                {!credsLoaded ? (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-admin-gold">
                    {credsError ? "Indisponível" : "Carregando…"}
                  </span>
                ) : (
                  <Switch
                    checked={sandboxDe(escolha.provider)}
                    disabled={!credsLoaded}
                    onCheckedChange={(checked) => {
                      setSandboxEscolhido((prev) => ({
                        ...prev,
                        [escolha.provider]: checked,
                      }));
                      // O teste anterior era do outro ambiente.
                      setTestResult(null);
                    }}
                    className="scale-75 data-[state=checked]:bg-admin-gold"
                  />
                )}
              </div>
            )}
          </div>

          {/* Selo "chave salva": só com token de verdade no banco (o filtro
              `credentials->>token` não vazio) — linha sem token não conta. */}
          {credsLoaded && comChaveSalva.has(escolha.provider) && (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
              <KeyRound className="size-3.5 shrink-0" />
              <span>
                Chave salva. Por segurança ela não aparece aqui — para trocar,
                cole a nova e salve.
              </span>
            </p>
          )}

          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              disabled={!credsLoaded}
              value={chaveDigitada[escolha.provider] ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setChaveDigitada((prev) => ({
                  ...prev,
                  [escolha.provider]: val,
                }));
              }}
              placeholder={
                comChaveSalva.has(escolha.provider)
                  ? "Cole uma chave nova só se quiser trocar a salva..."
                  : "Cole aqui a chave de acesso da sua conta..."
              }
              className="h-9 flex-1 rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            />
            <button
              type="button"
              disabled={
                isTestingCreds ||
                (!(chaveDigitada[escolha.provider] ?? "").trim() &&
                  !comChaveSalva.has(escolha.provider))
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

          {escolha.provider === "superfrete" && (
            <p className="text-[11px] leading-snug text-zinc-400">
              O teste faz uma cotação de verdade na SuperFrete (nada é comprado)
              e só passa com uma chave válida do ambiente escolhido — Sandbox e
              produção têm chaves diferentes.
            </p>
          )}

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
            <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
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
                        : "border-white/5 bg-zinc-900 text-zinc-400 hover:text-white"
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
          <span className="font-bold text-zinc-300">{opcaoAtiva?.nome}</span>
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
  );
});
