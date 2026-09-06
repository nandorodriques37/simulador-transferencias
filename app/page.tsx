"use client";

import { CSSProperties, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Barra, Kpi, PageHeader, Secao, Spinner } from "@/components/ui";
import { fmtInt, fmtPct, fmtRs, fmtRsCompacto, rotuloMes, rotuloRota } from "@/lib/format";

interface ResumoRota {
  cdOrigem: number; cdDestino: number; rota: string; aliquota: number; aliquotaDefinida: boolean;
  qtdMes: number[]; valorMes: number[]; qtd: number; valor: number;
  qtdImediata: number; valorImediata: number; impactoFiscal: number; linhas: number;
}
interface ResumoOrigem { cd: number; ordem: number; excessoQtd: number; excessoRs: number; transferidoQtd: number; transferidoRs: number; sobraQtd: number; sobraRs: number; skusComExcesso: number }
interface ResumoDestino { cd: number; ordem: number; necessidadeBrutaQtd: number; necessidadeQtd: number; necessidadeRs: number; atendidoQtd: number; atendidoRs: number; aberto: number; cobertura: number }
interface DashResp {
  analise: { id: string; label: string; criadoEm: string; criadoPor: string; fonteBase: string };
  cobertura: "total" | "acima_limite";
  modoDemanda: "saldo_ideal" | "pedidos";
  meses: string[];
  sequenciaOrigens: number[];
  sequenciaDestinos: number[];
  consideraAprovadas: boolean;
  regras: {
    coberturaMaxDestinoDias: number;
    coberturaMinDestinoDias: number;
    estrategiaDestino: "prioridade" | "nivelar_cobertura";
    considerarPendenteOrigem: boolean;
    arredondarCaixaFechada: boolean;
    minValorRota: number;
  };
  kpis: {
    excessoDisponivelRs: number; valorTransfTotal: number; qtdTransfTotal: number;
    necessidadeTotalRs: number; coberturaNecessidade: number; usoDoExcesso: number;
    valorImediata: number; impactoFiscalTotal: number; linhasPlano: number;
    skusDistintos: number; rotasAtivas: number; rotasSemAliquota: string[];
  };
  rotas: ResumoRota[];
  origens: ResumoOrigem[];
  destinos: ResumoDestino[];
  tempoMs: number;
  erro?: string;
  semAnalise?: boolean;
}

export default function Dashboard() {
  const [cobertura, setCobertura] = useState<"total" | "acima_limite">("total");
  const [data, setData] = useState<DashResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?cobertura=${cobertura}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [cobertura]);

  if (loading && !data) return <div className="pt-10"><Spinner label="Carregando painel…" /></div>;
  if (!data) return null;

  if (data.semAnalise || data.erro) {
    return (
      <div>
        <PageHeader title="Dashboard executivo" subtitle="Resultado da última análise de rede." />
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">Nenhuma análise rodada ainda nesta instância.</p>
          <Link href="/analise" className="btn-primary mt-4 inline-flex">Configurar e rodar a primeira análise</Link>
        </div>
      </div>
    );
  }

  const { kpis, rotas, origens, destinos, meses } = data;
  const modoPedidos = data.modoDemanda === "pedidos";

  // Matriz origem × destino (valor R$) na sequência escolhida pelo usuário.
  const valorRota = new Map(rotas.map((r) => [r.rota, r.valor]));
  const maxCelula = Math.max(1, ...rotas.map((r) => r.valor));
  // Heatmap sequencial: uma única hue (vermelho institucional), claro → escuro.
  const heat = (v: number): CSSProperties | undefined => {
    if (v <= 0) return undefined;
    const t = v / maxCelula;
    return {
      backgroundColor: `rgba(237,10,46,${(0.06 + 0.5 * t).toFixed(3)})`,
      color: t > 0.62 ? "#ffffff" : undefined,
      fontWeight: t > 0.35 ? 600 : undefined,
    };
  };
  const totalPorOrigem = (o: number) => rotas.filter((r) => r.cdOrigem === o).reduce((a, r) => a + r.valor, 0);
  const totalPorDestino = (d: number) => rotas.filter((r) => r.cdDestino === d).reduce((a, r) => a + r.valor, 0);
  const topRotas = [...rotas].sort((a, b) => b.valor - a.valor).slice(0, 8);
  const maxRota = Math.max(1, ...topRotas.map((r) => r.valor));

  return (
    <div>
      <PageHeader
        title="Dashboard executivo"
        subtitle={
          <>
            Análise <b>{data.analise.id}</b> · {modoPedidos ? "consumindo pedidos futuros" : "atendendo o saldo ideal"} ·{" "}
            {data.sequenciaOrigens.length} origem(ns) → {data.sequenciaDestinos.length} destino(s) · {data.tempoMs} ms
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
              <button onClick={() => setCobertura("total")} className={`rounded-md px-3 py-1.5 ${cobertura === "total" ? "bg-brand-600 text-white" : "text-slate-600"}`}>Total</button>
              <button onClick={() => setCobertura("acima_limite")} className={`rounded-md px-3 py-1.5 ${cobertura === "acima_limite" ? "bg-brand-600 text-white" : "text-slate-600"}`}>Estoque parado</button>
            </div>
            <Link href="/analise" className="btn-ghost">Nova análise</Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Badge tom="azul">Origens: {data.sequenciaOrigens.map((c) => `CD${c}`).join(" → ")}</Badge>
        <Badge tom="brand">Destinos: {data.sequenciaDestinos.map((c) => `CD${c}`).join(" → ")}</Badge>
        {modoPedidos && <Badge tom="warn">Meses: {meses.map(rotuloMes).join(" · ")}</Badge>}
        {data.consideraAprovadas && <Badge tom="good">Descontando sugestões aprovadas em aberto</Badge>}
        {data.regras?.coberturaMaxDestinoDias > 0 && <Badge>Teto {data.regras.coberturaMaxDestinoDias}d de cobertura</Badge>}
        {data.regras?.coberturaMinDestinoDias > 0 && <Badge>Piso {data.regras.coberturaMinDestinoDias}d</Badge>}
        {data.regras?.estrategiaDestino === "nivelar_cobertura" && <Badge tom="azul">Nivelando cobertura entre destinos</Badge>}
        {data.regras && !data.regras.considerarPendenteOrigem && <Badge tom="azul">Excesso físico (sem pendente)</Badge>}
        {data.regras?.arredondarCaixaFechada && <Badge>Só caixa fechada</Badge>}
      </div>

      {kpis.rotasSemAliquota.length > 0 && (
        <div className="mb-4">
          <Alert tom="warn">
            Rotas com transferência e sem alíquota definida: <b>{kpis.rotasSemAliquota.map(rotuloRota).join(" · ")}</b>. O impacto fiscal
            está subestimado — informe as alíquotas em <Link href="/analise" className="underline">Nova análise</Link>.
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Excesso disponível nas origens" valor={fmtRsCompacto(kpis.excessoDisponivelRs)} sub={`${fmtPct(kpis.usoDoExcesso)} aproveitado no plano`} tom="azul" />
        <Kpi titulo="Transferências planejadas" valor={fmtRsCompacto(kpis.valorTransfTotal)} sub={`${fmtInt(kpis.qtdTransfTotal)} un · ${fmtInt(kpis.linhasPlano)} linhas · ${fmtInt(kpis.skusDistintos)} SKUs`} tom="brand" />
        <Kpi titulo="Necessidade coberta" valor={fmtPct(kpis.coberturaNecessidade)} sub={`de ${fmtRsCompacto(kpis.necessidadeTotalRs)} demandados`} tom="good" />
        <Kpi titulo="Impacto fiscal (ICMS)" valor={fmtRsCompacto(kpis.impactoFiscalTotal)} sub={`Imediata: ${fmtRsCompacto(kpis.valorImediata)}`} tom="warn" />
      </div>

      {/* ------------------------- Matriz origem × destino ------------------------- */}
      <div className="mt-4">
        <Secao titulo="Matriz origem → destino" desc="Valor transferido em cada rota, na sequência que você escolheu.">
          <div className="overflow-x-auto thin-scroll">
            <table className="min-w-full border-separate" style={{ borderSpacing: "2px" }}>
              <thead>
                <tr>
                  <th className="math text-left">Origem \ Destino</th>
                  {data.sequenciaDestinos.map((d, i) => (
                    <th key={d} className="matgh">
                      <div className="text-slate-600">CD {d}</div>
                      <div className="text-[10px] font-normal text-slate-400">prioridade {i + 1}</div>
                    </th>
                  ))}
                  <th className="matgh text-right">Total origem</th>
                </tr>
              </thead>
              <tbody>
                {data.sequenciaOrigens.map((o, i) => (
                  <tr key={o}>
                    <td className="math">
                      <div className="text-slate-700">CD {o}</div>
                      <div className="text-[10px] font-normal text-slate-400">ordem {i + 1}</div>
                    </td>
                    {data.sequenciaDestinos.map((d) => {
                      const v = o === d ? -1 : valorRota.get(`${o}>${d}`) ?? 0;
                      return (
                        <td key={d} className="matd rounded-md text-right tabular-nums" style={v > 0 ? heat(v) : undefined} title={o === d ? "mesma unidade" : `CD${o} → CD${d}: ${fmtRs(v)}`}>
                          {o === d ? <span className="text-slate-300">—</span> : v > 0 ? fmtRsCompacto(v) : <span className="text-slate-300">0</span>}
                        </td>
                      );
                    })}
                    <td className="matd text-right font-semibold tabular-nums">{fmtRsCompacto(totalPorOrigem(o))}</td>
                  </tr>
                ))}
                <tr>
                  <td className="math">Total destino</td>
                  {data.sequenciaDestinos.map((d) => (
                    <td key={d} className="matd text-right font-semibold tabular-nums">{fmtRsCompacto(totalPorDestino(d))}</td>
                  ))}
                  <td className="matd text-right font-bold tabular-nums text-brand-700">{fmtRsCompacto(kpis.valorTransfTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Secao>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* --------------------------- Origens --------------------------- */}
        <Secao titulo="Origens — quanto do excesso escoou" desc="Na ordem de análise. O que sobra continua parado no CD.">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">#</th><th className="th">CD</th>
                <th className="th text-right">Excesso</th><th className="th text-right">Transferido</th>
                <th className="th w-32">Aproveitamento</th>
              </tr>
            </thead>
            <tbody>
              {origens.map((o) => {
                const uso = o.excessoRs > 0 ? o.transferidoRs / o.excessoRs : 0;
                return (
                  <tr key={o.cd} className="border-b border-slate-100">
                    <td className="td text-slate-400">{o.ordem}</td>
                    <td className="td font-semibold">CD {o.cd}</td>
                    <td className="td num">{fmtRsCompacto(o.excessoRs)}</td>
                    <td className="td num">{fmtRsCompacto(o.transferidoRs)}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <Barra pct={uso} tom="azul" />
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">{fmtPct(uso, 0)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Secao>

        {/* -------------------------- Destinos --------------------------- */}
        <Secao titulo="Destinos — quanto da necessidade foi coberto" desc="Na ordem de prioridade. O aberto segue para a próxima análise.">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">#</th><th className="th">CD</th>
                <th className="th text-right">Necessidade</th><th className="th text-right">Atendido</th>
                <th className="th w-32">Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {destinos.map((d) => (
                <tr key={d.cd} className="border-b border-slate-100">
                  <td className="td text-slate-400">{d.ordem}</td>
                  <td className="td font-semibold">CD {d.cd}</td>
                  <td className="td num">
                    {fmtRsCompacto(d.necessidadeRs)}
                    {Math.abs(d.necessidadeBrutaQtd - d.necessidadeQtd) > 1 && (
                      <div className="text-[10px] text-slate-400" title="demanda crua antes do teto/piso de cobertura">
                        bruta {fmtInt(d.necessidadeBrutaQtd)} un → {fmtInt(d.necessidadeQtd)} un
                      </div>
                    )}
                  </td>
                  <td className="td num">{fmtRsCompacto(d.atendidoRs)}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Barra pct={d.cobertura} tom={d.cobertura >= 0.999 ? "good" : "brand"} />
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">{fmtPct(d.cobertura, 0)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Secao>
      </div>

      {/* --------------------------- Top rotas --------------------------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Secao titulo="Maiores rotas" desc="Valor transferido por rota (top 8).">
          <div className="flex flex-col gap-2">
            {topRotas.map((r) => (
              <div key={r.rota} className="flex items-center gap-3" title={`${fmtRs(r.valor)} · ${fmtInt(r.qtd)} un · ${fmtInt(r.linhas)} SKUs`}>
                <div className="w-24 shrink-0 text-xs font-medium text-slate-600">CD{r.cdOrigem} → CD{r.cdDestino}</div>
                <div className="h-3 flex-1 overflow-hidden rounded-sm bg-slate-100">
                  <div className="h-full rounded-r-[4px] bg-brand-500" style={{ width: `${(r.valor / maxRota) * 100}%` }} />
                </div>
                <div className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-600">{fmtRsCompacto(r.valor)}</div>
              </div>
            ))}
            {topRotas.length === 0 && <p className="text-sm text-slate-400">Nenhuma transferência sugerida com os filtros atuais.</p>}
          </div>
        </Secao>

        <Secao titulo="Detalhe por rota" desc={modoPedidos ? "Quebra mensal do que cada rota abate de pedidos." : "Volume, imediata e impacto fiscal por rota."}>
          <div className="overflow-x-auto thin-scroll">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="thc">Rota</th>
                  {modoPedidos && meses.map((m) => <th key={m} className="thc text-right">{rotuloMes(m)}</th>)}
                  <th className="thc text-right">Total</th>
                  <th className="thc text-right">Imediata</th>
                  <th className="thc text-right">Alíq.</th>
                  <th className="thc text-right">Fiscal</th>
                </tr>
              </thead>
              <tbody>
                {rotas.map((r) => (
                  <tr key={r.rota} className="border-b border-slate-100">
                    <td className="tdc font-medium">CD{r.cdOrigem} → CD{r.cdDestino}</td>
                    {modoPedidos && r.valorMes.map((v, i) => <td key={i} className="tdc num">{fmtRsCompacto(v)}</td>)}
                    <td className="tdc num font-semibold">{fmtRsCompacto(r.valor)}</td>
                    <td className="tdc num">{fmtRsCompacto(r.valorImediata)}</td>
                    <td className="tdc num">{r.aliquotaDefinida ? fmtPct(r.aliquota) : <span className="text-amber-600">—</span>}</td>
                    <td className="tdc num">{fmtRsCompacto(r.impactoFiscal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      </div>
    </div>
  );
}
