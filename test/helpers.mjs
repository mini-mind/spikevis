/**
 * 测试辅助：后端单例、文档深度比较（带路径的差分报告）、测试用节点构造器。
 */

import assert from 'node:assert/strict';
import { createH5wasmBackend } from '../src/core/nir/backend-h5wasm.js';
import { NUMERIC_DTYPES, valuesEqual } from '../src/core/nir/index.js';

let backendPromise = null;
export function getBackend() {
  if (!backendPromise) backendPromise = createH5wasmBackend();
  return backendPromise;
}

/** 文档深度比较，差异写入 diffs（带路径），不抛错 */
export function compareDocs(a, b, diffs, path = '') {
  if (a.version !== b.version) diffs.push(`${path}/version: ${a.version} != ${b.version}`);
  compareNodes(a.graph, b.graph, diffs, `${path}/graph`);
}

export function compareNodes(a, b, diffs, path) {
  if (a.type !== b.type) {
    diffs.push(`${path}/type: ${a.type} != ${b.type}`);
    return;
  }
  compareValueMaps(a.fields, b.fields, diffs, `${path}/fields`);
  compareValueMaps(a.otherDatasets, b.otherDatasets, diffs, `${path}/otherDatasets`);
  compareMetadata(a.metadata, b.metadata, diffs, `${path}/metadata`);
  compareValueMaps(a.otherGroups, b.otherGroups, diffs, `${path}/otherGroups`, true);
  // children
  const ak = a.children ? Object.keys(a.children) : null;
  const bk = b.children ? Object.keys(b.children) : null;
  if (JSON.stringify(ak) !== JSON.stringify(bk)) {
    diffs.push(`${path}/children keys: [${ak}] != [${bk}]`);
  } else if (ak) {
    for (const k of ak) compareNodes(a.children[k], b.children[k], diffs, `${path}/children/${k}`);
  }
  // edges 原始数据集
  if (!valuesEqual(a.edges, b.edges)) {
    diffs.push(`${path}/edges dataset differs`);
  }
  // edgePairs
  if (JSON.stringify(a.edgePairs) !== JSON.stringify(b.edgePairs)) {
    diffs.push(`${path}/edgePairs: ${JSON.stringify(a.edgePairs)} != ${JSON.stringify(b.edgePairs)}`);
  }
}

function compareValueMaps(a, b, diffs, path, groups = false) {
  const ak = Object.keys(a || {}).sort();
  const bk = Object.keys(b || {}).sort();
  if (JSON.stringify(ak) !== JSON.stringify(bk)) {
    diffs.push(`${path} keys: [${ak}] != [${bk}]`);
    return;
  }
  for (const k of ak) {
    if (groups) {
      // 未知子组：键->NirValue|嵌套字典
      compareValueMaps(a[k], b[k], diffs, `${path}/${k}`);
    } else {
      if (!valuesEqual(a[k], b[k])) {
        diffs.push(`${path}/${k}: ${describeValue(a[k])} != ${describeValue(b[k])}`);
      }
    }
  }
}

function compareMetadata(a, b, diffs, path) {
  const ak = Object.keys(a || {}).sort();
  const bk = Object.keys(b || {}).sort();
  if (JSON.stringify(ak) !== JSON.stringify(bk)) {
    diffs.push(`${path} keys: [${ak}] != [${bk}]`);
    return;
  }
  for (const k of ak) {
    const va = a[k];
    const vb = b[k];
    const isMapA = va && typeof va === 'object' && !('dtype' in va);
    const isMapB = vb && typeof vb === 'object' && !('dtype' in vb);
    if (isMapA || isMapB) {
      if (!isMapA || !isMapB) diffs.push(`${path}/${k}: one side is a nested group, other is not`);
      else compareValueMaps(va, vb, diffs, `${path}/${k}`);
    } else if (!valuesEqual(va, vb)) {
      diffs.push(`${path}/${k}: ${describeValue(va)} != ${describeValue(vb)}`);
    }
  }
}

function describeValue(v) {
  if (v === undefined) return 'undefined';
  if (typeof v.data === 'string') return `${v.dtype}("${v.data}")`;
  if (Array.isArray(v.data)) return `${v.dtype}${JSON.stringify(v.shape)}[${v.data.length} strings]`;
  return `${v.dtype}${JSON.stringify(v.shape)}[${v.data.constructor.name} x ${v.data.length}]`;
}

/** 断言两文档相等；不等时把差异列出来 */
export function assertDocsEqual(a, b, label) {
  const diffs = [];
  compareDocs(a, b, diffs);
  if (diffs.length > 0) {
    assert.fail(`${label} differs:\n  ${diffs.slice(0, 30).join('\n  ')}`);
  }
}

// ---- 测试用构造器 ----

export function num(dtype, shape, values) {
  const Ctor = NUMERIC_DTYPES[dtype];
  // 64 位整数构造器要 BigInt，测试里允许直接传 number
  const isBigInt = dtype === 'i64' || dtype === 'u64';
  const prepared = isBigInt ? values.map((v) => (typeof v === 'bigint' ? v : BigInt(v))) : values;
  return { dtype, shape, data: new Ctor(prepared) };
}

export function strVal(s) {
  return { dtype: 'vlen-str', shape: [], data: s };
}

export function makeNode(type, fields = {}, metadata = {}) {
  return {
    type,
    fields,
    otherDatasets: {},
    metadata,
    children: null,
    edges: null,
    edgePairs: null,
    otherGroups: {},
  };
}

export function makeGraph(children, edgePairs, metadata = {}) {
  return {
    type: 'NIRGraph',
    fields: {},
    otherDatasets: {},
    metadata,
    children,
    edges: null,
    edgePairs,
    otherGroups: {},
  };
}
