import {
  CabecaDeSecao,
  Chave,
  Linha,
  PontoEstado,
} from "@/components/admin/shipping/primitivas-direcao-d";
import {
  transportadoraFicaSemPagamento,
  transportadoraVendeForaDaCidade,
} from "@/lib/aviso-transportadora-sem-pagamento";
import { cepEhLocal } from "@/lib/cep-local";
import type { ModoDaEntregaNaCidade } from "@/lib/guarda-de-frete";
import {
  alcanceEhSoPertoDaLoja,
  avisoDaFaixaDeCep,
  dicaDaFaixaVazia,
  incluirRegiaoNoAlcance,
  prefixoDoCepDaLoja,
  resumoDoAlcance,
} from "@/lib/loja-pronta";
import { cepCompleto } from "@/lib/loja-pronta";
import { reais } from "@/lib/status-da-entrega";
import type { View } from "@/types";
import { memo, useEffect, useRef, useState } from "react";

/** A dica do texto livre: os dois formatos que o servidor lê e o que "vazio" quer dizer. */
function dicaDoTexto(cepDaLoja: string | null | undefined): string {
  return `Escreva dois CEPs separados por vírgula (o primeiro e o último) e vale tudo o que está entre eles; ou os 5 primeiros números de cada região, separados por vírgula. ${dicaDaFaixaVazia(cepDaLoja)}. CEP que não entra recebe o frete nacional.`;
}

/** O que acontece com o cliente de outro bairro, conforme a regra pronta. */
const FRASE_DE_FORA = new Map<string, string>([
  ["sim", "compra com transportadora, se tiver conta."],
  ["nao", "não consegue comprar."],
  [
    "sem-pagamento",
    "não consegue comprar: a transportadora só vale com o pagamento pelo app ligado.",
  ],
]);

/** Uma das respostas grandes de "Até onde você entrega?": título e EFEITO. */
function OpcaoDeAlcance({
  ativa,
  titulo,
  efeito,
  desabilitado,
  onEscolher,
}: {
  readonly ativa: boolean;
  readonly titulo: string;
  readonly efeito: string;
  readonly desabilitado?: boolean;
  readonly onEscolher: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      disabled={desabilitado}
      onClick={onEscolher}
      className={`flex min-h-11 flex-col items-start gap-1 rounded-xl border border-solid p-4 text-left transition-colors active:scale-[0.99] disabled:opacity-50 ${ativa ? "border-admin-accent bg-admin-accent/10" : "border-white/10 bg-zinc-900/60 hover:border-white/25"}`}
    >
      <span className="text-sm font-bold text-zinc-100">{titulo}</span>
      <span className="text-[12.5px] leading-snug text-zinc-400">{efeito}</span>
    </button>
  );
}

/** As três respostas de "Como você entrega na sua cidade?" e o EFEITO de cada. */
const RESPOSTAS_DE_ENTREGA: readonly {
  readonly modo: ModoDaEntregaNaCidade;
  readonly titulo: string;
  readonly efeito: string;
}[] = [
  {
    modo: "entrego",
    titulo: "Entrego",
    efeito:
      "Você leva o pedido até o cliente da sua cidade. Ele não pode retirar na loja.",
  },
  {
    modo: "entrego_e_retiro",
    titulo: "Entrego e retiro",
    efeito: "O cliente escolhe: recebe em casa ou retira na loja, de graça.",
  },
  {
    modo: "so_retiro",
    titulo: "Só retiro",
    efeito: "Seus clientes só poderão retirar na loja. Não oferecemos entrega.",
  },
];

/**
 * Seção "Entrega na sua cidade" da tela de Frete v2 — direção D aprovada
 * pelo dono (03/09): linhas finas, sem caixa/card. O que existe hoje nessa
 * área (`localDeliveryFee`, `localCepRange`, `shippingCoverage`) continua
 * funcionando IGUAL — aqui só muda a casca (mando do dono: casca nova,
 * regra intacta).
 *
 * A CHAVE desta seção é o ÚNICO interruptor de verdade da tela (com campo
 * gravável real por trás): "Só entregar na cidade" grava `shippingCoverage`:
 * - LIGADA    = "local"    → a edge function RECUSA CEP de fora (a loja
 *   só atende a cidade — comportamento real de calculate-shipping);
 * - DESLIGADA = "national" → a cidade segue sendo atendida pela entrega
 *   local E o resto do Brasil compra com a transportadora.
 *
 * Por que NÃO se chama "Entrega local" como no mockup: a entrega local não
 * tem "desligar" no sistema — CEP da cidade SEMPRE recebe a opção
 * "Entrega Local", nos dois estados da cobertura. Uma chave "Entrega
 * local" desligada seria chave que mente. O campo real que liga e desliga
 * algo aqui é a cobertura, e o nome diz exatamente o que ela faz.
 *
 * Semântica do valor (vem da edge, repetida sem inventar): CEP do cliente
 * dentro da faixa → opção "Entrega Local" custa `localDeliveryFee`
 * (R$ 0 = entrega de graça na cidade). Faixa vazia = só CEPs que começam
 * com os 5 primeiros números do CEP da loja (NÃO a cidade inteira: em
 * cidade com CEP por rua isso deixa bairros de fora — ver `avisoDaFaixaDeCep`).
 *
 * ATÉ ONDE VOCÊ ENTREGA (16/10/2026): no lugar do campo de texto "Alcance
 * por CEP", duas respostas com o EFEITO escrito embaixo. "Só perto da loja"
 * grava os 5 primeiros números do CEP da loja no MESMO campo do formulário
 * (o Salvar do topo grava; nenhum fluxo novo): no instante da gravação é a
 * mesma regra do alcance VAZIO nas três cópias do servidor, só que agora dita
 * pela lojista — o cartão "Sua loja está pronta?" fecha o passo. O número é
 * uma CÓPIA: se o CEP da loja mudar, Minha loja o regrava no mesmo Salvar do
 * endereço (`alcanceAoMudarOCepDaLoja`). "Em mais lugares" abre o teste de CEP
 * ("entra / fica de fora") e o botão que acrescenta a região. O texto livre
 * continua, recolhido, para quem já o usa. Nenhum formato novo: só o que
 * `cepEhLocal`/`is_local_cep`/edge já leem.
 *
 * COMO VOCÊ ENTREGA (16/10/2026): três respostas ("Entrego", "Entrego e
 * retiro", "Só retiro") no lugar do interruptor "Permitir retirada na loja".
 * O pai traduz a escolha nos dois campos reais (entrega própria ligada +
 * chave `store-pickup` em `enabledShippingMethods`, calculada do config
 * ATUAL, preservando os serviços de transportadora). A cliente vê "Retirar na
 * loja", grátis, com o endereço de Minha loja — aqui ele só aparece para
 * LEITURA (D7, painel simples: o endereço tem uma casa só). Sem esse
 * endereço as duas respostas com retirada NÃO se escolhem: a tela explica e
 * oferece "Cadastrar endereço em Minha loja" (a edge também não oferece a
 * retirada sem endereço — a retirada ligada ali seria chave que mente).
 *
 * "Só retiro" não entrega, então esconde o que só existe para entrega: valor,
 * prazo, alcance por CEP e "Só entregar na cidade" (quem é de fora também
 * retira). O pai guarda esses valores e eles voltam ao escolher "Entrego".
 */
export const FreteLocalBloco = memo(function FreteLocalBloco({
  valor,
  onValor,
  faixa,
  onFaixa,
  coverage,
  onCoverage,
  cidade,
  uf,
  semOrigem,
  cepDaLoja,
  desabilitado,
  modo = "entrego",
  onModo,
  dias = "1",
  onDias,
  enderecoDaLoja,
  onNavigate,
  mostrarCabecalho = true,
  nomesLigados,
  pagamentoPeloAppLigado,
}: {
  readonly valor: number;
  readonly onValor: (valor: number) => void;
  readonly faixa: string;
  readonly onFaixa: (faixa: string) => void;
  readonly coverage: "local" | "national";
  readonly onCoverage: (coverage: "local" | "national") => void;
  readonly cidade?: string | null;
  readonly uf?: string | null;
  /** A loja ainda não definiu o CEP de origem — a entrega está parada. */
  readonly semOrigem?: boolean;
  /** CEP de origem da loja — a dica da faixa vazia cita os 5 primeiros números. */
  readonly cepDaLoja?: string | null;
  readonly desabilitado?: boolean;
  /** Como a loja entrega na cidade, no formulário. */
  readonly modo?: ModoDaEntregaNaCidade;
  /** Ausente = a tela não oferece as três respostas (nada é exibido). */
  readonly onModo?: (modo: ModoDaEntregaNaCidade) => void;
  /** Prazo da entrega própria, como o texto do campo (0 a 30; vazio = 1). */
  readonly dias?: string;
  /** Ausente = sem campo de prazo. */
  readonly onDias?: (dias: string) => void;
  /** `store_address` salvo — sem ele a retirada não se escolhe. */
  readonly enderecoDaLoja?: string | null;
  /** Leva a Minha loja (`admin-about-store`), onde o endereço se cadastra.
   * Ausente = sem botão (nada de botão morto). */
  readonly onNavigate?: (view: View) => void;
  /** `false` quando um `PainelRecolhivel` externo já mostra o título e o
   * estado (tela de Frete unificada, 23/09/2026) — evita cabeçalho em
   * dobro. Default `true` preserva o uso isolado (e os testes). */
  readonly mostrarCabecalho?: boolean;
  /** Nomes das transportadoras com cotação REAL ligada (a mesma régua da
   * faixa-resumo). `null`/ausente = a leitura ainda não chegou ou falhou: a
   * tela não afirma nada sobre o cliente de outro bairro. */
  readonly nomesLigados?: readonly string[] | null;
  /** Pagamento pelo app ligado (a transportadora só vende com ele). `null`/
   * ausente = não se sabe: a tela não promete a compra. */
  readonly pagamentoPeloAppLigado?: boolean | null;
}) {
  const [semEnderecoAoEscolher, setSemEnderecoAoEscolher] = useState(false);
  const [semCepAoEscolher, setSemCepAoEscolher] = useState(false);
  const soRetiro = modo === "so_retiro";
  const prefixo = prefixoDoCepDaLoja(cepDaLoja);
  const soPerto = alcanceEhSoPertoDaLoja(cepDaLoja, faixa);
  const faixaEscrita = faixa.trim() !== "";
  // Quem já tem alcance escrito (lista, faixa) está em "Em mais lugares" — lido
  // do valor de AGORA, não de um estado inicial: a config pode chegar depois do
  // primeiro desenho. `maisLugares` só guarda o clique de quem ainda não
  // escreveu nada.
  const [cliqueEmMais, setCliqueEmMais] = useState(false);
  const faixaPropria = faixaEscrita && !soPerto;
  const maisLugares = cliqueEmMais || faixaPropria;
  const [cepDeTeste, setCepDeTeste] = useState("");
  const campoDeTesteRef = useRef<HTMLInputElement>(null);
  // O painel do texto livre NÃO é controlado pelo que ela digita: o valor
  // ("38400" = só perto da loja) mudava `faixaPropria` no meio da digitação e o
  // painel fechava com o campo em foco. Ele só abre sozinho para quem já tem
  // alcance escrito e ainda não mexeu nele; depois disso, só ela abre e fecha.
  const detalhesRef = useRef<HTMLDetailsElement>(null);
  const [mexeuNoPainel, setMexeuNoPainel] = useState(false);
  useEffect(() => {
    if (faixaPropria && !mexeuNoPainel && detalhesRef.current)
      detalhesRef.current.open = true;
  }, [faixaPropria, mexeuNoPainel]);
  const temEndereco = (enderecoDaLoja ?? "").trim() !== "";
  const onde =
    cidade && uf ? `${cidade}/${uf}` : cidade ? cidade : "sua cidade";
  // UM aviso só sobre o endereço (nunca dois empilhados, nem repetido na dica):
  // o estado salvo/escolhido sem endereço ganha o texto do que isso causa; o
  // clique recusado só explica por que a escolha não valeu.
  const avisoDoEndereco: string | null =
    temEndereco || !onModo
      ? null
      : soRetiro
        ? "Sem endereço cadastrado, ninguém consegue comprar: cadastre o endereço em Minha loja ou volte a entregar."
        : modo !== "entrego"
          ? "A retirada está ligada, mas a loja está sem endereço: a opção não aparece para o cliente até você cadastrar o endereço em Minha loja."
          : semEnderecoAoEscolher
            ? "Para escolher a retirada, cadastre o endereço da loja em Minha loja. O cliente precisa saber onde buscar."
            : null;
  // "Só retiro" sem o CEP completo da loja: a edge e as RPCs recusam toda compra
  // (origin_cep vazio), então a escolha não vale e o estado salvo avisa. A
  // régua de "CEP completo" é a MESMA da loja pronta.
  const semCepDaLoja = !cepCompleto(cepDaLoja);
  const avisoDoCep: string | null =
    onModo && semCepDaLoja && (soRetiro || semCepAoEscolher)
      ? "Para vender só com retirada, cadastre o CEP da loja em Minha loja."
      : null;
  // UM alerta só: a falta do CEP vem antes da falta do endereço.
  const alertaDoModo = avisoDoCep ?? avisoDoEndereco;
  const entraNoTeste =
    prefixo !== null && cepDeTeste.replace(/\D/g, "").length === 8
      ? cepEhLocal(cepDaLoja ?? "", cepDeTeste, faixa)
      : null;
  // Outro bairro compra? A MESMA regra do aviso fixo da tela: a transportadora
  // precisa vender fora (ligada, fora do "só entregar na cidade") E o
  // pagamento pelo app estar ligado — o checkout recusa transportadora sem
  // ele. Sem saber (leitura em andamento ou falha), a frase some.
  const vendeFora =
    nomesLigados == null
      ? null
      : transportadoraVendeForaDaCidade({ cobertura: coverage, nomesLigados });
  const comprarDeFora =
    vendeFora === null
      ? null
      : !vendeFora
        ? "nao"
        : pagamentoPeloAppLigado == null
          ? null
          : transportadoraFicaSemPagamento({
                transportadoraVende: true,
                pagamentoPeloAppLigado,
              })
            ? "sem-pagamento"
            : "sim";
  const campoDaFaixa = (
    <input
      id="local-cep-range"
      type="text"
      value={faixa}
      onChange={(e) => onFaixa(e.target.value)}
      placeholder="Ex: 38500-000, 38509-999"
      disabled={desabilitado}
      className="h-11 w-full rounded-xl border border-white/10 bg-zinc-900/60 px-3.5 font-mono text-[13px] text-zinc-100 placeholder-zinc-600 transition-colors focus:border-admin-accent focus:outline-none disabled:opacity-50 md:w-56"
    />
  );
  const avisoDaFaixa = avisoDaFaixaDeCep({
    originCep: cepDaLoja,
    localCepRange: faixa,
  });

  return (
    <section
      id="bloco-frete-local"
      aria-label="Entrega na sua cidade"
      className="scroll-mt-24"
    >
      {mostrarCabecalho && (
        <CabecaDeSecao
          titulo="Entrega na sua cidade"
          estado={
            semOrigem ? (
              <>
                <PontoEstado tom="atencao" />
                <span className="text-amber-300">
                  parada — falta o CEP da loja
                </span>
              </>
            ) : (
              <>
                <PontoEstado tom="positivo" />
                <span>
                  <b className="font-semibold text-zinc-200">ligada</b> ·{" "}
                  {soRetiro ? "só retirada" : "entrega própria"}
                </span>
              </>
            )
          }
        />
      )}

      {onModo && (
        <div className="py-4" data-como-entrego="">
          <p className="text-sm font-bold text-zinc-100">
            Como você entrega na sua cidade?
          </p>
          <div
            role="radiogroup"
            aria-label="Como você entrega na sua cidade"
            className="mt-3 grid gap-3 sm:grid-cols-3"
          >
            {RESPOSTAS_DE_ENTREGA.map((r) => (
              <OpcaoDeAlcance
                key={r.modo}
                ativa={modo === r.modo}
                titulo={r.titulo}
                efeito={r.efeito}
                desabilitado={desabilitado}
                onEscolher={() => {
                  // Só retiro sem CEP da loja: ninguém consegue comprar.
                  if (r.modo === "so_retiro" && semCepDaLoja) {
                    setSemCepAoEscolher(true);
                    setSemEnderecoAoEscolher(false);
                    return;
                  }
                  // Retirada sem endereço seria promessa vazia: a escolha não
                  // vale e a tela manda cadastrar o endereço.
                  if (r.modo !== "entrego" && !temEndereco) {
                    setSemEnderecoAoEscolher(true);
                    setSemCepAoEscolher(false);
                    return;
                  }
                  setSemEnderecoAoEscolher(false);
                  setSemCepAoEscolher(false);
                  onModo(r.modo);
                }}
              />
            ))}
          </div>
          {alertaDoModo && (
            // Colado nos cartões: no celular um aviso lá embaixo ficava fora
            // da tela e parecia que o toque não tinha feito nada.
            <p
              role="alert"
              className="mt-3 text-[12.5px] leading-snug text-amber-300"
            >
              {alertaDoModo}
            </p>
          )}
          {avisoDoCep && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("admin-about-store")}
              className="mt-2 flex min-h-11 shrink-0 items-center rounded-lg border border-solid border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
            >
              Abrir Minha loja
            </button>
          )}
        </div>
      )}

      {!soRetiro && (
        <Linha
          nome="Só entregar na cidade"
          dica="Ligada: quem é de fora não consegue comprar. Desligada: o resto do Brasil compra com a transportadora."
        >
          <Chave
            rotulo="Só entregar na cidade"
            ligada={coverage === "local"}
            desabilitado={desabilitado}
            onToggle={() =>
              onCoverage(coverage === "local" ? "national" : "local")
            }
          />
        </Linha>
      )}

      {!soRetiro && (
        <Linha
          nome="Valor por pedido"
          dica={`O que o cliente de ${onde} paga${onDias ? " e em quantos dias você entrega (0 = no mesmo dia)" : ""}`}
        >
          {/* Mesma mecânica da tela anterior (o campo vazio lê 0 = grátis na
            cidade) — mudou a casca, não o comportamento. */}
          <label
            htmlFor="local-delivery-fee"
            className="flex min-h-11 cursor-text items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2"
          >
            <span className="text-xs font-semibold text-zinc-400">R$</span>
            <input
              id="local-delivery-fee"
              type="number"
              min="0"
              step="0.5"
              inputMode="decimal"
              value={valor === 0 ? "" : valor}
              onChange={(e) =>
                onValor(e.target.value === "" ? 0 : Number(e.target.value))
              }
              placeholder="0"
              disabled={desabilitado}
              className="w-20 bg-transparent text-right text-xl font-bold tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
          {onDias && (
            <label
              htmlFor="local-delivery-days"
              className="flex min-h-11 cursor-text items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2"
            >
              <input
                id="local-delivery-days"
                type="text"
                inputMode="numeric"
                aria-label="Prazo da entrega própria em dias"
                value={dias}
                onChange={(e) => onDias(e.target.value)}
                placeholder="1"
                disabled={desabilitado}
                className="w-10 bg-transparent text-right text-xl font-bold tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-0 disabled:opacity-50"
              />
              <span className="text-xs font-semibold text-zinc-400">
                {dias === "1" ? "dia" : "dias"}
              </span>
            </label>
          )}
        </Linha>
      )}

      {soRetiro ? null : prefixo === null ? (
        // Sem CEP completo da loja não há "perto da loja" para escolher: só o
        // campo de texto, como sempre foi.
        <Linha nome="Escrever faixa de CEP" dica={dicaDoTexto(cepDaLoja)}>
          {campoDaFaixa}
        </Linha>
      ) : (
        <div className="py-4" data-ate-onde-entrega="">
          <p className="text-sm font-bold text-zinc-100">
            Até onde você entrega?
          </p>
          <p className="mt-1 text-[13px] text-zinc-400">
            Hoje: {resumoDoAlcance(cepDaLoja, faixa)}.
          </p>
          <div
            role="radiogroup"
            aria-label="Até onde você entrega"
            className="mt-3 grid gap-3 sm:grid-cols-2"
          >
            <OpcaoDeAlcance
              ativa={!maisLugares && soPerto}
              titulo="Só perto da loja"
              efeito={`CEPs que começam com ${prefixo}, normalmente um pedaço do seu bairro.${
                comprarDeFora === null
                  ? ""
                  : ` Cliente de outro bairro: ${FRASE_DE_FORA.get(comprarDeFora)}`
              }${
                faixaPropria
                  ? " Troca o que está escrito em “Escrever faixa de CEP”."
                  : ""
              }`}
              desabilitado={desabilitado}
              onEscolher={() => {
                setCliqueEmMais(false);
                onFaixa(prefixo);
              }}
            />
            <OpcaoDeAlcance
              ativa={maisLugares}
              titulo="Em mais lugares"
              efeito="Você escolhe quais CEPs entram. Teste o CEP de um cliente e veja na hora."
              desabilitado={desabilitado}
              onEscolher={() => setCliqueEmMais(true)}
            />
          </div>

          {maisLugares && (
            <div className="mt-4">
              <label
                htmlFor="cep-de-teste"
                className="text-[13px] font-semibold text-zinc-300"
              >
                Teste o CEP de um cliente
              </label>
              <input
                id="cep-de-teste"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                ref={campoDeTesteRef}
                value={cepDeTeste}
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "").slice(0, 8);
                  setCepDeTeste(
                    d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d,
                  );
                }}
                placeholder="Ex: 38500-123"
                disabled={desabilitado}
                className="mt-1.5 flex h-11 w-full rounded-xl border border-white/10 bg-zinc-900/60 px-3.5 font-mono text-[13px] text-zinc-100 placeholder-zinc-600 transition-colors focus:border-admin-accent focus:outline-none disabled:opacity-50 md:w-56"
              />
              <div role="status" aria-live="polite">
                {entraNoTeste !== null && (
                  <p
                    className={`mt-2 text-[13px] font-semibold ${entraNoTeste ? "text-emerald-300" : "text-amber-300"}`}
                  >
                    {entraNoTeste
                      ? `Entra na sua entrega — ${valor > 0 ? `paga R$ ${reais(valor)}` : "entrega grátis"}`
                      : "Fica de fora da sua entrega"}
                  </p>
                )}
              </div>
              {entraNoTeste === false && (
                <button
                  type="button"
                  disabled={desabilitado}
                  onClick={() => {
                    onFaixa(
                      incluirRegiaoNoAlcance(faixa, cepDaLoja, cepDeTeste),
                    );
                    // O botão some (a região entrou): o foco volta ao campo.
                    campoDeTesteRef.current?.focus();
                  }}
                  className="mt-2 flex min-h-11 items-center rounded-lg border border-solid border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-200 transition-colors hover:border-white/25 hover:text-white active:scale-95 disabled:opacity-50"
                >
                  Incluir a região deste CEP
                </button>
              )}
            </div>
          )}

          <details ref={detalhesRef} className="group mt-2">
            <summary
              onClick={() => setMexeuNoPainel(true)}
              className="flex min-h-11 cursor-pointer list-none items-center text-[13px] font-semibold text-zinc-300 before:mr-2 before:inline-block before:text-base before:text-zinc-300 before:transition-transform before:content-['▸'] group-open:before:rotate-90 [&::-webkit-details-marker]:hidden"
            >
              Escrever faixa de CEP
            </summary>
            <Linha nome="CEPs da entrega" dica={dicaDoTexto(cepDaLoja)}>
              {campoDaFaixa}
            </Linha>
          </details>
        </div>
      )}

      {!soRetiro && avisoDaFaixa && (
        <p role="note" className="mt-2 text-xs text-amber-300">
          {avisoDaFaixa}
        </p>
      )}

      {/* Em "Entrego" a cliente NÃO pode retirar: com endereço cadastrado a
          linha afirmaria o contrário, então só aparece sem endereço (o botão
          de cadastrar é o caminho para ligar a retirada depois). */}
      {onModo && (modo !== "entrego" || !temEndereco) && (
        <Linha
          nome="Endereço da retirada"
          dica={
            temEndereco
              ? `${soRetiro ? "Todo cliente" : "Quem é da mesma área da entrega local"} pode buscar o pedido de graça em: ${(enderecoDaLoja ?? "").trim()}`
              : alertaDoModo
                ? undefined
                : "Para oferecer a retirada, cadastre o endereço da loja em Minha loja — o cliente precisa saber onde buscar o pedido."
          }
        >
          {!temEndereco && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("admin-about-store")}
              className="flex min-h-11 shrink-0 items-center rounded-lg border border-solid border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
            >
              Cadastrar endereço em Minha loja
            </button>
          )}
        </Linha>
      )}
    </section>
  );
});
