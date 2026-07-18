import { describe, expect, it } from "vitest";
import {
  calcular,
  cascataCumsum,
  cobertura,
  excessoTransferivel,
  indexarPedidos,
  precoUnitario,
} from "./calc";
import { Parametros, PedidoProjetado, PosicaoEstoque } from "./types";

// Cascata de referência ITERATIVA (pseudocódigo original) para cruzar com a
// implementação vetorizada por cumsum.
function cascataIterativa(pedidos: number[], excesso: number): number[] {
  let saldo = excesso;
  return pedidos.map((p) => {
    const t = Math.min(p, saldo);
    saldo -= t;
    return t;
  });
}

const MESES = ["2026_07", "2026_08", "2026_09"];
const CDS = [1, 9, 2, 8, 7];

const paramsBase: Parametros = {
  cdOrigem: 10,
  prioridadeCds: CDS,
  horizonteMeses: MESES,
  aliquotaFiscal: { 1: 0.052, 9: 0.015 }, // CD2/8/7 indefinidos
  fatorSegurancaImediata: 0.5,
  limiteCoberturaDias: 90,
};

function sku(p: Partial<PosicaoEstoque>): PosicaoEstoque {
  return {
    idSku: "10-1",
    deposito: 10,
    codigoProduto: 1,
    produto: "PROD",
    estoqueDisponivel: 0,
    estoqueObjetivo: 0,
    quantidadePendente: 0,
    vendaMedia3m: 0,
    custoReposicao: 0,
    precoLista: 0,
    embCompra: 0,
    fornecedor: "F",
    comprador: "C",
    analista: "A",
    categoriaN1: "",
    categoriaN2: "",
    categoriaN3: "",
    categoriaN4: "",
    ...p,
  };
}

describe("preço de valorização (REGRA 1)", () => {
  it("usa custo de reposição quando != 0", () => {
    expect(precoUnitario(sku({ custoReposicao: 10, precoLista: 99 }))).toBe(10);
  });
  it("cai para preço de lista quando custo == 0", () => {
    expect(precoUnitario(sku({ custoReposicao: 0, precoLista: 99 }))).toBe(99);
  });
});

describe("excesso transferível (REGRA 2)", () => {
  it("soma pendente, protege venda média e objetivo", () => {
    // 100 + 20 - 30 - 40 = 50
    expect(excessoTransferivel(sku({ estoqueDisponivel: 100, quantidadePendente: 20, vendaMedia3m: 30, estoqueObjetivo: 40 }))).toBe(50);
  });
  it("nunca negativo", () => {
    expect(excessoTransferivel(sku({ estoqueDisponivel: 10, estoqueObjetivo: 100 }))).toBe(0);
  });
});

describe("cascata vetorizada == iterativa", () => {
  const casos: [number[], number][] = [
    [[30, 160, 250, 0, 0], 74], // exemplo real (SKU 10-3858): cobre só o CD1 de julho
    [[10, 20, 30, 40, 50], 55],
    [[0, 0, 0, 0, 0], 100],
    [[100, 100], 0],
    [[5, 5, 5], 12],
    [[1000], 999.5],
  ];
  it.each(casos)("pedidos=%j excesso=%d", (pedidos, excesso) => {
    expect(cascataCumsum(pedidos, excesso)).toEqual(cascataIterativa(pedidos, excesso));
  });

  it("reproduz o exemplo da planilha (10-3858): 74 unidades só no CD1 de julho", () => {
    // pedidos julho: CD1=30, CD9=160, CD2=250; excesso=74 -> transf CD1=30, CD9=44
    const t = cascataCumsum([30, 160, 250, 0, 0], 74);
    expect(t).toEqual([30, 44, 0, 0, 0]);
    expect(t.reduce((a, b) => a + b, 0)).toBe(74); // sem sobra
  });
});

describe("cobertura (REGRA 7)", () => {
  it("venda zero com estoque => sem giro (9999)", () => {
    const c = cobertura(sku({ estoqueDisponivel: 100, vendaMedia3m: 0 }), 90);
    expect(c.dias).toBe(9999);
    expect(c.status).toBe("Sem giro");
  });
  it("venda zero sem estoque => 0", () => {
    expect(cobertura(sku({ estoqueDisponivel: 0, vendaMedia3m: 0 }), 90).dias).toBe(0);
  });
  it("classifica acima de 90 dias", () => {
    // (300+0)*30/30 = 300 dias
    const c = cobertura(sku({ estoqueDisponivel: 300, vendaMedia3m: 30 }), 90);
    expect(c.dias).toBe(300);
    expect(c.status).toBe("Acima de 90 dias");
  });
});

describe("motor completo — invariante de reconciliação", () => {
  it("soma(transf) + sobra final == excesso para todo SKU", () => {
    const posicao: PosicaoEstoque[] = Array.from({ length: 50 }, (_, i) =>
      sku({
        idSku: `10-${i}`,
        codigoProduto: i,
        estoqueDisponivel: (i * 37) % 500,
        quantidadePendente: (i * 13) % 100,
        vendaMedia3m: (i * 7) % 60,
        estoqueObjetivo: (i * 11) % 80,
        custoReposicao: 1 + (i % 5),
        embCompra: (i % 4) + 1,
      }),
    );
    const pedidos: PedidoProjetado[] = [];
    for (const m of MESES)
      for (const cd of CDS)
        for (let i = 0; i < 50; i++)
          pedidos.push({ anoMes: m, cdDestino: cd, codigoProduto: i, pedido: (i * cd * (m.endsWith("07") ? 3 : 1)) % 90 });
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    expect(res.reconciliacao.invarianteOk).toBe(true);
    expect(res.reconciliacao.maiorDivergencia).toBeLessThan(1e-6);
  });
});

describe("casos de borda", () => {
  it("preço zero cai para lista e ainda valoriza", () => {
    const posicao = [sku({ estoqueDisponivel: 100, custoReposicao: 0, precoLista: 10, embCompra: 10 })];
    const pedidos: PedidoProjetado[] = [{ anoMes: MESES[0], cdDestino: 1, codigoProduto: 1, pedido: 40 }];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    expect(res.linhas[0].precoUnitario).toBe(10);
    expect(res.linhas[0].valorTransfMes[0]).toBe(400);
  });

  it("emb_compra zero => caixas zero, sem crash", () => {
    const posicao = [sku({ estoqueDisponivel: 100, custoReposicao: 5, embCompra: 0 })];
    const pedidos: PedidoProjetado[] = [{ anoMes: MESES[0], cdDestino: 1, codigoProduto: 1, pedido: 40 }];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    expect(res.linhas[0].transfCaixasMes[0]).toBe(0);
    expect(res.linhas[0].imediataCaixas).toBe(0);
    expect(res.linhas[0].qtdImediataArredondada).toBe(0);
  });

  it("SKU sem pedido em nenhum CD => nenhuma linha, mas conta no excesso", () => {
    const posicao = [sku({ estoqueDisponivel: 100, custoReposicao: 5 })];
    const res = calcular(posicao, indexarPedidos([]), paramsBase);
    expect(res.linhas.length).toBe(0);
    expect(res.meta.excessoTotalRs).toBe(500);
  });

  it("excesso menor que o primeiro pedido => transferência parcial e sobra zero", () => {
    const posicao = [sku({ estoqueDisponivel: 20, custoReposicao: 1 })];
    const pedidos: PedidoProjetado[] = [{ anoMes: MESES[0], cdDestino: 1, codigoProduto: 1, pedido: 100 }];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    expect(res.linhas[0].transfMes[0]).toBe(20); // limitado pelo excesso
  });

  it("sobra integral no mês 3 (sem demanda nos meses 1 e 2)", () => {
    const posicao = [sku({ estoqueDisponivel: 100, custoReposicao: 1 })];
    const pedidos: PedidoProjetado[] = [{ anoMes: MESES[2], cdDestino: 1, codigoProduto: 1, pedido: 30 }];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    const linha = res.linhas[0];
    expect(linha.transfMes).toEqual([0, 0, 30]);
  });

  it("transferência imediata respeita fator de segurança e caixa fechada", () => {
    // disp=100, vmed=40, fs=0.5 => dispHoje = 100 - 20 = 80
    // transfM1 = min(pedido 90, excesso). excesso = 100+0-40-0 = 60 => transfM1=60
    // qtdImediata = min(60, 80) = 60 ; emb=10 => caixas = ROUNDDOWN(60/10) = 6 => 60
    const posicao = [sku({ estoqueDisponivel: 100, vendaMedia3m: 40, custoReposicao: 2, embCompra: 10 })];
    const pedidos: PedidoProjetado[] = [{ anoMes: MESES[0], cdDestino: 1, codigoProduto: 1, pedido: 90 }];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    const l = res.linhas[0];
    expect(l.qtdTransfImediata).toBe(60);
    expect(l.imediataCaixas).toBe(6);
    expect(l.qtdImediataArredondada).toBe(60);
    expect(l.valorTransfImediata).toBe(120);
  });

  it("transferência imediata em caixas arredonda PARA BAIXO (caixa fechada)", () => {
    // disp=100, vmed=40, fs=0.5 => dispHoje = 80 ; excesso = 60 => transfM1=60
    // qtdImediata = min(60, 80) = 60 ; emb=25 => ROUNDDOWN(60/25) = 2 (não 3) => 50
    const posicao = [sku({ estoqueDisponivel: 100, vendaMedia3m: 40, custoReposicao: 2, embCompra: 25 })];
    const pedidos: PedidoProjetado[] = [{ anoMes: MESES[0], cdDestino: 1, codigoProduto: 1, pedido: 90 }];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    const l = res.linhas[0];
    expect(l.qtdTransfImediata).toBe(60);
    expect(l.imediataCaixas).toBe(2);
    expect(l.qtdImediataArredondada).toBe(50);
  });

  it("quantidade imediata menor que 1 caixa => imediata em cx é ZERO", () => {
    // disp=100, vmed=40, fs=0.5 => dispHoje = 80 ; excesso = 60 => transfM1 = min(30,60)=30
    // qtdImediata = min(30, 80) = 30 ; emb=50 => 30 < 50 => ROUNDDOWN(30/50) = 0
    const posicao = [sku({ estoqueDisponivel: 100, vendaMedia3m: 40, custoReposicao: 2, embCompra: 50 })];
    const pedidos: PedidoProjetado[] = [{ anoMes: MESES[0], cdDestino: 1, codigoProduto: 1, pedido: 30 }];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    const l = res.linhas[0];
    expect(l.qtdTransfImediata).toBe(30);
    expect(l.imediataCaixas).toBe(0);
    expect(l.qtdImediataArredondada).toBe(0);
  });
});

describe("CDs configuráveis (origem e destinos)", () => {
  it("exclui o CD de origem da lista de destinos", () => {
    const posicao = [sku({ estoqueDisponivel: 1000, custoReposicao: 1 })];
    const pedidos: PedidoProjetado[] = [
      { anoMes: MESES[0], cdDestino: 10, codigoProduto: 1, pedido: 500 }, // origem — deve ser ignorado
      { anoMes: MESES[0], cdDestino: 3, codigoProduto: 1, pedido: 200 },
    ];
    // prioridade inclui o próprio 10 por engano + um CD novo (3)
    const res = calcular(posicao, indexarPedidos(pedidos), { ...paramsBase, prioridadeCds: [10, 3, 1] });
    expect(res.resumo.some((r) => r.cdDestino === 10)).toBe(false);
    const cd3 = res.linhas.find((l) => l.cdDestino === 3)!;
    expect(cd3.transfMes[0]).toBe(200);
  });

  it("suporta rede maior (11 CDs) sem código fixo", () => {
    const destinos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];
    const posicao = [sku({ estoqueDisponivel: 100000, custoReposicao: 1 })];
    const pedidos: PedidoProjetado[] = destinos.map((cd) => ({ anoMes: MESES[0], cdDestino: cd, codigoProduto: 1, pedido: 10 }));
    const res = calcular(posicao, indexarPedidos(pedidos), { ...paramsBase, cdOrigem: 10, prioridadeCds: destinos });
    expect(res.resumo.length).toBe(10);
    expect(res.linhas.length).toBe(10);
  });
});

describe("resumo executivo e impacto fiscal", () => {
  it("agrega por CD e aplica alíquota; sinaliza alíquota incompleta", () => {
    const posicao = [
      sku({ idSku: "10-1", codigoProduto: 1, estoqueDisponivel: 1000, custoReposicao: 10 }),
    ];
    const pedidos: PedidoProjetado[] = [
      { anoMes: MESES[0], cdDestino: 1, codigoProduto: 1, pedido: 100 }, // valor 1000, fiscal 52
      { anoMes: MESES[0], cdDestino: 2, codigoProduto: 1, pedido: 100 }, // CD2 sem alíquota
    ];
    const res = calcular(posicao, indexarPedidos(pedidos), paramsBase);
    const cd1 = res.resumo.find((r) => r.cdDestino === 1)!;
    expect(cd1.valorTransfMes[0]).toBe(1000);
    expect(cd1.impactoFiscal).toBeCloseTo(52, 6);
    expect(res.meta.alertaAliquotasIncompletas).toContain(2);
  });
});

describe("performance", () => {
  it("recalcula base grande (80k SKUs x 5 CDs x 3 meses) em < 10s", () => {
    const N = 80000;
    const posicao: PosicaoEstoque[] = new Array(N);
    for (let i = 0; i < N; i++) {
      posicao[i] = sku({
        idSku: `10-${i}`,
        codigoProduto: i,
        estoqueDisponivel: (i % 900) + 50,
        quantidadePendente: i % 40,
        vendaMedia3m: i % 60,
        estoqueObjetivo: i % 70,
        custoReposicao: 1 + (i % 50),
        embCompra: (i % 12) + 1,
      });
    }
    const pedidos: PedidoProjetado[] = [];
    for (const m of MESES)
      for (const cd of CDS)
        for (let i = 0; i < N; i += 3)
          pedidos.push({ anoMes: m, cdDestino: cd, codigoProduto: i, pedido: (i * cd) % 120 });
    const idx = indexarPedidos(pedidos);
    const t = Date.now();
    const res = calcular(posicao, idx, paramsBase);
    const ms = Date.now() - t;
    expect(res.reconciliacao.invarianteOk).toBe(true);
    expect(ms).toBeLessThan(10000);
  });
});
