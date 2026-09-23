import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  type ConfigDoProvedor,
  NOME_DO_PROVEDOR,
  PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR,
  type ProvedorFrete,
  buscarConfiguracaoDeFrete,
  emailDeContatoValido,
} from "@/components/admin/settings/TransportadorasCard";
import { EtiquetasEnvioCard } from "@/components/admin/shipping/EtiquetasEnvioCard";
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import {
  FreteNacionalBloco,
  type ProvedorNacional,
} from "@/components/admin/shipping/FreteNacionalBloco";
import {
  FreteResumoFaixa,
  type StatusDaFaixaFrete,
} from "@/components/admin/shipping/FreteResumoFaixa";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { resumoDaEstrategiaNacional } from "@/lib/estrategias-de-frete";
import { listaComRetirada, retiradaLigadaNaLista } from "@/lib/guarda-de-frete";
import {
  type PresetFreteGratis,
  presetDoConfig,
  valorDoPreset,
} from "@/lib/presets-de-frete-gratis";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AlertCircle, HelpCircle, RefreshCw, Save } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const ORDEM_DE_EXIBICAO: readonly ProvedorFrete[] = [
  "melhor_envio",
  "superfrete",
  "frenet",
];

interface AdminShippingViewProps {
  onNavigate?: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

/**
 * Tela "Frete" do painel — direção D, aprovada pelo dono em 03/09/2026
 * depois de 3 rodadas de iteração visual (a rodada anterior ele reprovou:
 * "o visual não mudou nada"). O desenho:
 *
 * - FAIXA-RESUMO entre duas hairlines com gradiente verde sutil no topo
 *   (desktop: 3 colunas; celular: 3 linhas compactas rótulo+valor, notas
 *   ocultas, 16px de respiro horizontal). Derivada do config SALVO — quem
 *   veio conferir vê a realidade; o pendente tem a barra de salvar.
 * - SEÇÕES COMO LINHAS FINAS, sem caixa/card nenhum: cabeçalho uppercase
 *   espaçado com o estado à direita, linhas nome+dica à esquerda e comando
 *   à direita, separadas por hairline (`primitivas-direcao-d.tsx`).
 * - CHAVES SÓ ONDE HÁ ESTADO REAL: "Só entregar na cidade" grava
 *   `shippingCoverage` (role="switch"); "Cotação na hora" é EXIBIÇÃO da
 *   credencial da transportadora — esta tela só lê credencial (divisão de
 *   território com Ajustes), então sem campo gravável não há chave
 *   clicável: o comando de verdade, desconectado, é o CTA para Ajustes.
 * - BARRA DE SALVAR FIXA no rodapé, que só existe com alteração pendente:
 *   bolinha âmbar + "Alterações não salvas" à esquerda, botão verde
 *   "Salvar alterações" à direita. Sem "Descartar" — o fluxo não existe
 *   hoje e não foi inventado. O save do topo da rodada anterior saiu junto.
 *
 * COMPOSIÇÃO DOS DADOS (intacta da rodada anterior): o card de taxa fixa
 * NÃO existe — fora da cidade, o preço é só o da cotação real da
 * transportadora (o campo `shippingFee` fica órfão no banco de propósito —
 * e é por isso que o save daqui deixa de enviá-lo).
 *
 * DIVISÃO DE TERRITÓRIO (herdada, segue valendo): esta tela é a dona das
 * REGRAS (presets de grátis, CEP de origem, cobertura, entrega local).
 * Provedor, serviços e credenciais são da seção de Transportadoras em
 * Ajustes — daqui eles são apenas LEITURA (a conexão mostrada vem da mesma
 * tabela que Ajustes grava). Salvar aqui NÃO envia
 * `shippingProvider`/`enabledShippingMethods` — enviar de novo daqui
 * revertia a escolha salva por um valor velho de formulário.
 * EXCEÇÃO ÚNICA (retirada na loja, release 1.5.3): a chave `store-pickup`
 * mora em `enabledShippingMethods` (contrato da RPC v23/v24 e da edge), e
 * a chave "Permitir retirada na loja" é desta tela. O save só envia a
 * lista quando a RETIRADA mudou, e a monta a partir do config ATUAL
 * (`listaComRetirada`): os serviços de transportadora que Ajustes gravou
 * saem intactos — nunca de um valor velho de formulário.
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
 * - a faixa-resumo descreve o config SALVO (a realidade), não o formulário
 *   pendente — o pendente ganha a barra fixa "Alterações não salvas".
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
    retiradaNaLoja: false,
  });

  // Leitura da credencial de transportadora (mesma edge que Ajustes usa)
  // — só para dizer a VERDADE sobre a conexão na faixa e na seção "Fora da
  // cidade". Esta tela nunca grava credencial e, desde o achado
  // AdminShippingView-126 (segurança), também não LÊ o token: a edge
  // (`ler_configuracao_frete`) devolve só o formato PRONTO de cada
  // provedor (`tem_chave`, `sandbox`, `contato_email`, `servicos`) —
  // nunca o token, que fica só no service role do servidor. O navegador
  // não tem, e nunca teve nesta release, um caminho para baixar o
  // segredo só para acender um booleano.
  // RELEASE 1.5.7 v2 (frete com vários provedores): a tela deixou de fazer
  // qualquer `select` direto em `store_shipping_credentials` — toda a
  // configuração vem pronta da edge (`ler_configuracao_frete`), que é a
  // MESMA fonte que a seção de Transportadoras usa. Sem isso, provedor
  // ligado no modo multi (linha `_ligados`, EMENDA R2) ficaria invisível
  // para quem só sabe ler a tabela de credenciais linha a linha.
  // Achado 2 (revisão Opus, regressão 1.5.5): guarda o `Map` inteiro que a
  // edge devolveu, não só um `Set` de "tem chave" — a SuperFrete PRECISA
  // do `contato_email` para saber se a chave está de fato COMPLETA (ver
  // `provedoresNacional` abaixo); um `Set` booleano não carrega isso.
  const [ligadosSalvos, setLigadosSalvos] = useState<
    ReadonlySet<ProvedorFrete>
  >(() => new Set());
  const [provedoresSalvos, setProvedoresSalvos] = useState<
    ReadonlyMap<ProvedorFrete, ConfigDoProvedor>
  >(() => new Map());
  const [credsErro, setCredsErro] = useState(false);

  const fetchCreds = useCallback(async () => {
    setCredsErro(false);
    const resultado = await buscarConfiguracaoDeFrete();
    if (!resultado.ok) {
      setCredsErro(true);
      return;
    }
    setLigadosSalvos(new Set(resultado.config.ligados));
    setProvedoresSalvos(resultado.config.provedores);
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
        retiradaNaLoja: retiradaLigadaNaLista(config.enabledShippingMethods),
      });
      fetchCreds();
    }
  }, [isLoaded, config, active, fetchCreds]);

  // Estado POR PROVEDOR (F10, EMENDA R2): nunca "conectado" só por ter
  // chave. `ligado` só vale quando o provedor está na lista `ligados` DA
  // EDGE *e* tem chave salva — protege contra o espelho antigo apontar um
  // provedor sem credencial nenhuma (loja recém-migrada para o modo multi).
  //
  // Achado 2 (revisão Opus, regressão 1.5.5): ter chave NÃO basta para a
  // SuperFrete cotar de verdade — sem `contato_email` válido a edge nunca
  // manda a cotação, mesmo que `ligados`/`tem_chave` digam que sim (a
  // linha pode ter sido salva direto no banco, ou de antes de existir essa
  // exigência). "ligado" sem essa garantia é mentira: "incompleta" entra
  // ANTES de "ligado" na régua, mesma checagem de
  // `PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR` que `TransportadorasCard.tsx`
  // usa para bloquear o SALVAR.
  const provedoresNacional: ProvedorNacional[] = useMemo(
    () =>
      ORDEM_DE_EXIBICAO.map((p) => {
        const salvo = provedoresSalvos.get(p);
        const temChave = salvo?.tem_chave ?? false;
        const incompleta =
          temChave &&
          PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR.has(p) &&
          !emailDeContatoValido(salvo?.contato_email);
        return {
          provider: p,
          nome: NOME_DO_PROVEDOR.get(p) ?? p,
          estado: incompleta
            ? "incompleta"
            : ligadosSalvos.has(p) && temChave
              ? "ligado"
              : temChave
                ? "chave_salva"
                : "sem_chave",
        };
      }),
    [ligadosSalvos, provedoresSalvos],
  );
  const algumProvedorLigado = provedoresNacional.some(
    (p) => p.estado === "ligado",
  );
  // Achado 5 (ANOTADO): estável entre renders que não mudam
  // `provedoresNacional` — evita recriar o array (e o texto derivado dele)
  // a cada render do formulário de regras, que não tem nada a ver com isto.
  const nomesLigados = useMemo(
    () =>
      provedoresNacional
        .filter((p) => p.estado === "ligado")
        .map((p) => p.nome),
    [provedoresNacional],
  );

  // ── A faixa-resumo descreve o que está SALVO (a realidade da loja hoje) ──
  // Frases derivadas do config, nunca do formulário pendente: quem abriu a
  // tela para CONFERIR precisa ver o que está valendo; quem veio mexer vê a
  // barra "Alterações não salvas" por cima (rodapé).
  const statusDaFaixa = useMemo(() => {
    const minSalvo = Number(config?.freeShippingMin ?? 0);
    const presetSalvo = presetDoConfig(minSalvo);
    const localFee = Number(config?.localDeliveryFee ?? 10);
    const cidade = config?.storeCity;
    const uf = config?.storeState;
    const ondeCidade =
      cidade && uf ? `${cidade}/${uf}` : cidade ? cidade : "sua cidade";

    const local: StatusDaFaixaFrete = !config?.originCep
      ? {
          rotulo: "Na sua cidade",
          valor: "Parado — falta o CEP da loja",
          detalhe: "Configure abaixo para abrir as vendas",
          tom: "atencao",
        }
      : {
          rotulo: "Na sua cidade",
          valor:
            localFee > 0
              ? `R$ ${reais(localFee)} por entrega`
              : "Grátis na cidade",
          detalhe: `Entrega própria em ${ondeCidade}`,
          tom: "positivo",
        };

    // T4 (23/09/2026): a estratégia NACIONAL (grátis/desconto por
    // transportadora) tem tela própria agora — não cabe uma 4ª coluna na
    // faixa, então o resumo curto entra no DETALHE desta mesma coluna
    // (ela já é sobre "fora da cidade"). `desligado` some do detalhe: nada
    // de poluir a linha com "desligado" quando não há nada a dizer.
    const resumoNacional =
      config != null ? resumoDaEstrategiaNacional(config) : "desligado";
    const detalheNacional = (base: string): string =>
      resumoNacional === "desligado" ? base : `${base} · ${resumoNacional}`;

    const nacional: StatusDaFaixaFrete =
      (config?.shippingCoverage || "national") === "local"
        ? {
            rotulo: "Fora da cidade",
            valor: "Só na sua cidade",
            detalhe: "fora dela, a loja não atende",
            tom: "neutro",
          }
        : credsErro
          ? {
              rotulo: "Fora da cidade",
              valor: "Conexão a confirmar",
              detalhe: "confira a transportadora em Ajustes",
              tom: "neutro",
            }
          : algumProvedorLigado
            ? {
                rotulo: "Fora da cidade",
                valor:
                  nomesLigados.length === 1
                    ? `${nomesLigados[0]} ligado`
                    : `${nomesLigados.length} provedores ligados`,
                detalhe: detalheNacional("cotação real na hora"),
                tom: "positivo",
              }
            : {
                rotulo: "Fora da cidade",
                valor: "Sem transportadora",
                detalhe: "por enquanto, só entrega na cidade",
                tom: "atencao",
              };

    // A coluna que era "Frete grátis" agora se identifica como LOCAL: a
    // regra aqui vale só para local-delivery/store-pickup (T3) — a
    // estratégia nacional tem a faixa própria acima. REVISÃO (correção 4,
    // revisão Opus): os detalhes diziam "não paga entrega"/"sai com entrega
    // grátis" sem dizer ONDE — lido rápido, parecia valer para qualquer
    // modalidade (o mesmo engano que a T3 corrigiu no cálculo). Agora cada
    // frase nomeia cidade/retirada.
    const gratis: StatusDaFaixaFrete =
      presetSalvo === "acima_de_valor"
        ? {
            rotulo: "Frete grátis local",
            valor: `Acima de R$ ${reais(minSalvo)}`,
            detalhe:
              "a compra que passa do valor não paga entrega na cidade nem retirada",
            tom: "positivo",
          }
        : presetSalvo === "sempre"
          ? {
              rotulo: "Frete grátis local",
              valor: "Em toda a loja",
              detalhe: "toda entrega na cidade e retirada saem grátis",
              tom: "positivo",
            }
          : presetSalvo === "por_produto"
            ? {
                rotulo: "Frete grátis local",
                valor: "Por produto marcado",
                detalhe:
                  "produtos marcados saem sem custo na entrega da cidade e na retirada",
                tom: "positivo",
              }
            : {
                rotulo: "Frete grátis local",
                valor: "Desligado",
                detalhe: "nenhuma regra de grátis ativa",
                tom: "neutro",
              };

    return [local, nacional, gratis] as const;
  }, [config, credsErro, algumProvedorLigado, nomesLigados]);

  // Dirty check to enable save bar — estratégia de grátis explícita +
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
    if (
      formData.retiradaNaLoja !==
      retiradaLigadaNaLista(config.enabledShippingMethods)
    )
      return true;
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
      // Retirada: a lista só vai quando a retirada MUDOU, e sai do config
      // atual — só a chave `store-pickup` entra ou sai.
      const retiradaMudou =
        formData.retiradaNaLoja !==
        retiradaLigadaNaLista(config?.enabledShippingMethods);
      const salvou = await updateConfig({
        freeShippingMin: valorDoPreset(formData.preset, formData.acimaDe),
        originCep: formData.originCep,
        shippingCoverage: formData.shippingCoverage,
        localDeliveryFee: Math.max(0, formData.localDeliveryFee),
        localCepRange: formData.localCepRange,
        ...(retiradaMudou
          ? {
              enabledShippingMethods: listaComRetirada(
                config?.enabledShippingMethods,
                formData.retiradaNaLoja,
              ),
            }
          : {}),
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

  // pb-[calc(11rem+safe-area)]: no celular a barra de salvar (quando existe)
  // mora ACIMA do menu inferior do admin (6.5rem de offset + ~66px de barra
  // ≈ 170px do fundo — mesmo achado da ficha do pedido, revisão do PR 549) e
  // o pb-32 antigo (128px) deixava o fim do formulário atrás dela; o iPhone
  // com notch soma ~34px de inset que o pb fixo não cobria — o calc com a
  // var cobre (padrão do AdminProductFormView). A partir de lg o menu e o
  // offset somem: pb-40 chega.
  return (
    <div className="min-h-screen bg-admin-bg pb-[calc(11rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] text-zinc-100 transition-colors duration-200 animate-in fade-in lg:pb-40">
      {/* Top Header Bar — fórmula "Elite Header" (herdada da onda visual
          02/09): AdminPageHeader padronizado + barra sticky na view. O
          Salvar mora na BARRA FIXA do rodapé (direção D) — não aqui. */}
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
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {!isLoaded ? (
          <div className="animate-pulse space-y-12" aria-busy="true">
            {/* Esqueleto na gramática da direção D: faixa + linhas, sem
                cards. */}
            <div className="h-20 border-y border-white/10 bg-white/[0.02]" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-5">
                <div className="h-3.5 w-44 rounded bg-white/5" />
                <div className="h-12 border-b border-white/5" />
                <div className="h-12 border-b border-white/5" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="text-[14.5px] text-zinc-500">
              Como a entrega funciona hoje — e os comandos para mudar.
            </p>

            <div className="mt-5">
              <FreteResumoFaixa status={statusDaFaixa} />
            </div>

            <div className="mt-10 space-y-12 md:mt-14 md:space-y-14">
              <FreteLocalBloco
                valor={formData.localDeliveryFee}
                onValor={(valor) =>
                  setFormData((prev) => ({ ...prev, localDeliveryFee: valor }))
                }
                faixa={formData.localCepRange}
                onFaixa={(faixa) =>
                  setFormData((prev) => ({ ...prev, localCepRange: faixa }))
                }
                coverage={formData.shippingCoverage}
                onCoverage={(shippingCoverage) =>
                  setFormData((prev) => ({ ...prev, shippingCoverage }))
                }
                cidade={config?.storeCity}
                uf={config?.storeState}
                semOrigem={!config?.originCep}
                desabilitado={isOffline}
                retirada={formData.retiradaNaLoja}
                onRetirada={(retiradaNaLoja) =>
                  setFormData((prev) => ({ ...prev, retiradaNaLoja }))
                }
                enderecoDaLoja={config?.storeAddress}
              />

              <FreteNacionalBloco
                originCep={formData.originCep}
                onOriginCep={(originCep) =>
                  setFormData((prev) => ({ ...prev, originCep }))
                }
                provedores={provedoresNacional}
                erroNaLeitura={credsErro}
                onAbrirAjustes={
                  onNavigate ? () => onNavigate("admin-settings") : undefined
                }
                onTentarDeNovo={fetchCreds}
                desabilitado={isOffline}
                resumoDaEstrategiaNacional={
                  config ? resumoDaEstrategiaNacional(config) : undefined
                }
                onAbrirEstrategiasNacionais={
                  onNavigate
                    ? () => onNavigate("admin-shipping-national")
                    : undefined
                }
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

              {/* ── Seção 4: etiquetas de envio (Onda 3, rastreio automático)
                  A etiqueta nasce da API do Melhor Envio — a confirmação de
                  saldo e a gravação do rastreio no pedido moram no card (e na
                  edge function melhor-envio-etiqueta). Sempre visível: é
                  operação de envio, não regra de cobrança — não depende do
                  interruptor de cobertura acima. */}
              <EtiquetasEnvioCard />
            </div>

            <p className="mt-10 flex items-start gap-2 text-[11px] leading-snug text-zinc-600">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              Nada aqui vale antes de salvar. Mexeu? A barra do rodapé aparece
              para você conferir e salvar.
            </p>
          </>
        )}
      </div>

      {/* ── Barra de salvar FIXA (direção D) — só existe com mudança
          pendente. Sem "Descartar": o fluxo de descartar não existe nesta
          tela e não foi inventado. O fluxo de salvar é EXATAMENTE o de
          sempre (offline → guarda → updateConfig → toasts). ── */}
      {isLoaded && isFormDirty && (
        // Mesmo conserto da ficha do pedido (revisão do PR 549): no celular
        // o menu inferior do admin (z-[60], DEPOIS no DOM) cobria esta
        // barra (z-40) — "Salvar alterações" ficava atrás de uma aba do
        // menu. Acima do menu até lg; no pé a partir de lg (menu some).
        <div className="fixed inset-x-0 bottom-[calc(6.5rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] z-40 border-t border-white/10 bg-[#09090b]/90 backdrop-blur-md duration-200 animate-in fade-in lg:bottom-0">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <p className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium text-zinc-400">
              <span
                aria-hidden="true"
                className="size-[7px] shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400/50"
              />
              <span className="truncate">Alterações não salvas</span>
            </p>
            <button
              type="button"
              disabled={isSaving || isOffline}
              onClick={handleSave}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-admin-accent px-5 py-2.5 text-sm font-extrabold text-zinc-950 shadow-lg shadow-admin-accent/20 transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {isSaving ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {isSaving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </div>
      )}

      {/* Ajuda da tela — quem procurava o token sai sabendo onde ele está;
          quem procurava a taxa fixa sai sabendo que ela se foi. */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Ajuda — Frete da loja"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            A entrega da sua loja tem três partes, cada uma com a seção dela na
            tela: o <span className="font-bold text-zinc-200">frete local</span>{" "}
            (você mesmo entrega na cidade), o{" "}
            <span className="font-bold text-zinc-200">frete nacional</span> (a
            transportadora cotada na hora) e o{" "}
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
              A chave de acesso das transportadoras (Melhor Envio, Frenet,
              SuperFrete), o teste de conexão, os serviços habilitados e o
              histórico de cotações ficam em{" "}
              <span className="font-bold text-zinc-200">
                Ajustes &gt; Transportadoras
              </span>
              . O botão "Abrir Ajustes" da seção Fora da cidade leva direto para
              lá.
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
              aqui? Clique em "Salvar alterações" na barra que aparece no rodapé
              — nada é aplicado antes disso.
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
