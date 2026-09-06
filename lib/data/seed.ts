import { LinhaBase, PedidoProjetado } from "@/lib/engine/types";
import { CDS_DEMO, horizontePadrao } from "./defaults";

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
const FORMAS = ["FLAC", "COMP", "CAPS", "SOL", "SUSP", "GEL", "POM", "COL", "XPE", "SACHE"];

export interface BaseDemo {
  base: LinhaBase[];
  pedidos: PedidoProjetado[];
  cds: number[];
}

/**
 * Base sintética de demonstração no formato NOVO: uma única base com todos os
 * CDs empilhados (cada CD é ao mesmo tempo candidato a origem e a destino).
 * Aproxima o perfil da base real — excesso concentrado em alguns CDs, falta em
 * outros, mistura de giro e de preços — sem versionar dados reais.
 */
export function gerarBaseDemo(nProdutos = 900, cds: number[] = CDS_DEMO): BaseDemo {
  const r = rng(20260906);
  const meses = horizontePadrao();
  const base: LinhaBase[] = [];
  const pedidos: PedidoProjetado[] = [];

  // Perfil de cada CD: quanto ele tende a ter de sobra (>1) ou de falta (<1).
  const perfil = new Map<number, number>();
  cds.forEach((cd, i) => perfil.set(cd, i === 0 ? 2.2 : 0.35 + 0.25 * ((i - 1) % 4)));

  for (let i = 0; i < nProdutos; i++) {
    const codigo = 3000 + i * 7;
    const cat = CATS[Math.floor(r() * CATS.length)];
    const nome = `${cat[3].slice(0, 8)} ${10 + Math.floor(r() * 900)}MG ${FORMAS[Math.floor(r() * FORMAS.length)]}`;
    const custo = Math.round((2 + r() * 180) * 100) / 100;
    const emb = [1, 6, 12, 24, 50][Math.floor(r() * 5)];
    const fornecedor = FORNECEDORES[Math.floor(r() * FORNECEDORES.length)];
    const comprador = COMPRADORES[Math.floor(r() * COMPRADORES.length)];
    const analista = ANALISTAS[Math.floor(r() * ANALISTAS.length)];

    for (const cd of cds) {
      const fator = perfil.get(cd)!;
      const venda = Math.round(r() * 900 * (cd === cds[0] ? 1.4 : 1));
      const objetivo = Math.round(venda * (1.1 + r() * 0.8));
      const disponivel = Math.max(0, Math.round(objetivo * fator * (0.5 + r())));
      const pendente = r() < 0.25 ? Math.round(objetivo * r() * 0.4) : 0;

      base.push({
        idSku: `${cd}-${codigo}`,
        cd,
        codigoProduto: codigo,
        produto: nome,
        estoqueDisponivel: disponivel,
        estoqueObjetivo: objetivo,
        quantidadePendente: pendente,
        vendaMedia3m: venda,
        custoReposicao: r() < 0.08 ? 0 : custo,
        precoLista: Math.round(custo * 1.35 * 100) / 100,
        embCompra: emb,
        fornecedor,
        comprador,
        analista,
        categoriaN1: cat[0],
        categoriaN2: cat[1],
        categoriaN3: cat[2],
        categoriaN4: cat[3],
        flagAme: r() < 0.15 ? "AME" : "",
        monitorado: r() < 0.1 ? "SIM" : "NAO",
        marcaPropria: cat[1] === "GENERICOS" && r() < 0.3 ? "SIM" : "NAO",
        leadTime: 7 + Math.floor(r() * 25),
      });

      // Pedidos projetados só para os CDs que tendem a comprar (perfil < 1).
      if (fator < 1) {
        for (const m of meses) {
          const q = Math.round(venda * (0.6 + r() * 0.9));
          if (q > 0) pedidos.push({ anoMes: m, cdDestino: cd, codigoProduto: codigo, pedido: q });
        }
      }
    }
  }

  return { base, pedidos, cds: [...cds] };
}
