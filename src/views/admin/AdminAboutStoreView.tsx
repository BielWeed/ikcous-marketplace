import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ContatoDaLoja } from "@/components/admin/minha-loja/ContatoDaLoja";
import { DadosDaEmpresa } from "@/components/admin/minha-loja/DadosDaEmpresa";
import {
  EnderecoDaLoja,
  type MudancaDoEndereco,
} from "@/components/admin/minha-loja/EnderecoDaLoja";
import { BusinessHoursSection } from "@/components/admin/settings/BusinessHoursSection";
import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemDeErroDoPainel } from "@/lib/erro-do-painel";
import {
  type ChaveDosSeisPassos,
  alcanceAoMudarOCepDaLoja,
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
// Um botão coordena os cinco pontos de gravação, sem juntar seus pacotes:
// cada editor valida e grava SÓ seus campos. A marca vem antes do endereço;
// ambos passam pela mesma linha/RPC e nunca podem salvar em paralelo.
// Endereço e descrição continuam juntos, como antes. O endereço só entra no
// pacote quando alterado. Falhas não limpam rascunhos nem anunciam Tudo salvo.
export interface EditorDeMinhaLoja {
  readonly alterado: boolean;
  readonly salvar: () => Promise<boolean>;
}
type ChaveDeSalvamento =
  | "marca"
  | "endereco"
  | "contato"
  | "empresa"
  | "horario";
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
  alterado = false,
  erro,
  children,
}: {
  readonly numero: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly alterado?: boolean;
  readonly erro?: string;
  /** Para levar o foco ao título (secaoInicial, "Falta preencher"). */
  readonly refDoTitulo?: (titulo: HTMLHeadingElement | null) => void;
  readonly children: React.ReactNode;
}) {
  const idDoTitulo = `bloco-sobre-a-loja-${numero}`;

  return (
    <section
      aria-labelledby={idDoTitulo}
      className="admin-glass rounded-2xl border border-admin-border p-4 shadow-2xl sm:p-6"
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
        {alterado && (
          <span className="ml-auto shrink-0 rounded-full bg-white/5 px-2 py-1 text-[11px] font-bold text-zinc-300">
            <span aria-hidden="true">● </span>Alterado
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-zinc-400">
        {descricao}
      </p>
      <div className="mt-5">{children}</div>
      {alterado && erro && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-400">
          {erro}
        </p>
      )}
    </section>
  );
}

export const AdminAboutStoreView = memo(function AdminAboutStoreView({
  onNavigate,
  active = true,
  onSetDirty,
  secaoInicial,
  onSetBackOverride,
}: AdminAboutStoreViewProps) {
  const { config, updateConfig, isLoaded } = useStore();
  const isOffline = useOnlineStatus();
  const usuario = useAuth().user?.id ?? "";

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
  const [salvandoTudo, setSalvandoTudo] = useState(false);
  const editores = useRef(new Map<ChaveDeSalvamento, EditorDeMinhaLoja>());
  const operacao = useRef<object | null>(null);
  const [errosDeSalvar, setErrosDeSalvar] = useState<
    Partial<Record<ChaveDeSalvamento, string>>
  >({});
  const [identidadePendente, setIdentidadePendente] = useState(false);
  const [horarioPendente, setHorarioPendente] = useState(false);
  const [contatoPendente, setContatoPendente] = useState(false);
  const [empresaPendente, setEmpresaPendente] = useState(false);
  const lifecycle = useRef({ mounted: true, active, usuario, serial: 0 });
  if (
    (lifecycle.current.active && !active) ||
    lifecycle.current.usuario !== usuario
  )
    lifecycle.current.serial++;
  lifecycle.current.active = active;
  lifecycle.current.usuario = usuario;
  useEffect(() => {
    // A fila pertence à tela ativa e ao administrador que a iniciou.
    setSaving(false);
    setSalvandoTudo(false);
    operacao.current = null;
  }, [active, usuario]);
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
        salvandoTudo ||
        identidadePendente ||
        horarioPendente ||
        contatoPendente ||
        empresaPendente,
    );
  }, [
    formDirty,
    saving,
    salvandoTudo,
    identidadePendente,
    horarioPendente,
    contatoPendente,
    empresaPendente,
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

  const blocos = [
    { chave: "marca", rotulo: "Marca", alterado: identidadePendente },
    { chave: "endereco", rotulo: "Endereço e descrição", alterado: formDirty },
    { chave: "contato", rotulo: "Contato", alterado: contatoPendente },
    { chave: "empresa", rotulo: "Dados da empresa", alterado: empresaPendente },
    { chave: "horario", rotulo: "Horário", alterado: horarioPendente },
  ] as const;
  const alterados = blocos.filter((bloco) => bloco.alterado);

  async function salvarTudo() {
    if (
      operacao.current ||
      !active ||
      isOffline ||
      !isLoaded ||
      !alterados.length
    )
      return;
    const pedido = {};
    operacao.current = pedido;
    const isCurrent = () =>
      operacao.current === pedido &&
      lifecycle.current.mounted &&
      lifecycle.current.active &&
      lifecycle.current.usuario === usuario;
    setSalvandoTudo(true);
    setErrosDeSalvar({});
    try {
      for (const bloco of alterados) {
        if (!isCurrent()) return;
        let salvou = false;
        try {
          // Consulta o registro atual, não uma função capturada antes do save anterior.
          salvou =
            bloco.chave === "endereco"
              ? await handleSubmit()
              : await (editores.current.get(bloco.chave)?.salvar() ??
                  Promise.resolve(false));
        } catch {
          // Um bloco com falha não impede a tentativa dos outros.
        }
        if (!isCurrent()) return;
        if (!salvou) {
          setErrosDeSalvar((anteriores) => ({
            ...anteriores,
            [bloco.chave]: `Não foi possível salvar ${bloco.rotulo.toLowerCase()}. Confira o bloco e tente novamente.`,
          }));
        }
      }
    } finally {
      if (isCurrent()) {
        operacao.current = null;
        setSalvandoTudo(false);
      }
    }
  }

  async function handleSubmit(): Promise<boolean> {
    if (saving || !active || isOffline || !formDirty) return false;
    if (enderecoPrecisaCompletar) return false;
    const life = lifecycle.current;
    const serial = ++life.serial;
    const isCurrent = () =>
      life.mounted && life.active && life.serial === serial;
    // Uma chamada só: descrição + (se mexeu) as quatro colunas do endereço.
    const enderecoParaGravar = enderecoAlterado
      ? (mudancaEndereco?.valores ?? null)
      : null;
    // O alcance "só perto da loja" é uma CÓPIA dos 5 primeiros números do CEP:
    // se o CEP mudou, ele vai junto, NESTA mesma chamada (nunca antes do
    // Salvar). Alcance vazio, lista ou faixa não são tocados.
    const alcanceNovo = enderecoParaGravar
      ? alcanceAoMudarOCepDaLoja(
          config.originCep,
          enderecoParaGravar.originCep,
          config.localCepRange,
        )
      : null;
    setSaving(true);
    try {
      const success = await updateConfig(
        {
          ...(enderecoParaGravar ?? {}),
          ...(alcanceNovo !== null && { localCepRange: alcanceNovo }),
          storeDescription: descricaoDaLojaParaHtml(descricao) || null,
        },
        { isCurrent, silent: true },
      );
      if (!isCurrent()) return false;
      if (success) {
        // Re-sincroniza o formulário com o que foi GRAVADO (o baseline vem
        // do config, que o updateConfig atualiza; sem isto, qualquer
        // diferença de normalização deixava o botão habilitado para sempre).
        // O endereço se re-sincroniza sozinho pelo config que chega.
        usuarioEditou.current = false;
        setDescricao(descricao.trim());
        // Este resultado confirma só o pacote de endereço e descrição.
        toast.success(
          alcanceNovo === null
            ? "Endereço e descrição salvos"
            : `Endereço e descrição salvos. Sua entrega acompanhou o novo CEP: CEPs que começam com ${alcanceNovo}.`,
        );
        return true;
      }
      // silent:true suprime TODOS os toasts de dentro do updateConfig —
      // inclusive o de falha. A falha tem de ser avisada AQUI, com o
      // rascunho preservado (o lojista não perde o texto nem acha que
      // salvou).
      toast.error(
        "Não foi possível confirmar que as alterações foram salvas. O texto foi preservado — tente novamente.",
      );
      return false;
    } catch (e) {
      if (isCurrent())
        toast.error(
          `${mensagemDeErroDoPainel(e, "salvar")} O texto foi preservado.`,
        );
      return false;
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
    <div className="pb-admin relative min-h-screen bg-admin-bg font-sans text-zinc-400 lg:pb-12">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-admin-border bg-admin-bg/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-about-store"]} />
        </div>
      </div>

      <fieldset
        disabled={salvandoTudo || !active}
        className="mx-auto min-w-0 max-w-4xl space-y-4 px-4 pt-4"
      >
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
          alterado={identidadePendente}
          erro={errosDeSalvar.marca}
          descricao="Nome e logo que aparecem no app inteiro — inclusive na página Sobre a Loja."
          refDoTitulo={guardarTitulo("marca")}
        >
          <Suspense
            fallback={
              <p className="text-sm text-zinc-400">Carregando identidade…</p>
            }
          >
            <IdentitySettingsSection
              active={active}
              onRegistrarSalvamento={(editor) =>
                editores.current.set("marca", editor)
              }
              onDirtyChange={setIdentidadePendente}
              onNavigate={onNavigate}
            />
          </Suspense>
        </BlocoNumerado>

        <BlocoNumerado
          numero="2"
          titulo="Endereço da loja"
          alterado={enderecoAlterado}
          erro={errosDeSalvar.endereco}
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
            <div className="mt-4 overflow-hidden rounded-2xl border border-admin-border">
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
          alterado={horarioPendente}
          erro={errosDeSalvar.horario}
          descricao="Aparece na página Sobre a Loja e no rodapé da página inicial. Em branco, não aparece."
        >
          <BusinessHoursSection
            active={active}
            onRegistrarSalvamento={(editor) =>
              editores.current.set("horario", editor)
            }
            onDirtyChange={setHorarioPendente}
          />
        </BlocoNumerado>

        <BlocoNumerado
          numero="4"
          titulo="Descrição da loja"
          alterado={descricao !== baselineDescricao}
          erro={errosDeSalvar.endereco}
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
            className="mt-2 w-full rounded-xl border border-admin-border bg-black/50 px-3.5 py-3 text-sm leading-relaxed text-white"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Texto simples, sem negrito nem imagens.
          </p>
        </BlocoNumerado>

        <BlocoNumerado
          numero="5"
          titulo="Contato"
          alterado={contatoPendente}
          erro={errosDeSalvar.contato}
          descricao="O WhatsApp da loja — o MESMO número do botão da página Sobre a Loja, da finalização da compra, dos pedidos e do perfil — e a mensagem que vai junto quando alguém compartilha um produto."
          refDoTitulo={guardarTitulo("contato")}
        >
          <ContatoDaLoja
            ativa={active}
            onRegistrarSalvamento={(editor) =>
              editores.current.set("contato", editor)
            }
            onDirtyChange={setContatoPendente}
            onSetBackOverride={onSetBackOverride}
          />
        </BlocoNumerado>

        <BlocoNumerado
          numero="6"
          titulo="Dados da empresa (opcional)"
          alterado={empresaPendente}
          erro={errosDeSalvar.empresa}
          descricao="Razão social, CNPJ ou CPF e e-mail de atendimento. Quem compra lê nos Termos, na Política de Privacidade e no rodapé do app. Em branco, nada aparece."
        >
          <DadosDaEmpresa
            onRegistrarSalvamento={(editor) =>
              editores.current.set("empresa", editor)
            }
            onDirtyChange={setEmpresaPendente}
          />
        </BlocoNumerado>

        <p className="px-2 pb-2 text-[11px] leading-relaxed text-zinc-500">
          Quer ver o resultado? Abra o Perfil do app e toque em "Sobre a Loja" —
          a página mostra exatamente o que está salvo aqui.
        </p>
      </fieldset>
      <AcaoDaBarra ativa={active} aria-label="Ações de Minha loja">
        <div className="w-full min-w-0">
          <div
            role="status"
            aria-live="polite"
            className="mb-2 flex flex-wrap items-center justify-between gap-1 text-xs"
          >
            <span
              className={
                alterados.length
                  ? "font-bold text-zinc-200"
                  : "font-bold text-emerald-500"
              }
            >
              {salvandoTudo
                ? "Salvando…"
                : alterados.length
                  ? `${alterados.length} ${alterados.length === 1 ? "alteração" : "alterações"} para salvar`
                  : "Tudo salvo"}
            </span>
            {alterados.length > 0 && (
              <span className="text-zinc-400">
                {alterados.map((bloco) => bloco.rotulo).join(" · ")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void salvarTudo()}
            disabled={
              !isLoaded || isOffline || salvandoTudo || !alterados.length
            }
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 text-sm font-bold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60 disabled:pointer-events-none disabled:bg-zinc-200 disabled:text-zinc-400"
          >
            {salvandoTudo ? (
              <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
            ) : alterados.length > 0 ? (
              <Save aria-hidden="true" className="size-4" />
            ) : null}
            {salvandoTudo
              ? "Salvando…"
              : alterados.length
                ? "Salvar alterações"
                : "Nada para salvar"}
          </button>
        </div>
      </AcaoDaBarra>
    </div>
  );
});
