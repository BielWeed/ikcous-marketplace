import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { normalizarNumeroMototaxi } from "@/components/admin/minha-loja/contato";
import { HistoricoCotacoesSection } from "@/components/admin/settings/HistoricoCotacoesCard";
import {
  type ConfigDoProvedor,
  NOME_DO_PROVEDOR,
  PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR,
  type ProvedorFrete,
  type SalvamentoDasTransportadoras,
  TransportadorasSection,
  emailDeContatoValido,
} from "@/components/admin/settings/TransportadorasCard";
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { FreteNacionalBloco } from "@/components/admin/shipping/FreteNacionalBloco";
import { PainelRecolhivel } from "@/components/admin/shipping/PainelRecolhivel";
import { PreviaDoFrete } from "@/components/admin/shipping/PreviaDoFrete";
import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useMototaxi } from "@/hooks/useMototaxi";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  transportadoraFicaSemPagamento,
  transportadoraVendeForaDaCidade,
} from "@/lib/aviso-transportadora-sem-pagamento";
import {
  erroDoFormularioNacional,
  estrategiaTemAlcanceEditavel,
  resumoDaEstrategiaNacional,
} from "@/lib/estrategias-de-frete";
import {
  DIAS_DA_ENTREGA_PROPRIA_PADRAO,
  type ModoDaEntregaNaCidade,
  diasDaEntregaPropria,
  listaComRetirada,
  modoDaEntregaNaCidade,
  retiradaLigadaNaLista,
} from "@/lib/guarda-de-frete";
import {
  alcanceAoMudarOCepDaLoja,
  cepCompleto,
  resumoDoAlcance,
} from "@/lib/loja-pronta";
import { usePagamentoPeloApp } from "@/lib/pagamento-pelo-app-no-painel";
import {
  type PresetFreteGratis,
  presetDoConfig,
  valorDoPreset,
} from "@/lib/presets-de-frete-gratis";
import { reais, situacaoDaEntrega } from "@/lib/status-da-entrega";
import type { EstrategiaDeFreteNacional, View } from "@/types";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  Check,
  Gift,
  HelpCircle,
  House,
  MapPin,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Truck,
} from "lucide-react";
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

/**
 * O prazo digitado como número, ou o padrão (1) se o campo está vazio. Texto
 * fora de 0 a 30 nem entra no campo (`aceitarDias`), então aqui só sobra
 * vazio ou número válido — `diasDaEntregaPropria` é a rede de segurança.
 */
function diasDoTexto(texto: string): number {
  return texto.trim() === ""
    ? DIAS_DA_ENTREGA_PROPRIA_PADRAO
    : diasDaEntregaPropria(Number(texto));
}

/** Só inteiro de 0 a 30 (ou vazio, para quem apaga para digitar de novo). */
function aceitarDias(texto: string): boolean {
  return /^\d{0,2}$/.test(texto) && (texto === "" || Number(texto) <= 30);
}

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

/** Perguntas da entrega; o contrato de gravação continua o mesmo. */
export const AdminShippingView = memo(function AdminShippingView({
  onNavigate,
  active,
  onSetDirty,
  painelInicial,
}: Readonly<AdminShippingViewProps>) {
  const { config, isLoaded, updateConfig } = useStore();
  const isOffline = useOnlineStatus();
  const mototaxi = useMototaxi(active);
  const [contatoMototaxi, setContatoMototaxi] = useState({
    whatsapp: "",
    nome: "",
  });
  const mototaxiPendenteRef = useRef(false);
  useEffect(() => {
    if (mototaxi.config && !mototaxiPendenteRef.current) {
      setContatoMototaxi({
        whatsapp: mototaxi.config.whatsapp ?? "",
        nome: mototaxi.config.nome ?? "",
      });
    }
  }, [mototaxi.config]);
  const mototaxiPendente =
    !!mototaxi.config &&
    (contatoMototaxi.whatsapp !== (mototaxi.config.whatsapp ?? "") ||
      contatoMototaxi.nome !== (mototaxi.config.nome ?? ""));
  const erroMototaxi =
    !!contatoMototaxi.whatsapp.trim() &&
    !normalizarNumeroMototaxi(contatoMototaxi.whatsapp);
  useEffect(() => {
    mototaxiPendenteRef.current = mototaxiPendente;
  }, [mototaxiPendente]);

  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const sincronizacaoSuspensaRef = useRef(false);
  const [falhaAoSalvar, setFalhaAoSalvar] = useState(false);

  // Painéis recolhíveis (pedido do dono, 23/09/2026): todos nascem
  // FECHADOS, exceto "Fora da cidade" quando a entrada veio pela rota
  // `admin-shipping-national` (compatibilidade com link/F5/Voltar antigos).
  const [painelAberto, setPainelAberto] = useState({
    local: false,
    nacional: painelInicial === "nacional",
    transportadoras: false,
    estrategiasLocais: false,
    etiquetas: false,
    consultas: false,
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
        case "transportadoras":
          return { ...prev, transportadoras: !prev.transportadoras };
        case "estrategiasLocais":
          return { ...prev, estrategiasLocais: !prev.estrategiasLocais };
        case "etiquetas":
          return { ...prev, etiquetas: !prev.etiquetas };
        case "consultas":
          return { ...prev, consultas: !prev.consultas };
        default:
          return prev;
      }
    });
  }, []);

  const [abaGratis, setAbaGratis] = useState<"local" | "nacional">("local");
  const [acaoTransportadoras, setAcaoTransportadoras] =
    useState<SalvamentoDasTransportadoras | null>(null);
  const somenteTransportadorasRef = useRef(false);
  const registrarSalvarTransportadoras = useCallback(
    (acao: SalvamentoDasTransportadoras) => setAcaoTransportadoras(acao),
    [],
  );
  const [escolhidos, setEscolhidos] = useState<readonly ProvedorFrete[] | null>(
    null,
  );
  const escolhaTransportadorasMudou = useCallback(
    (lista: readonly ProvedorFrete[]) => setEscolhidos(lista),
    [],
  );
  const abrirTransportadoras = useCallback(() => {
    setPainelAberto((prev) => ({ ...prev, nacional: true }));
    setTimeout(
      () =>
        document
          .getElementById("painel-frete-nacional")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }, []);

  // ── Formulário LOCAL (herdado, intacto) ───────────────────────────────
  const [formData, setFormData] = useState({
    preset: "desligado" as PresetFreteGratis,
    acimaDe: 0,
    shippingCoverage: "national" as "local" | "national",
    localDeliveryFee: 10,
    localCepRange: "",
    modo: "entrego" as ModoDaEntregaNaCidade,
    diasDaEntrega: String(DIAS_DA_ENTREGA_PROPRIA_PADRAO),
  });
  // O CEP da loja com que o formulário foi montado: "Só perto da loja" é uma
  // CÓPIA dos 5 primeiros números dele, e o Salvar a regrava se Minha loja
  // mudou o CEP enquanto esta tela estava aberta.
  const cepDoFormularioRef = useRef<string | null | undefined>(undefined);

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
      somenteTransportadorasRef.current = false;
      setFalhaAoSalvar(false);
      setFormData(atualizar);
    },
    [],
  );
  const atualizarFormDataNacional = useCallback(
    (atualizar: (prev: typeof formDataNacional) => typeof formDataNacional) => {
      somenteTransportadorasRef.current = false;
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
  // A leitura das transportadoras JÁ chegou ao menos uma vez? Antes disso as
  // listas vazias são "ainda não sei", não "nenhuma ligada".
  const [credsLidas, setCredsLidas] = useState(false);

  // A seção de Transportadoras avisa a cada leitura confirmada dela (ao
  // montar e depois de cada salvar): a faixa e "Fora da cidade" passam a
  // contar o que acabou de ser salvo, sem recarregar a tela.
  const onLigadosDasTransportadorasMudou = useCallback(
    (
      ligados: readonly ProvedorFrete[],
      provedores: ReadonlyMap<ProvedorFrete, ConfigDoProvedor>,
    ) => {
      setCredsErro(false);
      setCredsLidas(true);
      setLigadosSalvos(new Set(ligados));
      setProvedoresSalvos(provedores);
    },
    [],
  );
  // Token digitado e não salvo numa transportadora: entra na guarda de
  // navegação da tela (onSetDirty), mas não no botão Salvar do cabeçalho —
  // a chave tem o Salvar do próprio cartão.
  const [transportadorasPendentes, marcarTransportadorasPendentes] =
    useState(false);

  // ── Sincronização LOCAL (achado 3 da auditoria, intacta) ──────────────
  const jaSincronizouRef = useRef(false);
  const isFormDirtyRef = useRef(false);

  useEffect(() => {
    if (isLoaded && config) {
      if (
        jaSincronizouRef.current &&
        (isFormDirtyRef.current || sincronizacaoSuspensaRef.current)
      ) {
        return;
      }
      jaSincronizouRef.current = true;
      cepDoFormularioRef.current = config.originCep;
      const minSalvo = Number(config.freeShippingMin ?? 0);
      const presetSalvo = presetDoConfig(minSalvo);
      setFormData({
        preset: presetSalvo,
        acimaDe: presetSalvo === "acima_de_valor" ? minSalvo : 0,
        shippingCoverage: (config.shippingCoverage || "national") as
          | "local"
          | "national",
        localDeliveryFee: Number(config.localDeliveryFee ?? 10),
        localCepRange: config.localCepRange || "",
        modo: modoDaEntregaNaCidade(config),
        diasDaEntrega: String(diasDaEntregaPropria(config.localDeliveryDays)),
      });
    }
  }, [isLoaded, config, active]);

  // ── Sincronização NACIONAL (T4, mesma guarda, ref própria) ────────────
  const jaSincronizouNacionalRef = useRef(false);
  const isFormDirtyNacionalRef = useRef(false);

  useEffect(() => {
    if (isLoaded && config) {
      if (
        jaSincronizouNacionalRef.current &&
        (isFormDirtyNacionalRef.current || sincronizacaoSuspensaRef.current)
      ) {
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
            : (escolhidos ?? [...ligadosSalvos]).includes(p) && temChave
              ? ("ligado" as const)
              : temChave
                ? ("chave_salva" as const)
                : ("sem_chave" as const),
        };
      }),
    [ligadosSalvos, provedoresSalvos, escolhidos],
  );
  const nomesLigados = useMemo(
    () =>
      provedoresNacional
        .filter((p) => p.estado === "ligado")
        .map((p) => p.nome),
    [provedoresNacional],
  );

  // Transportadora vendendo + pagamento pelo app desligado = o cliente de
  // outra cidade só descobre no ÚLTIMO passo do checkout, e o lojista nunca
  // (14/10/2026). Mesma régua da faixa acima para "transportadora ligada" (a
  // leitura que falhou NÃO chuta) e o estado do pagamento pelo app é o do
  // PAINEL — o retrato do boot mais o eco que Ajustes recebe do servidor —,
  // nunca só o boot: aviso falso é pior que aviso nenhum.
  const pagamentoPeloAppLigado = usePagamentoPeloApp();
  const avisarTransportadoraSemPagamento = transportadoraFicaSemPagamento({
    transportadoraVende: transportadoraVendeForaDaCidade({
      cobertura: formData.shippingCoverage,
      nomesLigados: credsErro ? null : nomesLigados,
    }),
    pagamentoPeloAppLigado,
  });

  const resumoPainelLocal = `${formData.modo === "so_retiro" ? "Só retirada na loja · qualquer cliente pode buscar" : formData.modo === "entrego_e_retiro" ? "Você entrega ou o cliente retira" : "Você entrega"}${formData.modo === "so_retiro" ? "" : cepCompleto(config?.originCep) ? ` · ${resumoDoAlcance(config?.originCep, formData.localCepRange)}` : " · até onde, depende do CEP da loja"}`;
  const resumoPainelNacional =
    formData.shippingCoverage === "local"
      ? "Não vende fora da sua região"
      : credsErro || !credsLidas
        ? "Não deu para confirmar as transportadoras"
        : nomesLigados.length
          ? `${nomesLigados.join(" e ")} ${nomesLigados.length === 1 ? "cota" : "cotam"} o frete na hora`
          : "Nenhuma transportadora ligada: quem é de fora não compra";
  const resumoGratisLocal =
    formData.preset === "desligado"
      ? "não dá"
      : formData.preset === "sempre"
        ? "sempre"
        : formData.preset === "por_produto"
          ? "produtos marcados"
          : `acima de R$ ${reais(formData.acimaDe)}`;

  // ── Dirty check LOCAL (intacto) ────────────────────────────────────────
  const isFormDirtyLocal = useMemo(() => {
    if (!config) return false;
    const minAtual = Number(config.freeShippingMin ?? 0);
    if (formData.preset !== presetDoConfig(minAtual)) return true;
    if (formData.preset === "acima_de_valor" && formData.acimaDe !== minAtual)
      return true;
    if (formData.shippingCoverage !== (config.shippingCoverage || "national"))
      return true;
    if (formData.localDeliveryFee !== Number(config.localDeliveryFee ?? 10))
      return true;
    if (formData.localCepRange !== (config.localCepRange || "")) return true;
    if (formData.modo !== modoDaEntregaNaCidade(config)) return true;
    if (
      diasDoTexto(formData.diasDaEntrega) !==
      diasDaEntregaPropria(config.localDeliveryDays)
    )
      return true;
    return false;
  }, [formData, config]);

  // Retirada (as duas respostas com ela) exige o endereço da loja. É a MESMA
  // fonte que o bloco lê (`config.storeAddress`): o eco do Realtime não traz o
  // endereço, e nesse instante a tela trata como "sem endereço" e NÃO deixa
  // gravar uma retirada nova — melhor recusar do que gravar retirada que a
  // cliente não consegue usar. Quem já tinha a retirada ligada e só mexe em
  // outra coisa não é barrado (o modo não mudou).
  const temEnderecoDaLoja = (config?.storeAddress ?? "").trim() !== "";
  const retiradaSemEndereco =
    !!config &&
    formData.modo !== "entrego" &&
    formData.modo !== modoDaEntregaNaCidade(config) &&
    !temEnderecoDaLoja;

  // "Só retiro" sem o CEP completo da loja: a edge e as RPCs recusam toda
  // compra (origin_cep vazio). Vale também para a loja que JÁ está nesse modo:
  // o salvar fica travado enquanto o modo resultante for "Só retiro".
  const soRetiroSemCep =
    !!config && formData.modo === "so_retiro" && !cepCompleto(config.originCep);

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

  const regrasMudaram = isFormDirtyLocal || isFormDirtyNacional;
  const isFormDirty =
    regrasMudaram || !!acaoTransportadoras?.mudou || mototaxiPendente;
  const soMototaxiPendente =
    mototaxiPendente && !regrasMudaram && !acaoTransportadoras?.mudou;
  const erroLocal =
    formData.preset === "acima_de_valor" && formData.acimaDe <= 0
      ? "Escreva o valor. Para não dar frete grátis, escolha a primeira opção."
      : null;

  // Cada metade atualiza SÓ o próprio ref — é o que a guarda de
  // sincronização de cada metade lê.
  useEffect(() => {
    isFormDirtyRef.current = isFormDirtyLocal;
  }, [isFormDirtyLocal]);
  useEffect(() => {
    isFormDirtyNacionalRef.current = isFormDirtyNacional;
  }, [isFormDirtyNacional]);
  useEffect(() => {
    // Libera só depois de comparar o formulário com o config confirmado.
    if (!isSaving) sincronizacaoSuspensaRef.current = false;
  }, [isSaving]);

  // Um sinal só sai para o pai (gate de navegação do App) — ele nunca soube
  // que existiam duas metades. O token não salvo das Transportadoras soma
  // aqui também (H5): sair da tela não descarta a chave digitada em silêncio.
  useEffect(() => {
    onSetDirty?.(isFormDirty || transportadorasPendentes);
  }, [isFormDirty, transportadorasPendentes, onSetDirty]);

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

  const abrirEIrParaEstrategiaNacional = useCallback(() => {
    setPainelAberto((prev) => ({ ...prev, estrategiasLocais: true }));
    setAbaGratis("nacional");
    setTimeout(
      () =>
        document
          .getElementById("painel-frete-gratis")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }, []);

  // ── Salvar — LOCAL e NACIONAL na MESMA ação (pedido do dono, 23/09) ───
  const handleSave = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar as configurações.",
      });
      return;
    }
    if (isSaving || erroMototaxi) return;
    if (!soMototaxiPendente && erroLocal) {
      setPainelAberto((prev) => ({ ...prev, estrategiasLocais: true }));
      setAbaGratis("local");
      return;
    }
    if (!soMototaxiPendente && erroNacional) {
      // Segunda trava (a primeira é o botão desabilitado): se algo chamar
      // handleSave mesmo assim, o painel com o erro abre e ganha foco em
      // vez de a tela fingir que salvou.
      abrirEIrParaEstrategiaNacional();
      return;
    }

    if (!soMototaxiPendente && retiradaSemEndereco) {
      // Antes do `setIsSaving`: recusar não pode deixar a tela em "Salvando…".
      toast.error("Cadastre o endereço da loja em Minha loja", {
        description: "Sem endereço, o cliente não sabe onde retirar.",
      });
      return;
    }

    if (!soMototaxiPendente && soRetiroSemCep) {
      toast.error("Cadastre o CEP da loja em Minha loja", {
        description:
          "Para vender só com retirada, a loja precisa do CEP. Ou escolha outra forma de entrega.",
      });
      return;
    }

    sincronizacaoSuspensaRef.current = true;
    setIsSaving(true);
    haptic.medium();

    const retiradaMudou =
      (formData.modo !== "entrego") !==
      retiradaLigadaNaLista(config?.enabledShippingMethods);
    // O alcance "só perto da loja" é uma cópia do CEP: se Minha loja o mudou
    // desde que o formulário abriu, o Salvar leva o alcance junto. Limite
    // conhecido: um alcance escrito de propósito IGUAL aos 5 primeiros números
    // do CEP antigo (ex.: "38500") é indistinguível do automático e também
    // acompanha o CEP novo.
    const alcanceAntes = formData.localCepRange;
    const alcance =
      alcanceAoMudarOCepDaLoja(
        cepDoFormularioRef.current,
        config?.originCep,
        formData.localCepRange,
      ) ?? formData.localCepRange;

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
      let mototaxiSalvoNestaRodada = false;
      if (mototaxiPendente) {
        const salvouMototaxi = await mototaxi.salvar(contatoMototaxi);
        if (!salvouMototaxi) {
          setFalhaAoSalvar(true);
          toast.error("Não foi possível salvar o mototáxi. Tente de novo.");
          return;
        }
        mototaxiSalvoNestaRodada = true;
        mototaxiPendenteRef.current = false;
        setContatoMototaxi({
          whatsapp: normalizarNumeroMototaxi(contatoMototaxi.whatsapp) ?? "",
          nome: contatoMototaxi.nome.trim(),
        });
      }
      const salvou = !regrasMudaram
        ? true
        : await updateConfig({
            freeShippingMin: valorDoPreset(formData.preset, formData.acimaDe),
            shippingCoverage: formData.shippingCoverage,
            localDeliveryFee: Math.max(0, formData.localDeliveryFee),
            localCepRange: alcance,
            localDeliveryEnabled: formData.modo !== "so_retiro",
            localDeliveryDays: diasDoTexto(formData.diasDaEntrega),
            ...(retiradaMudou
              ? {
                  enabledShippingMethods: listaComRetirada(
                    config?.enabledShippingMethods,
                    formData.modo !== "entrego",
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

      // Normaliza só o formulário enviado; preserva edições feitas na espera.
      // O config confirmado passa a ser a referência do dirty check.
      setFormDataNacional((atual) =>
        atual.estrategia === formDataNacional.estrategia &&
        atual.minimo === formDataNacional.minimo &&
        atual.tipoDesconto === formDataNacional.tipoDesconto &&
        atual.valorDesconto === formDataNacional.valorDesconto &&
        atual.alcance === formDataNacional.alcance
          ? nacionalAjustado
          : atual,
      );
      if (alcance !== alcanceAntes) {
        // O alcance foi regravado: o formulário o acompanha, senão ficaria
        // "diferente do salvo" para sempre — mas só se o campo ainda é o de
        // antes do Salvar (os campos seguem editáveis enquanto salva).
        setFormData((prev) =>
          prev.localCepRange === alcanceAntes
            ? { ...prev, localCepRange: alcance }
            : prev,
        );
      }
      if (acaoTransportadoras?.mudou && !(await acaoTransportadoras.salvar())) {
        somenteTransportadorasRef.current = true;
        setFalhaAoSalvar(true);
        toast.error(
          regrasMudaram
            ? "As regras foram salvas, mas as transportadoras não. Toque em Tentar de novo."
            : "As transportadoras não foram salvas. Toque em Tentar de novo.",
        );
        return;
      }
      somenteTransportadorasRef.current = false;
      setFalhaAoSalvar(false);
      // A guarda acompanha o dirty check e os tokens pendentes pelo efeito.
      haptic.success();
      if (regrasMudaram) toast.success("Regras de frete salvas!");
      else if (mototaxiSalvoNestaRodada)
        toast.success("Contato do mototáxi salvo");
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
    !isSaving &&
    !isOffline &&
    isFormDirty &&
    !erroMototaxi &&
    (soMototaxiPendente ||
      (!erroLocal && !erroNacional && !retiradaSemEndereco && !soRetiroSemCep));

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
        estilo:
          "border border-admin-border bg-transparent text-[hsl(var(--admin-text-soft))]",
        rotulo: "Salvo",
        icone: <Check className="size-3.5" />,
      },
    ],
    [
      "pendente",
      {
        estilo:
          "bg-[hsl(var(--admin-gold-fill))] text-black shadow-lg hover:opacity-90",
        rotulo: "Salvar",
        icone: <Save className="size-3.5" />,
      },
    ],
    [
      "salvando",
      {
        estilo: "bg-[hsl(var(--admin-gold-fill))] text-black opacity-70",
        rotulo: "Salvando…",
        icone: <RefreshCw className="size-3.5 animate-spin" />,
      },
    ],
    [
      "erro",
      {
        estilo: "bg-[#BE123C] text-white hover:bg-[#BE123C]",
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
        style={
          estadoSalvar === "erro"
            ? { backgroundColor: "#BE123C", color: "#fff" }
            : undefined
        }
        onClick={handleSave}
        className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-extrabold transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${infoBotaoSalvar.estilo}`}
      >
        {infoBotaoSalvar.icone}
        {infoBotaoSalvar.rotulo}
      </button>
    </div>
  );

  const configDaPrevia = config
    ? {
        ...config,
        freeShippingMin: valorDoPreset(formData.preset, formData.acimaDe),
        shippingCoverage: formData.shippingCoverage,
        localDeliveryFee: formData.localDeliveryFee,
        localDeliveryDays: diasDoTexto(formData.diasDaEntrega),
        localDeliveryEnabled: formData.modo !== "so_retiro",
        localCepRange: formData.localCepRange,
        enabledShippingMethods: listaComRetirada(
          config.enabledShippingMethods,
          formData.modo !== "entrego",
        ),
        nationalShippingStrategy: formDataNacional.estrategia,
        nationalShippingMin: formDataNacional.minimo,
        nationalDiscountType: formDataNacional.tipoDesconto,
        nationalDiscountValue: formDataNacional.valorDesconto,
        nationalBenefitScope: formDataNacional.alcance,
      }
    : null;

  const {
    faltaCep,
    faltaTransportadora,
    faltaEndereco,
    faltaAlcance,
    confirmarTransportadoras,
    pendencias,
  } = situacaoDaEntrega(
    configDaPrevia,
    credsErro || !credsLidas ? null : nomesLigados,
    avisarTransportadoraSemPagamento,
  );
  const selo = isOffline
    ? "Sem internet"
    : confirmarTransportadoras
      ? "A confirmar"
      : pendencias === 0
        ? "Pronta para vender"
        : pendencias === 1
          ? "Falta 1 coisa para vender"
          : `Faltam ${pendencias} coisas`;

  return (
    <div className="pb-admin min-h-screen bg-admin-bg text-zinc-100">
      <div className="sticky top-0 z-30 bg-admin-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <header className="mx-auto max-w-4xl rounded-[20px] border border-admin-border bg-admin-surface p-4">
          <div className="flex items-center gap-1">
            <h1 className="min-w-0 break-words text-2xl font-black uppercase italic tracking-tight">
              {NOMES_DO_PAINEL["admin-shipping"]}
            </h1>
            <button
              type="button"
              title="Ajuda e explicação desta tela"
              onClick={() => setShowHelpModal(true)}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-[hsl(var(--admin-text-soft))]"
            >
              <HelpCircle className="size-5" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span
              role="status"
              className={`rounded-full border border-admin-border px-2.5 py-1 text-xs font-bold ${pendencias || confirmarTransportadoras ? "text-amber-300" : "text-emerald-300"}`}
            >
              {selo}
            </span>
            {botaoSalvar}
          </div>
          {(erroLocal || erroNacional) && (
            <p className="mt-2 text-xs text-red-300">
              Corrija o valor em Frete grátis para salvar.
            </p>
          )}
        </header>
      </div>
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:px-6">
        {!isLoaded ? (
          <div aria-busy="true" className="animate-pulse space-y-4">
            <div className="h-72 rounded-[20px] bg-admin-raised" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 rounded-[20px] bg-admin-raised" />
            ))}
          </div>
        ) : (
          <>
            {isOffline && (
              <p
                role="status"
                className="rounded-xl border border-admin-border bg-admin-surface p-3 text-[12.5px] text-zinc-400"
              >
                <b>Sem internet.</b> Você pode olhar tudo, mas precisa estar
                online para salvar.
              </p>
            )}
            <h2 className="pt-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[hsl(var(--admin-text-soft))]">
              • Como fica para o cliente
            </h2>
            {configDaPrevia && (
              <PreviaDoFrete
                config={configDaPrevia}
                nomesLigados={credsErro || !credsLidas ? null : nomesLigados}
                pendente={isFormDirty}
              />
            )}
            {pendencias > 0 && (
              <section aria-label="Antes de vender" className="space-y-3">
                <h2 className="pt-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[hsl(var(--admin-text-soft))]">
                  • Antes de vender
                </h2>
                {faltaEndereco && (
                  <AvisoDaEntrega
                    titulo="Falta o endereço da retirada"
                    detalhe="O cliente precisa saber onde buscar. Cadastre o endereço da loja."
                    botao="Abrir Minha loja"
                    onClick={
                      onNavigate
                        ? () => onNavigate("admin-about-store")
                        : undefined
                    }
                  />
                )}
                {faltaAlcance && (
                  <AvisoDaEntrega
                    titulo="Confira até onde você entrega"
                    detalhe="A faixa escrita não tem números: nenhum CEP recebe a entrega local."
                    botao="Ver Na sua região"
                    onClick={() =>
                      setPainelAberto((prev) => ({ ...prev, local: true }))
                    }
                  />
                )}
                {faltaCep && (
                  <AvisoDaEntrega
                    titulo="Falta o CEP de onde você envia"
                    detalhe="Sem ele nenhum frete é calculado e ninguém finaliza a compra."
                    botao="Cadastrar em Minha loja"
                    onClick={
                      onNavigate
                        ? () => onNavigate("admin-about-store")
                        : undefined
                    }
                  />
                )}
                {faltaTransportadora && (
                  <AvisoDaEntrega
                    titulo="Ninguém de fora da sua região compra"
                    detalhe="Nenhuma transportadora está ligada. Se só vende perto, tudo bem."
                    botao="Ligar transportadora"
                    onClick={abrirTransportadoras}
                  />
                )}
                {avisarTransportadoraSemPagamento && (
                  <div data-aviso-transportadora-sem-pagamento="">
                    <AvisoDaEntrega
                      titulo="Transportadora só funciona com pagamento pelo app ligado."
                      detalhe="Hoje seus clientes de fora da sua região não conseguem finalizar a compra."
                      botao="Ver pagamento pelo app"
                      onClick={
                        onNavigate
                          ? () => onNavigate("admin-settings")
                          : undefined
                      }
                    />
                  </div>
                )}
              </section>
            )}
            <h2 className="pt-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[hsl(var(--admin-text-soft))]">
              • O que você escolhe
            </h2>
            <section
              aria-label="De onde sai"
              className={`flex flex-wrap items-center gap-3 rounded-[20px] border bg-admin-surface p-4 ${faltaCep ? "border-amber-500/40" : "border-admin-border"}`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-admin-raised text-admin-gold">
                <MapPin aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-[150px] flex-1 break-words">
                <h3 className="text-[15px] font-extrabold">De onde sai</h3>
                <p className="text-[13px] text-[hsl(var(--admin-text-soft))]">
                  {faltaCep
                    ? "Sem CEP: nenhum frete é calculado"
                    : `CEP ${config?.originCep} · ${config?.storeCity ?? ""}/${config?.storeState ?? ""}`}
                </p>
              </div>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate("admin-about-store")}
                  className="min-h-11 rounded-xl border border-admin-border bg-admin-raised px-3 text-[13px] font-bold"
                >
                  {faltaCep ? "Cadastrar" : "Alterar"}
                </button>
              )}
            </section>
            <PainelRecolhivel
              id="painel-frete-local"
              titulo="Na sua região"
              icone={House}
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
                cidade={config?.storeCity}
                uf={config?.storeState}
                semOrigem={!config?.originCep}
                cepDaLoja={config?.originCep}
                desabilitado={isOffline}
                modo={formData.modo}
                onModo={(modo) =>
                  atualizarFormData((prev) => ({ ...prev, modo }))
                }
                dias={formData.diasDaEntrega}
                onDias={(diasDaEntrega) => {
                  if (aceitarDias(diasDaEntrega))
                    atualizarFormData((prev) => ({ ...prev, diasDaEntrega }));
                }}
                enderecoDaLoja={config?.storeAddress}
                onNavigate={onNavigate}
                nomesLigados={credsErro || !credsLidas ? null : nomesLigados}
                pagamentoPeloAppLigado={pagamentoPeloAppLigado}
              />
              <fieldset
                disabled={isOffline || isSaving || !mototaxi.config}
                className="mt-6 space-y-4 border-t border-admin-border pt-5"
              >
                <legend className="text-sm font-bold text-zinc-200">
                  Mototáxi{" "}
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    opcional
                  </span>
                </legend>
                <p className="text-xs text-zinc-500">
                  Quem faz as entregas para você. O número fica só no painel.
                </p>
                <div className="space-y-1.5">
                  <label
                    htmlFor="mototaxi-whatsapp"
                    className="flex items-center gap-2 text-xs text-zinc-400"
                  >
                    <IconeWhatsapp className="size-4 text-emerald-400" />{" "}
                    WhatsApp do mototáxi
                  </label>
                  <input
                    id="mototaxi-whatsapp"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={contatoMototaxi.whatsapp}
                    aria-invalid={erroMototaxi}
                    aria-describedby={
                      erroMototaxi ? "mototaxi-erro" : undefined
                    }
                    onChange={(e) => {
                      setFalhaAoSalvar(false);
                      setContatoMototaxi((c) => ({
                        ...c,
                        whatsapp: e.target.value,
                      }));
                    }}
                    className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-surface px-3 text-sm text-zinc-100 disabled:opacity-50"
                    placeholder="(11) 98765-4321"
                  />
                  {erroMototaxi && (
                    <p
                      id="mototaxi-erro"
                      role="alert"
                      className="text-xs text-amber-300"
                    >
                      Informe DDD e número brasileiros válidos.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="mototaxi-nome"
                    className="text-xs text-zinc-400"
                  >
                    Nome dele (opcional)
                  </label>
                  <input
                    id="mototaxi-nome"
                    type="text"
                    autoComplete="off"
                    maxLength={80}
                    value={contatoMototaxi.nome}
                    onChange={(e) => {
                      setFalhaAoSalvar(false);
                      setContatoMototaxi((c) => ({
                        ...c,
                        nome: e.target.value,
                      }));
                    }}
                    className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-surface px-3 text-sm text-zinc-100 disabled:opacity-50"
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  No pedido de entrega local aparece “Enviar ao mototáxi”, com a
                  mensagem pronta.
                </p>
              </fieldset>
              {mototaxi.erro && (
                <div role="alert" className="mt-3 text-xs text-amber-300">
                  Não foi possível carregar o mototáxi.{" "}
                  <button
                    type="button"
                    onClick={mototaxi.recarregar}
                    className="min-h-11 underline"
                  >
                    Tentar carregar de novo
                  </button>
                </div>
              )}
            </PainelRecolhivel>
            <PainelRecolhivel
              id="painel-frete-nacional"
              titulo="Fora da sua região"
              icone={Truck}
              resumo={
                transportadorasPendentes
                  ? `${resumoPainelNacional} · chave digitada — falta salvar`
                  : resumoPainelNacional
              }
              aberta={painelAberto.nacional}
              onToggle={() => alternarPainel("nacional")}
            >
              <FreteNacionalBloco
                coverage={formData.shippingCoverage}
                onCoverage={(shippingCoverage) =>
                  atualizarFormData((prev) => ({ ...prev, shippingCoverage }))
                }
                desabilitado={isOffline}
              >
                <TransportadorasSection
                  active={active}
                  onErroMudou={setCredsErro}
                  onDirtyMudou={marcarTransportadorasPendentes}
                  onLigadosMudou={onLigadosDasTransportadorasMudou}
                  onSalvarMudou={registrarSalvarTransportadoras}
                  onEscolhaMudou={escolhaTransportadorasMudou}
                  desabilitado={isOffline}
                />
              </FreteNacionalBloco>
            </PainelRecolhivel>
            <PainelRecolhivel
              id="painel-frete-gratis"
              titulo="Frete grátis"
              icone={Gift}
              resumo={`Na região: ${resumoGratisLocal} · Fora: ${resumoDaEstrategiaNacional(configDaPrevia ?? config)}`}
              aberta={painelAberto.estrategiasLocais}
              onToggle={() => alternarPainel("estrategiasLocais")}
              comPendencia={!!erroLocal || !!erroNacional}
            >
              <div
                role="tablist"
                aria-label="Onde dar frete grátis"
                className="mb-4 flex rounded-full bg-admin-bg p-1"
              >
                {(["local", "nacional"] as const).map((aba) => (
                  <button
                    key={aba}
                    type="button"
                    role="tab"
                    id={`aba-gratis-${aba}`}
                    aria-controls={`gratis-${aba}`}
                    aria-selected={abaGratis === aba}
                    onClick={() => setAbaGratis(aba)}
                    className={`min-h-11 min-w-0 flex-1 rounded-full px-2 text-xs font-bold ${abaGratis === aba ? "bg-[hsl(var(--admin-gold-fill))] text-black" : "text-zinc-300"}`}
                  >
                    {aba === "local" ? "Na sua região" : "Fora da região"}
                    {(aba === "local" ? erroLocal : erroNacional) && (
                      <span className="block text-red-300">
                        Corrija o valor
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                id="gratis-local"
                aria-labelledby="aba-gratis-local"
                hidden={abaGratis !== "local"}
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
              </div>
              <div
                role="tabpanel"
                id="gratis-nacional"
                aria-labelledby="aba-gratis-nacional"
                hidden={abaGratis !== "nacional"}
              >
                <EstrategiaNacionalBloco
                  mostrarCabecalho={false}
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
                  <p role="alert" className="mt-2 text-[12.5px] text-red-300">
                    {erroNacional}
                  </p>
                )}
              </div>
            </PainelRecolhivel>
            <PainelRecolhivel
              id="painel-frete-avancado"
              titulo="Avançado"
              icone={SlidersHorizontal}
              resumo="Consultas de frete e etiquetas de envio"
              aberta={painelAberto.consultas}
              onToggle={() => alternarPainel("consultas")}
            >
              <h3 className="text-sm font-bold">Consultas de frete</h3>
              <p className="mb-3 text-[12.5px] text-[hsl(var(--admin-text-soft))]">
                As últimas cotações feitas para os seus clientes.
              </p>
              {painelAberto.consultas && <HistoricoCotacoesSection />}
              <h3 className="mt-5 text-sm font-bold">Etiquetas de envio</h3>
              <p className="mt-2 text-[12.5px] text-[hsl(var(--admin-text-soft))]">
                Ficam no próprio pedido: abra Pedidos, toque no pedido e use
                “Etiqueta de envio”.
              </p>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate("admin-orders")}
                  className="mt-2 min-h-11 rounded-xl border border-admin-border px-3 text-xs font-bold"
                >
                  Abrir Pedidos
                </button>
              )}
            </PainelRecolhivel>
            <p className="text-xs leading-relaxed text-[hsl(var(--admin-text-soft))]">
              Mexeu em algo? Toque em Salvar, no alto. A chave de cada
              transportadora é salva dentro dela.
            </p>
          </>
        )}
      </main>
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Ajuda — Entrega e frete"
      >
        <p>
          Em Na sua região, escolha como você entrega ou oferece retirada. Em
          Fora da sua região, escolha se vende por transportadora e toque no
          nome dela para conectar a chave.
        </p>
        <p>
          Frete grátis reúne as regras da sua região e de fora em abas
          separadas. O preço fora da região vem da transportadora, cotado na
          hora — não há taxa fixa.
        </p>
        <p>
          O CEP e o endereço de onde sai são cadastrados em Minha loja.
          Consultas e etiquetas ficam em Avançado.
        </p>
        <p>
          Toque em Salvar no topo para gravar as regras e quem está ligado. A
          chave de acesso é salva dentro da folha da transportadora.
        </p>
      </AdminHelpModal>
    </div>
  );
});

function AvisoDaEntrega({
  titulo,
  detalhe,
  botao,
  onClick,
}: {
  readonly titulo: string;
  readonly detalhe: string;
  readonly botao: string;
  readonly onClick?: () => void;
}) {
  return (
    <div
      role="status"
      className="rounded-[14px] border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300"
    >
      <p className="flex items-start gap-2 text-[13px] font-bold">
        <AlertCircle aria-hidden="true" className="size-[18px] shrink-0" />
        {titulo}
      </p>
      <p className="mt-1 text-[12.5px]">{detalhe}</p>
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          className="mt-2 min-h-11 rounded-lg border border-amber-500/30 px-3 text-xs font-bold"
        >
          {botao}
        </button>
      )}
    </div>
  );
}
