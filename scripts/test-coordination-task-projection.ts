import assert from 'node:assert/strict';
import {
  flattenCoordinationTaskBindings as flattenDashboardBindings,
} from '../packages/dashboard/src/lib/coordination-task-bindings.js';
import {
  flattenCoordinationTaskBindings as flattenGatewayBindings,
} from '../packages/gateway/src/coordination-task-bindings.js';

const mixedProjection = {
  taskIdsBySurface: {
    discovery: 'task-discovery',
    backend: 'task-backend-2',
    testing: 'task-testing',
  },
  taskNodeIdsBySurface: {
    backend: ['task-backend-1', 'task-backend-2'],
    frontend: ['task-frontend-1'],
  },
};

const expected = [
  { surfaceId: 'discovery', taskId: 'task-discovery', nodeIndex: 0, isPrimary: true },
  { surfaceId: 'backend', taskId: 'task-backend-1', nodeIndex: 0, isPrimary: false },
  { surfaceId: 'backend', taskId: 'task-backend-2', nodeIndex: 1, isPrimary: true },
  { surfaceId: 'testing', taskId: 'task-testing', nodeIndex: 0, isPrimary: true },
  { surfaceId: 'frontend', taskId: 'task-frontend-1', nodeIndex: 0, isPrimary: true },
];

assert.deepEqual(flattenGatewayBindings(mixedProjection), expected);
assert.deepEqual(flattenDashboardBindings(mixedProjection), expected);

const legacyProjection = {
  taskIdsBySurface: {
    discovery: 'task-discovery',
    backend: 'task-backend',
  },
};
assert.deepEqual(flattenGatewayBindings(legacyProjection), [
  { surfaceId: 'discovery', taskId: 'task-discovery', nodeIndex: 0, isPrimary: true },
  { surfaceId: 'backend', taskId: 'task-backend', nodeIndex: 0, isPrimary: true },
]);

const duplicateProjection = {
  taskIdsBySurface: { backend: 'task-shared' },
  taskNodeIdsBySurface: {
    backend: ['task-shared', 'task-backend-2'],
    frontend: ['task-shared', 'task-frontend-2'],
  },
};
assert.deepEqual(flattenDashboardBindings(duplicateProjection), [
  { surfaceId: 'backend', taskId: 'task-shared', nodeIndex: 0, isPrimary: true },
  { surfaceId: 'backend', taskId: 'task-backend-2', nodeIndex: 1, isPrimary: false },
  { surfaceId: 'frontend', taskId: 'task-frontend-2', nodeIndex: 1, isPrimary: false },
]);

console.log('coordination task projection contract: PASS');
