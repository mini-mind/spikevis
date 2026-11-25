/**
 * 编辑操作(纯函数):输入文档,输出新文档;非法输入抛错且原文档不动。
 *
 * 画布与侧栏只发出"编辑动作"(见 src/io/editorActions.js 的 applyEditAction),
 * 不直接碰数据。所有操作都建立在 document.js 的不可变变换之上。
 *
 * 关于环:官方库(nir 1.0.8)实测接受带环的图——带 Input 入口且类型一致的环,
 * 构造/写/读(默认 type_check=True)全部成功;纯环(无 Input)在默认构造时抛
 * "No input nodes found",但 type_check=False 下可构造、可写。因此连线操作
 * 不拒绝造环;造出的纯环会在校验(形状推断)阶段被拦下,与官方语义一致。
 */

import {
  addNode, makeNodeRecord, removeNode, renameNode, setEdges, setNodeField,
  setNodeMetadata, transformDocument,
} from './document.js';
import { getOperatorInfo } from './operatorTable.js';
import {
  NUMERIC_DTYPES, isBigIntDtype, isNumericDtype, isStringDtype, stringValue,
} from './value.js';

/** 名字合法性:非空、不含斜杠(HDF5 路径分隔符)、不含点(与子图路径键约定冲突) */
export function assertValidName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('node name must be a non-empty string');
  }
  if (name.includes('/')) {
    throw new Error(`node name must not contain '/': '${name}'`);
  }
  if (name.includes('.')) {
    throw new Error(`node name must not contain '.': '${name}'`);
  }
}

/** 找到 parentPath 处的图节点(默认根图);不是图就抛错(grouping.js 等模块共用) */
export function graphAt(doc, parentPath) {
  let cur = doc.graph;
  for (const name of parentPath || []) {
    if (cur.type !== 'NIRGraph' || !cur.children || !(name in cur.children)) {
      throw new Error(`graph not found at path [${(parentPath || []).join(', ')}]`);
    }
    cur = cur.children[name];
  }
  if (cur.type !== 'NIRGraph') {
    throw new Error(`node at path [${(parentPath || []).join(', ')}] is not a graph (${cur.type})`);
  }
  return cur;
}

/** 找到 nodePath 处的节点(不存在抛错) */
function nodeAt(doc, nodePath) {
  const node = findNodeLoose(doc.graph, nodePath || []);
  if (!node) {
    throw new Error(`node not found at path [${(nodePath || []).join(', ')}]`);
  }
  return node;
}

function findNodeLoose(graph, nodePath) {
  let cur = graph;
  for (let i = 0; i < nodePath.length; i += 1) {
    if (cur.type !== 'NIRGraph' || !cur.children || !(nodePath[i] in cur.children)) {
      return null;
    }
    cur = cur.children[nodePath[i]];
  }
  return cur;
}

/**
 * 建议一个不重名的节点名:类型小写,重名时加 _1、_2 后缀。
 * 输入输出类节点保持惯用的 input/output 名。
 */
export function suggestNodeName(doc, parentPath, type) {
  const graph = graphAt(doc, parentPath || []);
  const taken = new Set(Object.keys(graph.children || {}));
  const base = type === 'Input' ? 'input' : type === 'Output' ? 'output' : type.toLowerCase();
  if (!taken.has(base)) return base;
  let i = 1;
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/**
 * 新建节点的缺省字段(对照官方各类型 __post_init__ 与夹具文件的写出风格):
 * 数值数组一律 f32;形状/整型一律 i64。shape 是神经元的通道数等一维尺寸。
 * 返回 NirNodeRecord(未连边的孤立节点)。
 */
export function buildNodeRecord(type, opts = {}) {
  const shape = opts.shape;
  const record = makeNodeRecord(type);
  const f32 = (values, dims) => ({
    dtype: 'f32', shape: dims, data: new Float32Array(values),
  });
  const i64 = (values, dims) => ({
    dtype: 'i64', shape: dims, data: new BigInt64Array(values.map((n) => BigInt(n))),
  });
  const ones = (n) => Array.from({ length: n }, () => 1);
  const zeros = (n) => Array.from({ length: n }, () => 0);

  switch (type) {
    case 'Input':
    case 'Output': {
      if (!Array.isArray(shape) || shape.length === 0 || shape.some((n) => !Number.isInteger(n) || n <= 0)) {
        throw new Error(`${type} needs a positive integer shape (got ${JSON.stringify(shape)})`);
      }
      record.fields.shape = i64(shape, [shape.length]);
      return record;
    }
    case 'LIF':
      requireChannels(shape, type);
      record.fields.tau = f32(ones(shape), shape);
      record.fields.r = f32(ones(shape), shape);
      record.fields.v_leak = f32(zeros(shape), shape);
      record.fields.v_threshold = f32(ones(shape), shape);
      record.fields.v_reset = f32(zeros(shape), shape);
      return record;
    case 'LI':
      requireChannels(shape, type);
      record.fields.tau = f32(ones(shape), shape);
      record.fields.r = f32(ones(shape), shape);
      record.fields.v_leak = f32(zeros(shape), shape);
      return record;
    case 'IF':
      requireChannels(shape, type);
      record.fields.r = f32(ones(shape), shape);
      record.fields.v_threshold = f32(ones(shape), shape);
      record.fields.v_reset = f32(zeros(shape), shape);
      return record;
    case 'I':
      requireChannels(shape, type);
      record.fields.r = f32(ones(shape), shape);
      return record;
    case 'CubaLIF':
      requireChannels(shape, type);
      record.fields.tau_syn = f32(ones(shape), shape);
      record.fields.tau_mem = f32(ones(shape), shape);
      record.fields.r = f32(ones(shape), shape);
      record.fields.v_leak = f32(zeros(shape), shape);
      record.fields.v_threshold = f32(ones(shape), shape);
      record.fields.v_reset = f32(zeros(shape), shape);
      record.fields.w_in = f32(ones(shape), shape);
      return record;
    case 'CubaLI':
      requireChannels(shape, type);
      record.fields.tau_syn = f32(ones(shape), shape);
      record.fields.tau_mem = f32(ones(shape), shape);
      record.fields.r = f32(ones(shape), shape);
      record.fields.v_leak = f32(zeros(shape), shape);
      record.fields.w_in = f32(ones(shape), shape);
      return record;
    case 'Scale':
    case 'Threshold':
      requireChannels(shape, type);
      record.fields[type === 'Scale' ? 'scale' : 'threshold'] = f32(ones(shape), shape);
      return record;
    case 'Delay':
      requireChannels(shape, type);
      record.fields.delay = f32(zeros(shape), shape);
      return record;
    case 'Linear':
    case 'Affine': {
      const dims = opts.weightShape || (opts.inSize && opts.outSize ? [opts.outSize, opts.inSize] : null);
      requireWeightShape(dims, type);
      record.fields.weight = f32(zeros(dims[0] * dims[1]), dims);
      if (type === 'Affine') {
        record.fields.bias = f32(zeros(dims[0]), [dims[0]]);
      }
      return record;
    }
    case 'Conv1d': {
      const dims = opts.weightShape || (opts.inSize && opts.outSize && opts.kernel
        ? [opts.outSize, opts.inSize, opts.kernel] : null);
      requireWeightShape(dims, type);
      record.fields.weight = f32(zeros(dims.reduce((a, b) => a * b, 1)), dims);
      record.fields.stride = i64([1], []);
      record.fields.padding = i64([0], []);
      record.fields.dilation = i64([1], []);
      record.fields.groups = i64([1], []);
      record.fields.bias = f32(zeros(dims[0]), [dims[0]]);
      return record;
    }
    case 'Conv2d': {
      const dims = opts.weightShape || (opts.inSize && opts.outSize && opts.kernel
        ? [opts.outSize, opts.inSize, opts.kernel, opts.kernel] : null);
      requireWeightShape(dims, type);
      record.fields.weight = f32(zeros(dims.reduce((a, b) => a * b, 1)), dims);
      record.fields.stride = i64([1, 1], [2]);
      record.fields.padding = i64([0, 0], [2]);
      record.fields.dilation = i64([1, 1], [2]);
      record.fields.groups = i64([1], []);
      record.fields.bias = f32(zeros(dims[0]), [dims[0]]);
      return record;
    }
    case 'SumPool2d':
    case 'AvgPool2d': {
      const k = opts.kernel && Number.isInteger(opts.kernel) && opts.kernel > 0 ? opts.kernel : 2;
      record.fields.kernel_size = i64([k, k], [2]);
      record.fields.stride = i64([k, k], [2]);
      record.fields.padding = i64([0, 0], [2]);
      return record;
    }
    case 'Flatten':
      record.fields.start_dim = i64([1], []);
      record.fields.end_dim = i64([-1], []);
      return record;
    default:
      throw new Error(`buildNodeRecord: unsupported node type '${type}'`);
  }
}

function requireChannels(shape, type) {
  if (!Array.isArray(shape) || shape.length !== 1 || !Number.isInteger(shape[0]) || shape[0] <= 0) {
    throw new Error(`${type} needs a positive channel count (got ${JSON.stringify(shape)})`);
  }
}

function requireWeightShape(dims, type) {
  if (!Array.isArray(dims) || dims.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`${type} needs positive integer dimensions (got ${JSON.stringify(dims)})`);
  }
}

/**
 * 新建节点:名字缺省时自动建议;缺省名可传 opts.name 覆盖。
 * 返回新文档。名字非法或重名抛错。
 */
export function createNode(doc, { parentPath = [], type, name, ...opts }) {
  assertValidName(type === undefined ? '' : String(type));
  if (!getOperatorInfo(type)) {
    throw new Error(`createNode: unknown node type '${type}'`);
  }
  const finalName = name === undefined || name === null ? suggestNodeName(doc, parentPath, type) : name;
  assertValidName(finalName);
  const record = buildNodeRecord(type, opts);
  return addNode(doc, finalName, record, parentPath || []);
}

/** 替换指定图的边列表(带 parentPath 的 setEdges) */
function replaceEdgesAt(doc, parentPath, edgePairs) {
  return transformDocument(doc, (draft) => {
    let cur = draft.graph;
    for (const name of parentPath || []) {
      cur = cur.children[name];
    }
    cur.edgePairs = edgePairs.map((e) => [...e]);
    cur.edges = null;
    return draft;
  });
}

/**
 * 连线:拒绝自环、重复边、指向 Input 的边、从 Output 出发的边、引用不存在节点的边。
 * 允许造环(官方实测接受;纯环由校验拦截,见文件头说明)。
 */
export function connectEdge(doc, parentPath, src, dst) {
  const graph = graphAt(doc, parentPath || []);
  if (typeof src !== 'string' || typeof dst !== 'string') {
    throw new Error('connectEdge: endpoints must be node names');
  }
  if (src === dst) {
    throw new Error(`connectEdge: self-loop on '${src}' is not allowed`);
  }
  if (!(src in graph.children)) {
    throw new Error(`connectEdge: source node '${src}' does not exist`);
  }
  if (!(dst in graph.children)) {
    throw new Error(`connectEdge: target node '${dst}' does not exist`);
  }
  if (graph.children[dst].type === 'Input') {
    throw new Error(`connectEdge: edge must not point at Input node '${dst}'`);
  }
  if (graph.children[src].type === 'Output') {
    throw new Error(`connectEdge: edge must not leave Output node '${src}'`);
  }
  const exists = (graph.edgePairs || []).some(([a, b]) => a === src && b === dst);
  if (exists) {
    throw new Error(`connectEdge: duplicate edge (${src}, ${dst})`);
  }
  return replaceEdgesAt(doc, parentPath, [...(graph.edgePairs || []), [src, dst]]);
}

/** 断线:删除一条边;边不存在抛错 */
export function disconnectEdge(doc, parentPath, src, dst) {
  const graph = graphAt(doc, parentPath || []);
  const kept = (graph.edgePairs || []).filter(([a, b]) => !(a === src && b === dst));
  if (kept.length === (graph.edgePairs || []).length) {
    throw new Error(`disconnectEdge: edge (${src}, ${dst}) does not exist`);
  }
  return replaceEdgesAt(doc, parentPath, kept);
}

/** 重命名(边同步;名字合法性检查;文档的 renameNode 已同步边) */
export function renameNodeChecked(doc, parentPath, oldName, newName) {
  assertValidName(newName);
  return renameNode(doc, parentPath || [], oldName, newName);
}

// ---- 参数编辑 ----

function finiteNumber(value, what) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`${what} must be a finite number (got ${JSON.stringify(value)})`);
  }
  return n;
}

function toInt(n, what) {
  const v = finiteNumber(n, what);
  if (!Number.isInteger(v)) {
    throw new Error(`${what} must be an integer (got ${v})`);
  }
  return v;
}

/** 目标 dtype:字段已存在沿用原 dtype;否则 int 字段 i64、数值字段 f32 */
function targetDtype(node, fieldName) {
  const existing = node.fields[fieldName];
  if (existing && isNumericDtype(existing.dtype)) return existing.dtype;
  const info = getOperatorInfo(node.type);
  const fieldInfo = info ? info.fields.find((f) => f.name === fieldName) : null;
  if (fieldInfo && (fieldInfo.kind === 'int' || fieldInfo.kind === 'shape')) return 'i64';
  return 'f32';
}

function buildNumeric(dtype, shape, numbers) {
  const Ctor = NUMERIC_DTYPES[dtype];
  const data = new Ctor(numbers.map((n) => (isBigIntDtype(dtype) ? BigInt(Math.trunc(n)) : n)));
  return { dtype, shape: [...shape], data };
}

/**
 * 设置标量字段(保留原 dtype;字段缺省时 int/shape 类建 i64,其余 f32)。
 * 整型 dtype 要求整数值。
 */
export function setScalarField(doc, nodePath, fieldName, value) {
  const node = nodeAt(doc, nodePath);
  const dtype = targetDtype(node, fieldName);
  const n = finiteNumber(value, `field '${fieldName}'`);
  if (isBigIntDtype(dtype)) toInt(n, `field '${fieldName}' (integer dtype ${dtype})`);
  return setNodeField(doc, nodePath, fieldName, buildNumeric(dtype, [], [n]));
}

/** 设置字符串标量字段(如 padding);字段已存在且是数值型时拒绝(数值请用 setScalarField) */
export function setStringField(doc, nodePath, fieldName, str) {
  if (typeof str !== 'string') {
    throw new Error(`field '${fieldName}' must be a string (got ${JSON.stringify(str)})`);
  }
  const node = nodeAt(doc, nodePath);
  const existing = node.fields[fieldName];
  if (existing && isNumericDtype(existing.dtype)) {
    throw new Error(`field '${fieldName}' on node [${(nodePath || []).join(', ')}] is numeric (dtype=${existing.dtype}); use setScalarField for numbers`);
  }
  return setNodeField(doc, nodePath, fieldName, stringValue([], str));
}

/**
 * 设置整数元组/形状字段(如 stride、Input 的 shape)。
 * numbers 是整数数组;dtype 沿用原字段(缺省 i64)。
 */
export function setIntArrayField(doc, nodePath, fieldName, numbers) {
  const node = nodeAt(doc, nodePath);
  if (!Array.isArray(numbers) || numbers.length === 0) {
    throw new Error(`field '${fieldName}' needs a non-empty integer array`);
  }
  const ints = numbers.map((n) => toInt(n, `field '${fieldName}'`));
  const dtype = targetDtype(node, fieldName);
  return setNodeField(doc, nodePath, fieldName, buildNumeric(dtype, [ints.length], ints));
}

/** 数值数组字段的公共前置检查:必须存在且为数值型;返回 {field, dtype} */
function requireNumericArray(node, nodePath, fieldName) {
  const existing = node.fields[fieldName];
  if (!existing) {
    throw new Error(`field '${fieldName}' does not exist on node [${(nodePath || []).join(', ')}]`);
  }
  if (!isNumericDtype(existing.dtype)) {
    throw new Error(`field '${fieldName}' is not numeric (dtype=${existing.dtype})`);
  }
  return existing;
}

/** 整体设值:把数组每个元素设成同一个数,保持形状与 dtype */
export function setFieldUniform(doc, nodePath, fieldName, value) {
  const node = nodeAt(doc, nodePath);
  const existing = requireNumericArray(node, nodePath, fieldName);
  const n = finiteNumber(value, `field '${fieldName}'`);
  const isInt = isBigIntDtype(existing.dtype);
  if (isInt) toInt(n, `field '${fieldName}' (integer dtype ${existing.dtype})`);
  const numbers = Array.from({ length: existing.data.length }, () => n);
  return setNodeField(doc, nodePath, fieldName, buildNumeric(existing.dtype, existing.shape, numbers));
}

/** 按比例缩放:逐元素乘 factor,保持形状与 dtype(仅浮点数组;整型数组拒绝) */
export function scaleField(doc, nodePath, fieldName, factor) {
  const node = nodeAt(doc, nodePath);
  const existing = requireNumericArray(node, nodePath, fieldName);
  const f = finiteNumber(factor, 'scale factor');
  if (isBigIntDtype(existing.dtype)) {
    throw new Error(`scaleField: integer array '${fieldName}' (dtype=${existing.dtype}) cannot be scaled; use uniform or per-index edits`);
  }
  const numbers = Array.from(existing.data, (x) => x * f);
  return setNodeField(doc, nodePath, fieldName, buildNumeric(existing.dtype, existing.shape, numbers));
}

/** 只改指定下标:pairs 是 [{ index, value }, ...];越界抛错 */
export function setFieldIndices(doc, nodePath, fieldName, pairs) {
  const node = nodeAt(doc, nodePath);
  const existing = requireNumericArray(node, nodePath, fieldName);
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error(`field '${fieldName}' needs at least one { index, value } pair`);
  }
  const numbers = Array.from(existing.data, (x) => (typeof x === 'bigint' ? Number(x) : x));
  const isInt = isBigIntDtype(existing.dtype);
  for (const { index, value } of pairs) {
    const i = toInt(index, 'index');
    if (i < 0 || i >= numbers.length) {
      throw new Error(`field '${fieldName}': index ${i} out of range (length ${numbers.length})`);
    }
    const v = finiteNumber(value, `field '${fieldName}'[${i}]`);
    numbers[i] = isInt ? toInt(v, `field '${fieldName}'[${i}]`) : v;
  }
  return setNodeField(doc, nodePath, fieldName, buildNumeric(existing.dtype, existing.shape, numbers));
}

/**
 * 大数组的概要:形状、dtype、元素数、最小/最大/均值(权重太大不逐个编辑时用)。
 * 非数值字段抛错。
 */
export function describeField(doc, nodePath, fieldName) {
  const node = nodeAt(doc, nodePath);
  const existing = requireNumericArray(node, nodePath, fieldName);
  const nums = Array.from(existing.data, (x) => (typeof x === 'bigint' ? Number(x) : x));
  const count = nums.length;
  const round = (x) => Math.round(x * 1e6) / 1e6;
  let min = null;
  let max = null;
  let sum = 0;
  for (const x of nums) {
    if (min === null || x < min) min = x;
    if (max === null || x > max) max = x;
    sum += x;
  }
  return {
    dtype: existing.dtype,
    shape: [...existing.shape],
    count,
    min: count > 0 ? round(min) : null,
    max: count > 0 ? round(max) : null,
    mean: count > 0 ? round(sum / count) : null,
  };
}

// ---- 元数据 ----

/** 设置字符串/数值元数据(null 删除);复杂结构请直接用 document.setNodeMetadata */
export function setSimpleMetadata(doc, nodePath, key, value) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('metadata key must be a non-empty string');
  }
  if (value === null) {
    return setNodeMetadata(doc, nodePath, key, null);
  }
  if (typeof value === 'string') {
    return setNodeMetadata(doc, nodePath, key, stringValue([], value));
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return setNodeMetadata(doc, nodePath, key, buildNumeric('f64', [], [value]));
  }
  throw new Error('metadata value must be a string, a finite number, or null');
}

// ---- 删除节点的连通性预警 ----

/** 图上"完好"节点集合:既从某 Input 可达、又能到达某 Output */
function connectedSet(nodes, edges) {
  const names = Object.keys(nodes);
  const inputs = names.filter((n) => nodes[n].type === 'Input');
  const outputs = new Set(names.filter((n) => nodes[n].type === 'Output'));
  const adj = new Map(names.map((n) => [n, []]));
  const radj = new Map(names.map((n) => [n, []]));
  for (const [a, b] of edges) {
    if (adj.has(a) && radj.has(b)) {
      adj.get(a).push(b);
      radj.get(b).push(a);
    }
  }
  const forward = new Set(inputs);
  const queue = [...inputs];
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const nxt of adj.get(cur)) {
      if (!forward.has(nxt)) {
        forward.add(nxt);
        queue.push(nxt);
      }
    }
  }
  const backward = new Set();
  const queue2 = [...outputs];
  while (queue2.length > 0) {
    const cur = queue2.pop();
    backward.add(cur);
    for (const prev of radj.get(cur)) {
      if (!backward.has(prev)) queue2.push(prev);
    }
  }
  const ok = new Set();
  for (const n of names) {
    if (forward.has(n) && backward.has(n)) ok.add(n);
  }
  return { ok, forward, backward };
}

/**
 * 删除节点前的连通性预警:返回"删除前完好、删除后会断"的节点清单(中文字符串)。
 * 只有相对变化才报:图本来就没有 Input/本来就断开时,不重复报老问题。
 * name 是 parentPath 图里的节点名。
 */
export function disconnectWarnings(doc, parentPath, name) {
  const graph = graphAt(doc, parentPath || []);
  if (!graph.children || !(name in graph.children)) {
    throw new Error(`disconnectWarnings: node '${name}' not found`);
  }
  const before = connectedSet(graph.children, graph.edgePairs || []);
  const afterNodes = { ...graph.children };
  delete afterNodes[name];
  const afterEdges = (graph.edgePairs || []).filter(([a, b]) => a !== name && b !== name);
  const after = connectedSet(afterNodes, afterEdges);

  const warnings = [];
  for (const n of Object.keys(afterNodes)) {
    const wasOk = before.ok.has(n);
    if (!wasOk) continue; // 之前就已断开的节点不重复报
    const reach = after.forward.has(n);
    const sink = after.backward.has(n);
    if (!reach && !sink) {
      warnings.push(`节点 '${n}' 删除后将从任何 Input 都不可达,也无法到达任何 Output`);
    } else if (!reach) {
      warnings.push(`节点 '${n}' 删除后将无法从任何 Input 到达`);
    } else if (!sink) {
      warnings.push(`节点 '${n}' 删除后将无法到达任何 Output`);
    }
  }
  return warnings;
}
