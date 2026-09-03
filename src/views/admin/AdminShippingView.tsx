import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import {
  type EstadoConexaoNacional,
  FreteNacionalBloco,
} from "@/components/admin/shipping/FreteNacionalBloco";
import {
  FreteResumoHero,
  type StatusDoHeroFrete,
} from "@/components/admin/shipping/FreteResumoHero";
import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  type PresetFreteGratis,
  presetDoConfig,
  valorDoPreset,
} from "@/lib/presets-de-frete-gratis";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AlertCircle, HelpCircle, RefreshCw, Save } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminShippingViewProps {
  onNavigate?: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

/**
 * Tela "Frete" do painel — redesign COMPLETO da frente frete-v2-0309
 * (03/09/2026, ordem do dono ao vivo: o ok visual do PR #414 foi REPROVADO —
 * "o visual não mudou nada" — e a "taxa de entrega fixa" foi aposentada:
 * "parece opção duplicada").
 *
 * COMPOSIÇÃO NOVA (a antiga era uma lista de cards; esta é um painel com
 * índice): um HERO que responde "como a entrega funciona hoje?" derivando o
 * estado REAL do config salvo, seguido de 3 blocos grandes com identidade
 * própria — Frete local (âmbar), Frete nacional (azul), Frete grátis
 * (esmeralda, presets em cards de radio). O card de taxa fixa NÃO existe
 * mais: fora da cidade, o preço é só o da cotação real da transportadora
 * (o campo `shippingFee` fica órfão no banco de propósito — e é por isso
 * que o save daqui deixa de enviá-lo).
 *
 * DIVISÃO DE TERRITÓRIO (herdada da frente anterior, segue valendo):
 * esta tela é a dona das REGRAS (presets de grátis, CEP de origem,
 * cobertura, entrega local). Provedor, serviços e credenciais são da seção
 * de Transportadoras em Ajustes — daqui eles são apenas LEITURA (a conexão
 * mostrada vem da mesma tabela que Ajustes grava). Salvar aqui NÃO envia
 * `shippingProvider`/`enabledShippingMethods` — enviar de novo daqui
 * revertia a escolha salva por um valor velho de formulário.
 *
 * FRETE GRÁTIS POR PRESETS (contrato único em
 * `src/lib/presets-de-frete-gratis.ts`): a estratégia escolhida é a ÚNICA
 * que vale. A tela ESCREVE via `valorDoPreset` e deriva o ativo via
 * `presetDoConfig` — inclusive as sentinelas do contrato final: "sempre"
 * grava 0,01 e "por produto" grava FRETE_GRATIS_POR_PRODUTO (-1; a
 * estratégia MORA na marcação `product.freeShipping`, o negativo no config
 * é só o marcador dela — por isso a escolha sobrevive à reabertura).
 *
 * Todas as travas auditadas seguem valendo:
 * - o CEP de origem abre VAZIO quando a loja não configurou, com o aviso
 *   da consequência real (sem ele a loja não vende);
 * - trocar de aba não apaga o que foi digitado: a sincronização com config
 *   novo de fora só passa se o formulário não estiver sujo — e a PRIMEIRA
 *   carga sempre passa (o formulário nasce "sujo" contra uma loja
 *   configurada; a guarda de uma condição só travaria a tela vazia);
 * - o hero descreve o config SALVO (a realidade), não o formulário
 *   pendente — o pendente ganha o selo "alterações não salvas".
 */
export const AdminShippingView = memo(function AdminShippingView({
  onNavigate,
  active,
  onSetDirty,
}: Readonly<AdminShippingViewProps>) {
  const { config, isLoaded, updateConfig } = useStore();
  const isOffline = useOnlineStatus();
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Formulário local — só regras. O frete grátis virou DUAS escolhas
  // explícitas (estratégia + valor mínimo do "acima de"), porque derivar
  // estratégia de um número solto era o que fazia a tela antiga parecer a
  // mesma coisa com outro texto.
  const [formData, setFormData] = useState({
    preset: "desligado" as PresetFreteGratis,
    acimaDe: 0,
    // Sem reserva de propósito: "38500-000" cravava Monte Carmelo no
    // formulário antes mesmo de a loja abrir a tela (herdado da auditoria
    // 26/08 — o CEP de origem é definido SÓ aqui).
    originCep: "",
    shippingCoverage: "national" as "local" | "national",
    localDeliveryFee: 10,
    localCepRange: "",
  });

  // Leitura da credencial de transportadora (mesma tabela que Ajustes
  // grava) — só para dizer a VERDADE sobre a conexão no hero e no bloco
  // nacional. Esta tela nunca grava credencial.
  const [credsMapa, setCredsMapa] = useState<{ [key: string]: any }>({});
  const [credsErro, setCredsErro] = useState(false);

  const fetchCreds = useCallback(async () => {
    setCredsErro(false);
    try {
      const { data, error } = await supabase
        .from("store_shipping_credentials")
        .select("*");
      if (!error && data) {
        const mapa: { [key: string]: any } = {};
        data.forEach((row: { provider: string; credentials: any }) => {
          mapa[row.provider] = row.credentials;
        });
        setCredsMapa(mapa);
      } else {
        setCredsErro(true);
      }
    } catch {
      setCredsErro(true);
    }
  }, []);

  // ── Achado 3 da auditoria rodada 2 (26/08/2026), intacto ─────────────────
  // O efeito abaixo redispara quando `active` volta a `true` (a view do painel
  // nunca desmonta) e quando a identidade de `config` muda (realtime, outra
  // aba, save em outra tela). Sem guarda, ele reescrevia o formulário inteiro
  // e jogava fora o que o lojista tinha acabado de digitar, sem aviso.
  //
  // A guarda NÃO pode ser só "está sujo": numa loja configurada o formulário
  // já nasce "sujo" contra o config ANTES da primeira sincronização — e a
  // tela abriria eternamente vazia. Por isso são duas condições, e a
  // primeira carga sempre passa.
  const jaSincronizouRef = useRef(false);
  const isFormDirtyRef = useRef(false);

  useEffect(() => {
    if (isLoaded && config) {
      if (jaSincronizouRef.current && isFormDirtyRef.current) {
        // Há trabalho não salvo na tela. Nada é recarregado: o valor digitado
        // vence o que chegou de fora.
        return;
      }
      jaSincronizouRef.current = true;
      const minSalvo = Number(config.freeShippingMin ?? 0);
      const presetSalvo = presetDoConfig(minSalvo);
      setFormData({
        preset: presetSalvo,
        acimaDe: presetSalvo === "acima_de_valor" ? minSalvo : 0,
        originCep: config.originCep ?? "",
        shippingCoverage: (config.shippingCoverage || "national") as
          | "local"
          | "national",
        localDeliveryFee: Number(config.localDeliveryFee ?? 10),
        localCepRange: config.localCepRange || "",
      });
      fetchCreds();
    }
  }, [isLoaded, config, active, fetchCreds]);

  // Estado da conexão com a transportadora de cotação — derivado do provedor
  // SALVO (nunca de escolha pendente: fora daqui não existe escolha de
  // provedor "por salvar") cruzado com a credencial gravada.
  //
  // REVISÃO A5 (frete v2, 03/09): `provedorNome` é NULL quando o config não
  // nomeia transportadora (provedor `flat_fee` remanescente de loja antiga ou
  // ausente). O nome define o ARTIGO da frase do bloco nacional — "conecte o
  // Melhor Envio" existe; "conecte o uma transportadora", não. O estado
  // `conectado` só ocorre com provedor nomeado + credencial, então o nome lá
  // nunca é nulo.
  const conexao = useMemo(() => {
    const provedorSalvo = config?.shippingProvider || "flat_fee";
    const nome =
      provedorSalvo === "melhor_envio"
        ? "Melhor Envio"
        : provedorSalvo === "frenet"
          ? "Frenet"
          : null;
    // Taxa fixa remanescente de loja antiga = sem cotação de fora, igual a
    // não conectado (a edge deixou de cotar por ela).
    const estado: EstadoConexaoNacional =
      provedorSalvo === "flat_fee"
        ? "desconectado"
        : credsErro
          ? "indeterminado"
          : credsMapa[provedorSalvo]?.token
            ? "conectado"
            : "desconectado";
    return { estado, provedorNome: nome };
  }, [config?.shippingProvider, credsMapa, credsErro]);

  // ── O hero descreve o que está SALVO (a realidade da loja hoje) ──────────
  // Frases derivadas do config, nunca do formulário pendente: quem abriu a
  // tela para CONFERIR precisa ver o que está valendo; quem veio mexer vê o
  // selo de "alterações não salvas" por cima.
  const statusDoHero = useMemo(() => {
    const minSalvo = Number(config?.freeShippingMin ?? 0);
    const presetSalvo = presetDoConfig(minSalvo);
    const localFee = Number(config?.localDeliveryFee ?? 10);
    const cidade = config?.storeCity;
    const uf = config?.storeState;
    const ondeCidade =
      cidade && uf ? `${cidade}/${uf}` : cidade ? cidade : "sua cidade";

    const local: StatusDoHeroFrete = !config?.originCep
      ? {
          id: "bloco-frete-local",
          rotulo: "Frete local",
          valor: "Parado — falta o CEP da loja",
          detalhe: "Configure abaixo para abrir as vendas",
          tom: "atencao",
        }
      : {
          id: "bloco-frete-local",
          rotulo: "Frete local",
          valor:
            localFee > 0
              ? `R$ ${reais(localFee)} por entrega`
              : "Grátis na cidade",
          detalhe: `Entrega própria em ${ondeCidade}`,
          tom: "positivo",
        };

    const nacional: StatusDoHeroFrete =
      (config?.shippingCoverage || "national") === "local"
        ? {
            id: "bloco-frete-nacional",
            rotulo: "Frete nacional",
            valor: "Só na sua cidade",
            detalhe: "fora dela, a loja não atende",
            tom: "neutro",
          }
        : conexao.estado === "conectado"
          ? {
              id: "bloco-frete-nacional",
              rotulo: "Frete nacional",
              valor: `${conexao.provedorNome} conectado`,
              detalhe: "cotação real na hora",
              tom: "positivo",
            }
          : conexao.estado === "indeterminado"
            ? {
                id: "bloco-frete-nacional",
                rotulo: "Frete nacional",
                valor: "Conexão a confirmar",
                detalhe: "confira a transportadora em Ajustes",
                tom: "neutro",
              }
            : {
                id: "bloco-frete-nacional",
                rotulo: "Frete nacional",
                valor: "Sem transportadora",
                detalhe: "por enquanto, só entrega na cidade",
                tom: "atencao",
              };

    const gratis: StatusDoHeroFrete =
      presetSalvo === "acima_de_valor"
        ? {
            id: "bloco-frete-gratis",
            rotulo: "Frete grátis",
            valor: `Acima de R$ ${reais(minSalvo)}`,
            detalhe: "a compra que passa do valor não paga entrega",
            tom: "positivo",
          }
        : presetSalvo === "sempre"
          ? {
              id: "bloco-frete-gratis",
              rotulo: "Frete grátis",
              valor: "Em toda a loja",
              detalhe: "todo pedido sai com entrega grátis",
              tom: "positivo",
            }
          : presetSalvo === "por_produto"
            ? {
                id: "bloco-frete-gratis",
                rotulo: "Frete grátis",
                valor: "Por produto marcado",
                detalhe: "produtos marcados saem sem custo de entrega",
                tom: "positivo",
              }
            : {
                id: "bloco-frete-gratis",
                rotulo: "Frete grátis",
                valor: "Desligado",
                detalhe: "nenhuma regra de grátis ativa",
                tom: "neutro",
              };

    return [local, nacional, gratis] as const;
  }, [config, conexao]);

  // Dirty check to enable save button — estratégia de grátis explícita +
  // regras. Comparar a ESTRATÉGIA (via `presetDoConfig`, não só o número
  // derivado) é o que faz a troca entre presets contar como mudança na tela:
  // "Por produto marcado" grava a sentinela -1 (FRETE_GRATIS_POR_PRODUTO, o
  // marcador da estratégia que mora na marcação do produto) e "Desligado"
  // grava 0 — números distintos, mas é a comparação de estratégia que conta a
  // história inteira (comentário corrigido pela revisão A6: aqui dizia que
  // por_produto "grava 0, igual Desligado", o que nunca foi verdade).
  const isFormDirty = useMemo(() => {
    if (!config) return false;
    const minAtual = Number(config.freeShippingMin ?? 0);
    if (formData.preset !== presetDoConfig(minAtual)) return true;
    if (formData.preset === "acima_de_valor" && formData.acimaDe !== minAtual)
      return true;
    if (formData.originCep !== (config.originCep ?? "")) return true;
    if (formData.shippingCoverage !== (config.shippingCoverage || "national"))
      return true;
    if (formData.localDeliveryFee !== Number(config.localDeliveryFee ?? 10))
      return true;
    if (formData.localCepRange !== (config.localCepRange || "")) return true;
    return false;
  }, [formData, config]);

  // Report dirty state to AdminLayout
  useEffect(() => {
    onSetDirty?.(isFormDirty);
    // O espelho que o efeito de sincronização lê. Ele é declarado ANTES deste
    // na ordem do componente, então lê o valor do commit anterior — que é
    // exatamente a pergunta certa: "a pessoa já tinha mexido quando esta
    // config nova chegou?".
    isFormDirtyRef.current = isFormDirty;
  }, [isFormDirty, onSetDirty]);

  // Handle save configurations — fluxo intacto da tela anterior (offline →
  // guarda → updateConfig → falha PARA aqui → toasts/haptics). A diferença
  // de payload: frete grátis sai do preset escolhido, e `shippingFee` NÃO é
  // mais enviado (a taxa fixa morreu — o campo fica órfão no banco de
  // propósito; sobrescrevê-lo com valor de formulário não faria sentido).
  const handleSave = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar as configurações.",
      });
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    haptic.medium();

    try {
      // Se esta gravação falhar, PARA AQUI (ADMIN-010, #94). O toast de
      // erro sai de dentro do `updateConfig`.
      const salvou = await updateConfig({
        freeShippingMin: valorDoPreset(formData.preset, formData.acimaDe),
        originCep: formData.originCep,
        shippingCoverage: formData.shippingCoverage,
        localDeliveryFee: Math.max(0, formData.localDeliveryFee),
        localCepRange: formData.localCepRange,
      });
      if (!salvou) {
        haptic.error();
        return;
      }

      onSetDirty?.(false);
      haptic.success();
      toast.success("Regras de frete salvas!");
    } catch (err) {
      console.error("[AdminShippingView] Error saving configs:", err);
      haptic.error();
      toast.error("Erro ao salvar as configurações.");
    } finally {
      setIsSaving(false);
    }
  };

  const irParaBloco = useCallback((id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="pb-admin min-h-screen bg-admin-bg pb-32 text-zinc-100 transition-colors duration-200 animate-in fade-in sm:pb-36 lg:pb-40">
      {/* Top Header Bar — fórmula "Elite Header" (herdada da onda visual
          02/09): AdminPageHeader padronizado + barra sticky na view. */}
      <div className="sticky top-0 z-30 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader titulo="Frete">
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
              title="Ajuda e explicação desta tela"
            >
              <HelpCircle className="size-4" />
            </button>
          </AdminPageHeader>

          <button
            type="button"
            disabled={!isFormDirty || isSaving || isOffline}
            onClick={handleSave}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-admin-gold/30 bg-admin-gold px-4 py-2 text-xs font-bold text-black shadow-lg shadow-amber-500/20 transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {isSaving ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>Salvar</span>
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-3 py-4 sm:p-6">
        {!isLoaded ? (
          <div className="animate-pulse space-y-4" aria-busy="true">
            <div className="h-40 rounded-3xl border border-white/10 bg-zinc-900/40" />
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-44 rounded-3xl border border-white/10 bg-zinc-900/40 p-4"
              >
                <Skeleton className="h-4 w-1/3 rounded-md bg-white/5" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-5">
            <FreteResumoHero
              status={statusDoHero}
              sujo={isFormDirty}
              onIrParaBloco={irParaBloco}
            />

            <FreteLocalBloco
              valor={formData.localDeliveryFee}
              onValor={(valor) =>
                setFormData((prev) => ({ ...prev, localDeliveryFee: valor }))
              }
              faixa={formData.localCepRange}
              onFaixa={(faixa) =>
                setFormData((prev) => ({ ...prev, localCepRange: faixa }))
              }
              cidade={config?.storeCity}
              uf={config?.storeState}
              desabilitado={isOffline}
            />

            <FreteNacionalBloco
              originCep={formData.originCep}
              onOriginCep={(originCep) =>
                setFormData((prev) => ({ ...prev, originCep }))
              }
              coverage={formData.shippingCoverage}
              onCoverage={(shippingCoverage) =>
                setFormData((prev) => ({ ...prev, shippingCoverage }))
              }
              conexao={conexao}
              onAbrirAjustes={
                onNavigate ? () => onNavigate("admin-settings") : undefined
              }
              onTentarDeNovo={fetchCreds}
              desabilitado={isOffline}
            />

            <FreteGratisBloco
              preset={formData.preset}
              acimaDe={formData.acimaDe}
              onEscolher={(preset) => {
                haptic.light();
                setFormData((prev) => ({
                  ...prev,
                  preset,
                  // Primeiro clique no "acima de" sem valor guardado: semente
                  // R$ 100 (a mesma que a tela antiga usava ao ligar o
                  // interruptor) — editável antes de salvar, nunca gravada
                  // sem a pessoa ver.
                  acimaDe:
                    preset === "acima_de_valor" && prev.acimaDe === 0
                      ? 100
                      : prev.acimaDe,
                }));
              }}
              onAcimaDe={(acimaDe) =>
                setFormData((prev) => ({ ...prev, acimaDe }))
              }
              desabilitado={isOffline}
            />

            <p className="flex items-start gap-2 px-1 text-[10.5px] leading-snug text-zinc-600">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              Nada aqui vale antes de Salvar. Mexeu? Confira o resumo lá em cima
              e salve.
            </p>
          </div>
        )}
      </div>

      {/* Ajuda da tela — quem procurava o token sai sabendo onde ele está;
          quem procurava a taxa fixa sai sabendo que ela se foi. */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Ajuda — Frete da loja"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            A entrega da sua loja tem três partes, cada uma com o bloco dela na
            tela: o <span className="font-bold text-zinc-200">frete local</span>{" "}
            (você mesmo entrega na cidade), o{" "}
            <span className="font-bold text-zinc-200">frete nacional</span>{" "}
            (transportadora cotada na hora) e o{" "}
            <span className="font-bold text-zinc-200">frete grátis</span> (você
            escolhe UMA estratégia pronta e edita do seu jeito).
          </p>
          <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <AlertCircle className="size-4 text-amber-500" />A taxa fixa foi
              aposentada
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">
              Antes existia um valor fixo para entregas fora da cidade. Ele
              enganava: parecia frete de verdade sem cotação nenhuma por trás.
              Agora, fora da sua cidade, o cliente vê SÓ o preço real cotado
              pela transportadora. Sem transportadora conectada, sua loja
              entrega apenas na cidade.
            </p>
          </div>
          <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <HelpCircle className="size-4 text-amber-500" />
              Onde estão as transportadoras
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">
              A chave de acesso das transportadoras (Melhor Envio, Frenet), o
              teste de conexão, os serviços habilitados e o histórico de
              cotações ficam em{" "}
              <span className="font-bold text-zinc-200">
                Ajustes &gt; Transportadoras
              </span>
              . O botão do bloco azul leva direto para lá.
            </p>
          </div>
          <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <AlertCircle className="size-4 text-amber-500" />
              Não esqueça
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">
              O CEP da loja é obrigatório: sem ele o app não consegue calcular
              frete nenhum e o cliente não finaliza a compra. Mexeu em algo
              aqui? Clique em Salvar no topo — nada é aplicado antes disso.
            </p>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});

/** Dinheiro como a pessoa escreve: R$ 10, R$ 49,90 — nunca "R$ 49.9". */
function reais(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0;
  return Number.isInteger(seguro)
    ? `${seguro}`
    : seguro.toFixed(2).replace(".", ",");
}
