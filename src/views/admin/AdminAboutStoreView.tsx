import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BusinessHoursSection } from "@/components/admin/settings/BusinessHoursSection";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { descricaoDaLojaParaHtml, textoDaLoja } from "@/lib/texto-da-loja";
import { AlertTriangle, ExternalLink, RefreshCw, Save } from "lucide-react";
import { Suspense, lazy, memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { View } from "@/types";

// Tela "Sobre a Loja" do painel (pedido do dono, 20/09/2026): concentra O QUE
// a página pública "Sobre a Loja" (AboutStoreView) exibe — marca (nome/logo),
// endereço que alimenta o mapa, horário e descrição. WhatsApp é LEITURA com
// atalho: o número é configuração da tela Atendimento e alimenta o app todo
// (checkout, pedido, perfil), não é desta página. Molde da
// AdminWhatsAppConfigView (direção B, lote-b 12/09): blocos numerados todos
// abertos, nada desmonta ao digitar.
//
// DOIS CONTRATOS DE SALVAMENTO, por desenho: identidade e horário têm
// editores próprios que salvam sozinhos (os MESMOS componentes dos Ajustes —
// campo é um só no banco, lógica é uma só); endereço e descrição são os
// campos novos da 20261167000000, gravados pelo botão "Salvar" desta tela
// num único updateConfig. O dirty da tela é o OU de todos.
interface AdminAboutStoreViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
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
  children,
}: {
  readonly numero: string;
  readonly titulo: string;
  readonly descricao: string;
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
          className="text-[15px] font-black tracking-tight text-white"
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
  onNavigate,
  active = true,
  onSetDirty,
}: AdminAboutStoreViewProps) {
  const { config, updateConfig, isLoaded } = useStore();
  const isOffline = useOnlineStatus();

  // Endereço e descrição: baseline do config, dirty por diff (mesmo molde do
  // editor de horário: dado que chega só atualiza editor puro). A descrição
  // gravada é HTML simples — o editor mostra o texto pelo INVERSO do mesmo
  // módulo que converte no save (ida e volta exata; sem isto, micro-
  // diferenças deixavam o botão Salvar eternamente habilitado).
  const baselineEndereco = config.storeAddress ?? "";
  const baselineDescricao = textoDaLoja(config.storeDescription);
  const [endereco, setEndereco] = useState(baselineEndereco);
  const [descricao, setDescricao] = useState(baselineDescricao);
  const [saving, setSaving] = useState(false);
  const [identidadePendente, setIdentidadePendente] = useState(false);
  const [horarioPendente, setHorarioPendente] = useState(false);
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
  const lastIncoming = useRef(
    `${config.storeAddress ?? ""}\n${config.storeDescription ?? ""}`,
  );
  const formDirty =
    endereco !== baselineEndereco || descricao !== baselineDescricao;
  useEffect(() => {
    // A assinatura é do config BRUTO (snake que o banco entrega via
    // mapConfig) — a MESMA forma do lastIncoming inicial, nunca texto
    // decodificado comparado com bruto.
    const assinatura = `${config.storeAddress ?? ""}\n${config.storeDescription ?? ""}`;
    if (assinatura === lastIncoming.current) return;
    lastIncoming.current = assinatura;
    if (!usuarioEditou.current && !saving) {
      setEndereco(baselineEndereco);
      setDescricao(baselineDescricao);
    }
  }, [
    baselineEndereco,
    baselineDescricao,
    config.storeAddress,
    config.storeDescription,
    saving,
  ]);
  useEffect(() => {
    onSetDirty?.(formDirty || saving || identidadePendente || horarioPendente);
  }, [formDirty, saving, identidadePendente, horarioPendente, onSetDirty]);
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
  const queryPrevia = endereco.trim() || config.originCep?.trim() || local;

  // O guard de navegação cobre o TODO (qualquer seção pendente). Já o botão
  // Salvar é SÓ do formulário (endereço/descrição) — identidade e horário
  // têm saves próprios; habilitar o Salvar com pendência deles era botão
  // mentiroso (achado da 1ª execução real, 20/09/2026).

  async function handleSubmit() {
    if (saving || !active || isOffline || !formDirty) return;
    const life = lifecycle.current;
    const serial = ++life.serial;
    const isCurrent = () =>
      life.mounted && life.active && life.serial === serial;
    const chosenEndereco = endereco.trim();
    setSaving(true);
    try {
      const success = await updateConfig(
        {
          storeAddress: chosenEndereco || null,
          storeDescription: descricaoDaLojaParaHtml(descricao) || null,
        },
        { isCurrent, silent: true },
      );
      if (!isCurrent()) return;
      if (success) {
        // Re-sincroniza o formulário com o que foi GRAVADO (o baseline vem
        // do config, que o updateConfig atualiza; sem isto, qualquer
        // diferença de normalização deixava o botão habilitado para sempre).
        usuarioEditou.current = false;
        setEndereco(chosenEndereco);
        setDescricao(descricao.trim());
        toast.success("Sobre a Loja salvo");
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
          `Falha ao salvar: ${e instanceof Error ? e.message : "erro desconhecido"}. O texto foi preservado.`,
        );
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }

  const whatsOk = lojaTemWhatsapp(config.whatsappNumber);

  return (
    <div className="pb-admin relative min-h-screen bg-[#09090b] font-sans text-zinc-400 lg:pb-12">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <AdminPageHeader
            titulo="Sobre a Loja"
            acoes={
              <button
                onClick={() => void handleSubmit()}
                disabled={!isLoaded || isOffline || !formDirty || saving}
                title="Salva o endereço e a descrição desta tela"
                className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-admin-gold px-4 text-[10.5px] font-black uppercase tracking-[0.12em] text-zinc-950 shadow-[0_6px_20px_rgba(212,175,55,0.22)] transition-all hover:bg-[#e3c25e] hover:shadow-[0_8px_26px_rgba(212,175,55,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:gap-2.5 sm:px-5"
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

        <BlocoNumerado
          numero="1"
          titulo="Marca da loja"
          descricao="Nome, logo e cores que aparecem no app inteiro — inclusive na página Sobre a Loja."
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
          descricao="Alimenta o mapa da página Sobre a Loja. Em branco, o mapa usa o CEP de frete e depois a cidade/UF — como antes deste campo existir."
        >
          <label htmlFor="store-address" className="text-sm text-zinc-300">
            Endereço
          </label>
          <input
            id="store-address"
            value={endereco}
            disabled={saving || !active}
            onChange={(event) => {
              usuarioEditou.current = true;
              setEndereco(event.target.value);
            }}
            placeholder="Ex.: Avenida Paulista, 1578 — Bela Vista"
            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-white"
          />
          {queryPrevia && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
              <div className="relative h-40 w-full">
                <iframe
                  title="Prévia do mapa da página Sobre a Loja"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(queryPrevia)}&z=15&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="pointer-events-none absolute left-0 top-[-56px] block h-[calc(100%+56px)] w-full border-0"
                />
                <p className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm">
                  Prévia do que o cliente vê
                </p>
              </div>
            </div>
          )}
        </BlocoNumerado>

        <BlocoNumerado
          numero="3"
          titulo="Horário de atendimento"
          descricao="Expediente publicado na página Sobre a Loja e no rodapé da home. O MESMO campo dos Ajustes — salvar aqui, atualiza lá."
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
            Texto simples: uma linha em branco vira parágrafo. Formatação rica
            (texto em negrito, imagens) é peça futura.
          </p>
        </BlocoNumerado>

        <BlocoNumerado
          numero="5"
          titulo="WhatsApp da loja"
          descricao="O botão flutuante da página Sobre a Loja usa o número configurado na tela Atendimento — o MESMO número do checkout, dos pedidos e do perfil. Configure em um lugar, funciona em todos."
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-white">
              {whatsOk
                ? (config.whatsappNumber ?? "").replace(/\D/g, "").slice(-11)
                : "Não configurado"}
            </span>
            <button
              type="button"
              onClick={() => onNavigate("admin-whatsapp-config")}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              <ExternalLink className="size-3.5" />
              Editar em Atendimento
            </button>
          </div>
        </BlocoNumerado>

        <p className="px-2 pb-2 text-[11px] leading-relaxed text-zinc-500">
          Quer ver o resultado? Abra o Perfil do app e toque em "Sobre a Loja" —
          a página mostra exatamente o que está salvo aqui.
        </p>
      </div>
    </div>
  );
});
