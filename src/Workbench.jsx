import { useEffect, useMemo, useState } from 'react';
import {
  STANCES, stanceOf, linksOfQuestion, coverage, unlinkedPapers,
  questionsOfPaper, buildExport, downloadJSON,
} from './store.js';

function Badge({ stance }) {
  const s = stanceOf(stance);
  return <span className={`stance-badge ${s.cls}`}>{s.label}</span>;
}

/* 问题编辑/新建弹窗 */
function QuestionDialog({ initial, onClose, onSubmit }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const submit = () => {
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), description: description.trim() });
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <span className="crumb">{initial ? 'EDIT QUESTION' : 'NEW QUESTION'}</span>
        <h2>{initial ? '编辑研究问题' : '创建研究问题'}</h2>
        <label>问题标题
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：认知是否只发生在大脑内部？"
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <label>问题描述 / 研究背景
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="这个问题想检验什么？怎样的证据算支持或反驳？" />
        </label>
        <button className="primary full" onClick={submit}>{initial ? '保存修改' : '创建问题'}</button>
      </div>
    </div>
  );
}

/* 关联文献弹窗：从"当前问题尚未关联"的文献中选择 */
function LinkDialog({ data, questionId, presetPaperId, onClose, onSubmit }) {
  const candidates = unlinkedPapers(data, questionId);
  const [paperId, setPaperId] = useState(presetPaperId ?? candidates[0]?.id ?? null);
  const [stance, setStance] = useState('support');
  const [excerpt, setExcerpt] = useState('');
  const [note, setNote] = useState('');

  const submit = () => {
    if (paperId == null) return;
    if (!excerpt.trim()) return;
    onSubmit({ questionId, paperId, stance, excerpt, note });
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <span className="crumb">NEW EVIDENCE LINK</span>
        <h2>关联文献作为证据</h2>
        <label>选择文献（仅显示尚未关联到本问题的文献）
          {candidates.length ? (
            <select className="ctl" value={paperId ?? ''} onChange={(e) => setPaperId(Number(e.target.value) || e.target.value)}>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>{p.title} — {p.authors} ({p.year})</option>
              ))}
            </select>
          ) : <p className="empty-hint">所有文献都已关联到本问题。如需修改立场或摘录，请直接编辑现有关联。</p>}
        </label>
        <label>立场
          <div className="stance-picker">
            {STANCES.map((s) => (
              <button key={s.key} type="button"
                className={`stance-opt ${s.cls} ${stance === s.key ? 'on' : ''}`}
                onClick={() => setStance(s.key)}>{s.label}</button>
            ))}
          </div>
        </label>
        <label>原文摘录 <span className="req">*</span>
          <textarea rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)}
            placeholder="粘贴支持/反驳该立场的原文片段…" />
        </label>
        <label>我的批注（可选）
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="为什么这样判定？证据强度如何？" />
        </label>
        <button className="primary full" disabled={!paperId || !excerpt.trim()} onClick={submit}>建立关联</button>
      </div>
    </div>
  );
}

/* 单条证据卡，可内联编辑 */
function EvidenceCard({ link, paper, onEdit, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [stance, setStance] = useState(link.stance);
  const [excerpt, setExcerpt] = useState(link.excerpt);
  const [note, setNote] = useState(link.note || '');

  const save = () => {
    if (!excerpt.trim()) return;
    onEdit(link.id, { stance, excerpt: excerpt.trim(), note: note.trim() });
    setEditing(false);
  };

  return (
    <article className={`evidence-card ${stanceOf(link.stance).cls}`}>
      <header>
        <Badge stance={link.stance} />
        <div className="ev-title">
          <h4>{paper?.title ?? '(已删除的文献)'}</h4>
          <small>{paper ? `${paper.authors} · ${paper.year}` : '文献已从库中移除'}</small>
        </div>
        <div className="ev-actions">
          <button onClick={() => setEditing((v) => !v)}>{editing ? '取消' : '编辑'}</button>
          <button className="danger" onClick={() => onRemove(link.id)}>解除关联</button>
        </div>
      </header>

      {!editing ? (
        <>
          <blockquote>{link.excerpt}</blockquote>
          {link.note && <p className="ev-note">✎ {link.note}</p>}
        </>
      ) : (
        <div className="ev-edit">
          <div className="stance-picker">
            {STANCES.map((s) => (
              <button key={s.key} type="button"
                className={`stance-opt ${s.cls} ${stance === s.key ? 'on' : ''}`}
                onClick={() => setStance(s.key)}>{s.label}</button>
            ))}
          </div>
          <textarea rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="批注（可选）" />
          <button className="primary small" onClick={save}>保存</button>
        </div>
      )}
    </article>
  );
}

export default function Workbench({ store, notice, focusQuestionId }) {
  const { questions, links, papers } = store;
  const [selectedId, setSelectedId] = useState(focusQuestionId ?? questions[0]?.id ?? null);
  const [stanceFilter, setStanceFilter] = useState('all');
  const [qQuery, setQQuery] = useState('');
  const [editingQuestion, setEditingQuestion] = useState(null); // null | 'new' | question object
  const [linkDialog, setLinkDialog] = useState(null); // { presetPaperId? } | null

  // 从文献详情跳转过来时定位到指定问题
  useEffect(() => {
    if (focusQuestionId) setSelectedId(focusQuestionId);
  }, [focusQuestionId]);

  // 问题可能被删除后，选中项需要兜底
  const question = questions.find((q) => q.id === selectedId) || questions[0] || null;
  const qid = question?.id;

  const qLinks = useMemo(() => (qid ? linksOfQuestion(links, qid) : []), [links, qid]);
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const cov = useMemo(() => (qid ? coverage({ papers, links }, qid) : null), [papers, links, qid]);
  const unlinked = useMemo(() => (qid ? unlinkedPapers({ papers, links }, qid) : []), [papers, links, qid]);

  const visibleLinks = stanceFilter === 'all' ? qLinks : qLinks.filter((l) => l.stance === stanceFilter);
  const filteredQuestions = questions.filter((q) =>
    `${q.title}${q.description}`.toLowerCase().includes(qQuery.toLowerCase()));

  const handleCreate = ({ title, description }) => {
    const id = store.addQuestion(title, description);
    setSelectedId(id);
    setEditingQuestion(null);
    notice('研究问题已创建');
  };
  const handleEdit = ({ title, description }) => {
    store.updateQuestion(editingQuestion.id, { title, description });
    setEditingQuestion(null);
    notice('问题已更新');
  };
  const handleDelete = () => {
    if (!question) return;
    if (!confirm(`删除问题「${question.title}」？其下 ${qLinks.length} 条证据关联将一并解除（文献本身保留）。`)) return;
    store.deleteQuestion(question.id);
    setSelectedId(questions.find((q) => q.id !== question.id)?.id ?? null);
    notice('问题已删除');
  };
  const handleLink = (payload) => {
    const res = store.addLink(payload);
    if (!res.ok) {
      notice(res.error, true);
      return;
    }
    setLinkDialog(null);
    notice('文献已关联为证据');
  };

  const doExport = () => {
    const obj = buildExport({ papers, questions, links }, qid);
    const safe = question.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    downloadJSON(`question-${safe || qid}.json`, obj);
    notice('当前问题已导出为结构化 JSON 文件');
  };

  return (
    <div className="wb">
      {/* 左：问题列表 */}
      <div className="wb-list">
        <div className="wb-list-head">
          <strong>研究问题</strong>
          <button className="primary small" onClick={() => setEditingQuestion('new')}>＋ 新建问题</button>
        </div>
        <div className="search compact">⌕
          <input placeholder="筛选问题…" value={qQuery} onChange={(e) => setQQuery(e.target.value)} />
        </div>
        <div className="q-list">
          {filteredQuestions.map((q) => {
            const n = linksOfQuestion(links, q.id).length;
            return (
              <button key={q.id} className={`q-item ${q.id === qid ? 'on' : ''}`} onClick={() => setSelectedId(q.id)}>
                <h4>{q.title}</h4>
                <small>{n} 条证据 · {new Set(linksOfQuestion(links, q.id).map((l) => l.paperId)).size} 篇文献</small>
              </button>
            );
          })}
          {!filteredQuestions.length && <div className="no-result">没有匹配的问题，点击「新建问题」开始</div>}
        </div>
      </div>

      {/* 右：问题工作台 */}
      <div className="wb-main">
        {!question ? (
          <div className="wb-empty">
            <p>还没有研究问题。</p>
            <button className="primary" onClick={() => setEditingQuestion('new')}>＋ 创建第一个问题</button>
          </div>
        ) : (
          <>
            <div className="wb-head">
              <div>
                <span className="crumb">RESEARCH QUESTION</span>
                <h2>{question.title}</h2>
                {question.description && <p className="q-desc">{question.description}</p>}
              </div>
              <div className="actions">
                <button className="outline" onClick={() => setEditingQuestion(question)}>编辑问题</button>
                <button className="outline danger-text" onClick={handleDelete}>删除</button>
                <button className="primary" onClick={doExport}>↓ 导出当前问题</button>
              </div>
            </div>

            {/* 证据覆盖 */}
            <div className="coverage">
              <div className="cov-main">
                <small>证据覆盖</small>
                <strong>{cov.linked}<small>/{cov.total} 篇文献</small></strong>
                <div className="cov-bar">
                  <i className="sup" style={{ flexGrow: cov.byStance.support }} />
                  <i className="ref" style={{ flexGrow: cov.byStance.refute }} />
                  <i className="unc" style={{ flexGrow: cov.byStance.uncertain }} />
                </div>
              </div>
              {STANCES.map((s) => (
                <div className={`cov-chip ${s.cls}`} key={s.key}>
                  <span>{s.label}</span><b>{cov.byStance[s.key]}</b>
                </div>
              ))}
              <div className="cov-chip neutral">
                <span>未关联文献</span><b>{cov.unlinked}</b>
              </div>
            </div>

            {/* 立场筛选 */}
            <div className="wb-toolbar">
              <div className="stance-filter">
                <button className={stanceFilter === 'all' ? 'on' : ''} onClick={() => setStanceFilter('all')}>
                  全部立场 <b>{qLinks.length}</b>
                </button>
                {STANCES.map((s) => (
                  <button key={s.key} className={`${s.cls} ${stanceFilter === s.key ? 'on' : ''}`}
                    onClick={() => setStanceFilter(s.key)}>
                    {s.label} <b>{cov.byStance[s.key]}</b>
                  </button>
                ))}
              </div>
              <button className="primary small" onClick={() => setLinkDialog({})}>＋ 关联文献为证据</button>
            </div>

            {/* 证据列表 */}
            <div className="evidence-list">
              {visibleLinks.map((l) => (
                <EvidenceCard key={l.id} link={l} paper={paperById.get(l.paperId)}
                  onEdit={(id, patch) => { store.updateLink(id, patch); notice('关联已更新'); }}
                  onRemove={(id) => { store.removeLink(id); notice('关联已解除'); }} />
              ))}
              {!visibleLinks.length && (
                <div className="no-result">
                  {stanceFilter === 'all' ? '还没有证据，点击「关联文献为证据」开始。' : '该立场下暂无证据。'}
                </div>
              )}
            </div>

            {/* 未关联文献 */}
            <div className="unlinked">
              <h4>未关联文献（{unlinked.length}）<span>尚未进入本问题，可快速补入证据</span></h4>
              {unlinked.length ? (
                <div className="unlinked-grid">
                  {unlinked.map((p) => {
                    const otherQs = questionsOfPaper(links, questions, p.id);
                    return (
                      <div className="unlinked-item" key={p.id}>
                        <div>
                          <strong>{p.title}</strong>
                          <small>{p.authors} · {p.year}</small>
                          {otherQs.length > 0 && <em>已在 {otherQs.length} 个其他问题中</em>}
                        </div>
                        <button className="outline small" onClick={() => setLinkDialog({ presetPaperId: p.id })}>关联</button>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="empty-hint">库中文献均已纳入本问题。</p>}
            </div>
          </>
        )}
      </div>

      {editingQuestion === 'new' && (
        <QuestionDialog onClose={() => setEditingQuestion(null)} onSubmit={handleCreate} />
      )}
      {editingQuestion && editingQuestion !== 'new' && (
        <QuestionDialog initial={editingQuestion} onClose={() => setEditingQuestion(null)} onSubmit={handleEdit} />
      )}
      {linkDialog && qid && (
        <LinkDialog data={{ papers, questions, links }} questionId={qid}
          presetPaperId={linkDialog.presetPaperId}
          onClose={() => setLinkDialog(null)}
          onSubmit={handleLink} />
      )}
    </div>
  );
}
