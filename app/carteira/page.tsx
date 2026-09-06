"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Kpi, Modal, PageHeader, Progress, Secao, Spinner } from "@/components/ui";
import { fmtInt, fmtRs, fmtRsCompacto } from "@/lib/format";

interface Sugestao {
  id: string; analiseId: string; criadoEm: string; criadoPor: string;
  cdOrigem: number; cdDestino: number; codigoProduto: number; produto: string;
  qtd: number; valor: number; preco: number; embCompra: number;
  status: "aprovada" | "faturada" | "cancelada"; qtdFaturada: number; faturadoEm: string | null;
}
interface Evento { id: string; em: string; por: string; arquivo: string; linhas: number; casadas: number; semCorrespondencia: number; qtdBaixada: number }
interface Resumo { aprovadas: number; qtdAberta: number; valorAberto: number; faturadas: number; qtdFaturada: number }
interface CarteiraResp { itens: Sugestao[]; resumo: Resumo; durable: boolean; eventos: Evento[] }
interface Achado { nivel: "erro" | "aviso" | "info"; mensagem: string; qtd: number; exemplos?: string[] }

const nivelTom = { erro: "erro", aviso: "warn", info: "info" } as const;

export default function Carteira() {
  const [status, setStatus] = useState<"aprovada" | "faturada" | "todas">("aprovada");
  const [q, setQ] = useState("");
  const [data, setData] = useState<CarteiraResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tom: "good" | "erro" | "info"; texto: string } | null>(null);

  // Modal de faturamento
  const [modal, setModal] = useState(false);
  const [fatFile, setFatFile] = useState<File | null>(null);
  const [previa, setPrevia] = useState<{ linhas: number; quantidadeTotal: number; rotas: string[] } | null>(null);
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const fatRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ status });
    if (q) p.set("q", q);
    fetch(`/api/carteira?${p}`).then((r) => r.json()).then(setData).finally(() => setLoading(false));
  }, [status, q]);
  useEffect(carregar, [carregar]);

  if (loading && !data) return <div className="pt-10"><Spinner label="Carregando carteira…" /></div>;
  if (!data) return null;

  const { itens, resumo, eventos } = data;
  const aberto = (s: Sugestao) => (s.status === "aprovada" ? Math.max(s.qtd - s.qtdFaturada, 0) : 0);

  const cancelar = async () => {
    if (sel.size === 0) return;
    if (!window.confirm(`Cancelar ${sel.size} sugestão(ões)? Elas voltam a liberar excesso na origem e necessidade no destino.`)) return;
    const r = await fetch("/api/carteira", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) });
    const d = await r.json();
    setMsg(r.ok ? { tom: "good", texto: `${d.canceladas} sugestão(ões) cancelada(s).` } : { tom: "erro", texto: d.erro });
    setSel(new Set());
    carregar();
  };

  const enviarFaturamento = async (dryRun: boolean) => {
    if (!fatFile) return;
    setEnviando(true);
    setProgresso(dryRun ? 40 : 25);
    if (dryRun) { setPrevia(null); setAchados(null); }
    const fd = new FormData();
    fd.append("faturamento", fatFile);
    fd.append("dryRun", String(dryRun));
    const r = await fetch("/api/faturamento", { method: "POST", body: fd });
    setProgresso(90);
    const d = await r.json();
    setProgresso(100);
    setEnviando(false);

    if (!r.ok) {
      setAchados([{ nivel: "erro", mensagem: d.erro ?? "falha na importação", qtd: 0, exemplos: (d.faltando ?? []).map((f: { rotulo: string; aliases: string[] }) => `${f.rotulo} — aceita: ${f.aliases.slice(0, 4).join(", ")}`) }]);
      return;
    }
    if (dryRun) {
      setPrevia({ linhas: d.linhas, quantidadeTotal: d.quantidadeTotal, rotas: d.rotas ?? [] });
      return;
    }
    setAchados(d.relatorio.achados);
    setMsg({ tom: "good", texto: `Faturamento aplicado: ${fmtInt(d.relatorio.baixadas)} sugestão(ões) baixada(s), ${fmtInt(d.relatorio.qtdBaixada)} unidades confirmadas.` });
    setFatFile(null);
    if (fatRef.current) fatRef.current.value = "";
    carregar();
  };

  return (
    <div>
      <PageHeader
        title="Carteira de transferências"
        subtitle={
          <>
            Sugestões aprovadas seguem descontando o excesso da origem e entrando como trânsito no destino
            <b> até o faturamento ser importado</b>.
          </>
        }
        right={
          <div className="flex gap-2">
            <button onClick={() => setModal(true)} className="btn-secondary">↑ Importar faturamento</button>
            <a href="/api/carteira/ordem" className="btn-primary">Gerar ordem (ERP)</a>
          </div>
        }
      />

      {msg && <div className="mb-3"><Alert tom={msg.tom}>{msg.texto}</Alert></div>}
      {!data.durable && (
        <div className="mb-3">
          <Alert tom="warn">
            Sem banco configurado: a carteira está <b>em memória</b> (modo demo) e se perde ao reiniciar a instância.
            Conecte o Vercel Neon/Postgres para torná-la durável.
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Sugestões em aberto" valor={fmtInt(resumo.aprovadas)} sub="aprovadas e ainda não faturadas" tom="brand" />
        <Kpi titulo="Volume comprometido" valor={fmtInt(resumo.qtdAberta)} sub="unidades reservadas na origem" tom="azul" />
        <Kpi titulo="Valor em aberto" valor={fmtRsCompacto(resumo.valorAberto)} sub="capital em trânsito planejado" />
        <Kpi titulo="Já faturadas" valor={fmtInt(resumo.faturadas)} sub={`${fmtInt(resumo.qtdFaturada)} un confirmadas`} tom="good" />
      </div>

      <div className="mt-4">
        <Secao
          titulo="Sugestões"
          desc="Aprovadas descontam as próximas análises; faturadas já estão refletidas nas bases; canceladas não contam."
          right={
            <div className="flex flex-wrap items-end gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="produto ou código" className="input w-44 py-1.5 text-xs" />
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="input py-1.5 text-xs">
                <option value="aprovada">Em aberto</option>
                <option value="faturada">Faturadas</option>
                <option value="todas">Todas</option>
              </select>
              <button onClick={cancelar} disabled={sel.size === 0} className="btn-ghost py-1.5 text-xs">Cancelar ({sel.size})</button>
            </div>
          }
        >
          <div className="overflow-x-auto thin-scroll">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="thc w-8">
                    <input
                      type="checkbox"
                      checked={itens.length > 0 && itens.every((s) => sel.has(s.id))}
                      onChange={() => setSel(itens.every((s) => sel.has(s.id)) ? new Set() : new Set(itens.map((s) => s.id)))}
                    />
                  </th>
                  <th className="thc">Rota</th>
                  <th className="thc">Código</th>
                  <th className="thc">Produto</th>
                  <th className="thc text-right">Aprovada</th>
                  <th className="thc text-right">Faturada</th>
                  <th className="thc text-right">Em aberto</th>
                  <th className="thc text-right">Valor aberto</th>
                  <th className="thc">Status</th>
                  <th className="thc">Análise</th>
                  <th className="thc">Aprovado em</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((s) => (
                  <tr key={s.id} className={`border-b border-slate-100 ${sel.has(s.id) ? "bg-brand-50/60" : ""}`}>
                    <td className="tdc">
                      <input
                        type="checkbox"
                        checked={sel.has(s.id)}
                        disabled={s.status === "faturada"}
                        onChange={() => {
                          const novo = new Set(sel);
                          if (novo.has(s.id)) novo.delete(s.id); else novo.add(s.id);
                          setSel(novo);
                        }}
                      />
                    </td>
                    <td className="tdc font-medium">CD{s.cdOrigem} → CD{s.cdDestino}</td>
                    <td className="tdc">{s.codigoProduto}</td>
                    <td className="tdc max-w-[240px] truncate" title={s.produto}>{s.produto}</td>
                    <td className="tdc num">{fmtInt(s.qtd)}</td>
                    <td className="tdc num text-slate-500">{fmtInt(s.qtdFaturada)}</td>
                    <td className="tdc num font-semibold">{fmtInt(aberto(s))}</td>
                    <td className="tdc num">{fmtRs(aberto(s) * s.preco)}</td>
                    <td className="tdc">
                      {s.status === "aprovada" && <Badge tom="brand">em aberto</Badge>}
                      {s.status === "faturada" && <Badge tom="good">faturada</Badge>}
                      {s.status === "cancelada" && <Badge>cancelada</Badge>}
                    </td>
                    <td className="tdc text-slate-500">{s.analiseId}</td>
                    <td className="tdc text-slate-500">{new Date(s.criadoEm).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
                {itens.length === 0 && (
                  <tr><td colSpan={11} className="td text-center text-slate-400">Nenhuma sugestão nesta visão. Aprove linhas no Plano de transferência.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Secao>
      </div>

      {eventos.length > 0 && (
        <div className="mt-4">
          <Secao titulo="Baixas por faturamento" desc="Cada importação confirma o que realmente foi transferido.">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Quando</th><th className="th">Quem</th><th className="th">Arquivo</th>
                  <th className="th text-right">Linhas</th><th className="th text-right">Casadas</th>
                  <th className="th text-right">Sem match</th><th className="th text-right">Un. baixadas</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="td">{new Date(e.em).toLocaleString("pt-BR")}</td>
                    <td className="td">{e.por}</td>
                    <td className="td max-w-xs truncate">{e.arquivo}</td>
                    <td className="td num">{fmtInt(e.linhas)}</td>
                    <td className="td num">{fmtInt(e.casadas)}</td>
                    <td className="td num">{fmtInt(e.semCorrespondencia)}</td>
                    <td className="td num">{fmtInt(e.qtdBaixada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Secao>
        </div>
      )}

      {/* ---------------------- Modal: base de faturamento ---------------------- */}
      <Modal aberto={modal} titulo="Importar base de faturamento" onFechar={() => setModal(false)}>
        <p className="text-sm text-slate-600">
          A planilha de faturamento confirma o que <b>já foi transferido</b>. As sugestões correspondentes recebem baixa
          e param de descontar as próximas análises — a partir daí, as bases atualizadas já trazem a saída na origem e a
          pendência no destino.
        </p>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <div className="label mb-1">Colunas esperadas</div>
          CD origem · CD destino · código do produto · quantidade faturada · (opcional) documento/NF e data.
          O casamento é por <b>rota + produto</b>, na ordem de aprovação.
        </div>

        <div className="mt-3">
          <input ref={fatRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" onChange={(e) => { setFatFile(e.target.files?.[0] ?? null); setPrevia(null); setAchados(null); }} className="input w-full text-xs" />
        </div>

        {enviando && <div className="mt-3"><Progress pct={progresso} label="Processando…" /></div>}

        {previa && (
          <div className="mt-3">
            <Alert tom="info">
              Prévia: <b>{fmtInt(previa.linhas)}</b> linhas · <b>{fmtInt(previa.quantidadeTotal)}</b> unidades ·
              rotas: {previa.rotas.slice(0, 10).join(", ")}{previa.rotas.length > 10 ? "…" : ""}
            </Alert>
          </div>
        )}

        {achados && (
          <div className="mt-3 flex flex-col gap-1.5">
            {achados.map((a, i) => (
              <Alert key={i} tom={nivelTom[a.nivel]}>
                <b>{a.mensagem}</b>
                {a.exemplos && a.exemplos.length > 0 && <div className="mt-0.5 text-xs opacity-80">{a.exemplos.slice(0, 6).join(" · ")}</div>}
              </Alert>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setModal(false)} className="btn-ghost">Fechar</button>
          <button onClick={() => enviarFaturamento(true)} disabled={!fatFile || enviando} className="btn-ghost">Validar</button>
          <button onClick={() => enviarFaturamento(false)} disabled={!fatFile || enviando} className="btn-primary">Aplicar baixa</button>
        </div>
      </Modal>
    </div>
  );
}
