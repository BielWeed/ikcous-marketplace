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
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { FreteNacionalBloco } from "@/components/admin/shipping/FreteNacionalBloco";
import {
  FreteResumoFaixa,
  type StatusDaFaixaFrete,
} from "@/components/admin/shipping/FreteResumoFaixa";
import { PainelRecolhivel } from "@/components/admin/shipping/PainelRecolhivel";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  erroDoFormularioNacional,
  estrategiaTemAlcanceEditavel,
  resumoDaEstrategiaNacional,
} from "@/lib/estrategias-de-frete";
import { listaComRetirada, retiradaLigadaNaLista } from "@/lib/guarda-de-frete";
import {
  type PresetFreteGratis,
  presetDoConfig,
  valorDoPreset,
} from "@/lib/presets-de-frete-gratis";
import type { EstrategiaDeFreteNacional, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AlertCircle, Check, HelpCircle, RefreshCw, Save } from "lucide-react";
import {
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  /**
   * Qual painel nasce aberto — usada pela rota `admin-shipping-national`
   * (T4/23/09/2026 unificação, pedido do dono): links, F5 e Voltar antigos
   * continuam abrindo a mesma tela de Frete, com "Fora da cidade" já
   * expandido em vez de uma tela própria. Ausente = os painéis nascem
   * todos fechados (entrada normal por "admin-shipping").
   */
  painelInicial?: "local" | "nacional";
}

/**
 * Tela "Frete" do painel — UNIFICADA (pedido do dono, 23/09/2026): a tela
 * "Estratégias do frete nacional" (`admin-shipping-national`,
 * `AdminShippingNationalView`, T4 do mesmo dia) foi trazida de volta para
 * cá como o CONTEÚDO do painel "Fora da cidade" — a tela separada existia
 * havia poucas horas e o cabeçalho dela já transbordava no celular. Direção
 * D (03/09/2026, 3 rodadas de iteração visual) segue valendo: faixa-resumo
 * no topo, seções como linhas finas sem caixa/card. O que muda nesta
 * rodada:
 *
 * - QUATRO SEÇÕES VIRAM PAINÉIS RECOLHÍVEIS (`PainelRecolhivel`), todos
 *   FECHADOS por padrão, mostrando título + resumo curto do estado salvo:
 *   "Entrega na sua cidade" (`FreteLocalBloco`), "Fora da cidade"
 *   (`FreteNacionalBloco` + `EstrategiaNacionalBloco`, a estratégia
 *   nacional inteira mora AQUI DENTRO agora), "Estratégias do frete local"
 *   (`FreteGratisBloco`) e "Etiquetas de envio" (a nota que aponta para o
 *   pedido). Os três Blocos ganharam `mostrarCabecalho={false}` aqui: o
 *   `PainelRecolhivel` já é o cabeçalho — dois títulos empilhados seria a
 *   poluição que este pedido veio resolver.
 * - BARRA DE SALVAR FIXA MORREU. No lugar, um botão no CABEÇALHO
 *   (`AdminPageHeader` `acoes`), sempre visível (o cabeçalho já é sticky):
 *   "Salvo" (sem alteração, discreto, desabilitado) → "Salvar" (pendente,
 *   destacado) → "Salvando…" (spinner) → "Tentar de novo" (falha, vermelho,
 *   `aria-live`). O rodapé volta ao `pb-admin` padrão (as outras ~19 telas
 *   do admin) — o `pb-[calc(11rem+...)]` só existia por causa da barra.
 * - FORMULÁRIO ÚNICO: os campos que eram de `AdminShippingNationalView`
 *   viraram estado desta view (`formDataNacional`), com a MESMA guarda de
 *   sincronização por referência que os campos locais já tinham (evita
 *   apagar o que a lojista digitou quando o config muda por fora) — só que
 *   em DOIS refs independentes (local e nacional), porque cada metade
 *   sincroniza contra o config na sua própria velocidade. `isFormDirty`
 *   final é `local OR nacional`, e é isso que vai para `onSetDirty` — o
 *   gate de navegação do App e o diálogo de alterações não salvas nunca
 *   souberam que existiam duas metades.
 * - SALVAR É UMA AÇÃO SÓ: o clique no cabeçalho grava os campos locais E
 *   os nacionais no MESMO `updateConfig` — a conta de cada campo (sentinela
 *   do preset local, `ajustado` do nacional, retirada só se mudou) é
 *   EXATAMENTE a mesma de antes, só que despachada junta.
 * - PAINEL COM ERRO NÃO FECHA: `erro` (validação do formulário nacional,
 *   mesmo espelho do CHECK do banco que `AdminShippingNationalView` já
 *   tinha) vira `comPendencia` do painel "Fora da cidade" — clicar no
 *   cabeçalho dele enquanto há erro não faz nada, e `handleSave` força o
 *   painel aberto (com rolagem) se for chamado com erro pendente, mesmo
 *   que o botão já esteja desabilitado nesse caso (dupla trava).
 * - A ROTA `admin-shipping-national` CONTINUA EXISTINDO: vira uma casca
 *   fininha (`AdminShippingNationalView.tsx`) que renderiza ESTA view com
 *   `painelInicial="nacional"` — menor mudança de roteamento possível
 *   (nada muda em App.tsx/AdminArea.tsx), e o botão "Estratégias do frete
 *   nacional →" dentro de "Fora da cidade" deixou de navegar: agora
 *   garante o painel aberto e rola até `#bloco-estrategia-nacional`.
 *
 * COMPOSIÇÃO DOS DADOS (intacta): o card de taxa fixa NÃO existe — fora da
 * cidade, o preço é só o da cotação real da transportadora.
 *
 * DIVISÃO DE TERRITÓRIO (herdada, segue valendo): Provedor, serviços e
 * credenciais são da seção de Transportadoras em Ajustes — daqui eles são
 * apenas LEITURA. Salvar aqui NÃO envia `shippingProvider`/
 * `enabledShippingMethods` (exceto a retirada, que é exceção única e
 * herdada — ver o `handleSave`).
 */
export const AdminShippingView = memo(function AdminShippingView({
  onNavigate,
  active,
  onSetDirty,
  painelInicial,
}: Readonly<AdminShippingViewProps>) {
  const { config, isLoaded, updateConfig } = useStore();
  const isOffline = useOnlineStatus();
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [falhaAoSalvar, setFalhaAoSalvar] = useState(false);

  // Painéis recolhíveis (pedido do dono, 23/09/2026): todos nascem
  // FECHADOS, exceto "Fora da cidade" quando a entrada veio pela rota
  // `admin-shipping-national` (compatibilidade com link/F5/Voltar antigos).
  const [painelAberto, setPainelAberto] = useState({
    local: false,
    nacional: painelInicial === "nacional",
    estrategiasLocais: false,
    etiquetas: false,
  });
  // `switch` explícito (não `{ ...prev, [chave]: ... }`): indexação
  // dinâmica por variável dispara `security/detect-object-injection` do
  // eslint, mesmo com `chave` tipada — o teto do lint reprova warning novo.
  const alternarPainel = useCallback((chave: keyof typeof painelAberto) => {
    setPainelAberto((prev) => {
      switch (chave) {
        case "local":
          return { ...prev, local: !prev.local };
        case "nacional":
          return { ...prev, nacional: !prev.nacional };
        case "estrategiasLocais":
          return { ...prev, estrategiasLocais: !prev.estrategiasLocais };
        case "etiquetas":
          return { ...prev, etiquetas: !prev.etiquetas };
        default:
          return prev;
      }
    });
  }, []);

  // ── Formulário LOCAL (herdado, intacto) ───────────────────────────────
  const [formData, setFormData] = useState({
    preset: "desligado" as PresetFreteGratis,
    acimaDe: 0,
    originCep: "",
    shippingCoverage: "national" as "local" | "national",
    localDeliveryFee: 10,
    localCepRange: "",
    retiradaNaLoja: false,
  });

  // ── Formulário NACIONAL (T4, herdado de AdminShippingNationalView) ───
  const [formDataNacional, setFormDataNacional] = useState({
    estrategia: "desligado" as EstrategiaDeFreteNacional,
    minimo: 0,
    tipoDesconto: null as "percentual" | "fixo" | null,
    valorDesconto: 0,
    alcance: "mais_barata" as "mais_barata" | "todas",
  });

  // Qualquer edição nova limpa o aviso de falha do save anterior — "Tentar
  // de novo" não deve continuar aceso depois que a lojista já mexeu de
  // novo no formulário.
  const atualizarFormData = useCallback(
    (atualizar: (prev: typeof formData) => typeof formData) => {
      setFalhaAoSalvar(false);
      setFormData(atualizar);
    },
    [],
  );
  const atualizarFormDataNacional = useCallback(
    (atualizar: (prev: typeof formDataNacional) => typeof formDataNacional) => {
      setFalhaAoSalvar(false);
      setFormDataNacional(atualizar);
    },
    [],
  );

  // Leitura da credencial de transportadora — ver comentário original
  // (AdminShippingView-126): a edge devolve só o formato pronto, nunca o
  // token.
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

  // ── Sincronização LOCAL (achado 3 da auditoria, intacta) ──────────────
  const jaSincronizouRef = useRef(false);
  const isFormDirtyRef = useRef(false);

  useEffect(() => {
    if (isLoaded && config) {
      if (jaSincronizouRef.current && isFormDirtyRef.current) {
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

  // ── Sincronização NACIONAL (T4, mesma guarda, ref própria) ────────────
  const jaSincronizouNacionalRef = useRef(false);
  const isFormDirtyNacionalRef = useRef(false);

  useEffect(() => {
    if (isLoaded && config) {
      if (jaSincronizouNacionalRef.current && isFormDirtyNacionalRef.current) {
        return;
      }
      jaSincronizouNacionalRef.current = true;
      setFormDataNacional({
        estrategia: config.nationalShippingStrategy,
        minimo: config.nationalShippingMin,
        tipoDesconto: config.nationalDiscountType,
        valorDesconto: config.nationalDiscountValue,
        alcance: config.nationalBenefitScope,
      });
    }
  }, [isLoaded, config, active]);

  // ── Estado por provedor (F10, EMENDA R2, intacto) ─────────────────────
  const provedoresNacional = useMemo(
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
            ? ("incompleta" as const)
            : ligadosSalvos.has(p) && temChave
              ? ("ligado" as const)
              : temChave
                ? ("chave_salva" as const)
                : ("sem_chave" as const),
        };
      }),
    [ligadosSalvos, provedoresSalvos],
  );
  const algumProvedorLigado = provedoresNacional.some(
    (p) => p.estado === "ligado",
  );
  const nomesLigados = useMemo(
    () =>
      provedoresNacional
        .filter((p) => p.estado === "ligado")
        .map((p) => p.nome),
    [provedoresNacional],
  );

  // ── Faixa-resumo: descreve o SALVO (intacto) ──────────────────────────
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

  // Resumo CURTO de cada painel fechado — deriva do MESMO `statusDaFaixa`
  // (fonte única; regra escrita em dois lugares diverge — lição #53).
  const resumoPainelLocal = statusDaFaixa[0].detalhe
    ? `${statusDaFaixa[0].valor} · ${statusDaFaixa[0].detalhe}`
    : statusDaFaixa[0].valor;
  const resumoPainelNacional = statusDaFaixa[1].detalhe
    ? `${statusDaFaixa[1].valor} · ${statusDaFaixa[1].detalhe}`
    : statusDaFaixa[1].valor;
  const resumoPainelEstrategiasLocais = statusDaFaixa[2].valor;

  // ── Dirty check LOCAL (intacto) ────────────────────────────────────────
  const isFormDirtyLocal = useMemo(() => {
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

  // ── Dirty check NACIONAL (T4, herdado) ─────────────────────────────────
  const isFormDirtyNacional = useMemo(() => {
    if (!config) return false;
    return (
      formDataNacional.estrategia !== config.nationalShippingStrategy ||
      formDataNacional.minimo !== config.nationalShippingMin ||
      formDataNacional.tipoDesconto !== config.nationalDiscountType ||
      formDataNacional.valorDesconto !== config.nationalDiscountValue ||
      formDataNacional.alcance !== config.nationalBenefitScope
    );
  }, [formDataNacional, config]);

  const isFormDirty = isFormDirtyLocal || isFormDirtyNacional;

  // Cada metade atualiza SÓ o próprio ref — é o que a guarda de
  // sincronização de cada metade lê.
  useEffect(() => {
    isFormDirtyRef.current = isFormDirtyLocal;
  }, [isFormDirtyLocal]);
  useEffect(() => {
    isFormDirtyNacionalRef.current = isFormDirtyNacional;
  }, [isFormDirtyNacional]);

  // Um sinal só sai para o pai (gate de navegação do App) — ele nunca soube
  // que existiam duas metades.
  useEffect(() => {
    onSetDirty?.(isFormDirty);
  }, [isFormDirty, onSetDirty]);

  // ── Estratégia nacional: escolher e validar (T4, herdado) ──────────────
  const escolherEstrategiaNacional = useCallback(
    (nova: EstrategiaDeFreteNacional) => {
      haptic.light();
      atualizarFormDataNacional((prev) => {
        const eraDesligado = prev.estrategia === "desligado";
        const novaTemAlcance = estrategiaTemAlcanceEditavel(nova);
        return {
          ...prev,
          estrategia: nova,
          alcance:
            eraDesligado && novaTemAlcance ? "mais_barata" : prev.alcance,
        };
      });
    },
    [atualizarFormDataNacional],
  );

  const erroCentavosNacional = useMemo(() => {
    const centavos = (valor: number) => Math.round((Number(valor) || 0) * 100);
    if (
      formDataNacional.estrategia === "acima_de_valor" &&
      centavos(formDataNacional.minimo) <= 0
    ) {
      return "Informe um valor mínimo maior que R$ 0 para o grátis acima de um valor.";
    }
    if (
      formDataNacional.estrategia === "desconto_na_mais_barata" &&
      formDataNacional.tipoDesconto === "fixo" &&
      centavos(formDataNacional.valorDesconto) <= 0
    ) {
      return "Informe um valor de desconto maior que R$ 0.";
    }
    return null;
  }, [formDataNacional]);

  const erroNacional = useMemo(
    () =>
      erroDoFormularioNacional({
        estrategia: formDataNacional.estrategia,
        minimo: formDataNacional.minimo,
        tipoDesconto: formDataNacional.tipoDesconto,
        valorDesconto: formDataNacional.valorDesconto,
      }) ?? erroCentavosNacional,
    [formDataNacional, erroCentavosNacional],
  );

  // Abre "Fora da cidade" e rola até a estratégia — o botão dentro de
  // FreteNacionalBloco deixou de NAVEGAR (T4 unificação, 23/09/2026): a
  // estratégia agora mora no MESMO painel, só mais abaixo.
  const abrirEIrParaEstrategiaNacional = useCallback(() => {
    setPainelAberto((prev) => ({ ...prev, nacional: true }));
    // `setTimeout(0)`, não `requestAnimationFrame` — mesmo padrão de
    // AdminOrdersView.tsx (rolar até a lista de pedidos): mais simples de
    // testar (jsdom não implementa rAF) e o painel só termina de aparecer
    // (sai do `hidden`) depois deste tick.
    setTimeout(() => {
      document
        .getElementById("bloco-estrategia-nacional")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  // ── Salvar — LOCAL e NACIONAL na MESMA ação (pedido do dono, 23/09) ───
  const handleSave = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar as configurações.",
      });
      return;
    }
    if (isSaving) return;
    if (erroNacional) {
      // Segunda trava (a primeira é o botão desabilitado): se algo chamar
      // handleSave mesmo assim, o painel com o erro abre e ganha foco em
      // vez de a tela fingir que salvou.
      abrirEIrParaEstrategiaNacional();
      return;
    }

    setIsSaving(true);
    haptic.medium();

    const retiradaMudou =
      formData.retiradaNaLoja !==
      retiradaLigadaNaLista(config?.enabledShippingMethods);

    const ehDesconto =
      formDataNacional.estrategia === "desconto_na_mais_barata";
    const nacionalAjustado = {
      estrategia: formDataNacional.estrategia,
      minimo:
        formDataNacional.estrategia === "acima_de_valor" || ehDesconto
          ? Math.max(0, formDataNacional.minimo)
          : 0,
      tipoDesconto: ehDesconto ? formDataNacional.tipoDesconto : null,
      valorDesconto: ehDesconto
        ? Math.max(0, formDataNacional.valorDesconto)
        : 0,
      alcance: formDataNacional.alcance,
    };

    try {
      // Se esta gravação falhar, PARA AQUI (ADMIN-010, #94). O toast de
      // erro sai de dentro do `updateConfig`.
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
        nationalShippingStrategy: nacionalAjustado.estrategia,
        nationalShippingMin: nacionalAjustado.minimo,
        nationalDiscountType: nacionalAjustado.tipoDesconto,
        nationalDiscountValue: nacionalAjustado.valorDesconto,
        nationalBenefitScope: nacionalAjustado.alcance,
      });
      if (!salvou) {
        haptic.error();
        setFalhaAoSalvar(true);
        return;
      }

      // Espelha o AJUSTADO no formData nacional (REVISÃO herdada de
      // AdminShippingNationalView, correção 1): sem isso, um mínimo/valor
      // "esquecido" de uma estratégia anterior deixaria `isFormDirty`
      // nacional preso em `true` para sempre.
      setFormDataNacional(nacionalAjustado);
      setFalhaAoSalvar(false);
      onSetDirty?.(false);
      haptic.success();
      toast.success("Regras de frete salvas!");
    } catch (err) {
      console.error("[AdminShippingView] Error saving configs:", err);
      haptic.error();
      setFalhaAoSalvar(true);
      toast.error("Erro ao salvar as configurações.");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Botão Salvar do cabeçalho — 4 estados (pedido do dono, 23/09) ─────
  const estadoSalvar: "limpo" | "pendente" | "salvando" | "erro" = isSaving
    ? "salvando"
    : falhaAoSalvar && isFormDirty
      ? "erro"
      : isFormDirty
        ? "pendente"
        : "limpo";
  const podeClicarSalvar =
    !isSaving && !isOffline && isFormDirty && !erroNacional;

  // Map (não Record indexado por variável): indexação dinâmica dispara
  // `security/detect-object-injection` do eslint e o teto do lint reprova
  // warning novo — mesmo padrão de `PONTO_TOM` em primitivas-direcao-d.tsx.
  const BOTAO_SALVAR_POR_ESTADO = new Map<
    typeof estadoSalvar,
    { estilo: string; rotulo: string; icone: ReactNode }
  >([
    [
      "limpo",
      {
        estilo: "border border-white/10 bg-transparent text-zinc-500",
        rotulo: "Salvo",
        icone: <Check className="size-3.5" />,
      },
    ],
    [
      "pendente",
      {
        estilo:
          "bg-admin-accent text-zinc-950 shadow-lg shadow-admin-accent/20 hover:opacity-90",
        rotulo: "Salvar",
        icone: <Save className="size-3.5" />,
      },
    ],
    [
      "salvando",
      {
        estilo: "bg-admin-accent/60 text-zinc-950",
        rotulo: "Salvando…",
        icone: <RefreshCw className="size-3.5 animate-spin" />,
      },
    ],
    [
      "erro",
      {
        estilo: "bg-rose-500/90 text-white hover:bg-rose-500",
        rotulo: "Tentar de novo",
        icone: <RefreshCw className="size-3.5" />,
      },
    ],
  ]);
  const infoBotaoSalvar = BOTAO_SALVAR_POR_ESTADO.get(estadoSalvar)!;

  const botaoSalvar = (
    <div aria-live="polite" className="flex shrink-0 items-center">
      <button
        type="button"
        disabled={!podeClicarSalvar}
        onClick={handleSave}
        className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-extrabold transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${infoBotaoSalvar.estilo}`}
      >
        {infoBotaoSalvar.icone}
        {infoBotaoSalvar.rotulo}
      </button>
    </div>
  );

  // pb-admin: o rodapé padrão de todas as ~19 telas do admin (só o menu
  // inferior). O pb-[calc(11rem+...)] anterior existia SÓ por causa da
  // barra de salvar fixa, que morreu nesta rodada.
  return (
    <div className="pb-admin min-h-screen bg-admin-bg text-zinc-100 transition-colors duration-200 animate-in fade-in">
      {/* Top Header Bar — fórmula "Elite Header" + `flex-wrap` (mesmo
          conserto de AdminPushView, 23/09/2026): título (h1, shrink-0) e o
          botão Salvar (shrink-0) são os dois únicos filhos desta linha —
          sem quebra, os dois nunca encolhem e forçam a página a alargar em
          375px. */}
      <div className="sticky top-0 z-30 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <AdminPageHeader titulo="Frete" acoes={botaoSalvar}>
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
              Como a entrega funciona hoje — toque numa seção para editar.
            </p>

            <div className="mt-5">
              <FreteResumoFaixa status={statusDaFaixa} />
            </div>

            <div className="mt-8 space-y-7">
              <PainelRecolhivel
                id="painel-frete-local"
                titulo="Entrega na sua cidade"
                resumo={resumoPainelLocal}
                aberta={painelAberto.local}
                onToggle={() => alternarPainel("local")}
              >
                <FreteLocalBloco
                  mostrarCabecalho={false}
                  valor={formData.localDeliveryFee}
                  onValor={(valor) =>
                    atualizarFormData((prev) => ({
                      ...prev,
                      localDeliveryFee: valor,
                    }))
                  }
                  faixa={formData.localCepRange}
                  onFaixa={(faixa) =>
                    atualizarFormData((prev) => ({
                      ...prev,
                      localCepRange: faixa,
                    }))
                  }
                  coverage={formData.shippingCoverage}
                  onCoverage={(shippingCoverage) =>
                    atualizarFormData((prev) => ({ ...prev, shippingCoverage }))
                  }
                  cidade={config?.storeCity}
                  uf={config?.storeState}
                  semOrigem={!config?.originCep}
                  desabilitado={isOffline}
                  retirada={formData.retiradaNaLoja}
                  onRetirada={(retiradaNaLoja) =>
                    atualizarFormData((prev) => ({ ...prev, retiradaNaLoja }))
                  }
                  enderecoDaLoja={config?.storeAddress}
                />
              </PainelRecolhivel>

              <PainelRecolhivel
                id="painel-frete-nacional"
                titulo="Fora da cidade"
                resumo={resumoPainelNacional}
                aberta={painelAberto.nacional}
                onToggle={() => alternarPainel("nacional")}
                comPendencia={!!erroNacional}
              >
                <div className="space-y-10">
                  <FreteNacionalBloco
                    mostrarCabecalho={false}
                    originCep={formData.originCep}
                    onOriginCep={(originCep) =>
                      atualizarFormData((prev) => ({ ...prev, originCep }))
                    }
                    provedores={provedoresNacional}
                    erroNaLeitura={credsErro}
                    onAbrirAjustes={
                      onNavigate
                        ? () => onNavigate("admin-settings")
                        : undefined
                    }
                    onTentarDeNovo={fetchCreds}
                    desabilitado={isOffline}
                    resumoDaEstrategiaNacional={
                      config ? resumoDaEstrategiaNacional(config) : undefined
                    }
                    onAbrirEstrategiasNacionais={abrirEIrParaEstrategiaNacional}
                  />

                  {/* Aviso específico da ESTRATÉGIA (herdado de
                      AdminShippingNationalView, T4): diferente da dica de
                      "Cotação na hora" acima (que fala da conexão em si),
                      este avisa que a REGRA de grátis/desconto abaixo só
                      vale quando alguma transportadora está ligada. */}
                  {!credsErro && !algumProvedorLigado && (
                    <p className="flex flex-wrap items-start gap-2 text-[12.5px] font-medium leading-snug text-amber-300 duration-200 animate-in fade-in">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>
                        Nenhuma transportadora ligada ainda — a estratégia só
                        vale quando há cotação de transportadora.
                      </span>
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate("admin-settings")}
                          className="shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 active:scale-95"
                        >
                          Conectar transportadora
                        </button>
                      )}
                    </p>
                  )}

                  <EstrategiaNacionalBloco
                    estrategia={formDataNacional.estrategia}
                    minimo={formDataNacional.minimo}
                    tipoDesconto={formDataNacional.tipoDesconto}
                    valorDesconto={formDataNacional.valorDesconto}
                    alcance={formDataNacional.alcance}
                    onEscolherEstrategia={escolherEstrategiaNacional}
                    onMinimo={(minimo) =>
                      atualizarFormDataNacional((prev) => ({ ...prev, minimo }))
                    }
                    onTipoDesconto={(tipoDesconto) =>
                      atualizarFormDataNacional((prev) => ({
                        ...prev,
                        tipoDesconto,
                      }))
                    }
                    onValorDesconto={(valorDesconto) =>
                      atualizarFormDataNacional((prev) => ({
                        ...prev,
                        valorDesconto,
                      }))
                    }
                    onAlcance={(alcance) =>
                      atualizarFormDataNacional((prev) => ({
                        ...prev,
                        alcance,
                      }))
                    }
                    desabilitado={isOffline}
                  />

                  {erroNacional && (
                    <p className="flex items-start gap-2 text-[12px] font-bold leading-snug text-amber-300 duration-200 animate-in fade-in">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                      {erroNacional}
                    </p>
                  )}
                </div>
              </PainelRecolhivel>

              <PainelRecolhivel
                id="painel-frete-estrategias-locais"
                titulo="Estratégias do frete local"
                resumo={resumoPainelEstrategiasLocais}
                aberta={painelAberto.estrategiasLocais}
                onToggle={() => alternarPainel("estrategiasLocais")}
              >
                <FreteGratisBloco
                  mostrarCabecalho={false}
                  preset={formData.preset}
                  acimaDe={formData.acimaDe}
                  onEscolher={(preset) => {
                    haptic.light();
                    atualizarFormData((prev) => ({
                      ...prev,
                      preset,
                      acimaDe:
                        preset === "acima_de_valor" && prev.acimaDe === 0
                          ? 100
                          : prev.acimaDe,
                    }));
                  }}
                  onAcimaDe={(acimaDe) =>
                    atualizarFormData((prev) => ({ ...prev, acimaDe }))
                  }
                  desabilitado={isOffline}
                />
              </PainelRecolhivel>

              <PainelRecolhivel
                id="painel-frete-etiquetas"
                titulo="Etiquetas de envio"
                resumo="agora ficam no próprio pedido"
                aberta={painelAberto.etiquetas}
                onToggle={() => alternarPainel("etiquetas")}
              >
                <p className="text-[11px] leading-snug text-zinc-500">
                  Etiquetas de envio agora ficam no próprio pedido: abra{" "}
                  {onNavigate ? (
                    <button
                      type="button"
                      onClick={() => onNavigate("admin-orders")}
                      className="font-semibold text-admin-gold underline decoration-admin-gold/40 underline-offset-2 transition-colors hover:text-admin-gold/80"
                    >
                      Pedidos
                    </button>
                  ) : (
                    "Pedidos"
                  )}
                  , toque no pedido e use "Etiqueta de envio".
                </p>
              </PainelRecolhivel>
            </div>

            <p className="mt-10 flex items-start gap-2 text-[11px] leading-snug text-zinc-600">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              Nada aqui vale antes de salvar. Mexeu? O botão "Salvar" no topo
              acende para você conferir e salvar.
            </p>
          </>
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
            A entrega da sua loja tem três partes, cada uma no seu painel
            recolhível: o{" "}
            <span className="font-bold text-zinc-200">frete local</span> (você
            mesmo entrega na cidade), o{" "}
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
              aqui? Toque em "Salvar" no cabeçalho da tela — nada é aplicado
              antes disso.
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
