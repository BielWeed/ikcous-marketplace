import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Label } from "@/components/ui/label";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  Headset,
  Info,
  MessageCircle,
  MoreVertical,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  Video,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { toast } from "sonner";

const PRESETS = [
  {
    name: "Clássico",
    text: "Confira este produto incrível: [nome] por apenas [preco]! Acesse: [link]",
    description: "Ideal para compartilhamento simples e direto.",
  },
  {
    name: "Oferta Quente",
    text: "🔥 Oportunidade Única! Adquira o [nome] por apenas [preco] na nossa loja. Clique no link para comprar agora: [link] 🛍️",
    description: "Excelente para conversão e promoções de escassez.",
  },
  {
    name: "Últimas Unidades",
    text: "⚠️ ATENÇÃO: Últimas unidades de [nome] em estoque por [preco]! Não perca a chance: [link]",
    description: "Cria senso de urgência baseado em escassez de estoque.",
  },
  {
    name: "Desconto Especial",
    text: "🎉 Conseguimos um preço especial para você! [nome] por apenas [preco]. Garanta o seu: [link]",
    description: "Enfoque em preço reduzido e benefício financeiro.",
  },
  {
    name: "Recomendação",
    text: "Olha o que eu acabei de encontrar! [nome] por apenas [preco]. Achei a sua cara: [link]",
    description: "Ideal para compartilhamento entre amigos.",
  },
  {
    name: "Preço Baixou",
    text: "🚨 CORRE! O preço do [nome] baixou para [preco]. Clique no link e aproveite antes que suba de novo: [link]",
    description: "Destaque na queda do preço com tom de pressa.",
  },
  {
    name: "Mais Vendido",
    text: "⭐ O queridinho da loja! Veja por que todos estão amando o [nome] por apenas [preco]: [link]",
    description: "Utiliza prova social para incentivar a compra.",
  },
  {
    name: "Elegante",
    text: "✨ Sofisticação e qualidade: conheça o [nome]. Disponível por [preco]. Visite nosso site: [link]",
    description: "Tom refinado e sofisticado para produtos premium.",
  },
  {
    name: "Novidade",
    text: "🆕 Acabou de chegar! Seja um dos primeiros a garantir o [nome] por [preco]: [link]",
    description: "Desperta curiosidade de novidade e exclusividade.",
  },
  {
    name: "Presente Perfeito",
    text: "🎁 Procurando o presente ideal? Encontrei o [nome] por apenas [preco]! Dá uma olhada: [link]",
    description: "Sugestão focada em datas comemorativas e presentes.",
  },
  {
    name: "Economia Garantida",
    text: "💰 Economize de verdade! [nome] com preço imbatível de [preco] só hoje: [link]",
    description: "Foco claro na economia do comprador.",
  },
  {
    name: "Curto/Direto",
    text: "[nome] por apenas [preco]. Acesse: [link]",
    description: "Cópia ultra-minimalista sem distrações.",
  },
  {
    name: "Status de Luxo",
    text: "👑 Eleve seu estilo com o [nome] por apenas [preco]. Estoque limitado: [link]",
    description: "Posicionamento focado em status e valor de marca.",
  },
  {
    name: "Indicação Amigável",
    text: "Olá! Lembrei de você na hora quando vi o [nome] por [preco]. Olha que legal: [link]",
    description: "Tom altamente pessoal e carinhoso.",
  },
  {
    name: "Segurança total",
    text: "🔒 Compra 100% garantida! Adquira o seu [nome] por apenas [preco]: [link]",
    description: "Ideal para construir confiança no processo de compra.",
  },
  {
    name: "Sensação do momento",
    text: "💥 BOMBOU! O produto [nome] está disponível por apenas [preco]. Clique rápido e garanta o seu: [link]",
    description: "Cópia enérgica e focada em tendências.",
  },
  {
    name: "Edição Limitada",
    text: "💎 Raro e exclusivo: [nome] por [preco]. Pouquíssimas unidades disponíveis: [link]",
    description: "Tom exclusivo e focado em edições de colecionador.",
  },
  {
    name: "Tendência",
    text: "🌟 Tendência do momento! [nome] por apenas [preco] na nossa loja. Veja mais no link: [link]",
    description: "Posicionamento de produto em alta nas redes sociais.",
  },
  {
    name: "Solução Fácil",
    text: "Facilite seu dia a dia com o [nome] por apenas [preco]! Confira os benefícios: [link]",
    description: "Enfoque em utilidade e resolução de problemas.",
  },
  {
    name: "VIP",
    text: "Acesso VIP liberado! Adquira o [nome] por [preco] em primeira mão: [link]",
    description: "Sensação de privilégio para clientes fiéis.",
  },
  {
    name: "Compartilhe",
    text: "Compartilhe com quem você gosta! [nome] está por apenas [preco]: [link]",
    description: "Incentiva o compartilhamento orgânico.",
  },
  {
    name: "Última Chance",
    text: "⏰ Última chance de garantir o [nome] pelo preço promocional de [preco]. Clique agora: [link]",
    description: "Gera urgência extrema pelo fim da promoção.",
  },
  {
    name: "Segredo Revelado",
    text: "🤫 O segredo dos especialistas! Descubra o [nome] por apenas [preco]: [link]",
    description: "Copy intrigante e focada em curiosidade.",
  },
  {
    name: "Foco em Benefício",
    text: "💡 Menos esforço, mais resultados com [nome] por [preco]. Compre já: [link]",
    description: "Venda baseada em valor agregado e usabilidade.",
  },
  {
    name: "Ideal para Você",
    text: "🎯 Encontramos o que você precisava! [nome] por apenas [preco]. Clique aqui: [link]",
    description: "Posicionamento personalizado e direto.",
  },
  {
    name: "Estoque Renovado",
    text: "🔄 ESTOQUE RENOVADO! O queridinho [nome] voltou por apenas [preco]. Garanta o seu antes que esgote: [link]",
    description: "Gera apelo de reposição de produto de alta procura.",
  },
  {
    name: "Sem Enrolação",
    text: "Sem rodeios: [nome] disponível por [preco]. Veja fotos e detalhes: [link]",
    description: "Ideal para compradores pragmáticos.",
  },
  {
    name: "Garantia de Satisfação",
    text: "Satisfação garantida ou seu dinheiro de volta! Peça o [nome] por [preco]: [link]",
    description: "Quebra de objeção clássica de garantia.",
  },
  {
    name: "Clube de Vantagens",
    text: "Entrou em oferta no nosso clube! [nome] por apenas [preco]: [link]",
    description: "Sensação de comunidade de vantagens.",
  },
  {
    name: "Recomendação Premium",
    text: "🏆 Escolha número 1 da categoria! [nome] por [preco]. Veja e comprove: [link]",
    description: "Apelo à liderança de mercado do produto.",
  },
];

const convertPlainTextToHTML = (text: string) => {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  html = html.replace(
    /\[nome\]/g,
    '<span class="inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-md bg-admin-gold/20 text-admin-gold border border-admin-gold/30 text-[10px] font-bold select-none cursor-default" data-tag="nome" contenteditable="false">🏷️ Nome do Produto</span>',
  );
  html = html.replace(
    /\[preco\]/g,
    '<span class="inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold select-none cursor-default" data-tag="preco" contenteditable="false">💰 Preço</span>',
  );
  html = html.replace(
    /\[link\]/g,
    '<span class="inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold select-none cursor-default" data-tag="link" contenteditable="false">🔗 Link</span>',
  );

  return html;
};

const convertHTMLToPlainText = (html: string) => {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const spans = doc.querySelectorAll("span[data-tag]");
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const tag = span.getAttribute("data-tag");
    const textNode = doc.createTextNode(`[${tag}]`);
    span.parentNode?.replaceChild(textNode, span);
  }

  const brs = doc.querySelectorAll("br");
  for (let i = 0; i < brs.length; i++) {
    const br = brs[i];
    const textNode = doc.createTextNode("\n");
    br.parentNode?.replaceChild(textNode, br);
  }

  return doc.body.textContent || doc.body.innerText || "";
};

const getProcessedPreviewText = (
  text: string,
  sample: { name: string; price: number; id?: string },
) => {
  if (!text) return "Confira os produtos!";

  const formattedPrice = sample.price.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const replacements: Record<string, string> = {
    nome: sample.name,
    nome_produto: sample.name,
    preco: formattedPrice,
    preco_produto: formattedPrice,
    link: `ikcous.com/produtos?id=${sample.id || "1"}`,
    link_produto: `ikcous.com/produtos?id=${sample.id || "1"}`,
  };

  let processed = text;
  for (const [key, value] of Object.entries(replacements)) {
    const regexSquare = new RegExp(`\\[${key}\\]`, "gi");
    const regexCurly = new RegExp(`\\{${key}\\}`, "gi");
    processed = processed
      .replace(regexSquare, value)
      .replace(regexCurly, value);
  }
  return processed;
};

interface AdminWhatsAppConfigViewProps {
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

const getCleanPhone = (val: string) => {
  const clean = (val || "").toString().replace(/\D/g, "");
  return clean.startsWith("55") && clean.length > 10 ? clean.slice(2) : clean;
};

export const AdminWhatsAppConfigView = memo(function AdminWhatsAppConfigView({
  active,
  onSetDirty,
}: Readonly<AdminWhatsAppConfigViewProps>) {
  const { config, isLoaded, updateConfig, refresh, products } = useStore();
  const isOffline = useOnlineStatus();
  const [isSaving, setIsSaving] = useState(false);
  const hasInitialSyncRef = useRef(false);
  const editorInitializedRef = useRef(false);

  // Form State
  const [formData, setFormData] = useState({
    whatsappNumber: "",
    businessHours: "",
    shareText: "",
  });

  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");
  const dragControls = useDragControls();

  // Lock scroll when presets bottom sheet is open
  useEffect(() => {
    if (isPresetsOpen) {
      document.body.classList.add("admin-modal-open");
    } else {
      document.body.classList.remove("admin-modal-open");
    }
    return () => {
      document.body.classList.remove("admin-modal-open");
    };
  }, [isPresetsOpen]);

  const onChangeWhatsappNumber = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, whatsappNumber: val }));
  }, []);

  const onChangeBusinessHours = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, businessHours: val }));
  }, []);

  const onChangeShareText = useCallback((val: string) => {
    setFormData((prev) => ({ ...prev, shareText: val }));
  }, []);

  const insertTag = useCallback(
    (tagType: "nome" | "preco" | "link") => {
      const editor = document.getElementById("settings-share-message-editor");
      if (!editor) return;

      editor.focus();

      const span = document.createElement("span");
      span.className =
        "inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-md text-[10px] font-bold select-none cursor-default";
      span.setAttribute("data-tag", tagType);
      span.setAttribute("contenteditable", "false");

      if (tagType === "nome") {
        span.classList.add(
          "bg-admin-gold/20",
          "text-admin-gold",
          "border",
          "border-admin-gold/30",
        );
        span.innerHTML = "🏷️ Nome do Produto";
      } else if (tagType === "preco") {
        span.classList.add(
          "bg-emerald-500/20",
          "text-emerald-400",
          "border",
          "border-emerald-500/30",
        );
        span.innerHTML = "💰 Preço";
      } else if (tagType === "link") {
        span.classList.add(
          "bg-blue-500/20",
          "text-blue-400",
          "border",
          "border-blue-500/30",
        );
        span.innerHTML = "🔗 Link";
      }

      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);

        if (editor.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          range.insertNode(span);

          range.setStartAfter(span);
          range.setEndAfter(span);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          editor.appendChild(span);
        }
      } else {
        editor.appendChild(span);
      }

      const plainText = convertHTMLToPlainText(editor.innerHTML);
      onChangeShareText(plainText);

      if (onSetDirty) {
        onSetDirty(true);
      }
    },
    [onChangeShareText, onSetDirty],
  );

  const applyPreset = useCallback(
    (presetText: string) => {
      const editor = document.getElementById("settings-share-message-editor");
      const html = convertPlainTextToHTML(presetText);

      if (editor) {
        editor.innerHTML = html;
        editor.focus();
      }

      onChangeShareText(presetText);

      if (onSetDirty) {
        onSetDirty(true);
      }
    },
    [onChangeShareText, onSetDirty],
  );

  // Produto de exemplo dinâmico do catálogo ou fallback
  const sampleProduct =
    products && products.length > 0
      ? products[0]
      : {
          name: "Fone de Ouvido Bluetooth",
          price: 189.9,
          description:
            "Excelente qualidade de som estereofônico, cancelamento de ruído ativo e até 24 horas de autonomia.",
          images: [
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=150&h=150&fit=crop&q=80",
          ],
        };

  const renderFormattedText = useCallback(
    (text: string) => {
      const processed = getProcessedPreviewText(text, sampleProduct);
      const parts = processed.split(
        /(ikcous\.com\/[^\s]+|https?:\/\/[^\s]+)/gi,
      );

      return parts.map((part, index) => {
        const isLink = /ikcous\.com\/[^\s]+|https?:\/\/[^\s]+/i.test(part);
        if (isLink) {
          return (
            <span
              key={index}
              className="text-[#53bdeb] underline hover:text-[#53bdeb]/80 cursor-pointer break-all"
            >
              {part}
            </span>
          );
        }
        return (
          <span key={index} className="whitespace-pre-wrap break-words">
            {part}
          </span>
        );
      });
    },
    [sampleProduct],
  );

  const handleEditorInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const html = e.currentTarget.innerHTML;
      const plainText = convertHTMLToPlainText(html);
      onChangeShareText(plainText);
    },
    [onChangeShareText],
  );

  const handleEditorBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const html = e.currentTarget.innerHTML;
      const plainText = convertHTMLToPlainText(html);
      onChangeShareText(plainText);
    },
    [onChangeShareText],
  );

  const handleEditorPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");

      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));

        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const html = e.currentTarget.innerHTML;
      const plainText = convertHTMLToPlainText(html);
      onChangeShareText(plainText);
    },
    [onChangeShareText],
  );

  // Sync state on load or config changes
  useEffect(() => {
    if (isLoaded && config) {
      const cleanPhone = getCleanPhone(config.whatsappNumber || "");
      const data = {
        whatsappNumber: cleanPhone,
        businessHours: config.businessHours || "",
        shareText: config.shareText || "",
      };
      if (!hasInitialSyncRef.current) {
        setFormData(data);
        hasInitialSyncRef.current = true;

        const editor = document.getElementById("settings-share-message-editor");
        if (editor) {
          editor.innerHTML = convertPlainTextToHTML(config.shareText || "");
          editorInitializedRef.current = true;
        }
      } else {
        // Only update if not dirty to prevent overriding user input on sync
        const isDirty =
          getCleanPhone(formData.whatsappNumber) !== cleanPhone ||
          formData.businessHours !== (config.businessHours || "") ||
          formData.shareText !== (config.shareText || "");

        if (!isDirty) {
          setFormData(data);

          const editor = document.getElementById(
            "settings-share-message-editor",
          );
          if (editor) {
            editor.innerHTML = convertPlainTextToHTML(config.shareText || "");
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, isLoaded]);

  // Keep store config updated in background when active
  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        refresh({ onlyConfig: true });
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [active, refresh]);

  // Notify parent of dirty state
  useEffect(() => {
    if (!onSetDirty || !config) return;
    const cleanPhone = getCleanPhone(config.whatsappNumber || "");
    const isDirty =
      getCleanPhone(formData.whatsappNumber) !== cleanPhone ||
      formData.businessHours !== (config.businessHours || "") ||
      formData.shareText !== (config.shareText || "");

    onSetDirty(isDirty);
    return () => {
      onSetDirty(false);
    };
  }, [
    formData.whatsappNumber,
    formData.businessHours,
    formData.shareText,
    config,
    onSetDirty,
  ]);

  const handleSubmit = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para salvar as configurações de suporte.",
      });
      return;
    }
    if (isSaving) return;

    if (!formData.whatsappNumber) {
      toast.error("WhatsApp é obrigatório");
      return;
    }

    let cleanWhatsApp = formData.whatsappNumber.replace(/\D/g, "");
    if (cleanWhatsApp.length < 10) {
      toast.error("WhatsApp inválido");
      return;
    }

    if (cleanWhatsApp.length === 10 || cleanWhatsApp.length === 11) {
      cleanWhatsApp = `55${cleanWhatsApp}`;
    }

    setIsSaving(true);
    try {
      await updateConfig({
        whatsappNumber: cleanWhatsApp,
        businessHours: formData.businessHours,
        shareText: formData.shareText,
      });
      onSetDirty?.(false);
      toast.success("Canais de atendimento atualizados com sucesso!");
    } catch (err) {
      console.error("[AdminWhatsAppConfigView] Error updating config:", err);
      toast.error("Erro ao salvar as configurações");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredPresets = PRESETS.filter(
    (preset) =>
      preset.name.toLowerCase().includes(presetSearch.toLowerCase()) ||
      preset.description.toLowerCase().includes(presetSearch.toLowerCase()) ||
      preset.text.toLowerCase().includes(presetSearch.toLowerCase()),
  );

  return (
    <div className="relative min-h-screen bg-[#09090b] pb-admin lg:pb-12 font-sans text-zinc-400">
      {/* Elite Header */}
      <div className="sticky top-0 z-30 mb-3 border-b border-white/5 bg-[#09090b]/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
            <span className="flex flex-nowrap items-baseline whitespace-nowrap">
              <span className="italic text-white">Atendimento</span>
            </span>
          </h1>
          <button
            onClick={handleSubmit}
            disabled={!isLoaded || isOffline || isSaving}
            className="h-9.5 flex shrink-0 items-center gap-2 rounded-lg bg-admin-gold px-3.5 text-[9.5px] font-black uppercase tracking-widest text-white shadow-[0_0_30px_rgba(212,175,55,0.2)] transition-all hover:bg-admin-gold/90 hover:shadow-[0_0_40px_rgba(212,175,55,0.3)] active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:gap-3 sm:px-5"
          >
            {isSaving ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <Save className="size-4" />
                <span>
                  Salvar<span className="hidden sm:inline"> Alterações</span>
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {isOffline && (
          <div className="flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="size-5 shrink-0 animate-pulse text-red-500" />
            <span>
              Você está offline. O salvamento das configurações está
              desabilitado até restabelecer a rede.
            </span>
          </div>
        )}

        <div className="admin-glass relative space-y-6 overflow-hidden rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6">
          <div className="flex items-center gap-3 border-b border-white/5 pb-4">
            <div className="flex size-10 items-center justify-center rounded-xl border border-admin-gold/20 bg-admin-gold/10">
              <Headset className="size-5 text-admin-gold" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                Canais de Atendimento
              </h2>
              <p className="text-[10px] text-zinc-500">
                Configure os pontos de contato e expedição do seu suporte
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* WhatsApp input */}
            <div className="flex-grow space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="settings-whatsapp"
                  className="ml-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400"
                >
                  WhatsApp da Operação
                </Label>
                <span className="rounded-full border border-[#25d366]/20 bg-[#25d366]/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#25d366]">
                  Atendimento & Vendas
                </span>
              </div>
              <p className="ml-1 text-[9.5px] leading-snug text-zinc-500">
                Número que receberá contatos diretos de clientes.
              </p>
              <div className="group relative">
                <div className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 border-r border-white/10 pr-2.5">
                  <MessageCircle className="size-3.5 text-[#25d366]" />
                  <span className="text-[11px] font-black text-zinc-500">
                    +55
                  </span>
                </div>
                <LocalBufferedInput
                  id="settings-whatsapp"
                  name="whatsapp"
                  useShadcn
                  mask="phone"
                  delay={350}
                  value={formData.whatsappNumber}
                  onFlush={onChangeWhatsappNumber}
                  placeholder="Ex: (34) 99999-9999"
                  className="h-10 rounded-xl border-white/10 bg-black/40 pl-16 text-xs font-bold text-white transition-all placeholder:text-zinc-700 focus:bg-black/60 focus:ring-admin-gold/50"
                  autoComplete="tel"
                  disabled={isOffline}
                  validate={(val) => {
                    if (!val) return "WhatsApp é obrigatório";
                    const clean = val.replace(/\D/g, "");
                    if (clean.length < 10 || clean.length > 11) {
                      return "Informe DDD + número (10 ou 11 dígitos)";
                    }
                    return null;
                  }}
                />
              </div>
              <div className="space-y-1 rounded-lg border border-white/5 bg-zinc-950/40 p-2.5">
                <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                  <Info className="size-3 text-admin-gold" />
                  <span>Formato e Protocolo</span>
                </div>
                <p className="text-[9px] leading-relaxed text-zinc-400">
                  Informe DDD + número (ex:{" "}
                  <code className="font-mono font-bold text-admin-gold">
                    34999999999
                  </code>
                  ). O código{" "}
                  <code className="font-mono text-zinc-300">55</code> é
                  adicionado automaticamente.
                </p>
              </div>
            </div>

            {/* Business Hours */}
            <div className="flex-grow space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="settings-business-hours"
                  className="ml-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400"
                >
                  Horário de Funcionamento
                </Label>
                <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-blue-400">
                  Expediente
                </span>
              </div>
              <p className="ml-1 text-[9.5px] leading-snug text-zinc-500">
                Informa aos clientes no PWA o expediente de suporte.
              </p>
              <div className="group relative">
                <div className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 items-center border-r border-white/10 pr-2.5">
                  <Clock className="size-3.5 text-admin-gold" />
                </div>
                <LocalBufferedInput
                  id="settings-business-hours"
                  name="businessHours"
                  useShadcn
                  delay={350}
                  value={formData.businessHours}
                  onFlush={onChangeBusinessHours}
                  placeholder="Ex: Seg-Sáb: 9h às 18h"
                  className="h-10 rounded-xl border-white/10 bg-black/40 pl-11 text-xs font-bold text-white transition-all placeholder:text-zinc-700 focus:bg-black/60 focus:ring-admin-gold/50"
                  autoComplete="off"
                  disabled={isOffline}
                />
              </div>
              <div className="space-y-1 rounded-lg border border-white/5 bg-zinc-950/40 p-2.5">
                <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                  <Clock className="size-3 text-zinc-500" />
                  <span>Exemplos recomendados</span>
                </div>
                <p className="text-[9px] leading-relaxed text-zinc-400">
                  •{" "}
                  <code className="font-mono text-zinc-300">
                    Seg-Sáb: 9h às 18h
                  </code>
                  <br />•{" "}
                  <code className="font-mono text-zinc-300">
                    Seg a Sex: 8h às 18h | Sáb: 8h às 12h
                  </code>
                </p>
              </div>
            </div>
          </div>

          {/* Share Message */}
          <div className="space-y-4 border-t border-white/5 pt-5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="ml-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 block">
                  Mensagem de Compartilhamento de Produtos
                </span>
                <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-purple-400">
                  Divulgação
                </span>
              </div>
              <p className="ml-1 text-[9.5px] leading-snug text-zinc-500">
                Texto anexado quando um usuário compartilha um produto. O nome
                do produto, o preço e o link serão adicionados de acordo com os
                placeholders.
              </p>
            </div>

            <div className="space-y-6">
              {/* WhatsApp Fiel Preview no topo */}
              <div className="space-y-2">
                <span className="ml-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 block">
                  Visualização da Mensagem no WhatsApp (Fiel)
                </span>

                {/* Chat window mockup com max-width responsivo e centralizado */}
                <div className="relative flex flex-col h-[340px] max-w-md mx-auto w-full rounded-2xl overflow-hidden border border-zinc-800 bg-[#0b141a] shadow-2xl transition-all duration-300">
                  {/* WhatsApp Custom Header */}
                  <div className="flex items-center justify-between bg-[#1f2c34] px-3.5 py-2 border-b border-[#222e35]/50 z-10 shrink-0">
                    <div className="flex items-center gap-2.5">
                      {/* Store avatar mockup */}
                      <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-admin-gold/15 border border-admin-gold/30 text-[9px] font-black text-admin-gold">
                        IK
                        <span className="absolute bottom-0 right-0 size-2 rounded-full border border-[#1f2c34] bg-[#25d366]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#e9edef] truncate">
                          Cliente (Você)
                        </p>
                        <p className="text-[8px] text-[#8696a0] leading-none">
                          online
                        </p>
                      </div>
                    </div>
                    {/* Header Icons */}
                    <div className="flex items-center gap-3.5 text-[#aebac1]">
                      <Video className="size-4 cursor-pointer hover:text-white transition-colors" />
                      <Phone className="size-3.5 cursor-pointer hover:text-white transition-colors" />
                      <div className="h-4 w-px bg-white/5" />
                      <MoreVertical className="size-4 cursor-pointer hover:text-white transition-colors" />
                    </div>
                  </div>

                  {/* Chat message body with wallpaper pattern */}
                  <div className="relative flex-1 p-3 overflow-y-auto flex flex-col">
                    {/* Doodle pattern overlay */}
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#25d366_1.2px,transparent_1.2px)] opacity-[0.03] [background-size:14px_14px]" />

                    {/* Sent message bubble wrapper */}
                    <div className="relative z-10 w-full max-w-[85%] self-end flex items-start justify-end gap-1 mt-auto">
                      {/* Sent message bubble */}
                      <div className="relative max-w-full min-w-0 rounded-xl rounded-tr-none bg-[#005c4b] px-3 py-2 text-[#e9edef] shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]">
                        {/* WhatsApp bubble tail SVG */}
                        <div className="absolute -right-[7px] top-0 text-[#005c4b] fill-current">
                          <svg width="8" height="13" viewBox="0 0 8 13">
                            <path d="M5.188 0H0v11.193l6.467-6.467C7.523 3.668 7.02 0 5.188 0z" />
                          </svg>
                        </div>

                        {/* OpenGraph Preview Link Card - Exibido de forma fiel ao compartilhamento de produto */}
                        <div className="w-full min-w-0 overflow-hidden rounded-lg bg-[#013c32] mb-1.5 border border-[#004d40] flex flex-col shadow-sm">
                          {/* Image and title block */}
                          <div className="flex gap-2.5 p-2 bg-black/10 w-full min-w-0">
                            {/* Product photo real/premium */}
                            <div className="relative flex size-14 shrink-0 overflow-hidden rounded-lg border border-white/5 bg-zinc-900 shadow-inner">
                              <img
                                src={
                                  sampleProduct.images?.[0]
                                    ? sampleProduct.images[0]
                                    : "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=150&h=150&fit=crop&q=80"
                                }
                                alt={sampleProduct.name}
                                className="size-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
                              <p className="text-[10px] font-bold text-[#e9edef] truncate">
                                {sampleProduct.name}
                              </p>
                              <p className="text-[8px] text-[#8696a0] line-clamp-2 leading-relaxed">
                                {sampleProduct.description ||
                                  "Excelente qualidade, preço justo e entrega rápida. Confira os detalhes em nossa loja!"}
                              </p>
                            </div>
                          </div>

                          {/* Domain footer block */}
                          <div className="flex items-center justify-between px-2.5 py-1 bg-black/20 border-t border-[#004d40]">
                            <span className="text-[8px] font-medium text-[#8696a0]">
                              ikcous.com
                            </span>
                            <ExternalLink className="size-2.5 text-[#8696a0]" />
                          </div>
                        </div>

                        {/* Main text bubble message with tags parsed */}
                        <div className="break-words text-[11px] leading-relaxed">
                          {renderFormattedText(formData.shareText)}
                        </div>

                        {/* Time and checkmarks */}
                        <div className="mt-1 flex items-center justify-end gap-1 text-[7.5px] text-[#8696a0]/80">
                          <span>12:00</span>
                          <span className="flex text-[#53bdeb] font-bold">
                            <Check className="size-2.5 text-[#53bdeb]" />
                            <Check className="size-2.5 -ml-1 text-[#53bdeb]" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Painel do Editor abaixo */}
              <div className="space-y-4 rounded-2xl border border-white/5 bg-zinc-950/40 p-4 sm:p-5">
                <div className="relative">
                  <div className="pointer-events-none absolute left-3.5 top-3.5 z-15">
                    <Share2 className="size-3.5 text-zinc-500" />
                  </div>

                  {/* ContentEditable Rich Text Area Mockup */}
                  <div
                    id="settings-share-message-editor"
                    contentEditable={!isOffline}
                    onInput={handleEditorInput}
                    onBlur={handleEditorBlur}
                    onPaste={handleEditorPaste}
                    className="min-h-[120px] rounded-xl border border-white/10 bg-black/40 p-3.5 pl-10 text-xs font-medium leading-relaxed text-white transition-all focus:bg-black/60 focus:ring-2 focus:ring-admin-gold/50 outline-none overflow-y-auto cursor-text relative empty:before:content-['Escreva_a_mensagem_de_compartilhamento_do_produto...'] empty:before:text-zinc-700 empty:before:absolute empty:before:left-10 empty:before:top-3.5 empty:before:pointer-events-none"
                  />
                </div>

                {/* Tags Dinâmicas */}
                <div className="space-y-2">
                  <div className="flex flex-col ml-1">
                    <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400">
                      Toque para Adicionar ao Texto
                    </span>
                    <span className="text-[8.5px] text-zinc-500">
                      O valor correspondente será injetado ao compartilhar.
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isOffline}
                      onClick={() => insertTag("nome")}
                      className="group flex items-center gap-1.5 rounded-xl border border-admin-gold/20 bg-[#09090b] px-3.5 py-2 text-[9.5px] font-bold text-zinc-300 transition-all hover:border-admin-gold/50 hover:bg-zinc-900 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Plus className="size-3.5 text-admin-gold group-hover:rotate-90 transition-transform duration-200" />
                      <span>Nome do Produto</span>
                    </button>
                    <button
                      type="button"
                      disabled={isOffline}
                      onClick={() => insertTag("preco")}
                      className="group flex items-center gap-1.5 rounded-xl border border-admin-gold/20 bg-[#09090b] px-3.5 py-2 text-[9.5px] font-bold text-zinc-300 transition-all hover:border-admin-gold/50 hover:bg-zinc-900 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Plus className="size-3.5 text-admin-gold group-hover:rotate-90 transition-transform duration-200" />
                      <span>Preço</span>
                    </button>
                    <button
                      type="button"
                      disabled={isOffline}
                      onClick={() => insertTag("link")}
                      className="group flex items-center gap-1.5 rounded-xl border border-admin-gold/20 bg-[#09090b] px-3.5 py-2 text-[9.5px] font-bold text-zinc-300 transition-all hover:border-admin-gold/50 hover:bg-zinc-900 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Plus className="size-3.5 text-admin-gold group-hover:rotate-90 transition-transform duration-200" />
                      <span>Link</span>
                    </button>
                  </div>
                </div>

                {/* Botão de Presets */}
                <div>
                  <button
                    type="button"
                    disabled={isOffline}
                    onClick={() => {
                      setPresetSearch("");
                      setIsPresetsOpen(true);
                    }}
                    className="flex items-center justify-center gap-2 w-full rounded-xl border border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 px-4 py-3.5 text-xs font-bold text-purple-400 hover:text-purple-300 hover:border-purple-500/30 transition-all active:scale-[0.98] shadow-sm cursor-pointer"
                  >
                    <Sparkles className="size-4 text-purple-400" />
                    <span>Escolher Modelo Pronto (Presets)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-Up Bottom Sheet for Presets */}
      <AnimatePresence>
        {isPresetsOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div className="fixed inset-0 z-[100] flex items-end justify-center">
              {/* Backdrop overlay */}
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setIsPresetsOpen(false)}
                className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-pointer"
              />

              {/* Bottom Sheet Container */}
              <motion.div
                drag="y"
                dragListener={false}
                dragControls={dragControls}
                dragConstraints={{ top: 0 }}
                dragElastic={{ top: 0, bottom: 0.8 }}
                dragMomentum={false}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 150 || info.velocity.y > 500) {
                    setIsPresetsOpen(false);
                  }
                }}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 30, stiffness: 350 }}
                className="relative z-10 w-full max-w-2xl rounded-t-[2rem] border-t border-white/10 bg-[#09090b] px-4 pb-8 pt-4 shadow-2xl flex flex-col max-h-[85vh] touch-none"
              >
                {/* Grab handle and Header drag target */}
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  className="w-full cursor-grab active:cursor-grabbing pb-3 pt-1 touch-none flex flex-col items-center select-none"
                >
                  {/* Top decorative handle */}
                  <div className="mb-4 h-1.5 w-12 rounded-full bg-zinc-800" />
                  
                  {/* Header content inside the drag area to make it easy to drag */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-4 w-full text-left pointer-events-none">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                        <Sparkles className="size-4 text-purple-400" />
                        Modelos de Mensagem (Presets)
                      </h3>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        Selecione um dos 30 modelos prontos de compartilhamento de
                        produto.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4 mt-2">
                  {/* Search Bar */}
                  <div className="relative">
                    <input
                      id="preset-search-input"
                      name="presetSearch"
                      type="text"
                      placeholder="Pesquisar por modelo, tom ou palavra-chave..."
                      value={presetSearch}
                      onChange={(e) => setPresetSearch(e.target.value)}
                      className="h-10 w-full rounded-xl border border-white/10 bg-black/40 px-4 text-xs font-bold text-white transition-all placeholder:text-zinc-700 focus:bg-black/60 focus:border-purple-500/50 outline-none"
                      autoComplete="off"
                    />
                  </div>

                  {/* Presets List Scrollable */}
                  <div className="overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh]">
                    {filteredPresets.length > 0 ? (
                      filteredPresets.map((preset) => (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() => {
                            applyPreset(preset.text);
                            setIsPresetsOpen(false);
                          }}
                          className="flex flex-col items-start gap-1.5 rounded-xl border border-white/5 bg-zinc-950/60 p-3.5 text-left transition-all hover:border-purple-500/30 hover:bg-purple-950/5 active:scale-[0.98] group"
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 group-hover:text-purple-300">
                              {preset.name}
                            </span>
                            <span className="rounded-full border border-purple-500/10 bg-purple-500/5 px-2 py-0.5 text-[7px] font-black uppercase tracking-wider text-purple-500">
                              Aplicar
                            </span>
                          </div>
                          <p className="text-[9px] leading-relaxed text-zinc-400 line-clamp-3 bg-black/30 p-2 rounded-lg border border-white/5 w-full font-mono font-medium">
                            {preset.text}
                          </p>
                          <span className="text-[8px] text-zinc-500 italic mt-0.5">
                            {preset.description}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="col-span-full py-8 text-center flex flex-col items-center justify-center gap-2">
                        <p className="text-xs text-zinc-600 font-bold uppercase tracking-wider">
                          Nenhum modelo encontrado
                        </p>
                        <p className="text-[10px] text-zinc-700">
                          Tente pesquisar usando outro termo.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>,
            document.body,
          )}
      </AnimatePresence>
    </div>
  );
});
