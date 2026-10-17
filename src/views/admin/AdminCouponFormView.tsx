import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { QuemPodeUsarOCupom } from "@/components/admin/coupons/QuemPodeUsarOCupom";
import {
  CAMPO,
  FOCO,
  INTERRUPTOR,
  PRIMARIO,
  SECUNDARIO,
  Selo,
} from "@/components/admin/coupons/apresentacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useCoupons } from "@/hooks/useCoupons";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { codigoDoCupomParaSalvar } from "@/lib/codigo-do-cupom";
import {
  AVISO_CUPOM_PODE_COBRIR_A_COMPRA,
  AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP,
  cupomPodeCobrirACompraInteira,
} from "@/lib/cupom-que-cobre-a-compra";
import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
import { cn, formatCurrency } from "@/lib/utils";
import type { ClienteDoCupom, Coupon, View } from "@/types";
import { haptic } from "@/utils/haptic";
import {
  dataEscolhidaParaValidade,
  validadeParaDataDoInput,
} from "@/utils/validade-do-cupom";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  Percent,
  Save,
  Shuffle,
  Ticket,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminCouponFormViewProps {
  couponId?: string;
  onNavigate: (view: View, id?: string) => void;
  onSetDirty?: (dirty: boolean) => void;
}

/** O banco recusou por falta de permissão (42501): administradora rebaixada. */
function semPermissaoDeAdmin(erro: unknown): boolean {
  return (erro as { code?: string } | null)?.code === "42501";
}

export const AdminCouponFormView = memo(function AdminCouponFormView({
  couponId,
  onNavigate,
  onSetDirty,
}: AdminCouponFormViewProps) {
  const {
    coupons,
    loading,
    addCoupon,
    updateCoupon,
    alcanceSuportado,
    alcanceSondado,
    listarClientesDoCupom,
    definirClientesDoCupom,
    buscarClientesParaCupom,
  } = useCoupons(true, true);
  const isOffline = useOnlineStatus();
  const { config } = useStore();
  // Nenhuma forma "na retirada/entrega" ligada: a loja só recebe pelo app, e
  // um cupom que zera a compra deixa a cliente sem caminho para fechar.
  const lojaSoRecebePeloApp =
    formasPagamentoNaEntregaValidas(config.formasPagamentoEntrega).length === 0;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previaAberta, setPreviaAberta] = useState(false);
  const previaBotaoRef = useRef<HTMLButtonElement>(null);

  const [formData, setFormData] = useState<Partial<Coupon>>({
    code: "",
    type: "percentage",
    value: 0,
    active: true,
    usageLimit: 0,
    minPurchase: 0,
    alcance: "codigo",
  });

  const [initialData, setInitialData] = useState<Partial<Coupon>>({
    code: "",
    type: "percentage",
    value: 0,
    active: true,
    usageLimit: 0,
    minPurchase: 0,
    alcance: "codigo",
  });

  // Laudo 0109 (A4): a decisão editar×criar MORAVA na lista carregada
  // (`coupons.find`) — o fetch falhou, o salvamento virava INSERT, a
  // constraint de código único recusava, e trocando o código para
  // "destravar" nascia um SEGUNDO cupom com o antigo vivo. O couponId
  // existe na rota e é ELE quem decide.
  const isEditing = Boolean(couponId);

  // Frente B (28/09/2026): as contas de um cupom exclusivo. Carregadas do
  // servidor ao editar; gravadas DEPOIS do cupom (falha fechada: exclusivo
  // sem lista vale para ninguém).
  const [clientes, setClientes] = useState<ClienteDoCupom[]>([]);
  const [clientesIniciais, setClientesIniciais] = useState<string[]>([]);
  // Estado EXPLÍCITO da lista gravada (revisão, B2): enquanto ela não
  // carregou, `[]` NÃO é "ninguém" — editar e salvar ficam travados, senão o
  // salvar trocaria a lista real por uma vazia/parcial sem aviso.
  const [listaDoExclusivo, setListaDoExclusivo] = useState<
    "nao_se_aplica" | "carregando" | "ok" | "falhou"
  >("nao_se_aplica");
  const [tentativaDaLista, setTentativaDaLista] = useState(0);
  const editingCoupon = couponId
    ? coupons.find((c) => c.id === couponId)
    : null;

  // Laudo 0109 (A5): o efeito antigo dependia de `[couponId, coupons]` e
  // fazia `setFormData(data)` sem guarda — abrir o form, digitar rápido e a
  // resposta do fetch chegar (nova array em `coupons`) apagava o que o
  // lojista tinha digitado, em rede de celular. Duas travas: (1) inicializa
  // UMA vez por cupom (ref abaixo); (2) o que o lojista JÁ digitou —
  // diferente do estado vazio de partida — vence, e o resto vem do banco.
  const cupomInicializadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!couponId || coupons.length === 0) return;
    if (cupomInicializadoRef.current === couponId) return;
    const editing = coupons.find((c) => c.id === couponId);
    if (!editing) return;
    const carregado = {
      code: editing.code,
      type: editing.type,
      value: editing.value,
      minPurchase: editing.minPurchase || 0,
      usageLimit: editing.usageLimit || 0,
      validUntil: editing.validUntil,
      active: editing.active,
      alcance: editing.alcance ?? "codigo",
    };
    const mesclado = {
      code: formData.code !== "" ? formData.code : carregado.code,
      type: formData.type !== "percentage" ? formData.type : carregado.type,
      value: Number(formData.value) !== 0 ? formData.value : carregado.value,
      minPurchase:
        Number(formData.minPurchase) !== 0
          ? formData.minPurchase
          : carregado.minPurchase,
      usageLimit:
        Number(formData.usageLimit) !== 0
          ? formData.usageLimit
          : carregado.usageLimit,
      validUntil:
        formData.validUntil !== undefined
          ? formData.validUntil
          : carregado.validUntil,
      active: formData.active !== true ? formData.active : carregado.active,
      alcance:
        formData.alcance !== "codigo" ? formData.alcance : carregado.alcance,
    };
    setFormData(mesclado);
    // `initialData` recebe o MESCLADO: "sujo" tem que significar mudança do
    // lojista DEPOIS da carga, nunca a mesclagem em si.
    setInitialData(mesclado);
    cupomInicializadoRef.current = couponId;
    // `formData` entra de propósito: a mesclagem precisa do que o lojista
    // já digitou nesta tela antes da carga chegar.
  }, [couponId, coupons, formData]);

  // Lista do exclusivo: depende só de VALORES (id e alcance gravado) — um
  // array novo de `coupons` (o fetch do hook chegando) não cancela a carga.
  const alcanceGravado = editingCoupon?.alcance;
  useEffect(() => {
    if (!couponId || !alcanceSuportado || alcanceGravado !== "exclusivo") {
      // O alcance deixou de ser exclusivo (inclusive o otimista revertido de
      // um salvar que falhou) ou o banco desta loja nem tem o "quem pode
      // usar": a lista não se aplica e nada fica travado (revisão, 2ª
      // rodada, R2-b).
      setListaDoExclusivo("nao_se_aplica");
      return;
    }
    let vivo = true;
    setListaDoExclusivo("carregando");
    listarClientesDoCupom(couponId)
      .then((lista) => {
        if (!vivo) return;
        setClientes(lista);
        setClientesIniciais(lista.map((c) => c.id).sort());
        setListaDoExclusivo("ok");
      })
      .catch((erro) => {
        if (!vivo) return;
        setListaDoExclusivo("falhou");
        // Administradora rebaixada: o banco recusa a lista (42501). Dizer o
        // motivo real — "tente de novo" não resolveria.
        toast.error(
          semPermissaoDeAdmin(erro)
            ? "Sua conta não tem mais permissão de administrador para ver os clientes deste cupom."
            : "Não foi possível carregar os clientes deste cupom.",
        );
      });
    return () => {
      vivo = false;
    };
  }, [
    couponId,
    alcanceGravado,
    alcanceSuportado,
    listarClientesDoCupom,
    tentativaDaLista,
  ]);
  const listaTravada =
    listaDoExclusivo === "carregando" || listaDoExclusivo === "falhou";

  const idsDosClientes = clientes.map((c) => c.id).sort();
  const clientesMudaram =
    idsDosClientes.join(",") !== clientesIniciais.join(",");

  // Código difícil de adivinhar para cupom exclusivo/secreto (sem 0/O/1/I).
  function gerarCodigo(): void {
    const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(8);
    crypto.getRandomValues(bytes);
    const codigo = Array.from(bytes, (b) => letras[b % letras.length]).join("");
    setFormData((prev) => ({ ...prev, code: codigo }));
  }

  // Track form dirty state to prevent accidental discards
  useEffect(() => {
    if (!onSetDirty) return;
    const isDirty =
      (formData.code || "") !== (initialData.code || "") ||
      formData.type !== initialData.type ||
      Number(formData.value) !== Number(initialData.value) ||
      formData.active !== initialData.active ||
      Number(formData.usageLimit) !== Number(initialData.usageLimit) ||
      Number(formData.minPurchase) !== Number(initialData.minPurchase) ||
      formData.validUntil !== initialData.validUntil ||
      formData.alcance !== initialData.alcance ||
      clientesMudaram;

    onSetDirty(isDirty);
  }, [formData, initialData, onSetDirty, clientesMudaram]);

  const handleSubmit = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar ou alterar cupons.",
      });
      return;
    }

    const cleanCode = codigoDoCupomParaSalvar(formData.code, initialData.code);
    if (!cleanCode) {
      toast.error("O código do cupom é obrigatório.");
      return;
    }

    const value = formData.value ?? 0;
    const minPurchase = formData.minPurchase ?? 0;
    const usageLimit = formData.usageLimit ?? 0;

    if (value <= 0) {
      toast.error("O valor do desconto deve ser maior que zero.");
      return;
    }

    if (formData.type === "percentage" && value > 100) {
      toast.error(
        "O valor do desconto em porcentagem não pode ser maior que 100%.",
      );
      return;
    }

    if (minPurchase < 0) {
      toast.error("O valor mínimo de compra não pode ser negativo.");
      return;
    }

    if (usageLimit < 0) {
      toast.error("O limite de uso não pode ser negativo.");
      return;
    }

    const alcance = formData.alcance ?? "codigo";
    if (listaTravada) {
      toast.error(
        listaDoExclusivo === "carregando"
          ? "Aguarde: a lista de clientes deste cupom ainda está carregando."
          : "A lista de clientes deste cupom não carregou. Tente carregar de novo antes de salvar.",
      );
      return;
    }
    if (alcanceSuportado && alcance === "exclusivo" && clientes.length === 0) {
      toast.error("Escolha pelo menos um cliente para o cupom exclusivo.");
      return;
    }

    const { alcance: _alcance, ...semAlcance } = formData;
    // O alcance só vai quando MUDOU (ou é cupom novo que não é secreto) —
    // salvar continua funcionando com o banco de antes da migration
    // 20261208000000 para quem não mexe nele. Banco sem a coluna: o bloco
    // nem aparece, nada de alcance e nada de lista.
    const alcanceMudou =
      alcanceSuportado && alcance !== (initialData.alcance ?? "codigo");
    const dataToSubmit: Partial<Coupon> = {
      ...semAlcance,
      code: cleanCode,
      ...(alcanceMudou ? { alcance } : {}),
    };

    setIsSubmitting(true);
    let idSalvo: string | null = null;
    try {
      if (couponId) {
        // Laudo 0109 (A4): cupom da rota que o fetch não trouxe (falha de
        // rede ou id inexistente) NÃO salva — nem como INSERT (o defeito
        // antigo), nem como UPDATE cego com os zeros de partida por cima
        // das regras reais do cupom. A tela conta o que acontece.
        if (!editingCoupon) {
          toast.error(
            loading
              ? "Aguarde: os dados do cupom ainda estão carregando."
              : "Não foi possível carregar os dados deste cupom. Recarregue a página antes de salvar.",
          );
          return;
        }
        // O hook só confirma o salvamento depois das regras E da lista.
        // Em falha parcial, os campos e o estado sujo ficam para nova tentativa.
        const clientesParaSalvar =
          alcanceSuportado &&
          alcance === "exclusivo" &&
          (clientesMudaram || alcanceMudou)
            ? idsDosClientes
            : alcanceMudou &&
                initialData.alcance === "exclusivo" &&
                clientesIniciais.length > 0
              ? []
              : undefined;
        if (clientesParaSalvar !== undefined) {
          await updateCoupon(
            editingCoupon.id,
            dataToSubmit,
            clientesParaSalvar,
          );
        } else {
          await updateCoupon(editingCoupon.id, dataToSubmit);
        }
        idSalvo = editingCoupon.id;
      } else {
        const criado = await addCoupon(
          dataToSubmit as Required<Omit<Coupon, "id" | "usageCount">>,
        );
        idSalvo = criado?.id ?? null;
      }

      // 2º passo (frente B): a lista do exclusivo. Falha aqui NUNCA abre o
      // cupom — exclusivo sem lista vale para ninguém — mas a tela avisa.
      if (idSalvo && !couponId && alcanceSuportado && alcance === "exclusivo") {
        try {
          await definirClientesDoCupom(idSalvo, idsDosClientes);
        } catch (erro) {
          console.error("Erro ao gravar os clientes do cupom:", erro);
          toast.error("O cupom foi salvo, mas a lista de clientes não.", {
            description: semPermissaoDeAdmin(erro)
              ? "Ninguém consegue usar este cupom até a lista ser salva. Sua conta não tem mais permissão de administrador: entre de novo e abra o cupom para salvar a lista."
              : "Ninguém consegue usar este cupom até a lista ser salva. Abra o cupom e salve de novo.",
            duration: 10000,
          });
        }
      }

      if (onSetDirty) onSetDirty(false); // Reset dirty state before navigating
      onNavigate("admin-coupons");
    } catch (error) {
      console.error("Erro ao salvar cupom:", error);
      // Laudo 0109 (A12): o toast ficou no hook (useCoupons avisa com
      // mensagemDeErroDoCupom, que diz o motivo real — "código já existe",
      // por exemplo). O aviso genérico daqui empilhava por cima e escondia
      // o motivo.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    haptic.light();
    onNavigate("admin-coupons");
  };

  return (
    <div className="pb-admin relative min-h-screen bg-[#08080A] font-sans text-zinc-400 lg:pb-12">
      <div className="sticky top-0 z-20 bg-[#08080A]/95 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:normal-case [&_h1]:tracking-tight">
          <AdminPageHeader
            titulo={`${isEditing ? "Editar" : "Novo"} ${NOMES_DO_PAINEL["admin-coupon-form"].toLowerCase()}`}
          />
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className={SECUNDARIO}
          >
            Cancelar
          </button>
        </div>
      </div>
      <div className="mx-auto max-w-xl space-y-7 px-5 py-4">
        {isOffline && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-[20px] border border-orange-300/20 bg-orange-300/5 p-4"
          >
            <AlertTriangle
              aria-hidden="true"
              className="size-5 shrink-0 text-orange-300"
            />
            <div className="text-left">
              <p className="text-sm font-bold text-zinc-50">
                Modo Offline Ativo
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                Criação e edição de cupons estão temporariamente desabilitadas.
              </p>
            </div>
          </div>
        )}

        {isSubmitting && (
          <p
            role="status"
            className="rounded-[20px] border border-sky-300/20 bg-sky-300/5 p-4 text-sm leading-relaxed text-sky-300"
          >
            Salvando alterações... Aguarde a confirmação. Todos os controles e
            Cancelar estão indisponíveis.
          </p>
        )}
        {isEditing && !editingCoupon && (
          <p
            role="status"
            className="rounded-[20px] border border-sky-300/20 bg-sky-300/5 p-4 text-sm leading-relaxed text-zinc-300"
          >
            {loading
              ? "Aguarde: os dados do cupom ainda estão carregando."
              : "Não foi possível carregar os dados deste cupom. Recarregue a página antes de salvar."}
          </p>
        )}
        <div className="space-y-7">
          <div>
            <button
              type="button"
              aria-expanded={previaAberta}
              aria-controls="coupon-preview"
              ref={previaBotaoRef}
              onClick={() => setPreviaAberta(!previaAberta)}
              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-violet-200/15 bg-gradient-to-br from-[#2C2838] to-[#17171C] px-3.5 py-3 text-left text-sm text-zinc-50 ${FOCO}`}
            >
              <span className="min-w-0 break-words">
                {formData.code ? (
                  <>
                    <span className="break-all">{formData.code}</span> ·{" "}
                    {formData.type === "percentage"
                      ? `${formData.value || 0}%`
                      : formatCurrency(Number(formData.value || 0))}{" "}
                    · mín. {formatCurrency(formData.minPurchase || 0)}
                  </>
                ) : (
                  "Prévia · código e desconto a preencher"
                )}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 text-zinc-400",
                  previaAberta && "rotate-180",
                )}
              />
            </button>
            {previaAberta && (
              <div id="coupon-preview" className="mt-3 space-y-3">
                <div className="space-y-4 rounded-[24px] border border-violet-200/20 bg-gradient-to-br from-[#2C2838] to-[#17171C] p-5 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-bold text-zinc-400">
                      <Selo
                        icone={
                          formData.type === "percentage" ? Percent : Wallet
                        }
                        matiz={
                          formData.type === "percentage" ? "#BAA0FF" : "#73BFFF"
                        }
                      />
                      PRÉVIA DO CUPOM
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-bold",
                        formData.active
                          ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-300"
                          : "border-white/15 bg-white/5 text-zinc-400",
                      )}
                    >
                      {formData.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <p className="break-all text-2xl font-bold uppercase text-zinc-50">
                    {formData.code || "CUPOMEXEMPLO"}
                  </p>
                  <div className="flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-3">
                    <div>
                      <p className="text-xs text-zinc-400">Desconto</p>
                      <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-50">
                        {formData.type === "percentage"
                          ? `${formData.value || 0}% OFF`
                          : formatCurrency(Number(formData.value || 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-400">Mínimo Compra</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-zinc-50">
                        {formatCurrency(formData.minPurchase || 0)}
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPreviaAberta(false);
                    previaBotaoRef.current?.focus();
                  }}
                  className={SECUNDARIO}
                >
                  Recolher prévia
                </button>
                <p className="text-xs text-zinc-400">
                  Visualização em tempo real do cupom
                </p>
              </div>
            )}
          </div>

          <div className="space-y-7">
            <section
              aria-labelledby="coupon-identification"
              className="space-y-3"
            >
              <h2
                id="coupon-identification"
                className="flex items-center gap-2.5 text-lg font-bold text-zinc-50"
              >
                <Selo icone={Ticket} matiz="#FF91B9" />
                Identificação
              </h2>
              <Label htmlFor="coupon-code" className="text-sm text-zinc-400">
                Código do Cupom
              </Label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <LocalBufferedInput
                    id="coupon-code"
                    name="code"
                    autoComplete="off"
                    value={formData.code || ""}
                    onFlush={(val) =>
                      setFormData((prev) => ({
                        ...prev,
                        code: codigoDoCupomParaSalvar(val, initialData.code),
                      }))
                    }
                    placeholder="EX: VERAO10"
                    useShadcn={true}
                    disabled={isOffline || isSubmitting}
                    className={CAMPO}
                  />
                </div>
                <button
                  type="button"
                  onClick={gerarCodigo}
                  disabled={isOffline || isSubmitting}
                  className={`${SECUNDARIO} min-h-12`}
                >
                  <Shuffle
                    aria-hidden="true"
                    className="size-5 text-violet-300"
                  />
                  Gerar
                </button>
              </div>
              {!formData.code && (
                <p className="text-xs text-zinc-400">
                  Código vazio · digite ou gere um código.
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="coupon-active"
                  className="text-sm font-semibold text-zinc-50"
                >
                  Ativar?
                </Label>
                <span className="ml-auto text-xs text-zinc-400">
                  Ativação manual
                </span>
                <Switch
                  id="coupon-active"
                  checked={formData.active}
                  disabled={isOffline || isSubmitting}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, active: checked })
                  }
                  className={INTERRUPTOR}
                />
              </div>
            </section>

            <section aria-labelledby="coupon-discount" className="space-y-3">
              <h2
                id="coupon-discount"
                className="flex items-center gap-2.5 text-lg font-bold text-zinc-50"
              >
                <Selo icone={Percent} matiz="#BAA0FF" />
                Tipo de Desconto
              </h2>
              <div
                className="grid grid-cols-2 gap-3"
                role="group"
                aria-label="Tipo de Desconto"
              >
                <button
                  type="button"
                  aria-pressed={formData.type === "percentage"}
                  onClick={() =>
                    !isOffline &&
                    !isSubmitting &&
                    setFormData({ ...formData, type: "percentage" })
                  }
                  disabled={isOffline || isSubmitting}
                  className={cn(
                    `${SECUNDARIO} min-h-12`,
                    formData.type === "percentage" &&
                      !isOffline &&
                      !isSubmitting &&
                      "border-[#F5C542] bg-[#F5C542]/10",
                  )}
                >
                  <Percent
                    aria-hidden="true"
                    className="size-5 shrink-0 text-violet-300"
                  />
                  % Percentual
                </button>
                <button
                  type="button"
                  aria-pressed={formData.type === "fixed"}
                  onClick={() =>
                    !isOffline &&
                    !isSubmitting &&
                    setFormData({ ...formData, type: "fixed" })
                  }
                  disabled={isOffline || isSubmitting}
                  className={cn(
                    `${SECUNDARIO} min-h-12`,
                    formData.type === "fixed" &&
                      !isOffline &&
                      !isSubmitting &&
                      "border-[#F5C542] bg-[#F5C542]/10",
                  )}
                >
                  <Wallet
                    aria-hidden="true"
                    className="size-5 shrink-0 text-sky-300"
                  />
                  R$ Fixo
                </button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-value" className="text-sm text-zinc-400">
                  {formData.type === "percentage" ? "Valor (%)" : "Valor (R$)"}
                </Label>
                <LocalBufferedInput
                  id="coupon-value"
                  name="value"
                  type="number"
                  autoComplete="off"
                  min={0}
                  max={formData.type === "percentage" ? 100 : undefined}
                  value={formData.value || ""}
                  onFlush={(val) =>
                    setFormData((prev) => ({ ...prev, value: Number(val) }))
                  }
                  useShadcn={true}
                  disabled={isOffline || isSubmitting}
                  className={CAMPO}
                  placeholder="EX: 15"
                />
              </div>
            </section>

            <section aria-labelledby="coupon-limits" className="space-y-3">
              <h2
                id="coupon-limits"
                className="flex items-center gap-2.5 text-lg font-bold text-zinc-50"
              >
                <Selo icone={Users} matiz="#73BFFF" />
                Limites
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="coupon-min-purchase"
                    className="text-sm text-zinc-400"
                  >
                    Mínimo de Compra
                  </Label>
                  <LocalBufferedInput
                    id="coupon-min-purchase"
                    name="minPurchase"
                    type="number"
                    autoComplete="off"
                    min={0}
                    value={formData.minPurchase || ""}
                    onFlush={(val) =>
                      setFormData((prev) => ({
                        ...prev,
                        minPurchase: Number(val),
                      }))
                    }
                    useShadcn={true}
                    disabled={isOffline || isSubmitting}
                    className={CAMPO}
                    placeholder="EX: 50"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="coupon-usage-limit"
                    className="text-sm text-zinc-400"
                  >
                    Limite de Uso
                  </Label>
                  <LocalBufferedInput
                    id="coupon-usage-limit"
                    name="usageLimit"
                    type="number"
                    autoComplete="off"
                    min={0}
                    value={formData.usageLimit || ""}
                    onFlush={(val) =>
                      setFormData((prev) => ({
                        ...prev,
                        usageLimit: Number(val),
                      }))
                    }
                    useShadcn={true}
                    disabled={isOffline || isSubmitting}
                    placeholder="0 = Ilimitado"
                    className={CAMPO}
                  />
                </div>
              </div>

              <p className="text-xs text-zinc-400">
                0 = sem mínimo. Limite total do cupom · 0 = Ilimitado.
              </p>
              {isEditing && editingCoupon && (
                <p className="text-xs leading-relaxed text-zinc-400">
                  {editingCoupon.usageCount} utilizações acumuladas. O contador
                  não pode ser editado e permanece ao alterar o limite.
                </p>
              )}
            </section>

            {/* CUPOM QUE COBRE A COMPRA INTEIRA (dono, 14/10/2026): aviso, nunca
                bloqueio — o cupom salva normalmente. Mais forte quando a loja
                só recebe pelo app: aí a cliente NÃO consegue fechar. */}
            {cupomPodeCobrirACompraInteira(formData) && (
              <div
                role="note"
                data-testid="aviso-cupom-cobre-a-compra"
                className="flex items-start gap-3 rounded-[20px] border border-orange-300/20 bg-orange-300/5 p-4"
              >
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-orange-300"
                />
                <p className="text-sm leading-relaxed text-orange-200">
                  {lojaSoRecebePeloApp
                    ? AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP
                    : AVISO_CUPOM_PODE_COBRIR_A_COMPRA}
                </p>
              </div>
            )}

            {/* Validity date */}
            <section aria-labelledby="coupon-validity" className="space-y-3">
              <h2
                id="coupon-validity"
                className="flex items-center gap-2.5 text-lg font-bold text-zinc-50"
              >
                <Selo icone={Calendar} matiz="#FFA45C" />
                Validade
              </h2>
              <Label
                htmlFor="coupon-valid-until"
                className="text-sm text-zinc-400"
              >
                Validade (Opcional)
              </Label>
              <div className="relative">
                <Calendar
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-sky-300"
                />
                <Input
                  id="coupon-valid-until"
                  name="validUntil"
                  type="date"
                  autoComplete="off"
                  value={validadeParaDataDoInput(formData.validUntil)}
                  disabled={isOffline || isSubmitting}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setFormData({ ...formData, validUntil: undefined });
                      return;
                    }
                    const validade = dataEscolhidaParaValidade(e.target.value);
                    if (validade) {
                      setFormData({
                        ...formData,
                        validUntil: validade,
                      });
                    }
                  }}
                  className={`${CAMPO} pl-10 [color-scheme:dark]`}
                />
              </div>
              <p className="text-xs text-zinc-400">
                Até 23:59 do dia escolhido, no seu fuso.
              </p>
              <button
                type="button"
                disabled={isOffline || isSubmitting || !formData.validUntil}
                onClick={() =>
                  setFormData({ ...formData, validUntil: undefined })
                }
                className={SECUNDARIO}
              >
                <X aria-hidden="true" className="size-4 text-zinc-400" />
                Limpar validade
              </button>
            </section>

            {/* Quem pode usar (frente B). Banco sem a coluna: escondido. */}
            {alcanceSondado && !alcanceSuportado && (
              <p
                role="note"
                className="rounded-[20px] border border-sky-300/20 bg-sky-300/5 p-4 text-sm leading-relaxed text-zinc-300"
              >
                <strong className="block text-zinc-50">
                  Somente os campos básicos
                </strong>
                As opções de público estão indisponíveis. Código, desconto,
                limites e validade continuam disponíveis.
              </p>
            )}
            {alcanceSuportado && (
              <div className="sm:col-span-2">
                <QuemPodeUsarOCupom
                  alcance={formData.alcance ?? "codigo"}
                  onAlcance={(alcance) =>
                    setFormData((prev) => ({ ...prev, alcance }))
                  }
                  clientes={clientes}
                  onClientes={setClientes}
                  carregandoClientes={listaDoExclusivo === "carregando"}
                  falhaAoCarregar={listaDoExclusivo === "falhou"}
                  onCarregarDeNovo={() => setTentativaDaLista((n) => n + 1)}
                  buscarClientes={buscarClientesParaCupom}
                  semLimiteNemValidade={
                    !formData.validUntil && !Number(formData.usageLimit)
                  }
                  desabilitado={isOffline || isSubmitting}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="sticky bottom-[var(--admin-tab-pb,6.25rem)] z-20 border-t border-white/10 bg-[#17171C]/95 px-5 py-4 backdrop-blur-xl lg:bottom-0">
        <div className="mx-auto max-w-xl">
          <Button
            onClick={handleSubmit}
            disabled={isOffline || isSubmitting}
            className={`${PRIMARIO} h-auto w-full`}
          >
            <Save aria-hidden="true" className="size-5" />
            {isSubmitting ? "Salvando..." : "Salvar Cupom"}
          </Button>
        </div>
      </div>
    </div>
  );
});
