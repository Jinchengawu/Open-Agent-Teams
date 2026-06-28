'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useAgentHealth } from '@/hooks/useAgentHealth';

interface PipelineDef {
  id: string;
  name: string;
  version?: string;
  source?: string;
  deletable?: boolean;
  surfaces: SurfaceDef[];
  edges: EdgeDef[];
}

interface SurfaceDef {
  id: string;
  name: string;
  agent: string;
  status?: string;
  input?: { required?: string[]; from?: string };
  output?: { artifacts?: string[]; description?: string };
}

interface EdgeDef {
  from: string;
  to: string | string[];
  description?: string;
}

interface SurfaceResult {
  surfaceId: string;
  status: string;
  artifacts?: Record<string, any>;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

interface PipelineInstance {
  id: string;
  pipelineId: string;
  status: string;
  surfaceResults: Record<string, SurfaceResult>;
  startedAt: number;
  completedAt?: number;
  pipeline_url?: string;
  knowledge_url?: string;
  kanban_url?: string;
  coordination?: {
    projectId: string;
    taskIdsBySurface: Record<string, string>;
    documentIdsBySurface: Record<string, string>;
  };
}

interface CoordinationTask {
  id: string;
  title: string;
  status: string;
  assignee: string;
}

interface CoordinationDocument {
  id: string;
  title: string;
  type: string;
}

interface CoordinationBinding {
  surfaceId: string;
  taskId: string;
  task?: CoordinationTask | null;
  documentId?: string;
  documents?: CoordinationDocument[];
  knowledge_url?: string;
}

interface CoordinationSummary {
  project?: {
    id: string;
    name: string;
  } | null;
  tasks: CoordinationTask[];
  bindings: CoordinationBinding[];
  navigation?: {
    pipeline_url?: string;
    knowledge_url?: string;
    kanban_url?: string;
  };
}

interface PipelineBuilderSurface {
  id: string;
  name: string;
  agent: string;
  goal: string;
  artifacts: string;
  dependsOn: string;
  x: number;
  y: number;
}

interface PipelineFailureDetail {
  surfaceId: string;
  surfaceName: string;
  agentId: string;
  agentName: string;
  status: string;
  error: string;
  taskId?: string;
  documentCount: number;
  latestCheckpoint?: {
    surfaceId: string;
    surfaceName: string;
    completedAt?: number;
  };
  projectId?: string;
}

const STORAGE_KEY = 'pipeline-execution-history';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const SURFACE_TIMEOUT_OPTIONS = [
  { label: '60 秒', value: 60_000 },
  { label: '90 秒', value: 90_000 },
  { label: '300 秒', value: 300_000 },
  { label: '600 秒', value: 600_000 },
];
const HISTORY_STATUS_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '执行中', value: 'running' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
  { label: '完成', value: 'completed' },
];
const BUILDER_CANVAS_WIDTH = 980;
const BUILDER_CANVAS_HEIGHT = 430;
const BUILDER_NODE_WIDTH = 190;
const BUILDER_NODE_HEIGHT = 112;
const YAML_DRAFT = `id: custom-dev-loop
name: Custom Dev Loop
version: "0.1.0"
surfaces:
  - id: discovery
    name: Discovery
    agent: dev-pm
    workflow:
      goal: Clarify the request and produce a concise plan.
edges: []
`;
const BUILDER_DEFAULT_SURFACE: PipelineBuilderSurface = {
  id: 'discovery',
  name: 'Discovery',
  agent: 'dev-pm',
  goal: 'Clarify the request and produce a concise plan.',
  artifacts: 'meeting_summary, prd',
  dependsOn: '',
  x: 72,
  y: 96,
};

function normalizePipeline(item: unknown): PipelineDef | null {
  if (!item || typeof item !== 'object') return null;
  const candidate = item as Partial<PipelineDef>;
  if (!candidate.id || !candidate.name) return null;

  return {
    ...candidate,
    id: String(candidate.id),
    name: String(candidate.name),
    version: candidate.version ? String(candidate.version) : undefined,
    source: candidate.source ? String(candidate.source) : undefined,
    deletable: Boolean(candidate.deletable),
    surfaces: Array.isArray(candidate.surfaces) ? candidate.surfaces : [],
    edges: Array.isArray(candidate.edges) ? candidate.edges : [],
  };
}

function normalizePipelines(items: unknown): PipelineDef[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizePipeline).filter((item): item is PipelineDef => item !== null);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function buildProgressSummary(pipeline: PipelineDef | undefined, instance: PipelineInstance, now: number) {
  const surfaceResults = Object.values(instance.surfaceResults || {});
  const total = Math.max(
    pipeline?.surfaces?.length || 0,
    Object.keys(instance.coordination?.taskIdsBySurface || {}).length,
    surfaceResults.length,
  );
  const completedCount = surfaceResults.filter((result) => result.status === 'completed').length;
  const finishedCount = surfaceResults.filter((result) => TERMINAL_STATUSES.has(result.status)).length;
  const runningSurfaceIds = surfaceResults
    .filter((result) => result.status === 'running')
    .map((result) => result.surfaceId);
  const pendingSurface = pipeline?.surfaces.find(
    (surface) => !surfaceResults.some((result) => result.surfaceId === surface.id),
  );
  const surfaceNameById = new Map((pipeline?.surfaces || []).map((surface) => [surface.id, surface.name]));
  const activeSurfaceLabels = runningSurfaceIds.length > 0
    ? runningSurfaceIds.map((id) => surfaceNameById.get(id) || id)
    : pendingSurface && instance.status === 'running'
      ? [surfaceNameById.get(pendingSurface.id) || pendingSurface.id]
      : [];
  const elapsedMs = (instance.completedAt || now) - instance.startedAt;
  const progressPercent = total > 0 ? Math.min(100, Math.round((finishedCount / total) * 100)) : 0;

  return {
    total,
    completedCount,
    finishedCount,
    activeSurfaceLabels,
    elapsed: formatDuration(elapsedMs),
    progressPercent,
  };
}

function buildFailureDetail(
  pipeline: PipelineDef | undefined,
  instance: PipelineInstance | null,
  summary: CoordinationSummary | null,
  agentNameById: Map<string, string>,
): PipelineFailureDetail | null {
  if (!instance || (instance.status !== 'failed' && instance.status !== 'cancelled')) return null;

  const results = Object.values(instance.surfaceResults || {});
  const failedResult = results.find((result) => result.status === 'failed' || result.status === 'blocked')
    || results.find((result) => result.status === 'cancelled')
    || results
      .slice()
      .sort((a, b) => (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0))[0];
  if (!failedResult) return null;

  const surface = pipeline?.surfaces.find((item) => item.id === failedResult.surfaceId);
  const latestCompleted = results
    .filter((result) => result.status === 'completed')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
  const latestCompletedSurface = latestCompleted
    ? pipeline?.surfaces.find((item) => item.id === latestCompleted.surfaceId)
    : undefined;
  const binding = summary?.bindings.find((item) => item.surfaceId === failedResult.surfaceId);
  const projectId = summary?.project?.id || instance.coordination?.projectId;

  return {
    surfaceId: failedResult.surfaceId,
    surfaceName: surface?.name || failedResult.surfaceId,
    agentId: surface?.agent || 'unknown',
    agentName: surface?.agent ? agentNameById.get(surface.agent) || surface.agent : '未绑定',
    status: failedResult.status,
    error: (failedResult.error || instance.status === 'cancelled')
      ? failedResult.error || 'Pipeline was cancelled before this surface completed.'
      : 'No error detail was reported by the surface.',
    taskId: binding?.taskId || instance.coordination?.taskIdsBySurface?.[failedResult.surfaceId],
    documentCount: binding?.documents?.length || 0,
    latestCheckpoint: latestCompleted
      ? {
          surfaceId: latestCompleted.surfaceId,
          surfaceName: latestCompletedSurface?.name || latestCompleted.surfaceId,
          completedAt: latestCompleted.completedAt,
        }
      : undefined,
    projectId,
  };
}

export default function PipelinePage() {
  const { showToast } = useToast();
  const { stats: agentStats, availableAgents, isLoading: agentHealthLoading } = useAgentHealth();
  const [pipelines, setPipelines] = useState<PipelineDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [currentInstance, setCurrentInstance] = useState<PipelineInstance | null>(null);
  const [instanceHistory, setInstanceHistory] = useState<PipelineInstance[]>([]);
  const [coordinationSummary, setCoordinationSummary] = useState<CoordinationSummary | null>(null);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [yamlDraft, setYamlDraft] = useState(YAML_DRAFT);
  const [yamlSource, setYamlSource] = useState('dashboard:pipeline-page');
  const [importingYaml, setImportingYaml] = useState(false);
  const [builderId, setBuilderId] = useState(`custom-pipeline-${Date.now()}`);
  const [builderName, setBuilderName] = useState('Custom Pipeline');
  const [builderSurfaces, setBuilderSurfaces] = useState<PipelineBuilderSurface[]>([BUILDER_DEFAULT_SURFACE]);
  const [selectedBuilderSurfaceId, setSelectedBuilderSurfaceId] = useState(BUILDER_DEFAULT_SURFACE.id);
  const [draggingSurfaceId, setDraggingSurfaceId] = useState<string | null>(null);
  const [connectingFromSurfaceId, setConnectingFromSurfaceId] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<'dry-run' | 'live'>('dry-run');
  const [surfaceTimeoutMs, setSurfaceTimeoutMs] = useState(90_000);
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
  const [now, setNow] = useState(Date.now());

  const livePipelineReady = agentStats.livePipelineReady;
  const canExecuteLive = executionMode !== 'live' || livePipelineReady;
  const selectedBuilderSurface = builderSurfaces.find((surface) => surface.id === selectedBuilderSurfaceId) || builderSurfaces[0];
  const selectedBuilderSurfaceIndex = selectedBuilderSurface
    ? builderSurfaces.findIndex((surface) => surface.id === selectedBuilderSurface.id)
    : -1;
  const agentNameById = useMemo(
    () => new Map(availableAgents.map((agent) => [agent.id, agent.name])),
    [availableAgents],
  );
  const builderEdges = useMemo(() => {
    const ids = new Set(builderSurfaces.map((surface) => surface.id.trim()).filter(Boolean));
    return builderSurfaces.flatMap((surface) => {
      const to = surface.id.trim();
      if (!to) return [];
      return surface.dependsOn
        .split(',')
        .map((item) => item.trim())
        .filter((from) => from && ids.has(from) && from !== to)
        .map((from) => ({ from, to }));
    });
  }, [builderSurfaces]);

  // 加载 Pipeline 列表 + 恢复历史
  useEffect(() => {
    fetchPipelines();
    restoreHistory();
    const requestedInstanceId = new URLSearchParams(window.location.search).get('instanceId');
    if (requestedInstanceId) {
      loadInstanceById(requestedInstanceId);
    }
  }, []);

  useEffect(() => {
    if (currentInstance?.id) {
      fetchCoordinationSummary(currentInstance.id);
    } else {
      setCoordinationSummary(null);
    }
  }, [currentInstance?.id]);

  useEffect(() => {
    if (currentInstance?.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [currentInstance?.status, currentInstance?.id]);

  // 从 Gateway 持久化实例恢复历史；localStorage 只作为本浏览器偏好排序线索。
  const restoreHistory = async () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const storedIds: string[] = stored ? JSON.parse(stored) : [];
      const uniqueIds = Array.from(new Set(storedIds)).filter(Boolean);

      const res = await fetch('/api/pipeline-instances?limit=100');
      if (!res.ok) return;

      const data = await res.json();
      const instances: PipelineInstance[] = Array.isArray(data.instances) ? data.instances : [];
      const byId = new Map(instances.map((instance) => [instance.id, instance]));
      const preferred = uniqueIds
        .map((id) => byId.get(id))
        .filter((instance): instance is PipelineInstance => Boolean(instance));
      const recent = instances.filter((instance) => !uniqueIds.includes(instance.id));
      const merged = [...preferred, ...recent]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 100);

      setInstanceHistory(merged);

      const runningInstance = merged.find((i: PipelineInstance) => i.status === 'running');
      if (runningInstance) {
        setCurrentInstance((current) => current || runningInstance);
        startPolling(runningInstance.id);
      }
    } catch (e) {
      console.error('恢复历史失败:', e);
    }
  };

  // 保存实例ID到 localStorage
  const saveInstanceId = (instanceId: string) => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const ids: string[] = stored ? JSON.parse(stored) : [];
      if (!ids.includes(instanceId)) {
        ids.push(instanceId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      }
    } catch (e) {
      console.error('保存历史失败:', e);
    }
  };

  const fetchPipelines = async () => {
    try {
      const res = await fetch('/api/pipelines');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setPipelines(normalizePipelines(data.pipelines));
    } catch (e) {
      showToast('Failed to load pipelines', 'error');
    }
  };

  const deletePipeline = async (pipeline: PipelineDef) => {
    if (!pipeline.deletable) return;

    try {
      const res = await fetch(`/api/pipelines/${encodeURIComponent(pipeline.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error || data.deleted !== true) {
        throw new Error(data.error || 'Delete failed');
      }
      setPipelines((prev) => prev.filter((item) => item.id !== pipeline.id));
      if (currentInstance?.pipelineId === pipeline.id) {
        setCurrentInstance(null);
        setCoordinationSummary(null);
      }
      showToast('Pipeline deleted', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      showToast(msg, 'error');
    }
  };

  const importYamlPipeline = async () => {
    if (!yamlDraft.trim()) {
      showToast('YAML definition is required', 'error');
      return;
    }

    setImportingYaml(true);
    try {
      const res = await fetch('/api/pipelines/load-yaml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yaml: yamlDraft,
          source: yamlSource.trim() || 'dashboard:pipeline-page',
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.pipeline?.id) {
        throw new Error(data.error || 'Import failed');
      }

      const nextPipelines = normalizePipelines(data.pipelines);
      const loadedPipeline = normalizePipeline(data.pipeline);
      if (nextPipelines.length > 0) {
        setPipelines(nextPipelines);
      } else if (loadedPipeline) {
        setPipelines((prev) => [loadedPipeline, ...prev.filter((item) => item.id !== loadedPipeline.id)]);
      } else {
        await fetchPipelines();
      }
      setYamlDraft(YAML_DRAFT.replace('custom-dev-loop', `custom-dev-loop-${Date.now()}`));
      showToast(`Pipeline imported: ${data.pipeline.id}`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      showToast(msg, 'error');
    } finally {
      setImportingYaml(false);
    }
  };

  const buildYamlFromBuilder = () => {
    const safeId = builderId.trim() || `custom-pipeline-${Date.now()}`;
    const safeName = builderName.trim() || safeId;
    const validSurfaces = builderSurfaces
      .map((surface, index) => ({
        ...surface,
        id: surface.id.trim() || `step-${index + 1}`,
        name: surface.name.trim() || `Step ${index + 1}`,
        goal: surface.goal.trim() || `Execute ${surface.name.trim() || `Step ${index + 1}`}.`,
      }))
      .filter((surface) => surface.agent);
    const edgeLines: string[] = [];

    for (const surface of validSurfaces) {
      const dependencies = surface.dependsOn
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      for (const dependency of dependencies) {
        edgeLines.push(`  - from: ${dependency}\n    to: ${surface.id}`);
      }
    }

    const surfacesYaml = validSurfaces.map((surface) => {
      const artifacts = surface.artifacts
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const artifactYaml = artifacts.length > 0
        ? `\n    output:\n      artifacts:\n${artifacts.map((artifact) => `        - ${artifact}`).join('\n')}`
        : '';
      return [
        `  - id: ${surface.id}`,
        `    name: ${surface.name}`,
        `    agent: ${surface.agent}`,
        `    workflow:`,
        `      goal: ${surface.goal}`,
        artifactYaml,
      ].join('\n');
    }).join('\n');

    return [
      `id: ${safeId}`,
      `name: ${safeName}`,
      `version: "0.1.0"`,
      `surfaces:`,
      surfacesYaml || `  - id: discovery\n    name: Discovery\n    agent: dev-pm\n    workflow:\n      goal: Clarify the request.`,
      `edges:`,
      edgeLines.length > 0 ? edgeLines.join('\n') : `[]`,
      '',
    ].join('\n');
  };

  const updateBuilderSurface = (index: number, patch: Partial<PipelineBuilderSurface>) => {
    setBuilderSurfaces((current) => current.map((surface, i) => i === index ? { ...surface, ...patch } : surface));
  };

  const updateBuilderSurfaceById = (id: string, patch: Partial<PipelineBuilderSurface>) => {
    setBuilderSurfaces((current) => current.map((surface) => surface.id === id ? { ...surface, ...patch } : surface));
  };

  const moveBuilderSurface = (id: string, x: number, y: number) => {
    updateBuilderSurfaceById(id, {
      x: Math.max(16, Math.min(760, x)),
      y: Math.max(16, Math.min(340, y)),
    });
  };

  const connectBuilderSurfaces = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    setBuilderSurfaces((current) => current.map((surface) => {
      if (surface.id !== toId) return surface;
      const dependencies = surface.dependsOn
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (dependencies.includes(fromId)) return surface;
      return {
        ...surface,
        dependsOn: [...dependencies, fromId].join(', '),
      };
    }));
  };

  const removeBuilderEdge = (fromId: string, toId: string) => {
    setBuilderSurfaces((current) => current.map((surface) => {
      if (surface.id !== toId) return surface;
      const dependencies = surface.dependsOn
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item && item !== fromId);
      return { ...surface, dependsOn: dependencies.join(', ') };
    }));
  };

  const addBuilderSurface = () => {
    const nextIndex = builderSurfaces.length + 1;
    const previous = builderSurfaces[builderSurfaces.length - 1];
    const nextId = `step-${nextIndex}`;
    setBuilderSurfaces((current) => [
      ...current,
      {
        id: nextId,
        name: `Step ${nextIndex}`,
        agent: availableAgents[0]?.id || 'dev-backend',
        goal: 'Execute this workflow step and produce a durable artifact.',
        artifacts: 'report',
        dependsOn: current[current.length - 1]?.id || '',
        x: Math.min(760, (previous?.x ?? 72) + 220),
        y: previous && (previous.x ?? 0) > 560 ? (previous.y ?? 96) + 150 : (previous?.y ?? 96),
      },
    ]);
    setSelectedBuilderSurfaceId(nextId);
  };

  const removeBuilderSurface = (index: number) => {
    const surfaceId = builderSurfaces[index]?.id;
    setBuilderSurfaces((current) => {
      if (current.length <= 1) return current;
      return current
        .filter((_, i) => i !== index)
        .map((surface) => ({
          ...surface,
          dependsOn: surface.dependsOn
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item && item !== surfaceId)
            .join(', '),
        }));
    });
    if (surfaceId === selectedBuilderSurfaceId) {
      const fallback = builderSurfaces.find((_, i) => i !== index);
      setSelectedBuilderSurfaceId(fallback?.id || BUILDER_DEFAULT_SURFACE.id);
    }
    if (surfaceId === connectingFromSurfaceId) {
      setConnectingFromSurfaceId(null);
    }
  };

  const generateBuilderYaml = () => {
    setYamlDraft(buildYamlFromBuilder());
    setYamlSource(`dashboard:pipeline-builder:${builderId.trim() || 'custom'}`);
    showToast('已生成 Pipeline YAML，可继续编辑或直接导入', 'success');
  };

  const fetchCoordinationSummary = async (instanceId: string) => {
    try {
      const res = await fetch(`/api/pipeline-instances/${instanceId}/coordination`);
      if (!res.ok) {
        setCoordinationSummary(null);
        return;
      }
      const data = await res.json();
      setCoordinationSummary(data);
    } catch {
      setCoordinationSummary(null);
    }
  };

  const loadInstanceById = async (instanceId: string) => {
    try {
      const res = await fetch(`/api/pipeline-instances/${encodeURIComponent(instanceId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setCurrentInstance(data);
      setInstanceHistory((prev) => [data, ...prev.filter((i) => i.id !== data.id)].slice(0, 100));
      saveInstanceId(data.id);
      if (data.status === 'running') {
        startPolling(data.id);
      }
    } catch (e) {
      console.error('加载 Pipeline 实例失败:', e);
    }
  };

  // 执行 Pipeline
  const executePipeline = async (
    pipelineId: string,
    recovery?: { retryOf?: string; forceDryRun?: boolean },
  ) => {
    const isDryRun = recovery?.forceDryRun ? true : executionMode === 'dry-run';
    if (!isDryRun && !livePipelineReady) {
      showToast('Hermes Agents are not all online; live execution is disabled', 'error');
      return;
    }

    setExecuting(pipelineId);
    try {
      const res = await fetch('/api/pipelines/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId,
          initialInput: {
            userRequest: isDryRun
              ? `Dashboard requested dry-run execution of ${pipelineId}. Produce concise coordination artifacts and preserve results as documents. Do not create, edit, delete, move, install, build, or write repository files.`
              : `Dashboard requested live execution of ${pipelineId}. Execute through the available Hermes Agents, preserve coordination artifacts as documents, and keep task state current.`,
            requestedBy: recovery?.retryOf ? 'dashboard-recovery-retry' : isDryRun ? 'dashboard-dry-run' : 'dashboard-live',
            retryOf: recovery?.retryOf,
          },
          options: {
            dryRun: isDryRun,
            surfaceTimeoutMs,
          },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.instanceId) {
        const instance: PipelineInstance = {
          ...data,
          id: data.id || data.instanceId,
          pipelineId,
          surfaceResults: data.surfaceResults || {},
        };
        setCurrentInstance(instance);
        setInstanceHistory(prev => [instance, ...prev.filter(i => i.id !== instance.id)].slice(0, 100));
        saveInstanceId(data.instanceId);
        if (data.status === 'running') {
          startPolling(data.instanceId);
        }
      }

      showToast(recovery?.retryOf ? 'Pipeline recovery retry started' : isDryRun ? 'Pipeline dry-run started' : 'Live Pipeline started', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      showToast(msg, 'error');
    } finally {
      setExecuting(null);
    }
  };

  const retryFailedPipeline = async (instance: PipelineInstance) => {
    await executePipeline(instance.pipelineId, {
      retryOf: instance.id,
      forceDryRun: true,
    });
  };

  // 轮询实例状态
  const startPolling = useCallback((instanceId: string) => {
    if (pollInterval) clearInterval(pollInterval);

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline-instances/${instanceId}`);
        if (!res.ok) return;
        const data = await res.json();
        setCurrentInstance(data);

        // 更新历史中的该实例
        setInstanceHistory(prev => {
          const filtered = prev.filter(i => i.id !== data.id);
          return [data, ...filtered].slice(0, 100);
        });

        if (TERMINAL_STATUSES.has(data.status)) {
          clearInterval(interval);
          setPollInterval(null);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);

    setPollInterval(interval);
  }, [pollInterval]);

  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'running': return 'bg-blue-500 animate-pulse';
      case 'failed': return 'bg-red-500';
      case 'blocked': return 'bg-red-500';
      case 'cancelled': return 'bg-amber-500';
      case 'pending': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge className="bg-green-500">完成</Badge>;
      case 'running': return <Badge className="bg-blue-500">执行中</Badge>;
      case 'failed': return <Badge className="bg-red-500">失败</Badge>;
      case 'cancelled': return <Badge className="bg-amber-500">已取消</Badge>;
      case 'pending': return <Badge variant="secondary">等待</Badge>;
      case 'todo': return <Badge variant="secondary">待办</Badge>;
      case 'in_progress': return <Badge className="bg-blue-500">进行中</Badge>;
      case 'review': return <Badge className="bg-purple-500">评审中</Badge>;
      case 'done': return <Badge className="bg-green-500">已完成</Badge>;
      case 'blocked': return <Badge className="bg-red-500">阻塞</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getSurfaceStatusFromTask = (taskStatus?: string) => {
    switch (taskStatus) {
      case 'done': return 'completed';
      case 'in_progress':
      case 'review':
        return 'running';
      case 'blocked': return 'blocked';
      case 'todo': return 'pending';
      default: return undefined;
    }
  };

  const cancelPipeline = async (instanceId: string) => {
    try {
      const res = await fetch(`/api/pipeline-instances/${instanceId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled from Dashboard' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Cancel failed');

      if (pollInterval) {
        clearInterval(pollInterval);
        setPollInterval(null);
      }
      setCurrentInstance(data);
      setInstanceHistory(prev => [data, ...prev.filter(i => i.id !== data.id)].slice(0, 100));
      showToast('Pipeline cancelled', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      showToast(msg, 'error');
    }
  };

  // 构建 DAG 拓扑排序（前端版本）
  const buildExecutionBatches = (pipeline: PipelineDef): string[][] => {
    const dag = new Map<string, Set<string>>();
    const surfaces = Array.isArray(pipeline.surfaces) ? pipeline.surfaces : [];
    const edges = Array.isArray(pipeline.edges) ? pipeline.edges : [];
    for (const s of surfaces) dag.set(s.id, new Set());
    for (const edge of edges) {
      if ((edge as any).loop) continue; // 循环边不加入 DAG
      const downstream = Array.isArray(edge.to) ? edge.to : [edge.to];
      for (const toId of downstream) {
        const deps = dag.get(toId) || new Set();
        deps.add(edge.from);
        dag.set(toId, deps);
      }
    }
    const inDegree = new Map<string, number>();
    const adj = new Map<string, Set<string>>();
    dag.forEach((deps, id) => {
      inDegree.set(id, deps.size);
      if (!adj.has(id)) adj.set(id, new Set());
      deps.forEach((dep) => {
        const d = adj.get(dep) || new Set();
        d.add(id);
        adj.set(dep, d);
      });
    });
    const batches: string[][] = [];
    const visited = new Set<string>();
    while (visited.size < dag.size) {
      const batch: string[] = [];
      inDegree.forEach((degree, id) => {
        if (degree === 0 && !visited.has(id)) batch.push(id);
      });
      if (batch.length === 0) break;
      batches.push(batch);
      batch.forEach((id) => {
        visited.add(id);
        (adj.get(id) || new Set()).forEach((downstream) => {
          inDegree.set(downstream, (inDegree.get(downstream) || 0) - 1);
        });
      });
    }
    return batches;
  };

  // 获取循环边
  const getLoopEdges = (pipeline: PipelineDef): { from: string; to: string }[] => {
    const edges = Array.isArray(pipeline.edges) ? pipeline.edges : [];
    return edges
      .filter((e) => (e as any).loop)
      .flatMap((e) => {
        const downstream = Array.isArray(e.to) ? e.to : [e.to];
        return downstream.map((toId) => ({ from: e.from, to: toId }));
      });
  };

  // 渲染 DAG 执行状态
  const renderPipelineDAG = (pipeline: PipelineDef, instance: PipelineInstance | null) => {
    const batches = buildExecutionBatches(pipeline);
    const loopEdges = getLoopEdges(pipeline);
    const surfaces = Array.isArray(pipeline.surfaces) ? pipeline.surfaces : [];
    const surfaceMap = new Map(surfaces.map((s) => [s.id, s]));
    const taskBySurface = new Map(
      (coordinationSummary?.bindings || []).map((binding) => [binding.surfaceId, binding.task])
    );

    return (
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-medium text-gray-700">DAG 执行流程:</span>
          {instance && (
            <span className="text-xs text-gray-500">
              实例: {instance.id} | {getStatusBadge(instance.status)}
            </span>
          )}
          {loopEdges.length > 0 && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
              {loopEdges.length} 条循环边
            </Badge>
          )}
        </div>

        {/* DAG 可视化 */}
        <div className="flex flex-col gap-8">
          {batches.map((batch, batchIndex) => (
            <div key={batchIndex} className="relative">
              {/* 批次之间的连接线 */}
              {batchIndex > 0 && (
                <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 w-0.5 h-6 bg-gray-300" />
              )}

              <div className={`grid gap-4 ${
                batch.length === 1 ? 'grid-cols-1' :
                batch.length === 2 ? 'grid-cols-2' :
                batch.length === 3 ? 'grid-cols-3' :
                'grid-cols-2 md:grid-cols-3'
              }`}>
                {batch.map((surfaceId) => {
                  const surface = surfaceMap.get(surfaceId);
                  if (!surface) return null;
                  const isCurrent = instance?.surfaceResults[surfaceId];
                  const task = taskBySurface.get(surfaceId);
                  const taskStatus = getSurfaceStatusFromTask(task?.status);
                  const status = isCurrent?.status === 'completed'
                    ? 'completed'
                    : taskStatus === 'blocked'
                      ? 'blocked'
                      : isCurrent?.status || taskStatus || 'pending';
                  const taskId = instance?.coordination?.taskIdsBySurface?.[surfaceId];
                  const documentId = instance?.coordination?.documentIdsBySurface?.[surfaceId];
                  const isLoopSource = loopEdges.some((e) => e.from === surfaceId);
                  const isLoopTarget = loopEdges.some((e) => e.to === surfaceId);

                  return (
                    <div key={surfaceId} className="relative">
                      {/* 循环边指示 */}
                      {(isLoopSource || isLoopTarget) && (
                        <div className="absolute -top-2 -right-2 z-10">
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-50">
                            🔄 循环
                          </Badge>
                        </div>
                      )}

                      <div className={`p-4 rounded-lg border-2 transition-all ${
                        status === 'running' ? 'border-blue-500 bg-blue-50' :
                        status === 'completed' ? 'border-green-500 bg-green-50' :
                        status === 'failed' ? 'border-red-500 bg-red-50' :
                        status === 'blocked' ? 'border-red-500 bg-red-50' :
                        status === 'cancelled' ? 'border-amber-500 bg-amber-50' :
                        'border-gray-200 bg-white'
                      }`}>
                        {/* 状态指示器和名称 */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${getStatusColor(status)}`} />
                          <span className="font-semibold text-sm">{surface.name}</span>
                          {getStatusBadge(status)}
                        </div>

                        <div className="text-xs text-gray-500 mb-2">
                          {surface.agent}
                        </div>

                        {taskId && (
                          <div className="mb-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                            任务:{' '}
                            <a
                              href={`/knowledge?projectId=${encodeURIComponent(instance?.coordination?.projectId || '')}&taskId=${encodeURIComponent(taskId)}`}
                              className="font-mono text-blue-600 hover:underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {taskId}
                            </a>
                            {task?.status && (
                              <span className="ml-2 inline-flex align-middle">
                                {getStatusBadge(task.status)}
                              </span>
                            )}
                            {documentId && (
                              <span className="ml-2">
                                文档: <span className="font-mono">{documentId}</span>
                              </span>
                            )}
                          </div>
                        )}

                        {/* 输入/输出 */}
                        <div className="text-xs text-gray-600 space-y-1">
                          {surface.input?.from && (
                            <p>← 来自 {surface.input.from}</p>
                          )}
                          {surface.output?.artifacts && (
                            <p>→ 产出: {surface.output.artifacts.join(', ')}</p>
                          )}
                        </div>

                        {/* 执行结果 */}
                        {isCurrent && (
                          <div className="mt-2 p-2 bg-white/80 rounded border text-xs">
                            {isCurrent.error ? (
                              <p className="text-red-600">❌ {isCurrent.error}</p>
                            ) : isCurrent.artifacts ? (
                              <div>
                                <p className="text-green-600">✅ 完成</p>
                                {Object.entries(isCurrent.artifacts).slice(0, 2).map(([key, value]) => (
                                  <p key={key} className="text-gray-600 truncate">
                                    {key}: {typeof value === 'string' ? value.substring(0, 60) : JSON.stringify(value).substring(0, 60)}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                            {isCurrent.startedAt && (
                              <p className="text-[10px] text-gray-400 mt-1">
                                {isCurrent.completedAt
                                  ? `${Math.round((isCurrent.completedAt - isCurrent.startedAt) / 1000)}s`
                                  : '进行中...'
                                }
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 循环边图例 */}
        {loopEdges.length > 0 && (
          <div className="mt-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
            <h4 className="text-sm font-semibold text-amber-800 mb-2">循环边</h4>
            <div className="flex flex-wrap gap-2">
              {loopEdges.map((edge, i) => (
                <Badge key={i} variant="outline" className="text-xs border-dashed border-amber-400 text-amber-700">
                  {edge.from} → {edge.to} (反馈)
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 渲染单个 Pipeline 的执行状态（保持向后兼容）
  const renderPipelineStatus = (pipeline: PipelineDef, instance: PipelineInstance | null) => {
    return renderPipelineDAG(pipeline, instance);
  };

  const currentPipeline = currentInstance
    ? pipelines.find((pipeline) => pipeline.id === currentInstance.pipelineId)
    : undefined;
  const currentProgress = currentInstance
    ? buildProgressSummary(currentPipeline, currentInstance, now)
    : null;
  const currentFailureDetail = buildFailureDetail(currentPipeline, currentInstance, coordinationSummary, agentNameById);
  const filteredInstanceHistory = historyStatusFilter === 'all'
    ? instanceHistory
    : instanceHistory.filter((instance) => instance.status === historyStatusFilter);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Pipeline 流水线</h1>
        <p className="text-gray-500 mb-8">基于"一体多面"哲学的面编排引擎</p>

        <Card className="mb-6 border-l-4 border-l-blue-500" data-testid="pipeline-execution-mode">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-lg">执行模式</CardTitle>
                <p className="mt-1 text-sm text-gray-500">
                  {agentHealthLoading
                    ? '正在检查 Hermes Agent 状态...'
                    : `Hermes Agent: ${agentStats.onlineCount}/${agentStats.totalAgents} 在线`}
                </p>
              </div>
              <Badge
                variant={livePipelineReady ? 'default' : 'outline'}
                className={livePipelineReady ? 'bg-green-600' : 'border-amber-300 text-amber-700'}
              >
                {livePipelineReady ? 'Live Ready' : 'Live Disabled'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setExecutionMode('dry-run');
                  setSurfaceTimeoutMs(90_000);
                }}
                className={`rounded-md border p-3 text-left text-sm transition ${
                  executionMode === 'dry-run'
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                data-testid="pipeline-mode-dry-run"
              >
                <div className="font-medium">演练模式</div>
                <div className="mt-1 text-xs text-gray-500">默认安全模式，禁止仓库副作用，只沉淀协作文档与任务状态</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!livePipelineReady) return;
                  setExecutionMode('live');
                  setSurfaceTimeoutMs(300_000);
                }}
                disabled={!livePipelineReady}
                className={`rounded-md border p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  executionMode === 'live'
                    ? 'border-green-500 bg-green-50 text-green-900'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                data-testid="pipeline-mode-live"
              >
                <div className="font-medium">真实执行</div>
                <div className="mt-1 text-xs text-gray-500">需要全部 Hermes Agent 在线，按工作流调用真实 Agent 能力</div>
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">Surface 超时</div>
                <div className="text-xs text-gray-500">超过该时长会失败并关闭看板任务</div>
              </div>
              <select
                value={surfaceTimeoutMs}
                onChange={(event) => setSurfaceTimeoutMs(Number(event.target.value))}
                className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                aria-label="Surface timeout"
                data-testid="pipeline-surface-timeout"
              >
                {SURFACE_TIMEOUT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-l-4 border-l-cyan-500" data-testid="pipeline-builder">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-lg">自定义 Pipeline Builder</CardTitle>
                <p className="mt-1 text-sm text-gray-500">像会议邀请 Agent 一样，为每个流水线步骤选择 Agent、目标、产物和依赖</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={addBuilderSurface}>添加步骤</Button>
                <Button onClick={generateBuilderYaml}>生成 YAML</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={builderId}
                onChange={(event) => setBuilderId(event.target.value)}
                className="h-10 rounded-md border border-gray-300 px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                placeholder="Pipeline ID"
                data-testid="pipeline-builder-id"
              />
              <input
                value={builderName}
                onChange={(event) => setBuilderName(event.target.value)}
                className="h-10 rounded-md border border-gray-300 px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                placeholder="Pipeline Name"
                data-testid="pipeline-builder-name"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-[#f8fafc]">
                <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
                  <div>
                    <div className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-700">Agent Flow Canvas</div>
                    <div className="text-xs text-gray-500">拖拽节点调整顺序；点击“连接”后再点目标节点创建 Agent to Agent 交付链路</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="rounded-full border border-gray-200 bg-white px-2 py-1">{builderSurfaces.length} 节点</span>
                    <span className="rounded-full border border-gray-200 bg-white px-2 py-1">{builderEdges.length} 连线</span>
                  </div>
                </div>

                <div className="overflow-auto">
                  <div
                    className="relative"
                    style={{
                      width: BUILDER_CANVAS_WIDTH,
                      height: BUILDER_CANVAS_HEIGHT,
                      backgroundImage:
                        'linear-gradient(to right, rgba(15, 23, 42, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
                      backgroundSize: '32px 32px',
                    }}
                    onPointerMove={(event) => {
                      if (!draggingSurfaceId) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      moveBuilderSurface(
                        draggingSurfaceId,
                        event.clientX - rect.left - BUILDER_NODE_WIDTH / 2,
                        event.clientY - rect.top - 28,
                      );
                    }}
                    onPointerUp={() => setDraggingSurfaceId(null)}
                    onPointerLeave={() => setDraggingSurfaceId(null)}
                    data-testid="pipeline-visual-builder-canvas"
                  >
                    <svg
                      className="pointer-events-none absolute inset-0"
                      width={BUILDER_CANVAS_WIDTH}
                      height={BUILDER_CANVAS_HEIGHT}
                      aria-hidden="true"
                    >
                      <defs>
                        <marker id="builder-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                          <path d="M0,0 L0,6 L9,3 z" fill="#0891b2" />
                        </marker>
                      </defs>
                      {builderEdges.map((edge) => {
                        const from = builderSurfaces.find((surface) => surface.id === edge.from);
                        const to = builderSurfaces.find((surface) => surface.id === edge.to);
                        if (!from || !to) return null;
                        const startX = from.x + BUILDER_NODE_WIDTH;
                        const startY = from.y + BUILDER_NODE_HEIGHT / 2;
                        const endX = to.x;
                        const endY = to.y + BUILDER_NODE_HEIGHT / 2;
                        const mid = Math.max(48, Math.abs(endX - startX) / 2);
                        const path = `M ${startX} ${startY} C ${startX + mid} ${startY}, ${endX - mid} ${endY}, ${endX} ${endY}`;
                        return (
                          <g key={`${edge.from}-${edge.to}`}>
                            <path d={path} fill="none" stroke="#0891b2" strokeWidth="2.5" markerEnd="url(#builder-arrow)" />
                            <circle cx={(startX + endX) / 2} cy={(startY + endY) / 2} r="5" fill="#ecfeff" stroke="#0891b2" strokeWidth="2" />
                          </g>
                        );
                      })}
                    </svg>

                    {builderSurfaces.map((surface, index) => {
                      const selected = surface.id === selectedBuilderSurface?.id;
                      const isConnectingSource = connectingFromSurfaceId === surface.id;
                      const dependencies = surface.dependsOn.split(',').map((item) => item.trim()).filter(Boolean);
                      return (
                        <div
                          key={`${surface.id}-${index}`}
                          role="button"
                          tabIndex={0}
                          className={`absolute rounded-lg border bg-white shadow-sm transition ${
                            selected ? 'border-cyan-500 ring-4 ring-cyan-100' : 'border-gray-200 hover:border-cyan-300'
                          } ${isConnectingSource ? 'ring-4 ring-amber-100 border-amber-400' : ''}`}
                          style={{ left: surface.x, top: surface.y, width: BUILDER_NODE_WIDTH, height: BUILDER_NODE_HEIGHT }}
                          onClick={() => {
                            if (connectingFromSurfaceId && connectingFromSurfaceId !== surface.id) {
                              connectBuilderSurfaces(connectingFromSurfaceId, surface.id);
                              setConnectingFromSurfaceId(null);
                            }
                            setSelectedBuilderSurfaceId(surface.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') setSelectedBuilderSurfaceId(surface.id);
                          }}
                          onPointerDown={(event) => {
                            if ((event.target as HTMLElement).closest('button')) return;
                            setDraggingSurfaceId(surface.id);
                            setSelectedBuilderSurfaceId(surface.id);
                            event.currentTarget.setPointerCapture(event.pointerId);
                          }}
                          data-testid={`pipeline-builder-node-${surface.id}`}
                        >
                          <div className="flex h-full flex-col justify-between p-3">
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-bold text-gray-950">{surface.name || surface.id}</div>
                                  <div className="mt-1 truncate text-xs text-cyan-700">{agentNameById.get(surface.agent) || surface.agent}</div>
                                </div>
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">#{index + 1}</span>
                              </div>
                              <div className="mt-2 line-clamp-2 text-xs text-gray-500">{surface.goal}</div>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[11px] text-gray-400">
                                {dependencies.length > 0 ? `依赖 ${dependencies.join(', ')}` : '起点节点'}
                              </span>
                              <button
                                type="button"
                                className={`rounded px-2 py-1 text-[11px] font-semibold ${
                                  isConnectingSource ? 'bg-amber-500 text-white' : 'bg-gray-950 text-white hover:bg-cyan-700'
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setConnectingFromSurfaceId(isConnectingSource ? null : surface.id);
                                  setSelectedBuilderSurfaceId(surface.id);
                                }}
                              >
                                连接
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                {selectedBuilderSurface && selectedBuilderSurfaceIndex >= 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-gray-950">节点属性</div>
                        <div className="text-xs text-gray-500">配置该 Agent 节点的职责、输入依赖和交付物</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeBuilderSurface(selectedBuilderSurfaceIndex)}
                        disabled={builderSurfaces.length <= 1}
                        className="border-red-200 text-red-600 hover:bg-red-50"
                      >
                        删除
                      </Button>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500">节点 ID</span>
                      <input
                        value={selectedBuilderSurface.id}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          const previousId = selectedBuilderSurface.id;
                          updateBuilderSurface(selectedBuilderSurfaceIndex, { id: nextId });
                          setSelectedBuilderSurfaceId(nextId);
                          setBuilderSurfaces((current) => current.map((surface, i) => {
                            if (i === selectedBuilderSurfaceIndex) return surface;
                            const dependencies = surface.dependsOn
                              .split(',')
                              .map((item) => item.trim())
                              .filter(Boolean)
                              .map((item) => item === previousId ? nextId : item);
                            return { ...surface, dependsOn: dependencies.join(', ') };
                          }));
                        }}
                        className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500">节点名称</span>
                      <input
                        value={selectedBuilderSurface.name}
                        onChange={(event) => updateBuilderSurface(selectedBuilderSurfaceIndex, { name: event.target.value })}
                        className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500">执行 Agent</span>
                      <select
                        value={selectedBuilderSurface.agent}
                        onChange={(event) => updateBuilderSurface(selectedBuilderSurfaceIndex, { agent: event.target.value })}
                        className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                      >
                        {availableAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500">目标</span>
                      <textarea
                        value={selectedBuilderSurface.goal}
                        onChange={(event) => updateBuilderSurface(selectedBuilderSurfaceIndex, { goal: event.target.value })}
                        className="min-h-[92px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500">交付产物</span>
                      <input
                        value={selectedBuilderSurface.artifacts}
                        onChange={(event) => updateBuilderSurface(selectedBuilderSurfaceIndex, { artifacts: event.target.value })}
                        className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        placeholder="prd, report, test_plan"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500">上游依赖</span>
                      <input
                        value={selectedBuilderSurface.dependsOn}
                        onChange={(event) => updateBuilderSurface(selectedBuilderSurfaceIndex, { dependsOn: event.target.value })}
                        className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        placeholder="从画布连线自动生成，也可手动编辑"
                      />
                    </label>
                    <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
                      <div className="mb-2 text-xs font-semibold text-gray-500">当前连线</div>
                      <div className="space-y-1">
                        {builderEdges.filter((edge) => edge.to === selectedBuilderSurface.id || edge.from === selectedBuilderSurface.id).length > 0 ? (
                          builderEdges
                            .filter((edge) => edge.to === selectedBuilderSurface.id || edge.from === selectedBuilderSurface.id)
                            .map((edge) => (
                              <div key={`${edge.from}-${edge.to}`} className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-xs">
                                <span className="font-mono text-gray-600">{edge.from} → {edge.to}</span>
                                <button
                                  type="button"
                                  className="text-red-600 hover:text-red-700"
                                  onClick={() => removeBuilderEdge(edge.from, edge.to)}
                                >
                                  移除
                                </button>
                              </div>
                            ))
                        ) : (
                          <div className="text-xs text-gray-400">暂无连线</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">选择一个节点开始配置</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-l-4 border-l-emerald-500" data-testid="pipeline-yaml-importer">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-lg">导入 YAML Pipeline</CardTitle>
                <p className="mt-1 text-sm text-gray-500">注册后会出现在 Pipeline 列表和工作流模板中</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={yamlSource}
                  onChange={(event) => setYamlSource(event.target.value)}
                  className="h-9 w-56 rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  aria-label="YAML source"
                  data-testid="pipeline-yaml-source"
                />
                <Button
                  onClick={importYamlPipeline}
                  disabled={importingYaml}
                  className="min-w-[96px]"
                  data-testid="pipeline-yaml-import"
                >
                  {importingYaml ? '导入中...' : '导入'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              value={yamlDraft}
              onChange={(event) => setYamlDraft(event.target.value)}
              className="min-h-[180px] w-full resize-y rounded-md border border-gray-300 bg-gray-950 p-3 font-mono text-sm text-gray-50 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              spellCheck={false}
              aria-label="Pipeline YAML definition"
              data-testid="pipeline-yaml-definition"
            />
          </CardContent>
        </Card>

        {/* 执行历史 */}
        {instanceHistory.length > 0 && (
          <Card className="mb-6 border-l-4 border-l-amber-500">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle className="text-lg">
                  执行历史 ({filteredInstanceHistory.length}/{instanceHistory.length})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <select
                    value={historyStatusFilter}
                    onChange={(event) => setHistoryStatusFilter(event.target.value)}
                    className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    aria-label="Pipeline history status filter"
                    data-testid="pipeline-history-status-filter"
                  >
                    {HISTORY_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
                    {showHistory ? '收起' : '展开'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {showHistory && (
              <CardContent>
                <div className="space-y-2">
                  {filteredInstanceHistory.map((instance) => (
                    <div
                      key={instance.id}
                      className={`flex items-center justify-between p-3 rounded border cursor-pointer hover:bg-gray-50 ${
                        currentInstance?.id === instance.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      }`}
                      onClick={() => {
                        setCurrentInstance(instance);
                        if (instance.status === 'running') {
                          startPolling(instance.id);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(instance.status)}`} />
                        <div>
                          <p className="font-medium text-sm">{instance.pipelineId}</p>
                          <p className="text-xs text-gray-500">{instance.id}</p>
                        </div>
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        <p>{getStatusBadge(instance.status)}</p>
                        <p>{new Date(instance.startedAt).toLocaleString()}</p>
                        {(instance.knowledge_url || instance.kanban_url) && (
                          <div className="mt-1 flex justify-end gap-2">
                            {instance.knowledge_url && (
                              <a
                                href={instance.knowledge_url}
                                className="text-blue-600 hover:underline"
                                onClick={(event) => event.stopPropagation()}
                              >
                                文档
                              </a>
                            )}
                            {instance.kanban_url && (
                              <a
                                href={instance.kanban_url}
                                className="text-slate-600 hover:underline"
                                onClick={(event) => event.stopPropagation()}
                              >
                                看板
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredInstanceHistory.length === 0 && (
                    <div className="rounded border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
                      当前筛选下没有执行记录
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Pipeline 列表 */}
        <div className="grid gap-6 mb-8">
          {pipelines.map((pipeline) => (
            <Card
              key={pipeline.id}
              className="border-l-4 border-l-blue-500"
              data-testid={`pipeline-card-${pipeline.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl">{pipeline.name}</CardTitle>
                      {pipeline.source === 'runtime-yaml' && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                          运行时 YAML
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">ID: {pipeline.id} | 版本: {pipeline.version || '1.0'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pipeline.deletable && (
                      <Button
                        variant="outline"
                        onClick={() => deletePipeline(pipeline)}
                        disabled={executing === pipeline.id}
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        data-testid={`pipeline-delete-${pipeline.id}`}
                      >
                        删除
                      </Button>
                    )}
                    <Button
                      onClick={() => executePipeline(pipeline.id)}
                      disabled={executing === pipeline.id || !canExecuteLive}
                      className="min-w-[100px]"
                      data-testid={`pipeline-execute-${pipeline.id}`}
                    >
                      {executing === pipeline.id ? '执行中...' : executionMode === 'live' ? '真实执行' : '演练'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {renderPipelineStatus(pipeline, currentInstance)}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 当前实例状态 */}
        {currentInstance && (
          <Card className="border-l-4 border-l-purple-500">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>当前执行实例</CardTitle>
                <div className="flex items-center gap-2">
                  {currentInstance.status === 'running' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelPipeline(currentInstance.id)}
                      className="border-amber-300 text-amber-700 hover:bg-amber-50"
                    >
                      停止
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled title="暂停需要 Surface checkpoint 协议">
                    暂停
                  </Button>
                  <Button variant="outline" size="sm" disabled title="恢复需要 Surface checkpoint/replay 协议">
                    恢复
                  </Button>
                  <Button variant="outline" size="sm" disabled title="回滚需要可逆副作用协议">
                    回滚
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                当前版本支持安全停止；暂停、恢复、回滚已在 API 层明确拒绝，等待 Surface checkpoint/replay 协议后开放。
              </div>
              {currentProgress && (
                <div
                  className="mb-4 rounded border border-blue-100 bg-blue-50 px-3 py-3"
                  data-testid="pipeline-progress-summary"
                >
                  <div className="mb-2 flex flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
                    <div>
                      <span className="font-medium text-blue-900">
                        {currentInstance.status === 'running' ? '当前面' : '最后进度'}:
                      </span>
                      <span className="ml-2 text-blue-800">
                        {currentProgress.activeSurfaceLabels.length > 0
                          ? currentProgress.activeSurfaceLabels.join(', ')
                          : '无运行中面'}
                      </span>
                    </div>
                    <div className="text-xs text-blue-800">
                      {currentProgress.finishedCount}/{currentProgress.total} 已结束
                      <span className="mx-2 text-blue-300">|</span>
                      {currentProgress.completedCount} 已完成
                      <span className="mx-2 text-blue-300">|</span>
                      耗时 {currentProgress.elapsed}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-white">
                    <div
                      className="h-full rounded bg-blue-600 transition-all"
                      style={{ width: `${currentProgress.progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
              {currentFailureDetail && (
                <div
                  className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-3"
                  data-testid="pipeline-failure-recovery-panel"
                >
                  <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-red-900">失败恢复</span>
                        {getStatusBadge(currentFailureDetail.status)}
                        <Badge variant="outline" className="border-red-200 text-red-700">
                          {currentFailureDetail.surfaceName}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-red-800">
                        负责 Agent: {currentFailureDetail.agentName}
                        <span className="mx-2 text-red-300">|</span>
                        Surface: <span className="font-mono">{currentFailureDetail.surfaceId}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => retryFailedPipeline(currentInstance)}
                        disabled={executing === currentInstance.pipelineId}
                        data-testid="pipeline-retry-button"
                      >
                        {executing === currentInstance.pipelineId ? '重试中...' : '重新执行 Pipeline'}
                      </Button>
                      {currentFailureDetail.projectId && (
                        <a
                          href={`/kanban?source=coordination&projectId=${encodeURIComponent(currentFailureDetail.projectId)}&status=blocked`}
                          className="inline-flex"
                        >
                          <Button variant="outline" size="sm" className="border-red-200 text-red-700">
                            查看阻塞任务
                          </Button>
                        </a>
                      )}
                      {currentFailureDetail.projectId && (
                        <a
                          href={`/knowledge?projectId=${encodeURIComponent(currentFailureDetail.projectId)}${currentFailureDetail.taskId ? `&taskId=${encodeURIComponent(currentFailureDetail.taskId)}` : ''}`}
                          className="inline-flex"
                        >
                          <Button variant="outline" size="sm">
                            查看交付文档
                          </Button>
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-red-900 md:grid-cols-2">
                    <div className="rounded bg-white/70 px-3 py-2">
                      <div className="mb-1 text-red-500">错误原因</div>
                      <div className="break-words font-mono">{currentFailureDetail.error}</div>
                    </div>
                    <div className="rounded bg-white/70 px-3 py-2">
                      <div className="mb-1 text-red-500">最近成功 checkpoint</div>
                      {currentFailureDetail.latestCheckpoint ? (
                        <div>
                          {currentFailureDetail.latestCheckpoint.surfaceName}
                          <span className="mx-2 text-red-300">|</span>
                          <span className="font-mono">{currentFailureDetail.latestCheckpoint.surfaceId}</span>
                          {currentFailureDetail.latestCheckpoint.completedAt && (
                            <span className="ml-2 text-red-700">
                              {new Date(currentFailureDetail.latestCheckpoint.completedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div>暂无成功 checkpoint，本次恢复会从 Pipeline 起点重新演练。</div>
                      )}
                    </div>
                    <div className="rounded bg-white/70 px-3 py-2">
                      <div className="mb-1 text-red-500">绑定任务</div>
                      <div className="font-mono">{currentFailureDetail.taskId || '未绑定'}</div>
                    </div>
                    <div className="rounded bg-white/70 px-3 py-2">
                      <div className="mb-1 text-red-500">关联文档</div>
                      <div>{currentFailureDetail.documentCount} 篇</div>
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">实例ID:</span>
                  <span className="ml-2 font-mono">{currentInstance.id}</span>
                </div>
                <div>
                  <span className="text-gray-500">Pipeline:</span>
                  <span className="ml-2">{currentInstance.pipelineId}</span>
                </div>
                <div>
                  <span className="text-gray-500">状态:</span>
                  <span className="ml-2">{getStatusBadge(currentInstance.status)}</span>
                </div>
                <div>
                  <span className="text-gray-500">开始时间:</span>
                  <span className="ml-2">{new Date(currentInstance.startedAt).toLocaleString()}</span>
                </div>
                {currentInstance.coordination?.projectId && (
                  <div>
                    <span className="text-gray-500">协作项目:</span>
                    <a
                      href={coordinationSummary?.navigation?.knowledge_url || `/knowledge?projectId=${encodeURIComponent(currentInstance.coordination.projectId)}`}
                      className="ml-2 font-mono text-blue-600 hover:underline"
                    >
                      {currentInstance.coordination.projectId}
                    </a>
                  </div>
                )}
                {currentInstance.coordination?.taskIdsBySurface && (
                  <div>
                    <span className="text-gray-500">绑定任务:</span>
                    <span className="ml-2">
                      {Object.keys(currentInstance.coordination.taskIdsBySurface).length} 个
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {currentInstance && coordinationSummary && (
          <Card className="mt-6 border-l-4 border-l-emerald-500">
            <CardHeader>
              <CardTitle>协作脉络</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                <div>
                  <span className="text-gray-500">项目:</span>
                  <span className="ml-2 font-mono">
                    {coordinationSummary.project?.id || currentInstance.coordination?.projectId || '未绑定'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">任务:</span>
                  <span className="ml-2">{coordinationSummary.tasks?.length || 0} 个</span>
                </div>
                <div>
                  <span className="text-gray-500">文档:</span>
                  <span className="ml-2">
                    {coordinationSummary.bindings.reduce((count, binding) => count + (binding.documents?.length || 0), 0)} 篇
                  </span>
                </div>
              </div>

              <div className="grid gap-2">
                {coordinationSummary.bindings.map((binding) => (
                  <div key={binding.surfaceId} className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{binding.surfaceId}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {binding.task?.title || binding.taskId}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {binding.task?.status && getStatusBadge(binding.task.status)}
                      <a
                        href={binding.knowledge_url || `/knowledge?projectId=${encodeURIComponent(coordinationSummary.project?.id || currentInstance.coordination?.projectId || '')}&taskId=${encodeURIComponent(binding.taskId)}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        文档
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {pipelines.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-500">
            <p>暂无 Pipeline 定义</p>
            <p className="text-sm mt-2">请在 Gateway 中加载 Pipeline YAML</p>
          </div>
        )}
      </div>
    </div>
  );
}
