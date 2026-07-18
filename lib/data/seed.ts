import { PedidoProjetado, PosicaoEstoque } from "@/lib/engine/types";
import { CD_ORIGEM_PADRAO, horizontePadrao } from "./defaults";

// Gerador determinístico (mulberry32) — mesma semente, mesma base de demonstração.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATS: [string, string, string, string][] = [
  ["MEDICAMENTO", "GENERICOS", "SIST. NERVOSO", "ANTICONVULSIVO"],
  ["MEDICAMENTO", "MARCA", "CARDIOLOGIA", "ANTI-HIPERTENSIVO"],
  ["MEDICAMENTO", "OTC", "VITAMINAS E MINERAIS", "MINERAIS"],
  ["NAO MEDICAMENTO", "DERMOCOSMETICO", "PROTETOR SOLAR", "FACIAL"],
  ["NAO MEDICAMENTO", "HIGIENE", "CABELO", "SHAMPOO"],
  ["MEDICAMENTO", "OTC", "GRIPE E RESFRIADO", "ANTIGRIPAL"],
  ["NAO MEDICAMENTO", "NUTRICAO", "SUPLEMENTOS", "PROTEINA"],
  ["MEDICAMENTO", "MARCA", "OFTALMICO", "ANTIBIOTICO"],
];
const FORNECEDORES = ["BALDACCI", "EUROFARMA", "MEDLEY", "EMS", "ACHE", "NEO QUIMICA", "SANOFI", "BAYER", "GSK", "HYPERA"];
const COMPRADORES = ["LUIZ AUGUSTO", "MARIA CLARA", "ROBERTO DIAS", "FERNANDA LUZ", "PAULO SERGIO"];
const ANALISTAS = ["AMANDA SILVA", "BRUNO COSTA", "CARLA MENDES", "DIEGO ROCHA", "ELISA NUNES"];
const PRODUTOS = ["FLAC", "COMP", "CAPS", "SOL", "SUSP", "GEL", "POM", "COL", "XPE", "SACHE"];

export interface BaseDemo {
  posicao: PosicaoEstoque[];
  pedidos: PedidoProjetado[];
}

/**
 * Base sintética de demonstração. Aproxima o perfil da base real (excesso
 * concentrado, mistura de giro, preços variados) sem versionar dados reais.
 */
export function gerarBaseDemo(nSkus = 4000, seed = 42): BaseDemo {
  const r = rng(seed);
  const meses = horizontePadrao();
  const cds = [1, 9, 2, 8, 7];
  const posicao: PosicaoEstoque[] = [];
  const pedidos: PedidoProjetado[] = [];

  for (let i = 0; i < nSkus; i++) {
    const codigo = 1000 + i;
    const cat = CATS[Math.floor(r() * CATS.length)];
    const vmed = Math.round(r() * r() * 300); // muitos itens de baixo giro
    const objetivo = Math.round(vmed * (0.5 + r() * 2));
    // ~65% dos SKUs com excesso
    const temExcesso = r() < 0.65;
    const disp = temExcesso
      ? objetivo + Math.round(vmed * (1 + r() * 6)) + Math.round(r() * 400)
      : Math.round(objetivo * r());
    const pend = Math.round(r() * vmed * 0.5);
    const custo = r() < 0.08 ? 0 : Math.round((2 + r() * 300) * 100) / 100; // ~8% com custo 0
    const lista = Math.round((custo || 5 + r() * 300) * (1.1 + r() * 0.6) * 100) / 100;
    const emb = r() < 0.05 ? 0 : [1, 1, 10, 12, 20, 24, 30, 60][Math.floor(r() * 8)];

    posicao.push({
      idSku: `${CD_ORIGEM_PADRAO}-${codigo}`,
      deposito: CD_ORIGEM_PADRAO,
      codigoProduto: codigo,
      produto: `${cat[3].split(" ")[0]} ${PRODUTOS[Math.floor(r() * PRODUTOS.length)]}/${[1, 12, 20, 30, 60][Math.floor(r() * 5)]}`,
      estoqueDisponivel: disp,
      estoqueObjetivo: objetivo,
      quantidadePendente: pend,
      vendaMedia3m: vmed,
      custoReposicao: custo,
      precoLista: lista,
      embCompra: emb,
      fornecedor: FORNECEDORES[Math.floor(r() * FORNECEDORES.length)],
      comprador: COMPRADORES[Math.floor(r() * COMPRADORES.length)],
      analista: ANALISTAS[Math.floor(r() * ANALISTAS.length)],
      categoriaN1: cat[0],
      categoriaN2: cat[1],
      categoriaN3: cat[2],
      categoriaN4: cat[3],
      flagAme: r() < 0.1 ? "AME" : "NÃO AME",
      monitorado: r() < 0.15 ? "S" : "N",
      marcaPropria: r() < 0.2 ? "S" : "N",
      leadTime: Math.round(15 + r() * 60),
    });

    // Pedidos projetados: nem todo SKU tem pedido em todo CD/mês.
    for (const m of meses) {
      for (const cd of cds) {
        if (r() < 0.35) {
          const p = Math.round(r() * Math.max(vmed, 20) * (0.5 + r()));
          if (p > 0) pedidos.push({ anoMes: m, cdDestino: cd, codigoProduto: codigo, pedido: p });
        }
      }
    }
  }
  return { posicao, pedidos };
}
