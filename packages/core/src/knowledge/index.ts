export {
  KnowledgeCenter,
  createKnowledgeCenter,
  getGlobalKnowledgeCenter,
  resetGlobalKnowledgeCenter,
} from './KnowledgeCenter.js';

export type {
  KnowledgeDocument,
  KnowledgeQuery,
  KnowledgeResult,
  KnowledgeCenterConfig,
} from './KnowledgeCenter.js';

// DocumentManager — 增强版文档管理
export {
  DocumentManager,
  createDocumentManager,
  getGlobalDocumentManager,
  resetGlobalDocumentManager,
} from './DocumentManager.js';

export type {
  DocumentManagerConfig,
  DocumentV2,
  DocumentComment,
  DocumentQuery,
  Project,
  Task,
} from './DocumentManager.js';
