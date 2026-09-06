"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, ErroCarga, PageHeader, Revalidando, Spinner } from "@/components/ui";
import { fmtInt, fmtPct, fmtRs, fmtRsCompacto, rotuloMes } from "@/lib/format";
import { useApi, useDebounce } from "@/lib/useApi";

interface LinhaPlano {
  cdOrigem: number; cdDestino: number; rota: string; codigoProduto: number; produto: string;
  fornecedor: string; comprador: string; analista: string; categoriaN1: string;
  precoUnitario: number; embCompra: number;
  demandaMes: number[]; transfMes: number[]; demandaSaldo: number; transfSaldo: number;
  transfTotal: number; valorTotal: number; caixas: number;
  qtdImediata: number; imediataCaixas: number; qtdImediataArredondada: number; valorImediata: number;
  coberturaDias: number; statusCobertura: string; aliquota: number; impactoFiscal: number;
  naCarteira: boolean;
}
interface Facets {
  origens: number[]; destinos: number[]; rotas: string[]; categorias: string[];
  fornecedores: string[]; compradores: string[]; analistas: string[]; status: string[];
}
interface PlanoResp {
  analiseId: string; modoDemanda: "saldo_ideal" | "pedidos"; meses: string[];
  facets: Facets; totaisFiltro: { qtd: number; valor: number; imediata: number; fiscal: number };
  total: number; page: number; pageSize: number; totalPaginas: number; itens: LinhaPlano[];
  erro?: string; semAnalise?: boolean;
  precisaRecalcular?: boolean; parametros?: unknown; label?: string; criadoEm?: string;
}

const FILTROS_INICIAIS: Record<string, string> = {
  cobertura: "total", origem: "", destino: "", categoria: "", fornecedor: "",
  comprador: "", analista: "", status: "", q: "", soImediata: "false",
};

/** Valores que não precisam aparecer na URL — são o padrão da tela. */
const PADROES: Record<string, string> = { ...FILTROS_INICIAIS, sort: "valorTotal", dir: "desc", page: "1" };

export default function PlanoPage() {
  // `useSearchParams` exige Suspense no Next 14 (a página é renderizada no cliente).
  return (
    <Suspense fallback={<div className="pt-10"><Spinner label="Carregando plano…" /></div>}>
      <Plano />
    </Suspense>
  );
}

function Plano() {
  const router = useRouter();
  const url = useSearchParams();

  // A URL é a fonte da verdade dos filtros: recarregar a página preserva a
  // visão, e o link filtrado pode ser mandado para outra pessoa.
  const filtros = useMemo(() => {
    const f = { ...FILTROS_INICIAIS };
    for (const k of Object.keys(FILTROS_INICIAIS)) {
      const v = url.get(k);
      if (v !== null) f[k] = v;
    }
    return f;
  }, [url]);
  const page = Math.max(1, Number(url.get("page") ?? 1));
  const sort = {
    campo: url.get("sort") ?? "valorTotal",
    dir: (url.get("dir") as "asc" | "desc") ?? "desc",
  };

  const [busca, setBusca] = useState(filtros.q);
  const buscaDebounced = useDebounce(busca, 300);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tom: "good" | "erro"; texto: string } | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const [recalculando, setRecalculando] = useState(false);

  const aplicar = (patch: Record<string, string>, resetPagina = true) => {
    const p = new URLSearchParams(url.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === PADROES[k]) p.delete(k);
      else p.set(k, v);
    }
    if (resetPagina) p.delete("page");
    router.replace(`/plano${p.toString() ? `?${p}` : ""}`, { scroll: false });
    setSel(new Set());
  };

  // A busca só entra na URL depois da pausa — uma requisição por termo, não por tecla.
  useEffect(() => {
    if (buscaDebounced !== filtros.q) aplicar({ q: buscaDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v && v !== "false") p.set(k, v);
    p.set("page", String(page));
    p.set("pageSize", "100");
    p.set("sort", sort.campo);
    p.set("dir", sort.dir);
    return p.toString();
  }, [filtros, page, sort.campo, sort.dir]);

  const api = useApi<PlanoResp>(`/api/plano?${qs}`);
  const data = api.data;
  const carregar = api.recarregar;

  const recalcular = async () => {
    if (!data?.parametros) return;
    setRecalculando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/analise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parametros: data.parametros, label: data.label, analiseId: data.analiseId }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ tom: "erro", texto: `Não foi possível recalcular: ${d.erro}` });
        return;
      }
      carregar();
    } catch (e) {
      setMsg({ tom: "erro", texto: `Não foi possível recalcular: ${(e as Error).message}` });
    } finally {
      setRecalculando(false);
    }
  };

  if (api.carregando) return <div className="pt-10"><Spinner label="Carregando plano…" /></div>;
  if (api.erro && !data) return <ErroCarga erro={api.erro} onTentar={api.recarregar} />;
  if (!data) return null;

  // O detalhe por SKU não é persistido: quando a instância está fria, o
  // resultado salvo sobrevive e o plano é reconstruído em um clique.
  if (data.precisaRecalcular) {
    return (
      <div>
        <PageHeader title="Plano de transferência" subtitle={`Análise ${data.analiseId} · ${data.label ?? ""}`} />
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">
            O plano desta análise não está disponível neste ambiente — provavelmente ele foi gerado antes de o
            armazenamento ser configurado.
          </p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-slate-400">
            Recalcular usa a mesma base e os mesmos parâmetros: leva alguns segundos e devolve o plano completo para
            filtrar e aprovar.
          </p>
          <button onClick={recalcular} disabled={recalculando} className="btn-primary mt-4 inline-flex">
            {recalculando ? "Recalculando…" : "↻ Recalcular o plano"}
          </button>
          {msg && <div className="mt-3"><Alert tom={msg.tom}>{msg.texto}</Alert></div>}
        </div>
      </div>
    );
  }

  if (data.semAnalise || data.erro) {
    return (
      <div>
        <PageHeader title="Plano de transferência" />
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">Rode uma análise para gerar o plano.</p>
          <Link href="/analise" className="btn-primary mt-4 inline-flex">Ir para Nova análise</Link>
        </div>
      </div>
    );
  }

  const { itens, facets, meses, totaisFiltro } = data;
  const modoPedidos = data.modoDemanda === "pedidos";
  const chave = (l: LinhaPlano) => `${l.rota}|${l.codigoProduto}`;
  const setF = (k: string, v: string) => aplicar({ [k]: v });
  const ordenar = (campo: string) =>
    aplicar({ sort: campo, dir: sort.campo === campo && sort.dir === "desc" ? "asc" : "desc" });
  const irPara = (p: number) => aplicar({ page: String(Math.max(1, p)) }, false);

  const alternar = (k: string) => {
    const novo = new Set(sel);
    if (novo.has(k)) novo.delete(k); else novo.add(k);
    setSel(novo);
  };
  const alternarTodas = () => {
    if (itens.every((l) => sel.has(chave(l)))) setSel(new Set());
    else setSel(new Set(itens.map(chave)));
  };

  const aprovar = async (tudoDoFiltro: boolean) => {
    setAprovando(true);
    setMsg(null);
    try {
      const body = tudoDoFiltro
        ? { analiseId: data.analiseId, filtros }
        : { analiseId: data.analiseId, chaves: Array.from(sel) };
      const r = await fetch("/api/carteira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setMsg({ tom: "erro", texto: `Erro: ${d.erro}` }); return; }
      const extra = (d.avisos ?? []).length ? ` ${(d.avisos as string[]).join(" · ")}` : "";
      setMsg({
        tom: (d.ignoradas ?? 0) > 0 || (d.conciliadas ?? 0) > 0 ? "erro" : "good",
        texto: `${fmtInt(d.gravadas)} linha(s) na carteira. Elas já descontam origem e destino na próxima análise.${extra}`,
      });
      setSel(new Set());
      carregar();
    } catch (e) {
      setMsg({ tom: "erro", texto: `Falha ao aprovar: ${(e as Error).message}. Nenhuma linha foi para a carteira.` });
    } finally {
      setAprovando(false);
    }
  };

  // Cabeçalho ordenável como <button>: alcançável por teclado e anunciado pelo
  // leitor de tela — o <th onClick> anterior não era nem uma coisa nem outra.
  const th = (campo: string, rotulo: string, extra = "") => {
    const ativo = sort.campo === campo;
    return (
      <th scope="col" className={`thc ${extra}`} aria-sort={ativo ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => ordenar(campo)}
          className="inline-flex items-center gap-0.5 uppercase tracking-wide hover:text-slate-800"
          title={`Ordenar por ${rotulo}`}
        >
          {rotulo}
          <span aria-hidden>{ativo ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <div>
      <PageHeader
        title="Plano de transferência"
        subtitle={
          <>
            Análise <b>{data.analiseId}</b> · uma linha por rota (origem → destino) × SKU ·{" "}
            {modoPedidos ? "abatendo pedidos" : "atendendo o saldo ideal"}
          </>
        }
        right={
          <div className="flex gap-2">
            <a href={`/api/plano/export?${qs}&format=csv`} className="btn-ghost">CSV</a>
            <a href={`/api/plano/export?${qs}&format=xlsx`} className="btn-ghost">Excel</a>
          </div>
        }
      />

      {msg && <div className="mb-3"><Alert tom={msg.tom}>{msg.texto}</Alert></div>}

      {/* ------------------------------ Filtros ------------------------------ */}
      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="label mb-0.5">Buscar</div>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="produto ou código" className="input w-48 py-1.5 text-xs" />
          </div>
          <div>
            <div className="label mb-0.5">Origem</div>
            <select value={filtros.origem} onChange={(e) => setF("origem", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todas</option>
              {facets.origens.map((c) => <option key={c} value={c}>CD {c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Destino</div>
            <select value={filtros.destino} onChange={(e) => setF("destino", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todos</option>
              {facets.destinos.map((c) => <option key={c} value={c}>CD {c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Categoria</div>
            <select value={filtros.categoria} onChange={(e) => setF("categoria", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todas</option>
              {facets.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Comprador</div>
            <select value={filtros.comprador} onChange={(e) => setF("comprador", e.target.value)} className="input py-1.5 text-xs">
              <option value="">Todos</option>
              {facets.compradores.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="label mb-0.5">Cobertura na origem</div>
            <select value={filtros.cobertura} onChange={(e) => setF("cobertura", e.target.value)} className="input py-1.5 text-xs">
              <option value="total">Total</option>
              <option value="acima_limite">Só estoque parado</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={filtros.soImediata === "true"} onChange={(e) => setF("soImediata", String(e.target.checked))} />
            Só com saída imediata
          </label>
          <button
            onClick={() => { setBusca(""); router.replace("/plano", { scroll: false }); setSel(new Set()); }}
            className="btn-ghost py-1.5 text-xs"
          >
            Limpar
          </button>
          <div className="pb-1.5"><Revalidando ativo={api.revalidando} /></div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            <Badge>{fmtInt(data.total)} linhas</Badge>
            <Badge tom="brand">{fmtRs(totaisFiltro.valor)}</Badge>
            <Badge tom="good">Imediata {fmtRsCompacto(totaisFiltro.imediata)}</Badge>
            <Badge tom="warn">Fiscal {fmtRsCompacto(totaisFiltro.fiscal)}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => aprovar(false)} disabled={sel.size === 0 || aprovando} className="btn-secondary py-1.5 text-xs">
              Aprovar selecionadas ({sel.size})
            </button>
            <button onClick={() => aprovar(true)} disabled={aprovando || data.total === 0} className="btn-primary py-1.5 text-xs">
              Aprovar todas do filtro ({fmtInt(data.total)})
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------- Tabela ------------------------------ */}
      <div className="card overflow-x-auto thin-scroll">
        <table className="min-w-full">
          <caption className="sr-only">
            Plano de transferência: uma linha por rota e SKU, {fmtInt(data.total)} linhas no filtro atual.
          </caption>
          <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              <th scope="col" className="thc w-8">
                <input type="checkbox" checked={itens.length > 0 && itens.every((l) => sel.has(chave(l)))} onChange={alternarTodas} />
              </th>
              {th("rota", "Rota")}
              {th("codigoProduto", "Código")}
              {th("produto", "Produto")}
              <th scope="col" className="thc">Categoria</th>
              {modoPedidos
                ? meses.map((m) => <th key={m} scope="col" className="thc text-right">Transf. {rotuloMes(m)}</th>)
                : <th scope="col" className="thc text-right">Necessidade</th>}
              {th("transfTotal", "Qtd total", "text-right")}
              <th scope="col" className="thc text-right">Cx</th>
              {th("qtdImediataArredondada", "Imediata (un)", "text-right")}
              {th("valorTotal", "Valor", "text-right")}
              {th("impactoFiscal", "Fiscal", "text-right")}
              {th("coberturaDias", "Cob. origem", "text-right")}
              <th scope="col" className="thc">Carteira</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((l) => {
              const k = chave(l);
              return (
                <tr key={k} className={`border-b border-slate-100 ${sel.has(k) ? "bg-brand-50/60" : ""}`}>
                  <td className="tdc"><input type="checkbox" checked={sel.has(k)} onChange={() => alternar(k)} /></td>
                  <td className="tdc font-medium">CD{l.cdOrigem} → CD{l.cdDestino}</td>
                  <td className="tdc">{l.codigoProduto}</td>
                  <td className="tdc max-w-[220px] truncate" title={l.produto}>{l.produto}</td>
                  <td className="tdc max-w-[130px] truncate text-slate-500" title={l.categoriaN1}>{l.categoriaN1}</td>
                  {modoPedidos
                    ? l.transfMes.map((t, i) => <td key={i} className="tdc num">{fmtInt(t)}</td>)
                    : <td className="tdc num text-slate-500">{fmtInt(l.demandaSaldo)}</td>}
                  <td className="tdc num font-semibold">{fmtInt(l.transfTotal)}</td>
                  <td className="tdc num text-slate-500">{fmtInt(l.caixas)}</td>
                  <td className="tdc num">{fmtInt(l.qtdImediataArredondada)}</td>
                  <td className="tdc num">{fmtRs(l.valorTotal)}</td>
                  <td className="tdc num text-slate-500">{fmtRs(l.impactoFiscal)}</td>
                  <td className="tdc num text-slate-500">{l.coberturaDias >= 9999 ? "s/ giro" : fmtInt(l.coberturaDias)}</td>
                  <td className="tdc">{l.naCarteira ? <Badge tom="good">aprovada</Badge> : <span className="text-slate-300">—</span>}</td>
                </tr>
              );
            })}
            {itens.length === 0 && (
              <tr><td colSpan={14} className="td text-center text-slate-400">Nenhuma linha com os filtros atuais.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <div>Página {data.page} de {data.totalPaginas} · {fmtInt(data.total)} linhas · imediata cobre {fmtPct(totaisFiltro.valor > 0 ? totaisFiltro.imediata / totaisFiltro.valor : 0, 0)} do valor</div>
        <div className="flex gap-2">
          <button onClick={() => irPara(page - 1)} disabled={data.page <= 1} className="btn-ghost py-1 text-xs">Anterior</button>
          <button onClick={() => irPara(page + 1)} disabled={data.page >= data.totalPaginas} className="btn-ghost py-1 text-xs">Próxima</button>
        </div>
      </div>
    </div>
  );
}
