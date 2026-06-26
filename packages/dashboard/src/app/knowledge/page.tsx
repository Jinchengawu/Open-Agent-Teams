'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/ui/skeleton';

// ── Types ──
interface DocumentV2 {
  id: string;
  title: string;
  content: string;
  type: string;
  projectId?: string;
  taskId?: string;
  authorId: string;
  authorName: string;
  version: number;
  tags: string[];
  relatedDocIds: string[];
  relatedTaskIds: string[];
  relatedAgentIds: string[];
  commentCount: number;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, any>;
}

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}

interface DocumentComment {
  id: string;
  documentId: string;
  authorId: string;
  authorName: string;
  content: string;
  parentId?: string;
  resolved: boolean;
  createdAt: number;
}

interface DocumentStats {
  totalDocuments: number;
  totalProjects: number;
  totalTasks: number;
  totalComments: number;
  typeDistribution: Record<string, number>;
  authorDistribution: Record<string, number>;
  recentDocuments: DocumentV2[];
}

// ── Constants ──
const TYPE_COLORS: Record<string, string> = {
  prd: 'border-violet-200 bg-violet-50 text-violet-700',
  tech_spec: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  meeting: 'border-orange-200 bg-orange-50 text-orange-700',
  report: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  task: 'border-[#ff5c1f]/25 bg-[#ff5c1f]/10 text-[#c2410c]',
  general: 'border-slate-200 bg-white/70 text-slate-700',
  review: 'border-pink-200 bg-pink-50 text-pink-700',
  code_review: 'border-sky-200 bg-sky-50 text-sky-700',
};

const TYPE_LABELS: Record<string, string> = {
  prd: 'PRD',
  tech_spec: '技术规范',
  meeting: '会议纪要',
  report: '报告',
  task: '任务',
  general: '通用',
  review: '评审',
  code_review: '代码评审',
};

const AGENT_NAMES: Record<string, string> = {
  'dev-frontend': 'Frontend',
  'dev-backend': 'Backend',
  'dev-testing': 'Testing',
  'dev-devops': 'DevOps',
  'dev-pm': 'PM',
  'project-admin': 'Admin',
};

// ── Component ──
export default function KnowledgePage() {
  // 状态
  const [documents, setDocuments] = useState<DocumentV2[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentV2 | null>(null);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [urlFiltersLoaded, setUrlFiltersLoaded] = useState(false);
  const [targetDocumentId, setTargetDocumentId] = useState('');

  // 过滤和排序
  const [filterProject, setFilterProject] = useState('');
  const [filterTask, setFilterTask] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'title'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchKeyword, setSearchKeyword] = useState('');

  // 评论输入
  const [commentInput, setCommentInput] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('');

  // 初始加载
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('projectId');
    const taskId = params.get('taskId');
    const documentId = params.get('documentId') || params.get('docId');
    const type = params.get('type');
    const authorId = params.get('authorId');
    const nextSortBy = params.get('sortBy');
    const nextSortOrder = params.get('sortOrder');
    if (projectId) setFilterProject(projectId);
    if (taskId) setFilterTask(taskId);
    if (documentId) setTargetDocumentId(documentId);
    if (type) setFilterType(type);
    if (authorId) setFilterAuthor(authorId);
    if (nextSortBy === 'updatedAt' || nextSortBy === 'createdAt' || nextSortBy === 'title') {
      setSortBy(nextSortBy);
    }
    if (nextSortOrder === 'asc' || nextSortOrder === 'desc') {
      setSortOrder(nextSortOrder);
    }
    fetchStats();
    fetchProjects();
    setUrlFiltersLoaded(true);
  }, []);

  // 过滤变化时重新加载
  useEffect(() => {
    if (!urlFiltersLoaded) return;
    syncUrlFilters();
    fetchDocuments();
  }, [urlFiltersLoaded, filterProject, filterTask, filterType, filterAuthor, sortBy, sortOrder]);

  // 加载文档详情时获取评论
  useEffect(() => {
    if (selectedDoc) {
      fetchComments(selectedDoc.id);
    }
  }, [selectedDoc?.id]);

  useEffect(() => {
    if (!targetDocumentId || documents.length === 0) return;
    const targetDoc = documents.find(doc => doc.id === targetDocumentId);
    if (targetDoc) {
      setSelectedDoc(targetDoc);
      setTargetDocumentId('');
    }
  }, [targetDocumentId, documents]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/v2/stats');
      if (res.ok) setStats(await res.json());
    } catch (e) { console.error('stats failed:', e); }
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/v2/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (e) { console.error('projects failed:', e); }
  };

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterProject) params.set('projectId', filterProject);
      if (filterTask) params.set('taskId', filterTask);
      if (filterType) params.set('type', filterType);
      if (filterAuthor) params.set('authorId', filterAuthor);
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      params.set('limit', '50');

      const res = await fetch(`/api/v2/documents?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (e) { console.error('documents failed:', e); }
    finally { setLoading(false); }
  };

  const syncUrlFilters = () => {
    const params = new URLSearchParams(window.location.search);
    const update = (key: string, value: string) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };

    update('projectId', filterProject);
    update('taskId', filterTask);
    update('type', filterType);
    update('authorId', filterAuthor);
    update('documentId', targetDocumentId);
    update('sortBy', sortBy === 'updatedAt' ? '' : sortBy);
    update('sortOrder', sortOrder === 'desc' ? '' : sortOrder);

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);
  };

  const clearContextFilters = () => {
    setFilterProject('');
    setFilterTask('');
    setFilterType('');
    setFilterAuthor('');
    setSearchKeyword('');
  };

  const searchDocuments = async () => {
    if (!searchKeyword.trim()) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('q', searchKeyword);
      if (filterProject) params.set('projectId', filterProject);
      if (filterTask) params.set('taskId', filterTask);
      if (filterType) params.set('type', filterType);
      const res = await fetch(`/api/v2/documents/search?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (e) { console.error('search failed:', e); }
    finally { setLoading(false); }
  };

  const fetchComments = async (docId: string) => {
    try {
      const res = await fetch(`/api/v2/documents/${docId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch (e) { console.error('comments failed:', e); }
  };

  const addComment = async () => {
    if (!selectedDoc || !commentInput.trim() || !commentAuthor) return;
    try {
      const res = await fetch(`/api/v2/documents/${selectedDoc.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: commentAuthor,
          authorName: AGENT_NAMES[commentAuthor] || commentAuthor,
          content: commentInput.trim(),
        }),
      });
      if (res.ok) {
        setCommentInput('');
        fetchComments(selectedDoc.id);
        fetchStats();
        // 更新文档评论数
        setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, commentCount: d.commentCount + 1 } : d));
      }
    } catch (e) { console.error('add comment failed:', e); }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getTypeBadge = (type: string) => {
    const colorClass = TYPE_COLORS[type] || TYPE_COLORS.general;
    const label = TYPE_LABELS[type] || type;
    return <Badge className={colorClass}>{label}</Badge>;
  };

  const getProjectName = (projectId?: string) => {
    if (!projectId) return '未分类';
    const project = projects.find(p => p.id === projectId);
    return project?.name || projectId.substring(0, 8);
  };

  // ── 渲染文档详情 ──
  const renderDocDetail = () => {
    if (!selectedDoc) return null;
    const relatedDocs = documents.filter(d => selectedDoc.relatedDocIds.includes(d.id));
    const relatedAgents = selectedDoc.relatedAgentIds.map(id => AGENT_NAMES[id] || id);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 p-4 backdrop-blur-sm">
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-400/30">
          {/* 头部 */}
          <div className="flex-shrink-0 border-b border-slate-200 p-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  {getTypeBadge(selectedDoc.type)}
                  <span className="text-sm text-gray-400">v{selectedDoc.version}</span>
                  {selectedDoc.commentCount > 0 && (
                    <Badge variant="outline" className="text-xs">💬 {selectedDoc.commentCount}</Badge>
                  )}
                </div>
                <h2 className="text-xl font-bold text-gray-900">{selectedDoc.title}</h2>
                <p className="mt-1 font-mono text-xs text-gray-400">{selectedDoc.id}</p>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                  <span>👤 {selectedDoc.authorName}</span>
                  <span>📁 {getProjectName(selectedDoc.projectId)}</span>
                  {selectedDoc.taskId && <span>✅ {selectedDoc.taskId}</span>}
                  <span>📝 {formatDate(selectedDoc.updatedAt)}</span>
                </div>
              </div>
              <button onClick={() => setSelectedDoc(null)} className="text-2xl text-slate-500 hover:text-[#111820]">×</button>
            </div>

            {/* 标签和关联 */}
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedDoc.tags.map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs">#{tag}</Badge>
              ))}
              {relatedAgents.map(agent => (
                <Badge key={agent} variant="outline" className="text-xs text-blue-600">🔗 {agent}</Badge>
              ))}
            </div>
          </div>

          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* 文档内容 */}
            <div className="prose prose-sm max-w-none mb-8">
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-800">
                {selectedDoc.content}
              </pre>
            </div>

            {/* 关联文档 */}
            {relatedDocs.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">🔗 关联文档</h3>
                <div className="flex flex-wrap gap-2">
                  {relatedDocs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition"
                    >
                      {doc.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 评论区域 */}
            <div className="border-t border-slate-200 pt-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                💬 评论 ({comments.length})
              </h3>

              {/* 评论列表 */}
              <div className="space-y-3 mb-4">
                {comments.length === 0 ? (
                  <p className="text-sm text-gray-400">暂无评论</p>
                ) : (
                  comments.map(comment => (
                    <div key={comment.id} className={`rounded-lg border border-slate-200 p-3 ${comment.resolved ? 'bg-emerald-50' : 'bg-slate-50/70'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{comment.authorName}</span>
                          <span className="text-xs text-gray-400">{formatDate(comment.createdAt)}</span>
                        </div>
                        {comment.resolved && <Badge className="bg-green-100 text-green-700 text-xs">✅ 已解决</Badge>}
                      </div>
                      <p className="text-sm text-gray-700 mt-1">{comment.content}</p>
                    </div>
                  ))
                )}
              </div>

              {/* 添加评论 */}
              <div className="flex gap-2">
                <select
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  className="px-2 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">选择Agent</option>
                  {Object.entries(AGENT_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addComment()}
                  placeholder="添加评论..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button size="sm" onClick={addComment}>发送</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-0">
      <div className="mx-auto max-w-[1540px]">
        <div className="mb-6 flex flex-col gap-2 border-b border-slate-300/70 pb-5">
          <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#007f96]">Knowledge Fabric</p>
          <h1 className="text-3xl font-black uppercase tracking-[0.12em] text-[#111820]">文档中心</h1>
          <p className="text-sm text-slate-600">跨 Agent 协作文档库 / 项目归档 / 任务关联 / 评论迭代</p>
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <StatCard title="总文档" value={stats.totalDocuments} icon="📄" />
            <StatCard title="项目数" value={stats.totalProjects} icon="📁" />
            <StatCard title="任务数" value={stats.totalTasks} icon="✅" />
            <StatCard title="评论数" value={stats.totalComments} icon="💬" />
            <StatCard title="作者数" value={Object.keys(stats.authorDistribution).length} icon="👥" />
          </div>
        )}

        {/* 按类型分布 */}
        {stats && Object.keys(stats.typeDistribution).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {Object.entries(stats.typeDistribution).map(([type, count]) => (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? '' : type)}
                className={`px-3 py-1.5 rounded-full text-sm transition ${
                  filterType === type
                    ? 'border border-[#111820] bg-[#111820] text-white'
                    : 'border border-slate-200 bg-white/70 text-slate-700 hover:border-[#007f96]/25 hover:bg-white'
                }`}
              >
                {TYPE_LABELS[type] || type} ({count})
              </button>
            ))}
          </div>
        )}

        {/* 过滤和搜索栏 */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              {/* 搜索 */}
              <div className="flex-1 min-w-[200px]">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="搜索文档内容..."
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchDocuments()}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button onClick={searchDocuments}>🔍</Button>
                  <Button variant="outline" onClick={() => { setSearchKeyword(''); fetchDocuments(); }}>清除</Button>
                </div>
              </div>

              {/* 项目过滤 */}
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                data-testid="knowledge-project-filter"
              >
                <option value="">所有项目</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {/* 任务过滤 */}
              <input
                type="text"
                placeholder="任务ID"
                value={filterTask}
                onChange={(e) => setFilterTask(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[180px]"
                data-testid="knowledge-task-filter"
              />

              {/* 作者过滤 */}
              <select
                value={filterAuthor}
                onChange={(e) => setFilterAuthor(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">所有作者</option>
                {Object.entries(AGENT_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>

              {/* 排序 */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="updatedAt">更新时间</option>
                <option value="createdAt">创建时间</option>
                <option value="title">标题</option>
              </select>

              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                {sortOrder === 'desc' ? '↓' : '↑'}
              </button>

              <Button variant="outline" onClick={fetchDocuments}>🔄</Button>
            </div>
          </CardContent>
        </Card>

        {(filterProject || filterTask || filterType || filterAuthor) && (
          <Card className="mb-6 border-l-4 border-l-blue-500" data-testid="knowledge-active-context">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-gray-700">当前上下文</span>
                  {filterProject && (
                    <Badge variant="outline" className="font-mono text-blue-700">项目 {filterProject}</Badge>
                  )}
                  {filterTask && (
                    <Badge variant="outline" className="font-mono text-emerald-700">任务 {filterTask}</Badge>
                  )}
                  {filterType && (
                    <Badge variant="outline">{TYPE_LABELS[filterType] || filterType}</Badge>
                  )}
                  {filterAuthor && (
                    <Badge variant="outline">{AGENT_NAMES[filterAuthor] || filterAuthor}</Badge>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={clearContextFilters}>
                  清除过滤
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 文档列表 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">文档列表</h2>
            <span className="text-sm text-gray-400">{documents.length} 篇</span>
          </div>

          {loading && documents.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white/70 py-12 text-center text-slate-500">
              <p className="text-lg">暂无文档</p>
              <p className="text-sm mt-2">Agent 创建文档后将自动归档至此</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {documents.map((doc) => (
                <Card
                  key={doc.id}
                  className="group cursor-pointer transition-all hover:-translate-y-0.5 hover:border-[#007f96]/30 hover:bg-white"
                  onClick={() => setSelectedDoc(doc)}
                  data-testid={`knowledge-doc-${doc.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {getTypeBadge(doc.type)}
                        {doc.commentCount > 0 && (
                          <span className="text-xs text-gray-400">💬 {doc.commentCount}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">v{doc.version}</span>
                    </div>

                    <h3 className="mb-1 font-semibold text-gray-900 transition group-hover:text-blue-600">
                      {doc.title}
                    </h3>
                    <p className="mb-2 font-mono text-xs text-gray-400">{doc.id}</p>

                    <p className="text-sm text-gray-500 line-clamp-2 mb-3">
                      {doc.content.substring(0, 100).replace(/[#*`_]/g, '')}...
                    </p>

                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-blue-600">{doc.authorName}</span>
                        <span>·</span>
                        <span>{getProjectName(doc.projectId)}</span>
                        {doc.taskId && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{doc.taskId}</span>
                          </>
                        )}
                      </div>
                      <span>{formatDate(doc.updatedAt)}</span>
                    </div>

                    {doc.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {doc.tags.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">#{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 文档详情弹窗 */}
      {renderDocDetail()}
    </div>
  );
}

// ── 统计卡片组件 ──
function StatCard({ title, value, icon }: { title: string; value: number; icon: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[#007f96]/20 bg-[#007f96]/8 text-lg">{icon}</span>
        </div>
      </CardContent>
    </Card>
  );
}
