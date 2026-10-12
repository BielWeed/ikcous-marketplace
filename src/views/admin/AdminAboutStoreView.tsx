import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ContatoDaLoja } from "@/components/admin/minha-loja/ContatoDaLoja";
import {
  EnderecoDaLoja,
  type MudancaDoEndereco,
} from "@/components/admin/minha-loja/EnderecoDaLoja";
import { BusinessHoursSection } from "@/components/admin/settings/BusinessHoursSection";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemDeErroDoPainel } from "@/lib/erro-do-painel";
import {
  type ChaveDosSeisPassos,
  entradaDosSeisPassos,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
import { descricaoDaLojaParaHtml, textoDaLoja } from "@/lib/texto-da-loja";
import { AlertTriangle, RefreshCw, Save } from "lucide-react";
import { Suspense, lazy, memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { View } from "@/types";

// Tela "Minha loja" do painel (antes "Sobre a Loja", pedido do dono de
// 20/09/2026; renomeada no painel simples de 09/10/2026): concentra O QUE a
// página pública "Sobre a Loja" (AboutStoreView) exibe — marca (nome/logo),
// endereço que alimenta o mapa, horário e descrição, mais o CONTATO (WhatsApp
// e a mensagem de compartilhar, que antes moravam na tela "Atendimento" — hoje
// só um apelido desta, `secaoInicial="contato"`). Direção B (lote-b 12/09):
// blocos numerados todos abertos, nada desmonta ao digitar. No topo, "Falta
// preencher" lista o que os seis passos da loja pronta ainda pedem aqui.
//
// TRÊS CONTRATOS DE SALVAMENTO, por desenho: identidade, horário e contato têm
// editores próprios que salvam sozinhos (IdentitySettingsSection,
// BusinessHoursSection e ContatoDaLoja — desde 22/09/2026 a edição mora só
// aqui; os acordeões duplicados em Ajustes ("Nome, logo e cores" e
// "Atendimento") saíram); endereço e descrição são gravados pelo botão
// "Salvar" desta tela num único updateConfig. O ENDEREÇO é a fonte única da loja (CEP, texto,
// cidade e UF — EnderecoDaLoja, sem migration: as quatro colunas que já
// existem); ele só entra no pacote quando a lojista o alterou. O dirty da
// tela é o OU de todos.
/** Blocos de Minha loja a que um link (ou o "Falta preencher") leva. */
type BlocoDeMinhaLoja = "marca" | "endereco" | "contato";

/** Em que bloco mora cada passo da loja pronta que esta tela cuida. */
const BLOCO_DO_PASSO = new Map<ChaveDosSeisPassos, BlocoDeMinhaLoja>([
  ["marca", "marca"],
  ["endereco", "endereco"],
  ["whatsapp", "contato"],
]);

interface AdminAboutStoreViewProps {
  /** O AdminArea repassa a todas as telas; esta não navega para fora (o
   * Contato mora aqui e o "Falta preencher" rola até o bloco). */
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  /**
   * Abre a tela já no bloco: rola até ele e põe o foco no título. O antigo
   * Atendimento (`admin-whatsapp-config`) é apelido desta tela nessa seção.
   */
  secaoInicial?: "contato";
  /** Voltar do aparelho com a folha de modelos do Contato aberta. */
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

const IdentitySettingsSection = lazy(() =>
  import("@/components/admin/settings/IdentitySettingsSection").then(
    (module) => ({ default: module.IdentitySettingsSection }),
  ),
);

// Cabeçalho dos blocos (mesmo desenho do BlocoNumerado da tela Atendimento —
// local a este arquivo de propósito, como lá).
function BlocoNumerado({
  numero,
  titulo,
  descricao,
  refDoTitulo,
  children,
}: {
  readonly numero: string;
  readonly titulo: string;
  readonly descricao: string;
  /** Para levar o foco ao título (secaoInicial, "Falta preencher"). */
  readonly refDoTitulo?: (titulo: HTMLHeadingElement | null) => void;
  readonly children: React.ReactNode;
}) {
  const idDoTitulo = `bloco-sobre-a-loja-${numero}`;

  return (
    <section
      aria-labelledby={idDoTitulo}
      className="admin-glass rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
    >
      <div className="flex items-center gap-3">
        <span
          data-numero
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-admin-gold/20 bg-admin-gold/10 text-[13px] font-black text-admin-gold"
        >
          {numero}
        </span>
        <h2
          id={idDoTitulo}
          ref={refDoTitulo}
          tabIndex={-1}
          className="scroll-mt-24 rounded text-[15px] font-black tracking-tight text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-gold"
        >
          {titulo}
        </h2>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-zinc-400">
        {descricao}
      </p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export const AdminAboutStoreView = memo(function AdminAboutStoreView({
  active = true,
  onSetDirty,
  secaoInicial,
  onSetBackOverride,
}: AdminAboutStoreViewProps) {
  const { config, updateConfig, isLoaded } = useStore();
  const isOffline = useOnlineStatus();

  // Descrição: baseline do config, dirty por diff (mesmo molde do editor de
  // horário: dado que chega só atualiza editor puro). A descrição gravada é
  // HTML simples — o editor mostra o texto pelo INVERSO do mesmo módulo que
  // converte no save (ida e volta exata; sem isto, micro-diferenças deixavam
  // o botão Salvar eternamente habilitado). O endereço tem baseline e dirty
  // próprios, dentro do EnderecoDaLoja (`mudancaEndereco`).
  const baselineDescricao = textoDaLoja(config.storeDescription);
  const [descricao, setDescricao] = useState(baselineDescricao);
  const [mudancaEndereco, setMudancaEndereco] =
    useState<MudancaDoEndereco | null>(null);
  const [saving, setSaving] = useState(false);
  const [identidadePendente, setIdentidadePendente] = useState(false);
  const [horarioPendente, setHorarioPendente] = useState(false);
  const [contatoPendente, setContatoPendente] = useState(false);
  const lifecycle = useRef({ mounted: true, active, serial: 0 });
  if (lifecycle.current.active && !active) lifecycle.current.serial++;
  lifecycle.current.active = active;
  useEffect(() => {
    if (!active) setSaving(false);
  }, [active]);
  // O que o lojista tem NA TELA vs o que o banco mandou por último: a
  // sincronização de incoming só sobrescreve se ele NÃO digitou desde a
  // última sincronização. O guarda é um REF, não o formDirty derivado: na
  // hidratação assíncrona (config vazio → fetch completa), o formDirty vira
  // true no MESMO render em que o baseline novo chega — e um guarda por
  // formDirty pulava a sincronização para sempre (campos presos vazios e
  // botão Salvar habilitado sem edição — 1ª execução real, 20/09/2026).
  const usuarioEditou = useRef(false);
  const lastIncoming = useRef(config.storeDescription ?? "");
  const enderecoAlterado = mudancaEndereco?.alterado ?? false;
  // Endereço alterado mas incompleto: o Salvar espera (o motivo está à vista
  // no bloco do endereço).
  const enderecoPrecisaCompletar =
    enderecoAlterado && mudancaEndereco?.valores == null;
  const formDirty = enderecoAlterado || descricao !== baselineDescricao;
  useEffect(() => {
    // A assinatura é do config BRUTO (snake que o banco entrega via
    // mapConfig) — a MESMA forma do lastIncoming inicial, nunca texto
    // decodificado comparado com bruto.
    const assinatura = config.storeDescription ?? "";
    if (assinatura === lastIncoming.current) return;
    lastIncoming.current = assinatura;
    if (!usuarioEditou.current && !saving) {
      setDescricao(baselineDescricao);
    }
  }, [baselineDescricao, config.storeDescription, saving]);
  useEffect(() => {
    onSetDirty?.(
      formDirty ||
        saving ||
        identidadePendente ||
        horarioPendente ||
        contatoPendente,
    );
  }, [
    formDirty,
    saving,
    identidadePendente,
    horarioPendente,
    contatoPendente,
    onSetDirty,
  ]);
  useEffect(() => {
    const life = lifecycle.current;
    life.mounted = true;
    return () => {
      life.mounted = false;
      life.serial++;
    };
  }, []);

  // Prévia do mapa com o que está DIGITADO (não o salvo): a mesma cascata
  // da página pública — endereço → CEP do frete → cidade/UF.
  const local = [config.storeCity?.trim(), config.storeState?.trim()]
    .filter(Boolean)
    .join(", ");
  const queryPrevia =
    mudancaEndereco?.valores?.storeAddress ||
    config.storeAddress?.trim() ||
    config.originCep?.trim() ||
    local;

  // O guard de navegação cobre o TODO (qualquer seção pendente). Já o botão
  // Salvar é SÓ do formulário (endereço/descrição) — identidade e horário
  // têm saves próprios; habilitar o Salvar com pendência deles era botão
  // mentiroso (achado da 1ª execução real, 20/09/2026).

  async function handleSubmit() {
    if (saving || !active || isOffline || !formDirty) return;
    if (enderecoPrecisaCompletar) return;
    const life = lifecycle.current;
    const serial = ++life.serial;
    const isCurrent = () =>
      life.mounted && life.active && life.serial === serial;
    // Uma chamada só: descrição + (se mexeu) as quatro colunas do endereço.
    const enderecoParaGravar = enderecoAlterado
      ? (mudancaEndereco?.valores ?? null)
      : null;
    setSaving(true);
    try {
      const success = await updateConfig(
        {
          ...(enderecoParaGravar ?? {}),
          storeDescription: descricaoDaLojaParaHtml(descricao) || null,
        },
        { isCurrent, silent: true },
      );
      if (!isCurrent()) return;
      if (success) {
        // Re-sincroniza o formulário com o que foi GRAVADO (o baseline vem
        // do config, que o updateConfig atualiza; sem isto, qualquer
        // diferença de normalização deixava o botão habilitado para sempre).
        // O endereço se re-sincroniza sozinho pelo config que chega.
        usuarioEditou.current = false;
        setDescricao(descricao.trim());
        // O Salvar do cabeçalho NÃO grava o contato (ele tem o próprio): o aviso
        // diz só o que foi salvo, e o contato pendente segue avisado no topo.
        toast.success("Endereço e descrição salvos");
      } else {
        // silent:true suprime TODOS os toasts de dentro do updateConfig —
        // inclusive o de falha. A falha tem de ser avisada AQUI, com o
        // rascunho preservado (o lojista não perde o texto nem acha que
        // salvou).
        toast.error(
          "Não foi possível confirmar que as alterações foram salvas. O texto foi preservado — tente novamente.",
        );
      }
    } catch (e) {
      if (isCurrent())
        toast.error(
          `${mensagemDeErroDoPainel(e, "salvar")} O texto foi preservado.`,
        );
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }

  // Títulos dos blocos que o "Falta preencher" e a `secaoInicial` alcançam.
  const titulos = useRef(new Map<BlocoDeMinhaLoja, HTMLElement>());
  const guardarTitulo =
    (bloco: BlocoDeMinhaLoja) => (titulo: HTMLHeadingElement | null) => {
      if (titulo) titulos.current.set(bloco, titulo);
      else titulos.current.delete(bloco);
    };
  function irAoBloco(bloco: BlocoDeMinhaLoja) {
    const titulo = titulos.current.get(bloco);
    if (!titulo) return;
    titulo.scrollIntoView?.({ block: "start" });
    // O foco leva o leitor de tela junto; a rolagem já foi feita acima.
    titulo.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (secaoInicial === "contato" && active) irAoBloco("contato");
  }, [secaoInicial, active]);

  // "Falta preencher": os passos da loja pronta que moram NESTA tela (marca,
  // endereço, WhatsApp) e ainda estão pendentes. Mesma função dos seis passos
  // do Início — o que não é desta tela (recebe, entrega, produto) fica de fora,
  // por isso os fatos do resto entram neutros.
  const passosAqui = seisPassosDaLojaPronta(
    entradaDosSeisPassos(config, {
      pixOk: false,
      formasNaEntrega: [],
      produtos: [],
      configCarregando: !isLoaded,
      produtosCarregando: false,
      entrega: "pendente",
    }),
  ).filter(
    (passo) =>
      passo.destino === "admin-about-store" && passo.estado === "pendente",
  );

  return (
    <div className="pb-admin relative min-h-screen bg-[#09090b] font-sans text-zinc-400 lg:pb-12">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader
            titulo={NOMES_DO_PAINEL["admin-about-store"]}
            acoes={
              <button
                onClick={() => void handleSubmit()}
                disabled={
                  !isLoaded ||
                  isOffline ||
                  !formDirty ||
                  saving ||
                  enderecoPrecisaCompletar
                }
                title="Salva o endereço e a descrição desta tela (o contato tem o próprio Salvar)"
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-admin-gold px-4 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-950 shadow-[0_6px_20px_rgba(212,175,55,0.22)] transition-all hover:bg-admin-gold/90 hover:shadow-[0_8px_26px_rgba(212,175,55,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:gap-2.5 sm:px-5"
              >
                {saving ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <Save className="size-4" />
                    <span>
                      Salvar
                      <span className="hidden sm:inline"> Alterações</span>
                    </span>
                  </>
                )}
              </button>
            }
          />
        </div>
        {contatoPendente && (
          <p
            role="status"
            data-contato-pendente
            className="mx-auto mt-2 flex w-full max-w-4xl items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-bold text-amber-300"
          >
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />O
            contato ainda não foi salvo — use Salvar contato.
          </p>
        )}
      </div>

      <div className="mx-auto max-w-4xl space-y-4 px-4 pt-4">
        {isOffline && (
          <div className="flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="size-5 shrink-0 animate-pulse text-red-500" />
            <span>
              Você está offline. O salvamento das configurações está
              desabilitado até restabelecer a rede.
            </span>
          </div>
        )}

        {passosAqui.length > 0 && (
          <div
            data-falta-preencher
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-admin-gold/20 bg-admin-gold/5 p-3"
          >
            <span className="text-sm font-bold text-white">
              Falta preencher:
            </span>{" "}
            {passosAqui.map((passo) => (
              <button
                key={passo.chave}
                type="button"
                onClick={() => {
                  const bloco = BLOCO_DO_PASSO.get(passo.chave);
                  if (bloco) irAoBloco(bloco);
                }}
                className="flex min-h-11 items-center rounded-xl border border-admin-gold/30 bg-admin-bg px-4 text-sm font-bold text-admin-gold transition-colors hover:border-admin-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60"
              >
                {passo.rotulo}
              </button>
            ))}
          </div>
        )}

        <BlocoNumerado
          numero="1"
          titulo="Marca da loja"
          descricao="Nome, logo e cores que aparecem no app inteiro — inclusive na página Sobre a Loja."
          refDoTitulo={guardarTitulo("marca")}
        >
          <Suspense
            fallback={
              <p className="text-sm text-zinc-400">Carregando identidade…</p>
            }
          >
            <IdentitySettingsSection
              active={active}
              onDirtyChange={setIdentidadePendente}
            />
          </Suspense>
        </BlocoNumerado>

        <BlocoNumerado
          numero="2"
          titulo="Endereço da loja"
          descricao="Digite o CEP e complete o número: a rua, o bairro e a cidade vêm sozinhos. É o endereço do mapa da página Sobre a Loja e de onde saem as entregas."
          refDoTitulo={guardarTitulo("endereco")}
        >
          <EnderecoDaLoja
            originCep={config.originCep}
            storeAddress={config.storeAddress}
            storeCity={config.storeCity}
            storeState={config.storeState}
            disabled={saving || !active}
            onMudou={setMudancaEndereco}
          />
          {queryPrevia && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
              <div className="relative h-40 w-full">
                {/* credentialless: mantido mesmo sem o COEP do app (removido do
                    vercel.json em 26/09/2026 — decisão do dono, travava o Card
                    Payment Brick). Sem o COEP do app o frame do Google não
                    corre mais risco de ser barrado por causa dele; o atributo
                    fica porque é inofensivo aqui — o mapa não usa cookie
                    nosso — e continua carregando num contexto efêmero. */}
                <iframe
                  title="Prévia do mapa da página Sobre a Loja"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(queryPrevia)}&z=15&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  credentialless=""
                  className="pointer-events-none absolute left-0 top-[-56px] block h-[calc(100%+56px)] w-full border-0"
                />
                <p className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm">
                  Prévia do que o cliente vê
                </p>
              </div>
            </div>
          )}
        </BlocoNumerado>

        <BlocoNumerado
          numero="3"
          titulo="Horário de atendimento"
          descricao="Aparece na página Sobre a Loja e no rodapé da página inicial. Em branco, não aparece."
        >
          <BusinessHoursSection
            active={active}
            onDirtyChange={setHorarioPendente}
          />
        </BlocoNumerado>

        <BlocoNumerado
          numero="4"
          titulo="Descrição da loja"
          descricao="A história da marca, abaixo do mapa na página Sobre a Loja. Deixe uma linha em branco entre os parágrafos."
        >
          <label htmlFor="store-description" className="text-sm text-zinc-300">
            Sobre a loja
          </label>
          <textarea
            id="store-description"
            value={descricao}
            disabled={saving || !active}
            onChange={(event) => {
              usuarioEditou.current = true;
              setDescricao(event.target.value);
            }}
            rows={5}
            maxLength={4000}
            placeholder="Conte a história da loja, o que vende e o que a diferencia…"
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 py-3 text-sm leading-relaxed text-white"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Texto simples, sem negrito nem imagens.
          </p>
        </BlocoNumerado>

        <BlocoNumerado
          numero="5"
          titulo="Contato"
          descricao="O WhatsApp da loja — o MESMO número do botão da página Sobre a Loja, da finalização da compra, dos pedidos e do perfil — e a mensagem que vai junto quando alguém compartilha um produto."
          refDoTitulo={guardarTitulo("contato")}
        >
          <ContatoDaLoja
            onDirtyChange={setContatoPendente}
            onSetBackOverride={onSetBackOverride}
          />
        </BlocoNumerado>

        <p className="px-2 pb-2 text-[11px] leading-relaxed text-zinc-500">
          Quer ver o resultado? Abra o Perfil do app e toque em "Sobre a Loja" —
          a página mostra exatamente o que está salvo aqui.
        </p>
      </div>
    </div>
  );
});
