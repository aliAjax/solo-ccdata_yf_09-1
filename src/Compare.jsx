import { useMemo, useState } from 'react';
import { compareQuestions, stanceOf } from './store.js';

function MiniStance({ link, onClick, label }) {
  if (!link) return <span className="cmp-none">— 未关联</span>;
  const s = stanceOf(link.stance);
  return (
    <button className={`cmp-stance ${s.cls}`} onClick={onClick}
      title={`${label}：${s.label}。点击跳转到该问题`}>
      <b>{s.label}</b>
      {link.excerpt ? <q>{link.excerpt}</q> : <q className="no-excerpt">（无摘录）</q>}
    </button>
  );
}

function PaperRow({ row, qidA, qidB, goPaper, goQuestion, conflict }) {
  return (
    <div className={`cmp-row ${conflict ? 'conflict' : ''}`}>
      <div className="cmp-row-head">
        <button className="cmp-paper" onClick={() => goPaper(row.paper.id)}>
          {conflict && <span className="cmp-warn" title="立场冲突">⚡</span>}
          <strong>{row.paper.title}</strong>
          <small>{[row.paper.authors, row.paper.year].filter(Boolean).join(' · ')}</small>
        </button>
      </div>
      <div className="cmp-sides">
        <MiniStance link={row.linkA} label="问题 A 立场" onClick={() => goQuestion(qidA)} />
        <MiniStance link={row.linkB} label="问题 B 立场" onClick={() => goQuestion(qidB)} />
      </div>
    </div>
  );
}

function Section({ title, hint, rows, tone, qidA, qidB, goPaper, goQuestion, conflicts }) {
  if (!rows.length) return null;
  return (
    <section className={`cmp-section ${tone || ''}`}>
      <h4>{title} <b>{rows.length}</b><span>{hint}</span></h4>
      <div className="cmp-rows">
        {rows.map((row) => (
          <PaperRow key={row.paper.id} row={row} qidA={qidA} qidB={qidB}
            goPaper={goPaper} goQuestion={goQuestion}
            conflict={conflicts?.has(row.paper.id)} />
        ))}
      </div>
    </section>
  );
}

export default function Compare({ store, goPaper, goQuestion, onExit }) {
  const { papers, questions, links } = store;
  const [a, setA] = useState(questions[0]?.id ?? '');
  const [b, setB] = useState(questions[1]?.id ?? '');

  const qa = questions.find((q) => q.id === a);
  const qb = questions.find((q) => q.id === b);

  const result = useMemo(() => {
    if (!a || !b || a === b) return null;
    return compareQuestions({ papers, questions, links }, a, b);
  }, [papers, questions, links, a, b]);

  const conflictIds = useMemo(
    () => new Set((result?.conflicts || []).map((r) => r.paper.id)), [result]);

  // 同立场（共同且非冲突）
  const aligned = result
    ? result.shared.filter((r) => !conflictIds.has(r.paper.id))
    : [];

  return (
    <div className="cmp">
      <div className="cmp-head">
        <div>
          <span className="crumb">COMPARE · 双问题对比</span>
          <h2>对比两个研究问题</h2>
        </div>
        <button className="outline" onClick={onExit}>← 返回当前问题</button>
      </div>

      {questions.length < 2 ? (
        <div className="cmp-empty block">
          <span>◔</span>
          <h3>至少需要两个研究问题才能对比</h3>
          <p>当前只有 {questions.length} 个问题。请先返回工作台再创建一个问题，并为其关联文献证据。</p>
          <button className="primary" onClick={onExit}>返回工作台创建问题</button>
        </div>
      ) : (
        <div className="cmp-picker">
          <label>问题 A
            <select value={a} onChange={(e) => setA(e.target.value)}>
              <option value="" disabled>选择问题…</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>{q.title}</option>
              ))}
            </select>
          </label>
          <span className="cmp-vs" aria-hidden>⇄</span>
          <label>问题 B
            <select value={b} onChange={(e) => setB(e.target.value)}>
              <option value="" disabled>选择问题…</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>{q.id === a ? `${q.title}（与 A 相同）` : q.title}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {questions.length >= 2 && (!a || !b) && (
        <div className="cmp-empty"><span>⇢</span> 请在两侧各选择一个问题。</div>
      )}

      {questions.length >= 2 && a && b && a === b && (
        <div className="cmp-empty warn">
          <span>⚑</span>
          <div><h3>不能将问题与自身对比</h3><p>请把问题 A、问题 B 改为两个不同的问题。</p></div>
        </div>
      )}

      {result && (result.totalEvidence === 0) && (
        <div className="cmp-empty block">
          <span>◌</span>
          <h3>暂无可比内容</h3>
          <p>这两个问题都还没有关联任何文献证据。请先在工作台为「{qa.title}」或「{qb.title}」关联文献。</p>
          <div className="cmp-empty-actions">
            <button className="outline" onClick={() => goQuestion(a)}>去「{qa.title}」关联</button>
            <button className="outline" onClick={() => goQuestion(b)}>去「{qb.title}」关联</button>
          </div>
        </div>
      )}

      {result && result.totalEvidence > 0 && (
        <>
          <div className="cmp-summary">
            <div className="cmp-sum-card shared"><b>{result.shared.length}</b><span>共同文献</span></div>
            <div className={`cmp-sum-card conflict ${result.conflicts.length ? 'hot' : ''}`}>
              <b>{result.conflicts.length}</b><span>立场冲突</span>
            </div>
            <div className="cmp-sum-card only"><b>{result.onlyA.length}</b><span>仅 A 有</span></div>
            <div className="cmp-sum-card only"><b>{result.onlyB.length}</b><span>仅 B 有</span></div>
            <p className="cmp-tip">点击文献标题可跳到文献详情；点击立场块可跳回对应问题。冲突定义：一方「支持」、另一方「反驳」；「存疑」不计为硬冲突。</p>
          </div>

          {result.conflicts.length > 0 && (
            <Section tone="conflict" title="⚡ 立场冲突的共同文献"
              hint="两个问题下结论相互对立" rows={result.conflicts}
              qidA={a} qidB={b} goPaper={goPaper} goQuestion={goQuestion}
              conflicts={conflictIds} />
          )}

          <Section title="共同文献（立场一致或存疑）"
            hint={`${aligned.length} 篇：双方都引用，且不存在支持↔反驳冲突`}
            rows={aligned}
            qidA={a} qidB={b} goPaper={goPaper} goQuestion={goQuestion} conflicts={conflictIds} />

          <Section tone="only-a" title={`仅「${qa.title}」`}
              hint="A 独有证据" rows={result.onlyA}
              qidA={a} qidB={b} goPaper={goPaper} goQuestion={goQuestion} />

          <Section tone="only-b" title={`仅「${qb.title}」`}
              hint="B 独有证据" rows={result.onlyB}
              qidA={a} qidB={b} goPaper={goPaper} goQuestion={goQuestion} />

          {result.shared.length === 0 && result.totalEvidence > 0 && (
            <div className="cmp-empty"><span>◇</span> 两个问题没有共同文献——下方仅列出各自独有文献。</div>
          )}
        </>
      )}
    </div>
  );
}
