import { useEffect, useState } from 'react';

/* ---------- 立场配置 ---------- */
export const STANCES = [
  { key: 'support', label: '支持', cls: 'sup' },
  { key: 'refute', label: '反驳', cls: 'ref' },
  { key: 'uncertain', label: '存疑', cls: 'unc' },
];
export const stanceOf = (key) => STANCES.find((s) => s.key === key) || STANCES[2];

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
  `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ---------- 本地存储 ---------- */
const KEY = 'research-workbench-v1';
const OLD_KEY = 'research-library';

const seedPapers = [
  { id: 1, title: 'The Extended Mind', authors: 'Clark, A. & Chalmers, D.', year: 1998, venue: 'Analysis', tags: ['具身认知', '经典'], abstract: '本文提出心智延展论：当外部环境稳定地承担认知功能时，心智边界可以超越头脑与身体。', status: '阅读中', cite: 'Clark, A. & Chalmers, D. (1998). The Extended Mind. Analysis.' },
  { id: 2, title: 'Situated Learning', authors: 'Lave, J. & Wenger, E.', year: 1991, venue: 'Cambridge University Press', tags: ['学习科学', '社会'], abstract: '学习发生在真实情境的参与过程中，知识与共同体实践不可分割。', status: '待读', cite: 'Lave, J. & Wenger, E. (1991). Situated Learning.' },
  { id: 3, title: 'Designing with Data', authors: 'Miller, S.', year: 2022, venue: 'MIT Press', tags: ['设计研究', '方法'], abstract: '一套面向设计师的数据研究方法，讨论如何把定性洞察转化为可行动的设计决策。', status: '已读', cite: 'Miller, S. (2022). Designing with Data.' },
  { id: 4, title: 'The Sciences of the Artificial', authors: 'Simon, H. A.', year: 1969, venue: 'MIT Press', tags: ['经典', '设计科学'], abstract: '讨论人工物的科学：设计作为一种处理"应当如何"的思维方式，与自然科学形成对照。', status: '待读', cite: 'Simon, H. A. (1969). The Sciences of the Artificial. MIT Press.' },
];

const seedQuestions = [
  { id: 'q1', title: '认知是否只发生在大脑内部？', description: '检验心智的边界是否可以延伸到外部工具与环境：内部表征是不是认知的必要条件。', createdAt: 1 },
  { id: 'q2', title: '情境化的研究结论能否直接转化为设计决策？', description: '考察定性、情境化的研究证据与可行动设计决策之间的距离与转化条件。', createdAt: 2 },
];

const seedLinks = [
  { id: 'lk1', questionId: 'q1', paperId: 1, stance: 'support', excerpt: '当外部环境稳定地承担认知功能时，心智的边界就可以超越头脑与皮肤。', note: '核心论点，正面立论。', createdAt: 1 },
  { id: 'lk2', questionId: 'q1', paperId: 2, stance: 'uncertain', excerpt: '学习发生在真实情境的参与过程中，知识与共同体实践不可分割。', note: '强调情境，但未直接否认内部表征，立场存疑。', createdAt: 2 },
  { id: 'lk3', questionId: 'q2', paperId: 3, stance: 'support', excerpt: '定性洞察可以通过结构化方法转化为可行动的设计决策。', note: '方法论上的直接支持。', createdAt: 3 },
  { id: 'lk4', questionId: 'q2', paperId: 1, stance: 'uncertain', excerpt: '心智延展暗示环境设计会影响认知过程，但书中并未给出决策层面的操作方法。', note: '同一篇文献在不同问题下可以持不同立场。', createdAt: 4 },
];

function seedData() {
  return { papers: seedPapers, questions: seedQuestions, links: seedLinks };
}

function withDefaults(d) {
  return {
    papers: Array.isArray(d.papers) ? d.papers : [],
    questions: Array.isArray(d.questions) ? d.questions : [],
    links: Array.isArray(d.links) ? d.links : [],
  };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return withDefaults(JSON.parse(raw));
    // 迁移旧版纯文献库数据
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
    const base = seedData();
    if (Array.isArray(old) && old.length) {
      base.papers = old;
      base.links = base.links.filter((l) => old.some((p) => p.id === l.paperId));
    }
    return base;
  } catch {
    return seedData();
  }
}

/* ---------- 派生数据 ---------- */
export const linksOfQuestion = (links, qid) => links.filter((l) => l.questionId === qid);
export const isLinked = (links, qid, pid) =>
  links.some((l) => l.questionId === qid && l.paperId === pid);
export const questionsOfPaper = (links, questions, pid) => {
  const ids = new Set(links.filter((l) => l.paperId === pid).map((l) => l.questionId));
  return questions.filter((q) => ids.has(q.id));
};

export function coverage(data, qid) {
  const qlinks = linksOfQuestion(data.links, qid);
  const linkedIds = new Set(qlinks.map((l) => l.paperId));
  const byStance = Object.fromEntries(STANCES.map((s) => [s.key, 0]));
  qlinks.forEach((l) => { byStance[l.stance] = (byStance[l.stance] || 0) + 1; });
  return {
    total: data.papers.length,
    linked: linkedIds.size,
    unlinked: data.papers.length - linkedIds.size,
    byStance,
  };
}

export const unlinkedPapers = (data, qid) => {
  const linkedIds = new Set(linksOfQuestion(data.links, qid).map((l) => l.paperId));
  return data.papers.filter((p) => !linkedIds.has(p.id));
};

/* ---------- 结构化导出 ---------- */
export function buildExport(data, qid) {
  const q = data.questions.find((x) => x.id === qid);
  if (!q) return null;
  const cov = coverage(data, qid);
  const paperById = new Map(data.papers.map((p) => [p.id, p]));
  const evidence = linksOfQuestion(data.links, qid).map((l) => ({
    linkId: l.id,
    stance: l.stance,
    stanceLabel: stanceOf(l.stance).label,
    excerpt: l.excerpt,
    note: l.note || '',
    paper: {
      id: l.paperId,
      title: paperById.get(l.paperId)?.title ?? '(已删除的文献)',
      authors: paperById.get(l.paperId)?.authors ?? '',
      year: paperById.get(l.paperId)?.year ?? null,
      venue: paperById.get(l.paperId)?.venue ?? '',
      cite: paperById.get(l.paperId)?.cite ?? '',
    },
  }));
  return {
    format: 'research-question-export/v1',
    exportedAt: new Date().toISOString(),
    question: { id: q.id, title: q.title, description: q.description || '' },
    summary: {
      evidenceCount: evidence.length,
      coverage: {
        totalPapers: cov.total,
        linkedPapers: cov.linked,
        unlinkedPapers: cov.unlinked,
        byStance: cov.byStance,
      },
    },
    evidence,
    unlinkedPapers: unlinkedPapers(data, qid).map((p) => ({
      id: p.id, title: p.title, authors: p.authors, year: p.year, cite: p.cite,
    })),
  };
}

export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Store ---------- */
export function useResearch() {
  const [data, setData] = useState(loadData);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(data));
  }, [data]);

  const savePaper = (paper) => {
    setData((d) => {
      const exists = d.papers.some((p) => p.id === paper.id);
      return {
        ...d,
        papers: exists ? d.papers.map((p) => (p.id === paper.id ? paper : p)) : [...d.papers, paper],
      };
    });
  };

  const addQuestion = (title, description) => {
    const q = { id: uid(), title: title.trim(), description: description.trim(), createdAt: Date.now() };
    setData((d) => ({ ...d, questions: [...d.questions, q] }));
    return q.id;
  };

  const updateQuestion = (id, patch) => {
    setData((d) => ({ ...d, questions: d.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  };

  const deleteQuestion = (id) => {
    setData((d) => ({
      ...d,
      questions: d.questions.filter((q) => q.id !== id),
      links: d.links.filter((l) => l.questionId !== id),
    }));
  };

  /** 返回 null 表示成功；否则返回错误信息（重复关联被拦截） */
  const addLink = ({ questionId, paperId, stance, excerpt, note }) => {
    if (isLinked(data.links, questionId, paperId)) {
      return { ok: false, error: '该文献已关联到此问题，请勿重复关联（可编辑现有关联修改立场或摘录）。' };
    }
    const link = { id: uid(), questionId, paperId, stance, excerpt: excerpt.trim(), note: note.trim(), createdAt: Date.now() };
    setData((d) => ({ ...d, links: [...d.links, link] }));
    return { ok: true, linkId: link.id };
  };

  const updateLink = (id, patch) => {
    setData((d) => ({ ...d, links: d.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  };

  const removeLink = (id) => {
    setData((d) => ({ ...d, links: d.links.filter((l) => l.id !== id) }));
  };

  return {
    ...data,
    savePaper, addQuestion, updateQuestion, deleteQuestion,
    addLink, updateLink, removeLink,
  };
}
