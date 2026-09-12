import { useEffect, useMemo, useState } from 'react';
import { uid, questionsOfPaper } from './store.js';

export default function Library({ store, notice, goQuestion, focusPaperId }) {
  const { papers, questions, links, savePaper } = store;
  const [selected, setSelected] = useState(focusPaperId ?? papers[0]?.id ?? null);
  useEffect(() => {
    if (focusPaperId != null) setSelected(focusPaperId);
  }, [focusPaperId]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('全部');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ title: '', authors: '', year: '2024', venue: '', abstract: '', tags: '' });

  const tags = ['全部', ...new Set(papers.flatMap((x) => x.tags || []))];
  const filtered = useMemo(
    () => papers.filter((x) =>
      (tag === '全部' || (x.tags || []).includes(tag)) &&
      `${x.title}${x.authors}${x.abstract}`.toLowerCase().includes(query.toLowerCase())),
    [papers, tag, query],
  );
  const cur = papers.find((x) => x.id === selected) || papers[0] || null;

  const update = (k, v) => cur && savePaper({ ...cur, [k]: v });
  const add = () => {
    if (!form.title.trim()) return;
    const p = {
      ...form, id: uid(), year: +form.year || null,
      tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean),
      status: '待读',
      cite: `${form.authors} (${form.year}). ${form.title}. ${form.venue}.`,
    };
    savePaper(p);
    setSelected(p.id);
    setForm({ title: '', authors: '', year: '2024', venue: '', abstract: '', tags: '' });
    setShow(false);
    notice('文献已加入研究库');
  };
  const bib = () => {
    navigator.clipboard?.writeText(cur.cite);
    notice('引用文本已复制');
  };
  const download = () => {
    const blob = new Blob([papers.map((x) => x.cite).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'references.txt'; a.click();
    URL.revokeObjectURL(url);
    notice('引用列表已导出');
  };

  return (
    <>
      <header>
        <div>
          <span className="crumb">RESEARCH / LIBRARY</span>
          <h1>所有文献</h1>
        </div>
        <div className="actions">
          <button className="outline" onClick={download}>↓ 导出引用</button>
          <button className="primary" onClick={() => setShow(true)}>＋ 添加文献</button>
        </div>
      </header>
      <div className="toolbar">
        <div className="search">⌕
          <input placeholder="搜索标题、作者或摘要…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery('')}>×</button>}
        </div>
        <div className="tag-filter">
          {tags.map((t) => (
            <button className={tag === t ? 'on' : ''} onClick={() => setTag(t)} key={t}>{t}</button>
          ))}
        </div>
      </div>
      <div className="body">
        <section className="paper-list">
          {filtered.map((p) => {
            const n = questionsOfPaper(links, questions, p.id).length;
            return (
              <button className={'paper ' + (cur?.id === p.id ? 'selected' : '')} onClick={() => setSelected(p.id)} key={p.id}>
                <div className="paper-year">{p.year}</div>
                <div className="paper-copy">
                  <h3>{p.title}</h3>
                  <p>{p.authors}</p>
                  <div>
                    {(p.tags || []).map((t) => <span key={t}>#{t}</span>)}
                    {n > 0 && <span className="qmark">◈ {n} 个问题</span>}
                  </div>
                </div>
                <small className={'status ' + p.status}>{p.status}</small>
              </button>
            );
          })}
          {!filtered.length && <div className="no-result">没有找到匹配的文献</div>}
        </section>
        <section className="detail">
          {cur && (
            <>
              <div className="detail-top">
                <span className="status reading">{cur.status}</span>
                <button onClick={() => update('status', cur.status === '已读' ? '待读' : '已读')}>
                  {cur.status === '已读' ? '标记为待读' : '标记为已读'}
                </button>
              </div>
              <h2>{cur.title}</h2>
              <p className="authors">{cur.authors}</p>
              <div className="cite-actions">
                <button onClick={bib}>▣ 复制引用</button>
              </div>

              <div className="detail-section">
                <h4>所属研究问题 <span>QUESTIONS</span></h4>
                {(() => {
                  const myQ = questionsOfPaper(links, questions, cur.id);
                  if (!myQ.length) return <p className="empty-hint">尚未进入任何研究问题，可到「问题工作台」将其关联为证据。</p>;
                  return (
                    <div className="paper-qchips">
                      {myQ.map((q) => {
                        const lk = links.find((l) => l.questionId === q.id && l.paperId === cur.id);
                        const s = { support: '支持', refute: '反驳', uncertain: '存疑' }[lk.stance];
                        return (
                          <button key={q.id} className={`q-chip ${lk.stance}`} onClick={() => goQuestion(q.id)}>
                            <span className="q-chip-stance">{s}</span>{q.title}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              <div className="detail-section">
                <h4>摘要 <span>ABSTRACT</span></h4>
                <p>{cur.abstract}</p>
              </div>
              <div className="detail-section">
                <h4>出版信息 <span>PUBLICATION</span></h4>
                <div className="pub-grid">
                  <div><small>出版物</small><strong>{cur.venue}</strong></div>
                  <div><small>年份</small><strong>{cur.year}</strong></div>
                </div>
              </div>
              <div className="detail-section">
                <h4>引用文本 <span>BIBTEX / TEXT</span></h4>
                <div className="cite-box">{cur.cite}<button onClick={bib}>复制</button></div>
              </div>
              <div className="detail-section">
                <h4>我的笔记 <span>PRIVATE</span></h4>
                <textarea className="notes" placeholder="记录你的阅读想法…" value={cur.notes || ''}
                  onChange={(e) => update('notes', e.target.value)} />
              </div>
            </>
          )}
        </section>
      </div>

      {show && (
        <div className="modal-bg" onClick={() => setShow(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setShow(false)}>×</button>
            <span className="crumb">NEW REFERENCE</span>
            <h2>添加一篇文献</h2>
            <label>标题
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="论文或书籍标题" />
            </label>
            <label>作者<input value={form.authors} onChange={(e) => setForm({ ...form, authors: e.target.value })} /></label>
            <div className="two">
              <label>年份<input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></label>
              <label>出版物<input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label>
            </div>
            <label>关键词<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="用逗号分隔" /></label>
            <label>摘要<textarea rows={3} value={form.abstract} onChange={(e) => setForm({ ...form, abstract: e.target.value })} /></label>
            <button className="primary full" onClick={add}>保存文献</button>
          </div>
        </div>
      )}
    </>
  );
}
