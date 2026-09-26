// @ts-nocheck
// RELEASE 1.5.7 — cotação com VÁRIOS provedores ligados (ME + SuperFrete +
// Frenet), em paralelo, com a régua comum, o cache assinado e a revisão.
// Contrato: CONTRATO-1.5.7.md §1–3, §7 (R1), §8 (R2), §9 (R3).
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    bancoFalso,
    cabecalho,
    CARRINHO_P1,
    CONFIG_BASE as CONFIG_BASE_TESTE,
    corpoDe,
    cotacao,
    EMAIL_ME,
    EMAIL_SF,
    json,
    LINHA_FRENET,
    LINHA_ME,
    LINHA_SF,
    linhaLigados,
    linhasDoLog,
    PRODUTO_P1,
    RESPOSTA_FRENET_EXEMPLO,
    RESPOSTA_ME_REAL,
    RESPOSTA_SF_OFICIAL,
    rodar,
    TOKEN_FRENET,
    TOKEN_ME,
    TOKEN_SF,
} from "./apoio-dos-testes.ts"
import * as edge from "./index.ts"

const ME = "melhorenvio.com.br/api/v2/me/shipment/calculate"
const SF = "superfrete.com/api/v0/calculator"
const FRENET = "api.frenet.com.br/shipping/quote"
const chamadasPara = (chamadas: any[], trecho: string) => chamadas.filter((c) => c.url.includes(trecho))
const ids = (corpo: any) => corpo.options.map((o: any) => o.id)
const multi = (ligados: string[], extra: any[] = [], outras: any = {}) =>
    bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(ligados), ...extra], ...outras })

// ── Régua comum (pura) ──────────────────────────────────────────────────────

Deno.test("régua: preço aceita ponto ou vírgula, arredonda ao centavo; ausente/vazio/negativo/não numérico = null", () => {
    const p = (v: unknown, aceitaZero = true) => edge.precoDaApi(v, { aceitaZero })
    assertEquals(p("11.74"), 11.74)
    assertEquals(p("11,74"), 11.74)
    assertEquals(p(18.61), 18.61)
    assertEquals(p("21.456"), 21.46)
    assertEquals(p("0"), 0)
    assertEquals(p(0), 0)
    assertEquals(p("0", false), null)
    for (const ruim of ["", "  ", undefined, null, "-1", -1, "abc", "1.234,56", "R$ 10", true, Number.NaN, Number.POSITIVE_INFINITY, "Infinity"]) {
        assertEquals(p(ruim), null, JSON.stringify(ruim))
    }
})

Deno.test("régua: prazo inteiro >= mínimo; '0' vale 0 (canônico); ausente, fração, negativo = null", () => {
    assertEquals(edge.prazoDaApi("0", 0), 0)
    assertEquals(edge.prazoDaApi(3, 0), 3)
    assertEquals(edge.prazoDaApi(" 8 ", 0), 8)
    assertEquals(edge.prazoDaApi(0, 1), null)
    for (const ruim of [undefined, null, "", "-1", -1, "2.5", 2.5, "abc", true]) {
        assertEquals(edge.prazoDaApi(ruim, 0), null, JSON.stringify(ruim))
    }
})

Deno.test("régua: ServiceCode aparado, <= 100, sem caractere de controle (nenhum formato inventado)", () => {
    assertEquals(edge.codigoDeServicoValido("  03298 "), "03298")
    assertEquals(edge.codigoDeServicoValido("JTE_INT"), "JTE_INT")
    assertEquals(edge.codigoDeServicoValido("código com espaço e ç"), "código com espaço e ç")
    assertEquals(edge.codigoDeServicoValido(31), "31")
    assertEquals(edge.codigoDeServicoValido("x".repeat(100)), "x".repeat(100))
    for (const ruim of ["", "   ", "x".repeat(101), "a\nb", "a\u0000b", null, undefined, {}, true]) {
        assertEquals(edge.codigoDeServicoValido(ruim), null, JSON.stringify(ruim))
    }
})

Deno.test("nome: econômica/expressa SÓ para Correios PAC/SEDEX; o resto 'Transportadora — Serviço'", () => {
    assertEquals(edge.nomeDaOpcao("Correios", "PAC"), "Entrega econômica")
    assertEquals(edge.nomeDaOpcao("Correios", "SEDEX"), "Entrega expressa")
    assertEquals(edge.nomeDaOpcao("Loggi", "Express"), "Loggi — Express")
    assertEquals(edge.nomeDaOpcao("Jadlog", ".Package"), "Jadlog — .Package")
    assertEquals(edge.nomeDaOpcao("Correios", "Mini Envios"), "Correios — Mini Envios")
    assertEquals(edge.nomeDaOpcao("Correios", "SEDEX 10"), "Correios — SEDEX 10")
    assertEquals(edge.nomeDaOpcao("J&T Express", "Standard"), "J&T Express — Standard")
    assertEquals(edge.nomeDaOpcao("Azul Cargo Express", "Expresso"), "Azul Cargo Express — Expresso")
    // PAC de outra transportadora não vira "econômica".
    assertEquals(edge.nomeDaOpcao("Outra", "PAC"), "Outra — PAC")
})

// ── Conjunto ligado: legado × multi (§1 + R2-1) ─────────────────────────────

Deno.test("modo LEGADO (sem linha _ligados): só o shipping_provider cota — a SF da IKCOUS, sem chamar ME nem Frenet", async () => {
    const { resposta, corpo, chamadas } = await rodar(cotacao())
    assertEquals(resposta.status, 200)
    assertEquals(chamadasPara(chamadas, SF).length, 1)
    assertEquals(chamadasPara(chamadas, ME).length, 0)
    assertEquals(chamadasPara(chamadas, FRENET).length, 0)
    assert(corpo.options.every((o: any) => o.provider === "superfrete"))
    assertEquals(corpo.cotacaoParcial, false)
})

Deno.test("modo LEGADO com ME (SAVY): o filtro de NOME de hoje continua — Loggi e Jadlog saem com as chaves sedex/pac", async () => {
    const banco = bancoFalso({ config: { shipping_provider: "melhor_envio" }, credenciais: [LINHA_ME] })
    const { corpo, chamadas } = await rodar(cotacao(), { banco })
    assertEquals(ids(corpo), ["melhor-envio-1", "melhor-envio-2"])
    // Sem seleção salva não vai `services` (pede tudo e filtra por nome, como hoje).
    assertEquals("services" in corpoDe(chamadasPara(chamadas, ME)[0]), false)
})

Deno.test("modo MULTI: os três ligados cotam, as ofertas se somam, PAC de dois provedores aparece duas vezes", async () => {
    const { resposta, corpo, chamadas } = await rodar(cotacao(), { banco: multi(["melhor_envio", "superfrete", "frenet"]) })
    assertEquals(resposta.status, 200)
    for (const url of [ME, SF, FRENET]) assertEquals(chamadasPara(chamadas, url).length, 1, url)
    const provedores = new Set(corpo.options.map((o: any) => o.provider))
    assertEquals(provedores, new Set(["melhor_envio", "superfrete", "frenet"]))
    const pacs = corpo.options.filter((o: any) => o.name === "Entrega econômica")
    assert(pacs.length >= 2, "PAC do ME e da SF são ofertas diferentes")
    for (const o of corpo.options) {
        assertEquals(typeof o.transportadora, "string")
        assertEquals(typeof o.servico, "string")
        assert(["Melhor Envio", "SuperFrete", "Frenet"].includes(o.provedorRotulo))
    }
    assertEquals(corpo.cotacaoParcial, false)
    assertEquals(typeof corpo.revisaoConfig, "string")
})

Deno.test("modo MULTI: o shipping_provider (espelho) NÃO decide; provedor da lista sem linha com token fica de fora", async () => {
    const banco = bancoFalso({
        config: { shipping_provider: "melhor_envio" },
        credenciais: [{ ...LINHA_ME, credentials: { sandbox: false } }, LINHA_FRENET, linhaLigados(["melhor_envio", "frenet"])],
    })
    const { corpo, chamadas } = await rodar(cotacao(), { banco })
    assertEquals(chamadasPara(chamadas, ME).length, 0)
    assertEquals(chamadasPara(chamadas, FRENET).length, 1)
    assert(corpo.options.every((o: any) => o.provider === "frenet"))
})

Deno.test("modo MULTI com a lista vazia: nenhuma chamada, 200 sem opções e o motivo no histórico", async () => {
    const { resposta, corpo, chamadas, registro } = await rodar(cotacao(), { banco: multi([]) })
    assertEquals(resposta.status, 200)
    assertEquals(corpo.options, [])
    assertEquals(chamadas.length, 0)
    assertEquals(registro.logs.at(-1)?.status, "error")
})

// ── Paralelo, isolado, sem retry (A2) ───────────────────────────────────────

Deno.test("paralelo: o ME só responde DEPOIS que a SF foi chamada — em série, o ME nunca responderia", async () => {
    let sfChamada = false
    const { corpo } = await rodar(cotacao(), {
        banco: multi(["melhor_envio", "superfrete"]),
        rotas: {
            me: async () => {
                for (let i = 0; i < 50 && !sfChamada; i++) await new Promise((r) => setTimeout(r, 2))
                if (!sfChamada) throw new DOMException("em série", "AbortError")
                return json(RESPOSTA_ME_REAL)
            },
            sf: () => {
                sfChamada = true
                return json(RESPOSTA_SF_OFICIAL)
            },
        },
    })
    assert(corpo.options.some((o: any) => o.provider === "melhor_envio"))
    assertEquals(corpo.cotacaoParcial, false)
})

Deno.test("paralelo: cada chamada leva o seu AbortSignal e o tempo limite é 10 s", async () => {
    assertEquals(edge.TEMPO_LIMITE_DO_PROVEDOR_MS, 10000)
    const { chamadas } = await rodar(cotacao(), { banco: multi(["melhor_envio", "superfrete", "frenet"]) })
    for (const c of chamadas) assert(c.init.signal instanceof AbortSignal, c.url)
})

Deno.test("um provedor estoura o tempo e os outros respondem: 200 com o que voltou, cotacaoParcial, e a linha PARCIAL gravada", async () => {
    const { resposta, corpo, registro } = await rodar(cotacao(), {
        banco: multi(["melhor_envio", "superfrete", "frenet"]),
        rotas: { me: () => Promise.reject(new DOMException("The signal has been aborted", "AbortError")) },
    })
    assertEquals(resposta.status, 200)
    assertEquals(corpo.cotacaoParcial, true)
    assert(corpo.options.every((o: any) => o.provider !== "melhor_envio"))
    const gravada = registro.upsertsCache.at(-1).linha.options
    assert(gravada.length > 0)
    assert(gravada.every((o: any) => o.cotacaoParcial === true))
})

Deno.test("sem retry: ME com 500 é chamado UMA vez", async () => {
    const { chamadas } = await rodar(cotacao(), {
        banco: multi(["melhor_envio", "superfrete"]),
        rotas: { me: () => new Response("erro", { status: 500 }) },
    })
    assertEquals(chamadasPara(chamadas, ME).length, 1)
})

Deno.test("os três com erro -> 503, sem preço, log 'error' e nada no cache", async () => {
    const { resposta, corpo, registro } = await rodar(cotacao(), {
        banco: multi(["melhor_envio", "superfrete", "frenet"]),
        rotas: {
            me: () => new Response("erro", { status: 500 }),
            sf: () => Promise.reject(new TypeError("error sending request")),
            frenet: () => new Response("<html>", { status: 200 }),
        },
    })
    assertEquals(resposta.status, 503)
    assertEquals(corpo.options, undefined)
    assertEquals(registro.upsertsCache.length, 0)
    assertEquals(registro.logs.at(-1)?.status, "error")
})

// ── Insumos do banco (A2, R1-6) ─────────────────────────────────────────────

Deno.test("ME: corpo oficial com services=<ids> salvos, insurance_value = valor do BANCO (COALESCE da variação) e medidas pela régua", async () => {
    const banco = multi(["melhor_envio"], [], {
        produtos: [{ ...PRODUTO_P1, altura_cm: 0 }],
        variantes: [{ id: "v1", product_id: "p1", price_override: 79.9 }],
    })
    banco.credenciais[0].credentials = { token: TOKEN_ME, servicos: ["31", "1", "2"] }
    const { chamadas } = await rodar(cotacao({ cart: [{ product: { id: "p1", price: 1 }, variantId: "v1", quantity: 2 }] }), { banco })
    const pedido = corpoDe(chamadasPara(chamadas, ME)[0])
    assertEquals(pedido.from, { postal_code: "38500000" })
    assertEquals(pedido.to, { postal_code: "01001000" })
    assertEquals(pedido.services, "1,2,31")
    // Altura 0 no banco = padrão 15 só naquele campo; o preço do navegador (1) nunca entra.
    assertEquals(pedido.products, [{ id: "p1", width: 11, height: 15, length: 16, weight: 0.1, insurance_value: 79.9, quantity: 2 }])
    assertEquals(cabecalho(chamadasPara(chamadas, ME)[0], "Authorization"), `Bearer ${TOKEN_ME}`)
})

Deno.test("ME por id: a Loggi (31) aparece como 'Loggi — Express', PAC/SEDEX com os nomes de sempre, id com o seguro padrão sem sufixo", async () => {
    const banco = multi(["melhor_envio"])
    banco.credenciais[0].credentials = { token: TOKEN_ME, servicos: ["1", "2", "31", "17"] }
    const { corpo } = await rodar(cotacao(), { banco })
    const porId = new Map(corpo.options.map((o: any) => [o.id, o]))
    assertEquals(porId.get("melhor-envio-31")?.name, "Loggi — Express")
    assertEquals(porId.get("melhor-envio-31")?.price, 10.49)
    assertEquals(porId.get("melhor-envio-31")?.transportadora, "Loggi")
    assertEquals(porId.get("melhor-envio-31")?.provedorRotulo, "Melhor Envio")
    assertEquals(porId.get("melhor-envio-1")?.name, "Entrega econômica")
    assertEquals(porId.get("melhor-envio-2")?.name, "Entrega expressa")
    // Mini voltou com erro: só aquele serviço sai. Jadlog (3) não foi pedido.
    assertEquals(porId.has("melhor-envio-17"), false)
    assertEquals(porId.has("melhor-envio-3"), false)
    assertEquals(porId.get("melhor-envio-1")?.seguroDeclarado, 59.9)
})

Deno.test("ME 'sem_seguro': insurance_value 0 no pedido e o id ganha -ss (a etiqueta sabe pelo id)", async () => {
    const banco = multi(["melhor_envio"])
    banco.credenciais[0].credentials = { token: TOKEN_ME, servicos: ["31"], seguro: "sem_seguro" }
    const { corpo, chamadas } = await rodar(cotacao(), { banco })
    assertEquals(corpoDe(chamadasPara(chamadas, ME)[0]).products[0].insurance_value, 0)
    assertEquals(ids(corpo), ["melhor-envio-31-ss"])
    assertEquals(corpo.options[0].seguroDeclarado, 0)
})

Deno.test("ME: preço efetivo = custom_price (regra da conta), prazo = custom_delivery_time; 0 do ME vale (R1-5)", async () => {
    const banco = multi(["melhor_envio"])
    banco.credenciais[0].credentials = { token: TOKEN_ME, servicos: ["1", "2", "31"] }
    const { corpo } = await rodar(cotacao(), {
        banco,
        rotas: {
            me: () =>
                json([
                    { ...RESPOSTA_ME_REAL[0], price: "26.75", custom_price: "24.00", delivery_time: 10, custom_delivery_time: 12 },
                    { ...RESPOSTA_ME_REAL[1], price: "55.22", custom_price: "0" },
                    { ...RESPOSTA_ME_REAL[4], custom_price: undefined, custom_delivery_time: undefined, price: "10.49", delivery_time: 2 },
                ]),
        },
    })
    const porId = new Map(corpo.options.map((o: any) => [o.id, o]))
    assertEquals(porId.get("melhor-envio-1")?.price, 24)
    assertEquals(porId.get("melhor-envio-1")?.deliveryDays, 12)
    assertEquals(porId.get("melhor-envio-2")?.price, 0)
    assertEquals(porId.get("melhor-envio-31")?.price, 10.49)
})

Deno.test("preço do banco AUSENTE: ME e Frenet falham FECHADO (nem chamam), a SF (sem seguro) cota com os padrões de medida", async () => {
    const { resposta, corpo, chamadas } = await rodar(cotacao({ cart: [{ product: { id: "p-sumiu", price: 999 }, quantity: 1 }] }), {
        banco: multi(["melhor_envio", "superfrete", "frenet"]),
    })
    assertEquals(resposta.status, 200)
    assertEquals(chamadasPara(chamadas, ME).length, 0)
    assertEquals(chamadasPara(chamadas, FRENET).length, 0)
    assertEquals(corpoDe(chamadasPara(chamadas, SF)[0]).products, [{ quantity: 1, weight: 0.3, height: 15, width: 15, length: 15 }])
    assertEquals(corpo.cotacaoParcial, true)
})

Deno.test("variação pedida e não achada no banco = sem preço (nunca o preço base nem o do navegador)", async () => {
    const { chamadas } = await rodar(cotacao({ cart: [{ product: { id: "p1", price: 1 }, variantId: "v-sumiu", quantity: 1 }] }), {
        banco: multi(["frenet"]),
    })
    assertEquals(chamadasPara(chamadas, FRENET).length, 0)
})

// ── SuperFrete (R2-7, sem agrupamento) ──────────────────────────────────────

Deno.test("SF em LEGADO: mesmo corpo da 1.5.6 (services 1,2,17, sem seguro, products do banco) e UA 1.5.7", async () => {
    const { chamadas } = await rodar(cotacao())
    const [c] = chamadasPara(chamadas, SF)
    assertEquals(corpoDe(c), {
        from: { postal_code: "38500000" },
        to: { postal_code: "01001000" },
        services: "1,2,17",
        options: { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false },
        products: [{ quantity: 1, weight: 0.1, height: 6, width: 11, length: 16 }],
    })
    assertEquals(cabecalho(c, "User-Agent"), `IKCOUS Marketplace 1.5.7 (${EMAIL_SF})`)
    assertEquals(cabecalho(c, "Authorization"), `Bearer ${TOKEN_SF}`)
})

Deno.test("SF sem o agrupamento PAC×Mini: as duas ofertas vão na lista, com cotacaoSf 2 e 'Correios — Mini Envios'", async () => {
    const { corpo } = await rodar(cotacao())
    const porId = new Map(corpo.options.map((o: any) => [o.id, o]))
    assertEquals(porId.get("superfrete-1")?.name, "Entrega econômica")
    assertEquals(porId.get("superfrete-17")?.name, "Correios — Mini Envios")
    assertEquals(porId.get("superfrete-2")?.name, "Entrega expressa")
    assert(corpo.options.every((o: any) => o.cotacaoSf === 2))
})

Deno.test("SF com serviços salvos: services = a seleção (ordenada), e a guarda do id pedido continua", async () => {
    const banco = bancoFalso({ credenciais: [{ ...LINHA_SF, credentials: { ...LINHA_SF.credentials, servicos: ["17", "1"] } }] })
    const { corpo, chamadas } = await rodar(cotacao(), { banco })
    assertEquals(corpoDe(chamadasPara(chamadas, SF)[0]).services, "1,17")
    assertEquals(ids(corpo).sort(), ["superfrete-1", "superfrete-17"])
})

Deno.test("preço 0: SF DESCARTA (R2-7); ME e Frenet ACEITAM (R1-5) — um teste por provedor", async () => {
    const sf = await rodar(cotacao(), {
        rotas: { sf: () => json([{ ...RESPOSTA_SF_OFICIAL[0], price: 0 }, RESPOSTA_SF_OFICIAL[1]]) },
    })
    assertEquals(ids(sf.corpo), ["superfrete-2"])

    const bancoMe = multi(["melhor_envio"])
    bancoMe.credenciais[0].credentials = { token: TOKEN_ME, servicos: ["1"] }
    const me = await rodar(cotacao(), { banco: bancoMe, rotas: { me: () => json([{ ...RESPOSTA_ME_REAL[0], price: "0", custom_price: "0" }]) } })
    assertEquals(me.corpo.options.map((o: any) => [o.id, o.price]), [["melhor-envio-1", 0]])

    const fr = await rodar(cotacao(), {
        banco: multi(["frenet"]),
        rotas: {
            frenet: () =>
                json({
                    ShippingSevicesArray: [
                        // 0 com o Original > 0 (regra da loja zerou) e 0 SEM o Original: os dois valem (R1-5).
                        { ...RESPOSTA_FRENET_EXEMPLO.ShippingSevicesArray[3], ShippingPrice: "0", OriginalShippingPrice: "25.09" },
                        { ...RESPOSTA_FRENET_EXEMPLO.ShippingSevicesArray[4], ShippingPrice: "0", OriginalShippingPrice: undefined },
                    ],
                }),
        },
    })
    assertEquals(fr.corpo.options.map((o: any) => [o.id, o.price]), [["frenet-03298", 0], ["frenet-03220", 0]])
})

// ── Frenet ──────────────────────────────────────────────────────────────────

Deno.test("Frenet: filtro por ServiceCode salvo, id frenet-<código>, nomes, vírgula, e o valor declarado do BANCO", async () => {
    const banco = multi(["frenet"])
    banco.credenciais[2].credentials = { token: TOKEN_FRENET, servicos: ["JTE_INT", "F_3", "03298", "03220"] }
    const { corpo, chamadas } = await rodar(cotacao({ cart: [{ product: { id: "p1", price: 1 }, quantity: 2 }] }), { banco })
    const [c] = chamadasPara(chamadas, FRENET)
    assertEquals(cabecalho(c, "token"), TOKEN_FRENET)
    assertEquals(corpoDe(c), {
        SellerCEP: "38500000",
        RecipientCEP: "01001000",
        ShipmentInvoiceValue: 119.8,
        ShippingItemArray: [{ Weight: 0.1, Length: 16, Height: 6, Width: 11, Quantity: 2 }],
    })
    assertEquals(corpo.options.map((o: any) => [o.id, o.name, o.price, o.deliveryDays]), [
        ["frenet-JTE_INT", "J&T Express — Standard", 11.74, 3],
        ["frenet-F_3", "Jadlog — .Package", 13.43, 6],
        ["frenet-03298", "Entrega econômica", 25.09, 8],
        ["frenet-03220", "Entrega expressa", 52.13, 4],
    ])
    assert(corpo.options.every((o: any) => o.provedorRotulo === "Frenet"))
})

Deno.test("Frenet sem seleção salva: filtro de NOME de hoje (sedex/pac) — compatível", async () => {
    const { corpo } = await rodar(cotacao(), { banco: multi(["frenet"]) })
    assertEquals(ids(corpo), ["frenet-03298", "frenet-03220"])
})

Deno.test("Frenet: Error, preço vazio/negativo, código inválido e prazo ausente descartam SÓ aquele serviço; cobra ShippingPrice (não o Original)", async () => {
    const base = RESPOSTA_FRENET_EXEMPLO.ShippingSevicesArray[3]
    const banco = multi(["frenet"])
    banco.credenciais[2].credentials = { token: TOKEN_FRENET, servicos: ["A", "B", "C", "D", "E", "F", "G", " H "] }
    const { corpo } = await rodar(cotacao(), {
        banco,
        rotas: {
            frenet: () =>
                json({
                    ShippingSevicesArray: [
                        { ...base, ServiceCode: "A", Error: true, Msg: "Serviço indisponível para o trecho" },
                        { ...base, ServiceCode: "B", ShippingPrice: "" },
                        { ...base, ServiceCode: "C", ShippingPrice: "-5" },
                        { ...base, ServiceCode: "D", DeliveryTime: undefined },
                        { ...base, ServiceCode: "E", DeliveryTime: "0" },
                        { ...base, ServiceCode: "F", ShippingPrice: "20,00", OriginalShippingPrice: "30.00" },
                        { ...base, ServiceCode: "x".repeat(101) },
                        { ...base, ServiceCode: "  H  ", ShippingPrice: "9.9" },
                    ],
                }),
        },
    })
    assertEquals(corpo.options.map((o: any) => [o.id, o.price, o.deliveryDays]), [
        ["frenet-E", 25.09, 0],
        ["frenet-F", 20, 8],
        ["frenet-H", 9.9, 8],
    ])
})

Deno.test("prazo 0 é CANÔNICO (R1-4): o app antigo (sem contratoCliente) e o novo recebem 0, e o cache guarda 0", async () => {
    const zero = () => json({ ShippingSevicesArray: [{ ...RESPOSTA_FRENET_EXEMPLO.ShippingSevicesArray[3], DeliveryTime: "0" }] })
    for (const extra of [{ contratoCliente: undefined }, { contratoCliente: 3 }]) {
        const { corpo, registro } = await rodar(cotacao(extra), { banco: multi(["frenet"]), rotas: { frenet: zero } })
        assertEquals(corpo.options[0].deliveryDays, 0)
        assertEquals(registro.upsertsCache.at(-1).linha.options[0].deliveryDays, 0)
    }
})

// ── Cache: assinatura, revisão e parcial (§3, R1-1, R3) ─────────────────────

Deno.test("cache: a credencial é lida ANTES do cache, e a segunda conta do MESMO carrinho é servida sem chamar ninguém", async () => {
    const banco = multi(["melhor_envio", "superfrete"])
    const primeira = await rodar(cotacao(), { banco })
    const eventos = primeira.registro.eventos
    assert(eventos.indexOf("select:store_shipping_credentials") < eventos.indexOf("select:shipping_quotes_cache"))
    const segunda = await rodar(cotacao(), { banco })
    assertEquals(segunda.chamadas.length, 0)
    assertEquals(segunda.corpo.options, primeira.corpo.options)
    assertEquals(segunda.corpo.revisaoConfig, primeira.corpo.revisaoConfig)
    // O cart_hash não muda (a RPC o desmonta).
    assertEquals(primeira.registro.upsertsCache[0].linha.cart_hash, edge.getCartHash(CARRINHO_P1))
})

Deno.test("cache: linha PARCIAL é gravada mas NUNCA servida — a próxima conta recota", async () => {
    const banco = multi(["melhor_envio", "superfrete"])
    await rodar(cotacao(), { banco, rotas: { me: () => new Response("x", { status: 500 }) } })
    assert(banco.registro.cacheLinhas[0].options.every((o: any) => o.cotacaoParcial === true))
    const depois = await rodar(cotacao(), { banco })
    assertEquals(chamadasPara(depois.chamadas, ME).length, 1)
    assertEquals(depois.corpo.cotacaoParcial, false)
})

Deno.test("cache: linha antiga (sem assinatura) é falta — recota uma vez e sobrescreve a mesma chave", async () => {
    const antiga = [{ id: "superfrete-1", name: "Entrega econômica", price: 18.61, deliveryDays: 5, provider: "superfrete", cotacaoSf: 2 }]
    const { chamadas, registro } = await rodar(cotacao(), { banco: bancoFalso({ cache: [{ options: antiga }] }) })
    assertEquals(chamadasPara(chamadas, SF).length, 1)
    assertEquals(registro.upsertsCache[0].onConflict, "origin_cep,destination_cep,cart_hash")
})

const estadoBase = () => ({
    config: { ...CONFIG_BASE_TESTE },
    credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(["superfrete"])].map((l) => structuredClone(l)),
    produtos: [{ ...PRODUTO_P1 }],
})

Deno.test("cache: controle — nada mudou, a segunda conta é servida sem chamar a SF", async () => {
    const estado = estadoBase()
    const b1 = bancoFalso(estado)
    await rodar(cotacao(), { banco: b1 })
    const b2 = bancoFalso({ ...structuredClone(estado), cache: b1.registro.cacheLinhas })
    const segunda = await rodar(cotacao(), { banco: b2 })
    assertEquals(segunda.chamadas.length, 0)
})

for (
    const [rotulo, mudar, mudaRevisao] of [
        ["preço do produto no cadastro", (e: any) => e.produtos[0].preco_venda = 79.9, false],
        ["medida do produto no cadastro", (e: any) => e.produtos[0].altura_cm = 4, false],
        ["serviços salvos", (e: any) => e.credenciais[1].credentials.servicos = ["1"], true],
        ["updated_at da credencial (chave trocada)", (e: any) => e.credenciais[1].updated_at = "2026-09-23T09:00:00.000Z", true],
        ["métodos da loja", (e: any) => e.config.enabled_shipping_methods = ["sedex"], true],
        ["origem da loja", (e: any) => e.config.origin_cep = "38400-000", true],
        ["conjunto ligado", (e: any) => e.credenciais[3].credentials.ligados = ["superfrete", "melhor_envio"], true],
        ["revisão das credenciais", (e: any) => e.credenciais.push({ provider: "_revisao", credentials: { revisao: "uuid-novo" }, updated_at: "x" }), true],
    ] as const
) {
    Deno.test(`cache: mudar ${rotulo} dentro do TTL invalida a linha (assinatura/revisão)`, async () => {
        const estado = estadoBase()
        const b1 = bancoFalso(estado)
        const primeira = await rodar(cotacao(), { banco: b1 })
        const mudado = structuredClone(estado)
        mudar(mudado)
        const b2 = bancoFalso({ ...mudado, cache: b1.registro.cacheLinhas })
        const segunda = await rodar(cotacao(), { banco: b2 })
        assertEquals(chamadasPara(segunda.chamadas, SF).length, 1, rotulo)
        if (mudaRevisao) assertNotEquals(segunda.corpo.revisaoConfig, primeira.corpo.revisaoConfig, rotulo)
        else assertEquals(segunda.corpo.revisaoConfig, primeira.corpo.revisaoConfig, rotulo)
    })
}

Deno.test("revisão: cada opção nacional leva revisaoCredenciais (o uuid lido de _revisao, ou null sem a linha)", async () => {
    const sem = await rodar(cotacao())
    assert(sem.corpo.options.every((o: any) => o.revisaoCredenciais === null))
    const banco = bancoFalso({ credenciais: [LINHA_SF, { provider: "_revisao", credentials: { revisao: "rev-A" }, updated_at: "t" }] })
    const com = await rodar(cotacao(), { banco })
    assert(com.corpo.options.every((o: any) => o.revisaoCredenciais === "rev-A"))
    assert(com.registro.upsertsCache[0].linha.options.every((o: any) => o.revisaoCredenciais === "rev-A"))
    // _revisao é lida ANTES da config e das credenciais.
    const ev = com.registro.eventos
    assert(ev.indexOf("select:store_shipping_credentials") < ev.indexOf("select:store_config"))
})

Deno.test("revisão mudou DURANTE a cotação: não grava, recota UMA vez e grava com a revisão nova", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_SF, { provider: "_revisao", credentials: { revisao: "rev-A" }, updated_at: "t" }] })
    let chamadasSf = 0
    const { corpo, registro } = await rodar(cotacao(), {
        banco,
        rotas: {
            sf: () => {
                chamadasSf += 1
                if (chamadasSf === 1) banco.credenciais[1].credentials.revisao = "rev-B"
                return json(RESPOSTA_SF_OFICIAL)
            },
        },
    })
    assertEquals(chamadasSf, 2)
    assertEquals(registro.upsertsCache.length, 1)
    assert(registro.upsertsCache[0].linha.options.every((o: any) => o.revisaoCredenciais === "rev-B"))
    assert(corpo.options.every((o: any) => o.revisaoCredenciais === "rev-B"))
})

Deno.test("revisão mudou DE NOVO na recotação: sem gravar, sem opções nacionais, cotacaoIncompleta e o log configuracao_mudou_durante_cotacao", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_SF, { provider: "_revisao", credentials: { revisao: "rev-0" }, updated_at: "t" }] })
    let n = 0
    const { resposta, corpo, registro, saida } = await rodar(cotacao(), {
        banco,
        rotas: {
            sf: () => {
                n += 1
                banco.credenciais[1].credentials.revisao = `rev-${n}`
                return json(RESPOSTA_SF_OFICIAL)
            },
        },
    })
    assertEquals(n, 2)
    assertEquals(registro.upsertsCache.length, 0)
    assertEquals(corpo.options, undefined)
    assertEquals(corpo.cotacaoIncompleta, true)
    assertEquals(resposta.status, 503)
    assert(saida.includes("configuracao_mudou_durante_cotacao"))
    assert(String(registro.logs.at(-1)?.error_message).includes("configuracao_mudou_durante_cotacao"))
})

// ── Log estruturado (uma linha por provedor) ────────────────────────────────

Deno.test("log: UMA linha JSON por provedor, com códigos, preços, erro e cache — sem token, e-mail, CEP, nome nem Msg", async () => {
    const banco = multi(["melhor_envio", "superfrete", "frenet"])
    banco.credenciais[2].credentials = { token: TOKEN_FRENET, servicos: ["JTE_INT", "04227"] }
    const { saida } = await rodar(cotacao(), {
        banco,
        rotas: {
            frenet: () =>
                json({
                    ShippingSevicesArray: [
                        ...RESPOSTA_FRENET_EXEMPLO.ShippingSevicesArray,
                        { Carrier: "X", ServiceCode: "ERR", Error: true, Msg: "CEP 01001-000 da cliente Nome-Secreto-XYZ fora da área" },
                    ],
                }),
        },
    })
    const linhas = linhasDoLog(saida)
    assertEquals(linhas.length, 3)
    assertEquals(new Set(linhas.map((l) => l.provedor)), new Set(["melhor_envio", "superfrete", "frenet"]))
    const frenet = linhas.find((l) => l.provedor === "frenet")
    assertEquals(frenet.servicos_pedidos, ["JTE_INT", "04227"])
    assertEquals(frenet.cache, "miss")
    assertEquals(frenet.precos_mudados_pela_regra, 1)
    assert(frenet.retornados.some((r: any) => r.codigo === "ERR" && r.erro === true))
    for (const linha of linhas) {
        const texto = JSON.stringify(linha)
        for (const proibido of [TOKEN_ME, TOKEN_SF, TOKEN_FRENET, EMAIL_SF, EMAIL_ME, "Nome-Secreto-XYZ", "fora da área"]) {
            assertEquals(texto.includes(proibido), false, proibido)
        }
        assertEquals(/\b\d{5}-?\d{3}\b/.test(texto), false, texto)
    }
    for (const segredo of [TOKEN_ME, TOKEN_SF, TOKEN_FRENET, EMAIL_ME]) assertEquals(saida.includes(segredo), false)
})

Deno.test("log: provedor que falhou também deixa a sua linha (resultado 'falha'), e o acerto do cache deixa 'hit'", async () => {
    const banco = multi(["melhor_envio", "superfrete"])
    const { saida } = await rodar(cotacao(), { banco, rotas: { me: () => new Response("x", { status: 500 }) } })
    const me = linhasDoLog(saida).find((l) => l.provedor === "melhor_envio")
    assertEquals(me.resultado, "falha")
    const bancoOk = multi(["superfrete"])
    await rodar(cotacao(), { banco: bancoOk })
    const hit = await rodar(cotacao(), { banco: bancoOk })
    assertEquals(linhasDoLog(hit.saida).map((l) => [l.provedor, l.cache]), [["superfrete", "hit"]])
})

// ── Local e retirada (regressão em modo multi) ──────────────────────────────

Deno.test("modo MULTI com destino LOCAL: só a entrega local (e a retirada), nenhuma transportadora chamada", async () => {
    const banco = multi(["melhor_envio", "superfrete", "frenet"], [], {
        config: { local_cep_range: "01001", enabled_shipping_methods: ["sedex", "pac", "store-pickup"] },
        enderecoDaLoja: "Rua Fictícia, 1",
    })
    const { corpo, chamadas } = await rodar(cotacao({ aceitaRetirada: true }), { banco })
    assertEquals(chamadas.length, 0)
    assertEquals(ids(corpo), ["local-delivery", "store-pickup"])
})

Deno.test("resposta da cotação traz revisaoConfig igual à da ação pública revisao_config_frete, sem token nenhum", async () => {
    const banco = multi(["melhor_envio", "superfrete", "frenet"])
    const cot = await rodar(cotacao(), { banco })
    const rev = await rodar({ action: "revisao_config_frete" }, { banco, admin: false })
    assertEquals(rev.resposta.status, 200)
    assertEquals(Object.keys(rev.corpo), ["revisaoConfig"])
    assertEquals(rev.corpo.revisaoConfig, cot.corpo.revisaoConfig)
    assertEquals(rev.chamadas.length, 0)
    for (const segredo of [TOKEN_ME, TOKEN_SF, TOKEN_FRENET]) assertEquals(rev.texto.includes(segredo), false)
})

// ── Revisão Opus: defesa na cotação pública — Sandbox ligado NÃO cota (multi) ──

Deno.test("modo MULTI: ligado com credencial sandbox:true (gravada por fora) NÃO é chamado; vira falha 'sandbox' no log e os outros seguem (parcial)", async () => {
    const banco = bancoFalso({
        credenciais: [
            { ...LINHA_ME, credentials: { ...LINHA_ME.credentials, sandbox: true } },
            LINHA_SF,
            LINHA_FRENET,
            linhaLigados(["melhor_envio", "superfrete"]),
        ],
    })
    const { resposta, corpo, chamadas, saida } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(chamadasPara(chamadas, "melhorenvio").length, 0)
    assertEquals(chamadasPara(chamadas, SF).length, 1)
    assert(ids(corpo).every((id: string) => id.startsWith("superfrete-")), JSON.stringify(ids(corpo)))
    assertEquals(corpo.cotacaoParcial, true)
    const me = linhasDoLog(saida).find((l) => l.provedor === "melhor_envio")
    assertEquals([me.resultado, me.motivo], ["falha", "sandbox"])
    assertEquals(saida.includes(TOKEN_ME), false)
})

Deno.test("modo MULTI: o ÚNICO ligado em Sandbox -> nenhuma chamada, 503 como 'todos falharam'", async () => {
    const banco = bancoFalso({
        credenciais: [{ ...LINHA_ME, credentials: { ...LINHA_ME.credentials, sandbox: true } }, LINHA_SF, linhaLigados(["melhor_envio"])],
    })
    const { resposta, chamadas, saida } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 503)
    assertEquals(chamadas.length, 0)
    assertEquals(linhasDoLog(saida).map((l) => [l.provedor, l.motivo]), [["melhor_envio", "sandbox"]])
})

Deno.test("modo LEGADO com Sandbox: comportamento da 1.5.6 (cota no sandbox) — a defesa é só do multi", async () => {
    const banco = bancoFalso({ credenciais: [{ ...LINHA_SF, credentials: { ...LINHA_SF.credentials, sandbox: true } }] })
    const { resposta, chamadas } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(chamadas.map((c) => c.url), ["https://sandbox.superfrete.com/api/v0/calculator"])
})

// ── Estratégia do frete NACIONAL (23/09/2026, T2) ───────────────────────────
//
// `cotacao()` cota para "01001-000" (fora de "38500-000" — sempre NACIONAL);
// chaves padrão [sedex,pac] dão à SuperFrete PAC 18,61 + SEDEX 10,77 + Mini
// 13,00 (id superfrete-1/2/17, a mesma tabela usada nos testes de cima). O
// subtotal do carrinho padrão (`PRODUTO_P1.preco_venda` 59,90 × 1) é o que
// decide `acima_de_valor`/`desconto_na_mais_barata` — NUNCA o `price` que o
// carrinho manda (`CARRINHO_P1` manda `price: 1`, a mentira do navegador).
const nacional = (colunas: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    multi(["superfrete"], [], { config: { ...colunas }, ...extra })
const colunasNacionais = (parcial: Record<string, unknown>) => ({
    national_shipping_strategy: "desligado",
    national_shipping_min: 0,
    national_discount_type: null,
    national_discount_value: 0,
    national_benefit_scope: "todas",
    ...parcial,
})
const PRODUTO_P1_MARCADO = { ...PRODUTO_P1, frete_gratis: true }

Deno.test("nacional: 'sempre' + alcance 'todas' zera TODAS as opções e o cache grava price/precoCheio/carimbo", async () => {
    const banco = nacional(colunasNacionais({ national_shipping_strategy: "sempre" }))
    const { resposta, corpo, registro } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo).sort(), ["superfrete-1", "superfrete-17", "superfrete-2"])
    assert(corpo.options.every((o: any) => o.price === 0))
    assert(corpo.options.every((o: any) => o.precoCheio > 0))
    assert(corpo.options.every((o: any) => o.estrategiaNacional?.estrategia === "sempre"))
    const gravada = registro.upsertsCache.at(-1).linha.options
    assertEquals(gravada.map((o: any) => o.price), corpo.options.map((o: any) => o.price))
    assertEquals(gravada.map((o: any) => o.precoCheio), corpo.options.map((o: any) => o.precoCheio))
    assert(gravada.every((o: any) => o.estrategiaNacional?.estrategia === "sempre"))
})

Deno.test("nacional: banco SEM as 5 colunas — preço CHEIO, SEM carimbo, resposta idêntica à de antes desta mudança", async () => {
    const banco = multi(["superfrete"]) // CONFIG_BASE puro — nenhuma coluna nacional
    const { resposta, corpo } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(
        corpo.options.map((o: any) => [o.id, o.price]).sort(),
        [["superfrete-1", 18.61], ["superfrete-17", 13], ["superfrete-2", 10.77]],
    )
    assert(corpo.options.every((o: any) => !("estrategiaNacional" in o)))
    assert(corpo.options.every((o: any) => !("precoCheio" in o)))
})

Deno.test("nacional: erro REAL do PostgREST (42703) na leitura das 5 colunas — mesmo tratamento de coluna ausente: cheio, sem carimbo, revisão igual", async () => {
    const bancoComErro = nacional(colunasNacionais({ national_shipping_strategy: "sempre" }), { falhas: { colunasNacionais: true } })
    const { resposta, corpo } = await rodar(cotacao(), { banco: bancoComErro })
    assertEquals(resposta.status, 200)
    assert(corpo.options.every((o: any) => o.price > 0)) // NÃO zerou — a estratégia 'sempre' não foi aplicada
    assert(corpo.options.every((o: any) => !("estrategiaNacional" in o)))
    assert(corpo.options.every((o: any) => !("precoCheio" in o)))

    const bancoSemColunas = multi(["superfrete"]) // CONFIG_BASE puro
    const semColunas = await rodar(cotacao(), { banco: bancoSemColunas })
    assertEquals(corpo.revisaoConfig, semColunas.corpo.revisaoConfig)
})

Deno.test("nacional: item SEM cadastro no carrinho (produtosSemCadastro > 0) — subtotal não confiável: NÃO aplica a estratégia, NÃO carimba", async () => {
    // `cotacao()` manda o carrinho padrão (produto 'p1'); sem NENHUM produto
    // cadastrado no banco falso, todo item vira "sem cadastro".
    const banco = nacional(colunasNacionais({ national_shipping_strategy: "sempre" }), { produtos: [] })
    const { resposta, corpo } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assert(corpo.options.length > 0, JSON.stringify(corpo))
    assert(corpo.options.every((o: any) => o.price > 0), JSON.stringify(corpo.options))
    assert(corpo.options.every((o: any) => !("estrategiaNacional" in o)))
    assert(corpo.options.every((o: any) => !("precoCheio" in o)))
})

Deno.test("nacional: mudar a estratégia muda o revisaoConfig (mesma loja, mesmo carrinho)", async () => {
    const bancoDesligado = nacional(colunasNacionais({}))
    const bancoSempre = nacional(colunasNacionais({ national_shipping_strategy: "sempre" }))
    const desligado = await rodar(cotacao(), { banco: bancoDesligado })
    const sempre = await rodar(cotacao(), { banco: bancoSempre })
    assertNotEquals(desligado.corpo.revisaoConfig, sempre.corpo.revisaoConfig)
})

Deno.test("nacional: acima_de_valor usa o SUBTOTAL DO BANCO (59,90), nunca o price que o carrinho manda (1)", async () => {
    const bacima = nacional(colunasNacionais({ national_shipping_strategy: "acima_de_valor", national_shipping_min: 50 }))
    const abaixo = nacional(colunasNacionais({ national_shipping_strategy: "acima_de_valor", national_shipping_min: 100 }))
    const { corpo: corpoAcima } = await rodar(cotacao(), { banco: bacima })
    const { corpo: corpoAbaixo } = await rodar(cotacao(), { banco: abaixo })
    assert(corpoAcima.options.every((o: any) => o.price === 0), JSON.stringify(corpoAcima.options))
    assert(corpoAbaixo.options.every((o: any) => o.price === o.precoCheio), JSON.stringify(corpoAbaixo.options))
})

Deno.test("nacional: por_produto INDEPENDENTE do local — local desligado (free_shipping_min=0) + nacional por_produto: CEP fora vira free-shipping-promo, CEP local paga a taxa cheia", async () => {
    const banco = nacional(colunasNacionais({ national_shipping_strategy: "por_produto" }), { produtos: [PRODUTO_P1_MARCADO] })
    const fora = await rodar(cotacao(), { banco })
    assertEquals(ids(fora.corpo), ["free-shipping-promo"])
    assertEquals(fora.corpo.options[0].price, 0)

    const localBanco = nacional(colunasNacionais({ national_shipping_strategy: "por_produto" }), { produtos: [PRODUTO_P1_MARCADO] })
    const local = await rodar(cotacao({ cep: "38500-120" }), { banco: localBanco })
    assertEquals(ids(local.corpo), ["local-delivery"])
    assertEquals(local.corpo.options[0].price, 10)
})

Deno.test("nacional: por_produto INDEPENDENTE do local — local por_produto (free_shipping_min=-1) + nacional desligado: CEP local grátis, CEP fora cota de verdade (sem free-shipping-promo)", async () => {
    const colunas = colunasNacionais({}) // desligado
    const localBanco = nacional({ ...colunas, free_shipping_min: -1 }, { produtos: [PRODUTO_P1_MARCADO] })
    const local = await rodar(cotacao({ cep: "38500-120" }), { banco: localBanco })
    assertEquals(ids(local.corpo), ["local-delivery"])
    assertEquals(local.corpo.options[0].price, 0)

    const foraBanco = nacional({ ...colunas, free_shipping_min: -1 }, { produtos: [PRODUTO_P1_MARCADO] })
    const fora = await rodar(cotacao(), { banco: foraBanco })
    assertEquals(ids(fora.corpo).sort(), ["superfrete-1", "superfrete-17", "superfrete-2"])
    assert(fora.corpo.options.every((o: any) => o.price === o.precoCheio && o.precoCheio > 0))
    assert(fora.corpo.options.every((o: any) => o.estrategiaNacional?.estrategia === "desligado"))
})

Deno.test("nacional: cotação PARCIAL preserva o desconto (só na mais barata das que sobreviveram)", async () => {
    const banco = multi(["melhor_envio", "superfrete"], [], {
        config: colunasNacionais({ national_shipping_strategy: "desconto_na_mais_barata", national_discount_type: "fixo", national_discount_value: 5 }),
    })
    const { resposta, corpo } = await rodar(cotacao(), {
        banco,
        rotas: { me: () => Promise.reject(new DOMException("The signal has been aborted", "AbortError")) },
    })
    assertEquals(resposta.status, 200)
    assertEquals(corpo.cotacaoParcial, true)
    assert(corpo.options.every((o: any) => o.provider !== "melhor_envio"))
    assert(corpo.options.every((o: any) => o.estrategiaNacional?.estrategia === "desconto_na_mais_barata"))
    // SF sozinha: SEDEX (10,77) é a mais barata — só ela desconta 5.
    const sedex = corpo.options.find((o: any) => o.id === "superfrete-2")
    const pac = corpo.options.find((o: any) => o.id === "superfrete-1")
    assertEquals(sedex.price, 5.77)
    assertEquals(pac.price, pac.precoCheio)
})
