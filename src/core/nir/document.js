/**
 * 不可变文档模型。
 *
 * NirDocument = { version: string, graph: NirNodeRecord }
 * NirNodeRecord 见 read.js 顶部注释（type / fields / otherDatasets / metadata /
 * children / edges / edgePairs / otherGroups）。
 *
 * 约定：文档对象一律深冻结；任何"修改"都通过下面的纯函数完成——克隆受影响的
 * 子树，返回新文档，原文档保持不变。编辑操作（下一轮）在这组纯函数之上叠加。
 */

import { cloneGraph } from './shape.js';
import { cloneValue, stringValue } from './value.js';

/** 深冻结（TypedArray 冻结后元素不可写；字符串/普通对象照常冻结） */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    if (ArrayBuffer.isView(obj)) return obj; // TypedArray 不能冻结，按约定不改写
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      deepFreeze(obj[key]);
    }
  }
  return obj;
}

/** 由部件拼一个新文档（编辑器"新建模型"或测试用） */
export function createDocument(version, graph) {
  return deepFreeze({ version, graph: cloneGraph(graph) });
}

/** 通用变换：draft 是深拷贝的可变草稿，改完返回新冻结文档 */
export function transformDocument(doc, mutator) {
  const draft = { version: doc.version, graph: cloneGraph(doc.graph) };
  const result = mutator(draft);
  const next = result && result.version !== undefined ? result : draft;
  return deepFreeze(next);
}

/** 设置版本字符串 */
export function withVersion(doc, version) {
  return transformDocument(doc, (draft) => {
    draft.version = version;
    return draft;
  });
}

/** 找节点：nodePath 是从根图开始的名字序列（如 ['block', 'lif']） */
function findNode(graph, nodePath) {
  let cur = graph;
  for (let i = 0; i < nodePath.length; i += 1) {
    if (cur.type !== 'NIRGraph' || !cur.children || !(nodePath[i] in cur.children)) {
      return null;
    }
    cur = cur.children[nodePath[i]];
  }
  return cur;
}

function cloneNodeShallow(node) {
  const copy = {
    type: node.type,
    fields: { ...node.fields },
    otherDatasets: { ...node.otherDatasets },
    metadata: { ...node.metadata },
    children: null,
    edges: node.edges || null,
    edgePairs: node.edgePairs ? node.edgePairs.map((e) => [...e]) : null,
    otherGroups: { ...node.otherGroups },
  };
  if (node.children) {
    copy.children = { ...node.children };
  }
  return copy;
}

/**
 * 沿路径克隆（路径上的节点都换成浅拷贝，其余子树共享引用）。
 * 返回 { graph, node } —— node 是路径末端节点的可变浅拷贝。
 */
function cloneAlongPath(graph, nodePath) {
  const root = cloneNodeShallow(graph);
  let cur = root;
  for (const name of nodePath) {
    const child = cloneNodeShallow(cur.children[name]);
    cur.children[name] = child;
    cur = child;
  }
  return { graph: root, node: cur };
}

/**
 * 设置/替换节点的一个字段值（NirValue）。传 null 表示删除该字段。
 * nodePath 省略或空数组 = 根图节点本身。
 */
export function setNodeField(doc, nodePath, fieldName, value) {
  return transformDocument(doc, (draft) => {
    const { graph, node } = cloneAlongPath(draft.graph, nodePath || []);
    draft.graph = graph;
    if (value === null) {
      delete node.fields[fieldName];
    } else {
      node.fields[fieldName] = cloneValue(value);
    }
    return draft;
  });
}

/** 设置节点元数据键（value 为 NirValue 或嵌套字典）；null 删除 */
export function setNodeMetadata(doc, nodePath, key, value) {
  return transformDocument(doc, (draft) => {
    const { graph, node } = cloneAlongPath(draft.graph, nodePath || []);
    draft.graph = graph;
    if (value === null) {
      delete node.metadata[key];
    } else if (value && typeof value === 'object' && 'dtype' in value) {
      node.metadata[key] = cloneValue(value);
    } else {
      node.metadata[key] = value;
    }
    return draft;
  });
}

/** 整体替换图的边列表（字符串对数组）；edges NirValue 置空，写出时按 vlen 重建 */
export function setEdges(doc, edgePairs) {
  return transformDocument(doc, (draft) => {
    draft.graph = cloneGraph(draft.graph);
    draft.graph.edgePairs = edgePairs.map((e) => [...e]);
    draft.graph.edges = null;
    return draft;
  });
}

/** 重命名节点（同时改引用它的边；子图内部同名节点不受影响） */
export function renameNode(doc, parentPath, oldName, newName) {
  return transformDocument(doc, (draft) => {
    const { graph, node } = cloneAlongPath(draft.graph, parentPath || []);
    draft.graph = graph;
    if (node.type !== 'NIRGraph' || !node.children || !(oldName in node.children)) {
      throw new Error(`renameNode: node '${oldName}' not found`);
    }
    if (newName in node.children) {
      throw new Error(`renameNode: node name '${newName}' already exists`);
    }
    const children = {};
    for (const [name, child] of Object.entries(node.children)) {
      children[name === oldName ? newName : name] = child;
    }
    node.children = children;
    node.edgePairs = node.edgePairs.map(([a, b]) => [a === oldName ? newName : a, b === oldName ? newName : b]);
    node.edges = null;
    return draft;
  });
}

/**
 * 新建一个空图节点记录（编辑器加节点用）；fields 由调用方按算子表填。
 */
export function makeNodeRecord(type) {
  return {
    type,
    fields: {},
    otherDatasets: {},
    metadata: {},
    children: type === 'NIRGraph' ? {} : null,
    edges: null,
    edgePairs: type === 'NIRGraph' ? [] : null,
    otherGroups: {},
  };
}

/** 加节点到指定图（parentPath 省略 = 根图） */
export function addNode(doc, name, nodeRecord, parentPath = []) {
  return transformDocument(doc, (draft) => {
    const { graph, node } = cloneAlongPath(draft.graph, parentPath);
    draft.graph = graph;
    if (node.type !== 'NIRGraph') {
      throw new Error(`addNode: parent is not a graph (${node.type})`);
    }
    if (name in node.children) {
      throw new Error(`addNode: node name '${name}' already exists`);
    }
    node.children[name] = cloneGraph(nodeRecord);
    return draft;
  });
}

/** 删节点（同时删与它相连的边） */
export function removeNode(doc, name, parentPath = []) {
  return transformDocument(doc, (draft) => {
    const { graph, node } = cloneAlongPath(draft.graph, parentPath);
    draft.graph = graph;
    if (node.type !== 'NIRGraph' || !node.children || !(name in node.children)) {
      throw new Error(`removeNode: node '${name}' not found`);
    }
    const children = { ...node.children };
    delete children[name];
    node.children = children;
    node.edgePairs = node.edgePairs.filter(([a, b]) => a !== name && b !== name);
    node.edges = null;
    return draft;
  });
}

/** 便捷构造：字符串标量 NirValue（版本号、padding 等） */
export function strValue(s) {
  return stringValue([], s);
}
