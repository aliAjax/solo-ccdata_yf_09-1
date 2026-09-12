import { useCallback, useState } from 'react';
import { useResearch, linksOfQuestion } from './store.js';
import Library from './Library.jsx';
import Workbench from './Workbench.jsx';

export default function App() {
  const store = useResearch();
  const [view, setView] = useState('library'); // 'library' | 'workbench'
  const [focusQuestion, setFocusQuestion] = useState(null);
  const [toast, setToast] = useState(null); // { text, error }

  const notice = useCallback((text, error = false) => {
    setToast({ text, error });
    clearTimeout(notice._t);
    notice._t = setTimeout(() => setToast(null), 2600);
  }, []);

  const goQuestion = (qid) => {
    setFocusQuestion(qid);
    setView('workbench');
  };

  const nQuestions = store.questions.length;
  const nLinks = store.links.length;
  const unlinkedCount =
    store.papers.length -
    new Set(
      store.questions.flatMap((q) => linksOfQuestion(store.links, q.id).map((l) => l.paperId)),
    ).size;

  return (
    <div className="app">
      <aside>
        <div className="logo"><span>∴</span> RESEARCH</div>
        <div className="library-head">
          <span>本地研究数据</span>
          <strong>{store.papers.length}<small> 篇文献</small></strong>
        </div>
        <nav>
          <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>
            ▤ <span>所有文献</span><b>{store.papers.length}</b>
          </button>
          <button className={view === 'workbench' ? 'active' : ''} onClick={() => setView('workbench')}>
            ◈ <span>问题工作台</span><b>{nQuestions}</b>
          </button>
        </nav>
        <div className="side-tags">
          <small>工作台概览</small>
          <button onClick={() => setView('workbench')}>◈ {nQuestions} 个研究问题</button>
          <button onClick={() => setView('workbench')}>⌗ {nLinks} 条证据关联</button>
          <button onClick={() => setView('library')}>○ {Math.max(unlinkedCount, 0)} 篇未进任何问题</button>
        </div>
        <div className="side-foot">
          <small>数据仅保存在本机浏览器</small>
          <small>localStorage · 刷新不丢失</small>
        </div>
      </aside>

      <main>
        <div className="mobile-tabs" role="tablist" aria-label="视图切换">
          <button role="tab" aria-selected={view === 'library'}
            className={view === 'library' ? 'on' : ''} onClick={() => setView('library')}>
            ▤ 所有文献 <b>{store.papers.length}</b>
          </button>
          <button role="tab" aria-selected={view === 'workbench'}
            className={view === 'workbench' ? 'on' : ''} onClick={() => setView('workbench')}>
            ◈ 问题工作台 <b>{nQuestions}</b>
          </button>
        </div>
        {view === 'library' ? (
          <Library store={store} notice={notice} goQuestion={goQuestion} />
        ) : (
          <Workbench store={store} notice={notice} focusQuestionId={focusQuestion} />
        )}
      </main>

      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.text}</div>}
    </div>
  );
}
