export interface CoordinationTaskProjection {
  taskIdsBySurface?: Record<string, unknown>;
  taskNodeIdsBySurface?: Record<string, unknown>;
}

export interface CoordinationTaskBinding {
  surfaceId: string;
  taskId: string;
  nodeIndex: number;
  isPrimary: boolean;
}

export function flattenCoordinationTaskBindings(
  coordination: CoordinationTaskProjection | null | undefined,
): CoordinationTaskBinding[] {
  const legacy = coordination?.taskIdsBySurface ?? {};
  const nodes = coordination?.taskNodeIdsBySurface ?? {};
  const surfaceIds = Array.from(new Set([...Object.keys(legacy), ...Object.keys(nodes)]));
  const seenTaskIds = new Set<string>();
  const bindings: CoordinationTaskBinding[] = [];

  for (const surfaceId of surfaceIds) {
    const projectedIds = Array.isArray(nodes[surfaceId])
      ? (nodes[surfaceId] as unknown[]).filter(isTaskId)
      : [];
    const legacyId = isTaskId(legacy[surfaceId]) ? legacy[surfaceId] : undefined;
    const taskIds = projectedIds.length > 0 ? projectedIds : legacyId ? [legacyId] : [];
    const primaryTaskId = legacyId ?? taskIds[0];

    taskIds.forEach((taskId, nodeIndex) => {
      if (seenTaskIds.has(taskId)) return;
      seenTaskIds.add(taskId);
      bindings.push({ surfaceId, taskId, nodeIndex, isPrimary: taskId === primaryTaskId });
    });
  }

  return bindings;
}

function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
