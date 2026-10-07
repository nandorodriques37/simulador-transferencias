"use client";

import { useMemo, useRef, useState } from "react";
import { Alert, Campo, ErroCarga, Estado, Fonte, Kpi, Kpis, Modal, PageHeader, Pill, Progress, Revalidando, Rolagem, Rota, Secao, Spinner, Status } from "@/components/ui";
import { Icone } from "@/components/icones";
import { fmtInt, fmtRs, fmtRsCompacto } from "@/lib/format";
import { useApi, useDebounce } from "@/lib/useApi";

interface Baixa { qtd: number; em: string; registradoEm: string; documento?: string }
interface Sugestao {
  id: string; analiseId: string; criadoEm: string; criadoPor: string; baixas?: Baixa[];
  cdOrigem: number; cdDestino: number; codigoProduto: number; produto: string;
  qtd: number; valor: number; preco: number; embCompra: number;
  status: "aprovada" | "faturada" | "cancelada"; qtdFaturada: number; faturadoEm: string | null;
}
interface Evento { id: string; em: string; por: string; arquivo: string; linhas: number; casadas: number; semCorrespondencia: number; qtdBaixada: number }
interface Resumo {
  aprovadas: number; qtdAberta: number; valorAberto: number; faturadas: number; qtdFaturada: number;
  qtdNaoRefletida: number; valorNaoRefletido: number; envelhecidas: number; diasMaisAntiga: number;
}
interface CarteiraResp { itens: Sugestao[]; resumo: Resumo; durable: boolean; eventos: Evento[]; dataPosicao?: string }
interface Achado { nivel: "erro" | "aviso" | "info"; mensagem: string; qtd: number; exemplos?: string[] }

const nivelTom = { erro: "erro", aviso: "warn", info: "info" } as const;

export default function Carteira() {
  const [status, setStatus] = useState<"aprovada" | "faturada" | "todas">("aprovada");
  const [q, setQ] = useState("");
  const qDebounced = useDebounce(q, 300);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tom: "good" | "erro" | "info"; texto: string } | null>(null);

  // Modal de faturamento
  const [modal, setModal] = useState(false);
  const [confirmaCancelar, setConfirmaCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [fatFile, setFatFile] = useState<File | null>(null);
  const [previa, setPrevia] = useState<{ linhas: number; quantidadeTotal: number; rotas: string[] } | null>(null);
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const fatRef = useRef<HTMLInputElement>(null);

  const url = useMemo(() => {
    const p = new URLSearchParams({ status });
    if (qDebounced) p.set("q", qDebounced);
    return `/api/carteira?${p}`;
  }, [status, qDebounced]);

  const api = useApi<CarteiraResp>(url);
  const data = api.data;
  const carregar = api.recarregar;

  if (api.carregando) return <Spinner label="Abrindo a carteira…" />;
  if (api.erro && !data) return <ErroCarga erro={api.erro} onTentar={api.recarregar} />;
  if (!data) return null;

  const { itens, resumo, eventos } = data;
  const aberto = (s: Sugestao) => (s.status === "aprovada" ? Math.max(s.qtd - s.qtdFaturada, 0) : 0);
  const dias = (s: Sugestao) => Math.floor((Date.now() - new Date(s.criadoEm).getTime()) / 86400000);

  // A confirmação é um modal (não mais window.confirm): mostra o que será
  // cancelado e o volume que volta a ficar disponível.
  const cancelar = async () => {
    if (sel.size === 0) return;
    setCancelando(true);
    try {
      const r = await fetch("/api/carteira", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) });
      const d = await r.json();
      setMsg(r.ok ? { tom: "good", texto: `${d.canceladas} sugestão(ões) cancelada(s).` } : { tom: "erro", texto: d.erro });
      setSel(new Set());
      carregar();
    } catch (e) {
      // Sem isso, uma rede fora do ar deixava o cancelamento em silêncio — e o
      // usuário sem saber se as sugestões continuam valendo.
      setMsg({ tom: "erro", texto: `Falha ao cancelar: ${(e as Error).message}. Nada foi alterado.` });
    } finally {
      setCancelando(false);
      setConfirmaCancelar(false);
    }
  };

  const enviarFaturamento = async (dryRun: boolean) => {
    if (!fatFile) return;
    setEnviando(true);
    setProgresso(dryRun ? 40 : 25);
    if (dryRun) { setPrevia(null); setAchados(null); }
    const fd = new FormData();
    fd.append("faturamento", fatFile);
    fd.append("dryRun", String(dryRun));
    let r: Response;
    let d: {
      erro?: string; faltando?: { rotulo: string; aliases: string[] }[];
      linhas: number; quantidadeTotal: number; rotas?: string[];
      relatorio: { achados: Achado[]; baixadas: number; qtdBaixada: number };
    };
    try {
      r = await fetch("/api/faturamento", { method: "POST", body: fd });
      setProgresso(90);
      d = await r.json();
    } catch (e) {
      setEnviando(false);
      setAchados([{ nivel: "erro", mensagem: `Falha no envio: ${(e as Error).message}`, qtd: 0 }]);
      return;
    }
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

  const selecionadas = itens.filter((s) => sel.has(s.id));
  const unSelecionadas = selecionadas.reduce((a, s) => a + aberto(s), 0);
  const situacao = (s: Sugestao): { tom: "aberta" | "faturada" | "parcial" | "velha" | "cancelada"; rotulo: string } => {
    if (s.status === "faturada") return { tom: "faturada", rotulo: "Faturada" };
    if (s.status === "cancelada") return { tom: "cancelada", rotulo: "Cancelada" };
    if (s.qtdFaturada > 0) return { tom: "parcial", rotulo: "Faturada em parte" };
    const d = dias(s);
    if (d >= 30) return { tom: "velha", rotulo: `Em aberto há ${fmtInt(d)} dias` };
    return { tom: "aberta", rotulo: "Em aberto" };
  };
  const titulo =
    resumo.envelhecidas > 0
      ? <><em>{fmtInt(resumo.envelhecidas)} sugest{resumo.envelhecidas === 1 ? "ão" : "ões"}</em> em aberto há mais de 30 dias segue{resumo.envelhecidas === 1 ? "" : "m"} reservando estoque</>
      : resumo.aprovadas > 0
        ? <>{fmtInt(resumo.aprovadas)} sugest{resumo.aprovadas === 1 ? "ão" : "ões"} em aberto reserva{resumo.aprovadas === 1 ? "" : "m"} {fmtInt(resumo.qtdAberta)} un nas origens</>
        : "Nenhuma sugestão em aberto na carteira";
  const dataBase = data.dataPosicao ? new Date(data.dataPosicao).toLocaleDateString("pt-BR") : "";

  return (
    <>
      <PageHeader
        title={titulo}
        subtitle="Sugestões aprovadas descontam a origem e entram como trânsito no destino até o faturamento ser importado"
        right={
          <>
            <Revalidando ativo={api.revalidando} />
            <button type="button" onClick={() => setModal(true)} className="pgm-botao pgm-botao--secundario">Importar faturamento</button>
            <a href="/api/carteira/ordem" className="pgm-botao">Gerar ordem (ERP)</a>
          </>
        }
      />

      {(msg || api.erro || !data.durable || resumo.envelhecidas > 0) && (
        <div className="flex flex-col gap-3">
          {msg && <Alert tom={msg.tom} titulo={msg.tom === "good" ? "Pronto" : msg.tom === "erro" ? "Falha" : "Informação"}>{msg.texto}</Alert>}
          {api.erro && (
            <Alert tom="erro" titulo="Falha ao atualizar" acao={<button onClick={api.recarregar} className="pgm-botao pgm-botao--secundario" type="button">Tentar de novo</button>}>
              {api.erro}. A lista abaixo é da última carga.
            </Alert>
          )}
          {!data.durable && (
            <Alert tom="warn" titulo="Sem banco · modo demonstração">
              A carteira está <b>em memória</b> e se perde ao reiniciar a instância. Conecte o Postgres (Neon) para torná-la durável.
            </Alert>
          )}
          {resumo.envelhecidas > 0 && (
            <Alert
              tom="warn"
              titulo="Em aberto há mais de 30 dias"
              acao={status !== "aprovada" ? <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => setStatus("aprovada")}>Ver em aberto</button> : undefined}
            >
              {fmtInt(resumo.envelhecidas)} sugestão(ões); a mais antiga tem {fmtInt(resumo.diasMaisAntiga)} dias. Enquanto estiverem aqui, reservam estoque na origem e reduzem a necessidade do destino em toda análise. Se a transferência não vai acontecer, cancele: o volume volta a ficar disponível.
            </Alert>
          )}
        </div>
      )}

      <Kpis label="Indicadores da carteira">
        <Kpi titulo="Sugestões em aberto" valor={fmtInt(resumo.aprovadas)} sub="aprovadas e ainda não faturadas" />
        <Kpi titulo="Volume comprometido" valor={fmtInt(resumo.qtdAberta)} sub={`unidades reservadas na origem · ${fmtRsCompacto(resumo.valorAberto)}`} />
        <Kpi titulo="A base atual não reflete" valor={fmtInt(resumo.qtdNaoRefletida)} sub={`${fmtRsCompacto(resumo.valorNaoRefletido)} · é o que a próxima análise desconta`} tom={resumo.qtdNaoRefletida > 0 ? "warn" : "default"} />
        <Kpi titulo="Já faturadas" valor={fmtInt(resumo.faturadas)} sub={`${fmtInt(resumo.qtdFaturada)} un confirmadas`} tom="good" />
      </Kpis>

      <Alert tom="info" titulo="Como o app evita duplicar">
        Faturada <i>antes</i> da data da base: já aparece nos números importados e sai da conta. Faturada <i>depois</i>: continua descontando até a próxima base chegar. Por isso a <b>data da posição de estoque</b> informada na importação sustenta o ciclo.{dataBase && <> Base atual com posição de <b>{dataBase}</b>.</>}
      </Alert>

      {/* ------------------------------- Sugestões ------------------------------ */}
      <Secao flush titulo="Sugestões" desc="Aprovadas descontam as próximas análises; faturadas já estão refletidas nas bases; canceladas não contam.">
        <div style={{ padding: "0 24px 16px" }}>
          <div className="pgm-filtros">
            <Campo rotulo="Buscar" htmlFor="c-busca" style={{ minWidth: 240 }}>
              <input id="c-busca" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produto ou código" className="pgm-campo__controle" />
            </Campo>
            <Campo rotulo="Situação" htmlFor="c-status">
              <select id="c-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="pgm-campo__controle">
                <option value="aprovada">Em aberto</option>
                <option value="faturada">Faturadas</option>
                <option value="todas">Todas</option>
              </select>
            </Campo>
            <button type="button" onClick={() => setConfirmaCancelar(true)} disabled={sel.size === 0} className="pgm-botao pgm-botao--perigo">
              Cancelar sugestões ({sel.size})
            </button>
          </div>
        </div>
        <Rolagem>
          <table className="pgm-tabela tabela-fixa">
            <caption className="sr-only">Sugestões da carteira, {fmtInt(itens.length)} nesta visão.</caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    checked={itens.some((s) => s.status === "aprovada") && itens.filter((s) => s.status === "aprovada").every((s) => sel.has(s.id))}
                    onChange={() => {
                      const abertas = itens.filter((s) => s.status === "aprovada");
                      setSel(abertas.every((s) => sel.has(s.id)) ? new Set() : new Set(abertas.map((s) => s.id)));
                    }}
                    aria-label="Selecionar todas as sugestões em aberto"
                  />
                </th>
                <th scope="col">Rota</th><th scope="col">Código</th><th scope="col">Produto</th>
                <th scope="col" className="pgm-num">Aprovada</th><th scope="col" className="pgm-num">Faturada</th><th scope="col" className="pgm-num">Em aberto</th><th scope="col" className="pgm-num">Valor aberto</th>
                <th scope="col">Situação</th><th scope="col">Análise</th><th scope="col">Aprovado em</th><th scope="col" className="pgm-num">Dias</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((s) => {
                const st = situacao(s);
                const d = dias(s);
                return (
                  <tr key={s.id} className={sel.has(s.id) ? "sel" : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={sel.has(s.id)}
                        disabled={s.status !== "aprovada"}
                        aria-label={`Selecionar ${s.produto}`}
                        onChange={() => {
                          const novo = new Set(sel);
                          if (novo.has(s.id)) novo.delete(s.id); else novo.add(s.id);
                          setSel(novo);
                        }}
                      />
                    </td>
                    <td><Rota origem={s.cdOrigem} destino={s.cdDestino} /></td>
                    <td>{s.codigoProduto}</td>
                    <td className="prod" title={s.produto}>{s.produto}</td>
                    <td className="pgm-num">{fmtInt(s.qtd)}</td>
                    <td className="pgm-num">{fmtInt(s.qtdFaturada)}</td>
                    <td className="pgm-num"><b>{fmtInt(aberto(s))}</b></td>
                    <td className="pgm-num">{fmtRs(aberto(s) * s.preco)}</td>
                    <td><Status tom={st.tom}>{st.rotulo}</Status></td>
                    <td>{s.analiseId}</td>
                    <td>{new Date(s.criadoEm).toLocaleDateString("pt-BR")}</td>
                    <td className="pgm-num"><span className="dias" data-velha={s.status === "aprovada" && d >= 30 ? "true" : undefined}>{s.status === "aprovada" ? fmtInt(d) : "—"}</span></td>
                  </tr>
                );
              })}
              {itens.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ padding: 0, background: "var(--papel)" }}>
                    <Estado
                      icone="carteira"
                      rotulo={status === "aprovada" ? "Carteira vazia" : "Sem resultado"}
                      titulo={status === "aprovada" ? "Nenhuma sugestão em aberto" : "Nenhuma sugestão nesta visão"}
                      texto={status === "aprovada" ? "Tudo o que foi aprovado já foi faturado. Aprove linhas no Plano de transferência para a carteira voltar a descontar as próximas análises." : "Troque a situação ou limpe a busca."}
                      acoes={status === "aprovada" ? <a href="/plano" className="pgm-botao">Abrir o plano</a> : <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => { setQ(""); setStatus("todas"); }}>Ver todas</button>}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Rolagem>
        {itens.length > 0 && (
          <div className="tabela-rodape"><span>{fmtInt(itens.length)} sugestão(ões) nesta visão{sel.size > 0 && ` · ${sel.size} selecionada(s)`}</span></div>
        )}
      </Secao>

      {eventos.length > 0 && (
        <Secao flush titulo="Baixas por faturamento" desc="Cada importação confirma o que realmente foi transferido">
          <Rolagem>
            <table className="pgm-tabela">
              <thead>
                <tr><th>Quando</th><th>Quem</th><th>Arquivo</th><th className="pgm-num">Linhas</th><th className="pgm-num">Casadas</th><th className="pgm-num">Sem correspondência</th><th className="pgm-num">Unidades baixadas</th></tr>
              </thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.em).toLocaleString("pt-BR")}</td>
                    <td>{e.por}</td>
                    <td className="prod" style={{ maxWidth: 320 }} title={e.arquivo}>{e.arquivo}</td>
                    <td className="pgm-num">{fmtInt(e.linhas)}</td>
                    <td className="pgm-num">{fmtInt(e.casadas)}</td>
                    <td className="pgm-num">{e.semCorrespondencia > 0 ? <Pill tom="ambar" pequena>{fmtInt(e.semCorrespondencia)}</Pill> : "0"}</td>
                    <td className="pgm-num">{fmtInt(e.qtdBaixada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Rolagem>
        </Secao>
      )}

      <Fonte>Fonte: carteira de sugestões ({data.durable ? "armazenamento durável" : "em memória"}){dataBase && ` · base de CDs com posição de ${dataBase}`} · envelhecimento = mais de 30 dias em aberto.</Fonte>

      {/* ------------------------ Modal: cancelar sugestões ---------------------- */}
      <Modal
        aberto={confirmaCancelar}
        titulo={`Cancelar ${sel.size} sugest${sel.size === 1 ? "ão" : "ões"}?`}
        sub={`O volume volta a ficar disponível: ${fmtInt(unSelecionadas)} unidades deixam de ser reservadas na origem e saem do trânsito do destino.`}
        onFechar={() => setConfirmaCancelar(false)}
        largura={520}
        rodape={
          <>
            <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => setConfirmaCancelar(false)}>Manter</button>
            <button type="button" className="pgm-botao pgm-botao--perigo" disabled={cancelando} onClick={cancelar}>
              {cancelando ? "Cancelando…" : `Cancelar ${sel.size} sugest${sel.size === 1 ? "ão" : "ões"}`}
            </button>
          </>
        }
      >
        <div className="mb-lista">
          {selecionadas.slice(0, 6).map((s) => (
            <div key={s.id} className="mb-item">
              <div><b>{s.produto} · {s.codigoProduto}</b><span>CD {s.cdOrigem} → CD {s.cdDestino} · {situacao(s).rotulo.toLowerCase()}</span></div>
              <span className="v">{fmtInt(aberto(s))} un</span>
            </div>
          ))}
          {selecionadas.length > 6 && <div className="mb-item"><div><b>Mais {selecionadas.length - 6} sugestão(ões)</b></div><span className="v"></span></div>}
        </div>
        <Alert tom="warn" titulo="Sem volta">A sugestão cancelada fica no histórico, mas não pode ser reaberta. Para transferir de novo, rode uma análise.</Alert>
      </Modal>

      {/* ---------------------- Modal: base de faturamento ---------------------- */}
      <Modal
        aberto={modal}
        titulo="Importar base de faturamento"
        sub={<>A planilha confirma o que <b>já foi transferido</b>. As sugestões correspondentes recebem baixa e param de descontar as próximas análises.</>}
        onFechar={() => setModal(false)}
        largura={760}
        rodape={
          <>
            <span className="nota">{previa ? "Prévia: nada foi gravado ainda." : achados ? "Resultado da última operação." : "Escolha o arquivo e valide antes de aplicar."}</span>
            <button type="button" onClick={() => setModal(false)} className="pgm-botao pgm-botao--secundario">Fechar</button>
            <button type="button" onClick={() => enviarFaturamento(true)} disabled={!fatFile || enviando} className="pgm-botao pgm-botao--secundario">Validar</button>
            <button type="button" onClick={() => enviarFaturamento(false)} disabled={!fatFile || enviando} className="pgm-botao">Aplicar baixa</button>
          </>
        }
      >
        <div className="colunas">
          <b>Colunas esperadas</b>
          CD origem · CD destino · código do produto · quantidade faturada · (opcional) documento/NF e data. O casamento é por <strong>rota + produto</strong>, na ordem de aprovação, com baixa parcial quando a quantidade faturada é menor que a aprovada.
        </div>

        <input ref={fatRef} type="file" accept=".csv,.xlsx,.xls,.xlsb" className="sr-only" id="arq-fat" onChange={(e) => { setFatFile(e.target.files?.[0] ?? null); setPrevia(null); setAchados(null); }} />
        <div className="upload" data-ok={fatFile ? "true" : undefined}>
          <span className="upload__ico"><Icone nome={fatFile ? "check" : "upload"} tamanho={22} /></span>
          <div className="upload__txt">
            <b>{fatFile ? fatFile.name : "Nenhum arquivo escolhido"}</b>
            <span>{fatFile ? `${(fatFile.size / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB · pronto para validar` : "CSV, XLSX ou XLSB"}</span>
          </div>
          <button type="button" className="pgm-botao pgm-botao--secundario" onClick={() => fatRef.current?.click()}>{fatFile ? "Trocar" : "Escolher arquivo"}</button>
        </div>

        {enviando && <Progress pct={progresso} label="Enviando e processando…" />}

        {previa && (
          <div>
            <p className="pgm-campo__rotulo" style={{ margin: "0 0 8px" }}>Prévia da baixa</p>
            <div className="resumo-previa">
              <div><b>{fmtInt(previa.linhas)}</b><span>linhas no arquivo</span></div>
              <div><b>{fmtInt(previa.quantidadeTotal)}</b><span>unidades a baixar</span></div>
              <div><b>{previa.rotas.length}</b><span>rota(s): {previa.rotas.slice(0, 6).join(", ")}{previa.rotas.length > 6 ? "…" : ""}</span></div>
            </div>
          </div>
        )}

        {achados && achados.length > 0 && (
          <div className="flex flex-col gap-3">
            {achados.map((a, i) => (
              <Alert key={i} tom={nivelTom[a.nivel]} titulo={`${a.nivel === "erro" ? "Erro" : a.nivel === "aviso" ? "Atenção" : "Informação"}${a.qtd > 0 ? ` · ${fmtInt(a.qtd)}` : ""}`}>
                {a.mensagem}
                {a.exemplos && a.exemplos.length > 0 && <> Exemplos: {a.exemplos.slice(0, 6).join(" · ")}.</>}
              </Alert>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
