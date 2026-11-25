/**
 * 编辑动作分发:把界面发来的动作对象翻译成核心模块的纯函数调用。
 *
 * 本文件不 import Vue,Node 测试可以直接跑。
 * applyEditAction(doc, action) 返回 { doc, label, warnings }:
 *   doc      新文档(动作被拒绝时抛 Error,原文档不动);
 *   label    操作名(进历史栈);
 *   warnings 删除节点的连通性预警(非空且 action.confirmed 非 true 时不应用,
 *            把 warnings 原样返回给界面确认;确认后带 confirmed: true 重发)。
 *
 * 支持的动作(均可用 path 指到子图,缺省根图):
 *   { kind: 'removeNode',  path?, name, confirmed? }
 *   { kind: 'addNode',     path?, type, name?, shape?, inSize?, outSize?, kernel? }
 *   { kind: 'connect',     path?, src, dst }
 *   { kind: 'disconnect',  path?, src, dst }
 *   { kind: 'rename',      path?, oldName, newName }
 *   { kind: 'setScalar',       path, field, value }
 *   { kind: 'setString',       path, field, value }
 *   { kind: 'setIntArray',     path, field, values }
 *   { kind: 'setUniform',      path, field, value }
 *   { kind: 'scaleField',      path, field, factor }
 *   { kind: 'setFieldIndices', path, field, pairs }
 *   { kind: 'setMetadata',     path, key, value|null }
 *   { kind: 'pruneChannels',   path(节点路径,末位是节点名), axis: 'in'|'out', keep: number[] }
 *   { kind: 'group',       path?(父图路径), names: string[], name?, confirmed? }
 *       —— path 指父图;names 是要编组的节点名清单;多端口子图会先返回
 *          warnings(官方库只支持单入单出子图),confirmed 非 true 时不应用
 *   { kind: 'ungroup',     path(节点路径,末位是子图节点名) }
 */

import {
  connectEdge, createNode, disconnectEdge, disconnectWarnings, renameNodeChecked,
  scaleField, setFieldIndices, setFieldUniform, setIntArrayField, setScalarField,
  setSimpleMetadata, setStringField,
} from '../core/nir/edits.js';
import { applyPruneChannels } from '../core/nir/prune.js';
import { groupNodes, planGroupNodes, ungroupNode } from '../core/nir/grouping.js';
import { removeNode } from '../core/nir/document.js';

/** 每种动作对应的操作名(历史栈标签) */
function labelOf(action) {
  switch (action.kind) {
    case 'removeNode': return `删除节点 ${action.name}`;
    case 'addNode': return `新建节点 ${action.name || action.type}`;
    case 'connect': return `连线 ${action.src} → ${action.dst}`;
    case 'disconnect': return `断开 ${action.src} → ${action.dst}`;
    case 'rename': return `重命名 ${action.oldName} → ${action.newName}`;
    case 'setScalar':
    case 'setString':
    case 'setIntArray':
    case 'setUniform':
    case 'setFieldIndices':
      return `修改 ${lastOf(action.path)} 的 ${action.field}`;
    case 'scaleField':
      return `缩放 ${lastOf(action.path)} 的 ${action.field} ×${action.factor}`;
    case 'setMetadata': {
      const node = lastOf(action.path);
      return action.value === null ? `删除 ${node} 的元数据 ${action.key}` : `修改 ${node} 的元数据 ${action.key}`;
    }
    case 'pruneChannels':
      return `通道剪枝 ${lastOf(action.path)}(保留 ${Array.isArray(action.keep) ? action.keep.length : '?'} 个通道)`;
    case 'group':
      return `编成一组 ${action.name || '(自动命名)'}`;
    case 'ungroup':
      return `展开子图 ${lastOf(action.path)}`;
    default: throw new Error(`applyEditAction: unknown action kind '${action.kind}'`);
  }
}

function lastOf(path) {
  return (path && path.length > 0) ? path[path.length - 1] : '';
}

export function applyEditAction(doc, action) {
  // 删除节点:先算连通性预警,非空且未确认就不应用
  if (action.kind === 'removeNode' && !action.confirmed) {
    const warnings = disconnectWarnings(doc, action.path || [], action.name);
    if (warnings.length > 0) {
      return { doc, label: labelOf(action), warnings, applied: false };
    }
  }
  // 成组:会产生多端口子图时先返回预警(官方库只支持单入单出子图),
  // 界面确认后带 confirmed: true 重发
  if (action.kind === 'group' && !action.confirmed) {
    const plan = planGroupNodes(doc, action.path || [], action.names, { name: action.name });
    if (plan.warnings.length > 0) {
      return { doc, label: labelOf(action), warnings: plan.warnings, applied: false };
    }
  }

  let next;
  switch (action.kind) {
    case 'removeNode': next = removeNode(doc, action.name, action.path || []); break;
    case 'addNode': next = createNode(doc, action); break;
    case 'connect': next = connectEdge(doc, action.path || [], action.src, action.dst); break;
    case 'disconnect': next = disconnectEdge(doc, action.path || [], action.src, action.dst); break;
    case 'rename': next = renameNodeChecked(doc, action.path || [], action.oldName, action.newName); break;
    case 'setScalar': next = setScalarField(doc, action.path, action.field, action.value); break;
    case 'setString': next = setStringField(doc, action.path, action.field, action.value); break;
    case 'setIntArray': next = setIntArrayField(doc, action.path, action.field, action.values); break;
    case 'setUniform': next = setFieldUniform(doc, action.path, action.field, action.value); break;
    case 'scaleField': next = scaleField(doc, action.path, action.field, action.factor); break;
    case 'setFieldIndices': next = setFieldIndices(doc, action.path, action.field, action.pairs); break;
    case 'setMetadata': next = setSimpleMetadata(doc, action.path, action.key, action.value); break;
    case 'pruneChannels': {
      const r = applyPruneChannels(doc, [{ path: action.path, axis: action.axis, keep: action.keep }]);
      next = r.doc;
      break;
    }
    case 'group': {
      const r = groupNodes(doc, action.path || [], action.names, { name: action.name });
      next = r.doc;
      break;
    }
    case 'ungroup': {
      const r = ungroupNode(doc, action.path);
      next = r.doc;
      break;
    }
    default: throw new Error(`applyEditAction: unknown action kind '${action.kind}'`);
  }
  return { doc: next, label: labelOf(action), warnings: [], applied: true };
}
