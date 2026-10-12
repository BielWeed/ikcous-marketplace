import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import { Label } from "@/components/ui/label";
import { useStore } from "@/contexts/StoreContext";
import {
  Check,
  ExternalLink,
  MoreVertical,
  Phone,
  Plus,
  Share2,
  Sparkles,
  Video,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRESETS,
  type TipoDeMarcador,
  htmlDoMarcador,
  htmlParaTexto,
  textoDaPrevia,
  textoParaHtml,
} from "./modelos-de-mensagem";

// Bloco "Mensagem de compartilhamento" de Minha loja › Contato (painel simples,
// D9): extraído do bloco 3 da antiga tela "Atendimento", com o mesmo
// comportamento — editor com marcadores (nome, preço, link), prévia fiel ao vivo
// e 30 modelos prontos. O editor vive montado: nada do que foi digitado some.
//
// A folha de "Modelos prontos" agora é a FolhaDoPainel (diálogo acessível do
// painel: Esc fecha, foco preso e devolvido a quem abriu, toque fora fecha).
// O Voltar do aparelho continua fechando SÓ a folha, pelo mesmo padrão do
// AdminBannersView (`onSetBackOverride` + uma entrada própria no histórico).

interface MensagemDeCompartilharProps {
  /** O texto que está no editor agora (alimenta a prévia). */
  readonly texto: string;
  /**
   * O que o editor deve CARREGAR: trocar o `id` recarrega o editor com este
   * texto (config que chegou, ou a primeira carga). Digitar não passa por aqui.
   */
  readonly carga: { readonly texto: string; readonly id: number };
  readonly onMudar: (texto: string) => void;
  readonly desabilitado?: boolean;
  /**
   * Voltar do Android/AdminLayout com a folha aberta: fecha só a folha, sem
   * sair da tela. Opcional — sem ele o Esc e o toque fora seguem fechando.
   */
  readonly onSetBackOverride?: (fn: (() => void) | null) => void;
}

const ID_DO_EDITOR = "settings-share-message-editor";

const BOTAO_DE_MARCADOR =
  "group flex min-h-11 items-center gap-1.5 rounded-xl border border-admin-gold/20 bg-admin-bg px-3.5 text-sm font-bold text-zinc-300 transition-all hover:border-admin-gold/50 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/50 focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg active:scale-95 disabled:pointer-events-none disabled:opacity-50";

const MARCADORES_DO_BOTAO: readonly {
  readonly tipo: TipoDeMarcador;
  readonly rotulo: string;
}[] = [
  { tipo: "nome", rotulo: "Nome do Produto" },
  { tipo: "preco", rotulo: "Preço" },
  { tipo: "link", rotulo: "Link" },
];

const EXEMPLO_SEM_CATALOGO = {
  name: "Fone de Ouvido Bluetooth",
  price: 189.9,
  description:
    "Excelente qualidade de som estereofônico, cancelamento de ruído ativo e até 24 horas de autonomia.",
  images: [
    "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=150&h=150&fit=crop&q=80",
  ],
};

const PADRAO_DE_LINK = /(ikcous\.com\/[^\s]+|https?:\/\/[^\s]+)/gi;
const EH_LINK = /ikcous\.com\/[^\s]+|https?:\/\/[^\s]+/i;

export const MensagemDeCompartilhar = memo(function MensagemDeCompartilhar({
  texto,
  carga,
  onMudar,
  desabilitado = false,
  onSetBackOverride,
}: MensagemDeCompartilharProps) {
  const { products } = useStore();
  const editorRef = useRef<HTMLDivElement>(null);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [busca, setBusca] = useState("");

  // Carga do editor: na montagem e a cada `carga.id`. O editor é imperativo
  // (contentEditable) — o React não escreve dentro dele.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = textoParaHtml(carga.texto);
    }
  }, [carga]);

  const fecharFolha = useCallback(() => {
    setFolhaAberta(false);
  }, []);

  // Foco: devolvido a quem abriu a folha ao fechar (laudo de acessibilidade
  // pedido pelo dono). A FolhaDoPainel só devolve o foco a um Dialog.Trigger, e
  // aqui quem abre é um botão comum. Só na TRANSIÇÃO aberta→fechada: na
  // montagem (folha nasce fechada) o focus() rolaria a tela até o botão.
  const botaoQueAbriuRef = useRef<HTMLButtonElement>(null);
  const folhaJaAbriuRef = useRef(false);
  useEffect(() => {
    if (folhaAberta) {
      folhaJaAbriuRef.current = true;
    } else if (folhaJaAbriuRef.current) {
      botaoQueAbriuRef.current?.focus();
    }
  }, [folhaAberta]);

  // Voltar físico do Android / botão Voltar do AdminLayout: empurra uma
  // entrada de histórico própria na MESMA URL ao abrir, e a consome
  // (history.back()) ao fechar por QUALQUER caminho, só se ela ainda não
  // tiver sido consumida pelo pop físico do navegador.
  const temEntradaDeHistoricoRef = useRef(false);
  useEffect(() => {
    if (folhaAberta) {
      if (!temEntradaDeHistoricoRef.current) {
        window.history.pushState(
          { ...window.history.state, modal: "presets" },
          "",
          window.location.pathname + window.location.search,
        );
        temEntradaDeHistoricoRef.current = true;
      }
    } else if (temEntradaDeHistoricoRef.current) {
      temEntradaDeHistoricoRef.current = false;
      if (window.history.state?.modal === "presets") {
        window.history.back();
      }
    }
  }, [folhaAberta]);

  const jaFechouPeloVoltarRef = useRef(false);
  useEffect(() => {
    if (onSetBackOverride) {
      if (folhaAberta) {
        jaFechouPeloVoltarRef.current = false;
        onSetBackOverride(() => () => {
          if (jaFechouPeloVoltarRef.current) return;
          jaFechouPeloVoltarRef.current = true;
          fecharFolha();
        });
      } else {
        onSetBackOverride(null);
      }
    }
    return () => {
      if (onSetBackOverride) onSetBackOverride(null);
    };
  }, [folhaAberta, onSetBackOverride, fecharFolha]);

  const sincronizarComOEditor = useCallback(() => {
    const editor = editorRef.current;
    if (editor) onMudar(htmlParaTexto(editor.innerHTML));
  }, [onMudar]);

  const inserirMarcador = useCallback(
    (tipo: TipoDeMarcador) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();

      const molde = document.createElement("template");
      molde.innerHTML = htmlDoMarcador(tipo);
      const chip = molde.content.firstElementChild;
      if (!chip) return;

      const selecao = window.getSelection();
      if (selecao && selecao.rangeCount > 0) {
        const trecho = selecao.getRangeAt(0);
        if (editor.contains(trecho.commonAncestorContainer)) {
          trecho.deleteContents();
          trecho.insertNode(chip);
          trecho.setStartAfter(chip);
          trecho.setEndAfter(chip);
          selecao.removeAllRanges();
          selecao.addRange(trecho);
        } else {
          editor.appendChild(chip);
        }
      } else {
        editor.appendChild(chip);
      }
      sincronizarComOEditor();
    },
    [sincronizarComOEditor],
  );

  const aplicarModelo = useCallback(
    (textoDoModelo: string) => {
      const editor = editorRef.current;
      if (editor) {
        editor.innerHTML = textoParaHtml(textoDoModelo);
        editor.focus();
      }
      onMudar(textoDoModelo);
      setFolhaAberta(false);
    },
    [onMudar],
  );

  const aoColar = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const colado = e.clipboardData.getData("text/plain");
      const selecao = window.getSelection();
      if (selecao && selecao.rangeCount > 0) {
        const trecho = selecao.getRangeAt(0);
        trecho.deleteContents();
        trecho.insertNode(document.createTextNode(colado));
        trecho.collapse(false);
        selecao.removeAllRanges();
        selecao.addRange(trecho);
      }
      sincronizarComOEditor();
    },
    [sincronizarComOEditor],
  );

  // Produto de exemplo da prévia: o primeiro do catálogo, ou um de fábrica.
  const exemplo =
    products && products.length > 0 ? products[0] : EXEMPLO_SEM_CATALOGO;

  const previa = useMemo(
    () =>
      textoDaPrevia(texto, exemplo)
        .split(PADRAO_DE_LINK)
        .map((parte, i) =>
          EH_LINK.test(parte) ? (
            <span
              key={`${i}-${parte}`}
              className="cursor-pointer break-all text-[#53bdeb] underline hover:text-[#53bdeb]/80"
            >
              {parte}
            </span>
          ) : (
            <span
              key={`${i}-${parte}`}
              className="whitespace-pre-wrap break-words"
            >
              {parte}
            </span>
          ),
        ),
    [texto, exemplo],
  );

  const modelosFiltrados = useMemo(() => {
    const termo = busca.toLowerCase();
    return PRESETS.filter(
      (modelo) =>
        modelo.name.toLowerCase().includes(termo) ||
        modelo.description.toLowerCase().includes(termo) ||
        modelo.text.toLowerCase().includes(termo),
    );
  }, [busca]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-black text-white">
          Mensagem de compartilhamento
        </h3>
        <p className="text-sm leading-snug text-zinc-400">
          Texto que vai junto quando alguém compartilha um produto da sua loja.
          A prévia em cima mostra ao vivo o que você digitar embaixo — como a
          mensagem chega no WhatsApp de quem recebe.
        </p>
      </div>

      {/* Prévia ao vivo — EM CIMA do campo: o lojista digita embaixo e vê a
          mensagem montando aqui em tempo real. Fiel: cabeçalho, papel de
          parede, bolha com o card do produto e o domínio real da loja. */}
      <div className="space-y-2">
        <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-zinc-400">
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            Ao vivo
          </span>
          Como chega no WhatsApp de quem recebe
        </span>

        <div className="relative mx-auto flex h-[420px] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0b141a] shadow-2xl">
          <div className="z-10 flex shrink-0 items-center justify-between border-b border-[#222e35]/50 bg-[#1f2c34] px-3.5 py-2">
            <div className="flex items-center gap-2.5">
              <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-admin-gold/30 bg-admin-gold/15 text-[11px] font-black text-admin-gold">
                IK
                <span className="absolute bottom-0 right-0 size-2 rounded-full border border-[#1f2c34] bg-[#25d366]" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-[#e9edef]">
                  Cliente (Você)
                </p>
                <p className="text-[11px] leading-none text-[#8696a0]">
                  online
                </p>
              </div>
            </div>
            <div
              aria-hidden="true"
              className="flex items-center gap-3.5 text-[#aebac1]"
            >
              <Video className="size-4" />
              <Phone className="size-3.5" />
              <div className="h-4 w-px bg-white/5" />
              <MoreVertical className="size-4" />
            </div>
          </div>

          <div className="relative flex flex-1 flex-col overflow-y-auto p-3">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#25d366_1.2px,transparent_1.2px)] opacity-[0.03] [background-size:14px_14px]" />

            <div className="relative z-10 mt-auto flex w-full max-w-[85%] items-start justify-end gap-1 self-end">
              <div className="relative min-w-0 max-w-full rounded-xl rounded-tr-none bg-[#005c4b] px-3 py-2 text-[#e9edef] shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]">
                <div className="absolute right-[-7px] top-0 fill-current text-[#005c4b]">
                  <svg
                    width="8"
                    height="13"
                    viewBox="0 0 8 13"
                    aria-hidden="true"
                  >
                    <path d="M5.188 0H0v11.193l6.467-6.467C7.523 3.668 7.02 0 5.188 0z" />
                  </svg>
                </div>

                {/* Card de link: fiel ao compartilhamento de um produto. */}
                <div className="mb-1.5 flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-[#004d40] bg-[#013c32] shadow-sm">
                  <div className="flex w-full min-w-0 gap-2.5 bg-black/10 p-2">
                    <div className="relative flex size-14 shrink-0 overflow-hidden rounded-lg border border-white/5 bg-zinc-900 shadow-inner">
                      <img
                        src={
                          exemplo.images?.[0] || EXEMPLO_SEM_CATALOGO.images[0]
                        }
                        alt={exemplo.name}
                        className="size-full object-cover"
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                      <p className="truncate text-xs font-bold text-[#e9edef]">
                        {exemplo.name}
                      </p>
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-[#8696a0]">
                        {exemplo.description ||
                          "Excelente qualidade, preço justo e entrega rápida. Confira os detalhes em nossa loja!"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-[#004d40] bg-black/20 px-2.5 py-1">
                    <span className="text-[11px] font-medium text-[#8696a0]">
                      {window.location.host}
                    </span>
                    <ExternalLink
                      aria-hidden="true"
                      className="size-3 text-[#8696a0]"
                    />
                  </div>
                </div>

                <div className="break-words text-xs leading-relaxed">
                  {previa}
                </div>

                <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#8696a0]/80">
                  <span>12:00</span>
                  <span className="flex font-bold text-[#53bdeb]">
                    <Check aria-hidden="true" className="size-3" />
                    <Check aria-hidden="true" className="-ml-1 size-3" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-white/5 pt-4">
        <Label
          id="rotulo-texto-mensagem"
          className="block text-sm font-bold text-white"
        >
          Texto da mensagem
        </Label>
        <div className="relative">
          <div className="pointer-events-none absolute left-3.5 top-3.5 z-10">
            <Share2 aria-hidden="true" className="size-4 text-zinc-500" />
          </div>
          {/* O rótulo se associa por aria-labelledby: div editável não é
              campo rotulável por `for` — é a associação correta aqui. */}
          <div
            ref={editorRef}
            id={ID_DO_EDITOR}
            role="textbox"
            aria-multiline="true"
            aria-labelledby="rotulo-texto-mensagem"
            tabIndex={0}
            contentEditable={!desabilitado}
            suppressContentEditableWarning
            onInput={sincronizarComOEditor}
            onBlur={sincronizarComOEditor}
            onPaste={aoColar}
            className="relative min-h-[140px] cursor-text overflow-y-auto rounded-xl border border-white/10 bg-black/40 p-3.5 pl-10 text-sm font-medium leading-relaxed text-white outline-none transition-all empty:before:pointer-events-none empty:before:absolute empty:before:left-10 empty:before:top-3.5 empty:before:text-zinc-500 empty:before:content-['Escreva_a_mensagem_de_compartilhamento_do_produto...'] focus:bg-black/60 focus:ring-2 focus:ring-admin-gold/50"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {MARCADORES_DO_BOTAO.map(({ tipo, rotulo }) => (
            <button
              key={tipo}
              type="button"
              disabled={desabilitado}
              onClick={() => inserirMarcador(tipo)}
              className={BOTAO_DE_MARCADOR}
            >
              <Plus
                aria-hidden="true"
                className="size-4 text-admin-gold transition-transform duration-200 group-hover:rotate-90"
              />
              <span>{rotulo}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        ref={botaoQueAbriuRef}
        type="button"
        disabled={desabilitado}
        onClick={() => {
          setBusca("");
          setFolhaAberta(true);
        }}
        className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-purple-500/20 bg-purple-500/5 px-4 text-sm font-bold text-purple-400 shadow-sm transition-all hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        <Sparkles aria-hidden="true" className="size-4 text-purple-400" />
        <span>Modelos prontos ({PRESETS.length} disponíveis)</span>
      </button>

      <FolhaDoPainel
        aberta={folhaAberta}
        onFechar={fecharFolha}
        titulo="Modelos prontos de mensagem"
        icone={Sparkles}
      >
        <p className="text-xs text-zinc-400">
          Selecione um dos {PRESETS.length} modelos prontos de compartilhamento
          de produto.
        </p>
        <input
          id="preset-search-input"
          name="presetSearch"
          type="text"
          aria-label="Pesquisar modelos"
          placeholder="Pesquisar por modelo, tom ou palavra-chave..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-4 text-sm font-bold text-white outline-none transition-all placeholder:text-zinc-500 focus:border-purple-500/50 focus:bg-black/60"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {modelosFiltrados.length > 0 ? (
            modelosFiltrados.map((modelo) => (
              <button
                key={modelo.name}
                type="button"
                onClick={() => aplicarModelo(modelo.text)}
                className="group flex min-h-11 flex-col items-start gap-1.5 rounded-xl border border-white/5 bg-zinc-950/60 p-3.5 text-left transition-all hover:border-purple-500/30 hover:bg-purple-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 active:scale-[0.98]"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-purple-400 group-hover:text-purple-300">
                    {modelo.name}
                  </span>
                  <span className="rounded-full border border-purple-500/10 bg-purple-500/5 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-purple-500">
                    Aplicar
                  </span>
                </div>
                <p className="line-clamp-3 w-full rounded-lg border border-white/5 bg-black/30 p-2 font-mono text-xs font-medium leading-relaxed text-zinc-400">
                  {modelo.text}
                </p>
                <span className="text-xs italic text-zinc-500">
                  {modelo.description}
                </span>
              </button>
            ))
          ) : (
            <div className="col-span-full flex flex-col items-center justify-center gap-2 py-8 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Nenhum modelo encontrado
              </p>
              <p className="text-xs text-zinc-500">
                Tente pesquisar usando outro termo.
              </p>
            </div>
          )}
        </div>
      </FolhaDoPainel>
    </div>
  );
});
