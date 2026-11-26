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
 *   { kind: 'removeNodes', path?, names: string[], confirmed? }
 *       —— 批量删除(画布多选后按 Delete):一次确认、一条历史。
 *          预警按"逐个删、在同一份渐进文档上算"合并,同一批删除彼此造成的断连
 *          不算这批的预警(边已经随前一个节点一起删掉了,不再重复报)。
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
 *
 * 子图端口保护(进入子图编辑轮新增):
 * - 子图内部删除 Input/Output 端口节点被拒绝(抛错,人话原因)——端口是接口,
 *   父图的边还接在上面;顶层图的 Input/Output 仍可删(带连通性预警);
 * - 子图内部的通道剪枝若传播会改到内部端口的 shape,同样拒绝(先解组再剪)。
 */

import {
  connectEdge, createNode, disconnectEdge, disconnectWarningItems, graphAt, renameNodeChecked,
  scaleField, setFieldIndices, setFieldUniform, setIntArrayField, setScalarField,
  setSimpleMetadata, setStringField,
} from '../core/nir/edits.js';
import { applyPruneChannels, planPruneChannels } from '../core/nir/prune.js';
import { groupNodes, planGroupNodes, ungroupNode } from '../core/nir/grouping.js';
import { removeNode } from '../core/nir/document.js';

/**
 * 每种动作对应的操作名(历史栈标签)。
 * 返回 { label, code, params }:label 是中文正典(测试锁定,逐字不变);
 * code+params 供界面用 i18n 的 tLabel() 出当前语言。
 */
function labelOf(action) {
  switch (action.kind) {
    case 'removeNode':
      return { label: `删除节点 ${action.name}`, code: 'act.removeNode', params: { name: action.name } };
    case 'removeNodes':
      return { label: `删除 ${action.names.length} 个节点`, code: 'act.removeNodes', params: { count: action.names.length } };
    case 'addNode': {
      const name = action.name || action.type;
      return { label: `新建节点 ${name}`, code: 'act.addNode', params: { name } };
    }
    case 'connect':
      return { label: `连线 ${action.src} → ${action.dst}`, code: 'act.connect', params: { src: action.src, dst: action.dst } };
    case 'disconnect':
      return { label: `断开 ${action.src} → ${action.dst}`, code: 'act.disconnect', params: { src: action.src, dst: action.dst } };
    case 'rename':
      return { label: `重命名 ${action.oldName} → ${action.newName}`, code: 'act.rename', params: { oldName: action.oldName, newName: action.newName } };
    case 'setScalar':
    case 'setString':
    case 'setIntArray':
    case 'setUniform':
    case 'setFieldIndices': {
      const node = lastOf(action.path);
      return { label: `修改 ${node} 的 ${action.field}`, code: 'act.editField', params: { node, field: action.field } };
    }
    case 'scaleField': {
      const node = lastOf(action.path);
      return { label: `缩放 ${node} 的 ${action.field} ×${action.factor}`, code: 'act.scaleField', params: { node, field: action.field, factor: action.factor } };
    }
    case 'setMetadata': {
      const node = lastOf(action.path);
      return action.value === null
        ? { label: `删除 ${node} 的元数据 ${action.key}`, code: 'act.removeMetadata', params: { node, key: action.key } }
        : { label: `修改 ${node} 的元数据 ${action.key}`, code: 'act.editMetadata', params: { node, key: action.key } };
    }
    case 'pruneChannels': {
      const node = lastOf(action.path);
      const count = Array.isArray(action.keep) ? action.keep.length : '?';
      return { label: `通道剪枝 ${node}(保留 ${count} 个通道)`, code: 'act.pruneChannels', params: { node, count } };
    }
    case 'group': {
      const name = action.name || '(自动命名)';
      return { label: `编成一组 ${name}`, code: 'act.group', params: { name } };
    }
    case 'ungroup': {
      const node = lastOf(action.path);
      return { label: `展开子图 ${node}`, code: 'act.ungroup', params: { node } };
    }
    default: throw new Error(`applyEditAction: unknown action kind '${action.kind}'`);
  }
}

function lastOf(path) {
  return (path && path.length > 0) ? path[path.length - 1] : '';
}

export function applyEditAction(doc, action) {
  // 子图内部删除 Input/Output 端口:拒绝。端口是子图与外界的接口,
  // 父图的边还接在这个端口上,直接删会让外面的边悬空。
  // (顶层图的 Input/Output 不在此限——它们没有"外面的边"。)
  // 批量删除同样受保护:任一名字是端口就整批拒绝(人话里点名该端口)。
  if ((action.kind === 'removeNode' || action.kind === 'removeNodes') && (action.path || []).length > 0) {
    const graph = graphAt(doc, action.path);
    const names = action.kind === 'removeNodes' ? action.names : [action.name];
    for (const name of names) {
      const port = graph.children[name];
      if (port && (port.type === 'Input' || port.type === 'Output')) {
        throw new Error(
          `不能删除子图端口 '${name}'(${port.type}):它是子图与外界的接口,父图的边还接在这个端口上;`
          + `要删接口请先回到上层断开对应的边,或用"展开到当前层"解组后再删`,
        );
      }
    }
  }
  // 删除节点:先算连通性预警,非空且未确认就不应用
  if (action.kind === 'removeNode' && !action.confirmed) {
    const warningItems = disconnectWarningItems(doc, action.path || [], action.name);
    if (warningItems.length > 0) {
      return {
        doc,
        ...labelOf(action),
        warnings: warningItems.map((w) => w.message),
        // 结构化预警:界面用 tv() 按当前语言显示
        warningsX: warningItems,
        applied: false,
      };
    }
  }
  // 批量删除:预警逐个算,且每个节点都在"同批其余节点已删掉"的渐进文档上算,
  // 避免把"断连是同批删除造成的"误报成这批的预警
  if (action.kind === 'removeNodes' && !action.confirmed) {
    let probe = doc;
    const warningItems = [];
    for (const name of action.names) {
      warningItems.push(...disconnectWarningItems(probe, action.path || [], name));
      probe = removeNode(probe, name, action.path || []);
    }
    if (warningItems.length > 0) {
      return {
        doc,
        ...labelOf(action),
        warnings: warningItems.map((w) => w.message),
        warningsX: warningItems,
        applied: false,
      };
    }
  }
  // 成组:会产生多端口子图时先返回预警(官方库只支持单入单出子图),
  // 界面确认后带 confirmed: true 重发
  if (action.kind === 'group' && !action.confirmed) {
    const plan = planGroupNodes(doc, action.path || [], action.names, { name: action.name });
    if (plan.warnings.length > 0) {
      return {
        doc,
        ...labelOf(action),
        warnings: plan.warnings,
        warningsX: plan.warningsX || [],
        applied: false,
      };
    }
  }

  let next;
  switch (action.kind) {
    case 'removeNode': next = removeNode(doc, action.name, action.path || []); break;
    case 'removeNodes': {
      next = doc;
      for (const name of action.names) {
        next = removeNode(next, name, action.path || []);
      }
      break;
    }
    // createNode 的签名是 parentPath,动作里叫 path:这里显式对接,
    // 防止"进子图新建节点"时 path 被静默丢掉、节点错加到根图
    case 'addNode': next = createNode(doc, { ...action, parentPath: action.path || [] }); break;
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
      // 子图内部剪枝:传播若会改到内部 Input/Output 端口的 shape,等于改了子图的
      // 接口,外面的边会失配——拒绝并说明(先解组,连同外面的边一起剪)。
      // path 长度 > 1 = 被剪的图本身嵌在某个子图里。
      if ((action.path || []).length > 1) {
        const plan = planPruneChannels(doc, [{ path: action.path, axis: action.axis, keep: action.keep }]);
        const graph = graphAt(doc, action.path.slice(0, -1));
        const portHit = plan.pruned.find((p) => {
          const n = graph.children[p.name];
          return n && (n.type === 'Input' || n.type === 'Output');
        });
        if (portHit) {
          throw new Error(
            `通道剪枝被拒绝:剪枝会改到子图端口 '${portHit.name}' 的 shape,子图外面的边会失配;`
            + `请先回到上层用"展开到当前层"解组,连同外面的边一起剪`,
          );
        }
      }
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
  return { doc: next, ...labelOf(action), warnings: [], warningsX: [], applied: true };
}
