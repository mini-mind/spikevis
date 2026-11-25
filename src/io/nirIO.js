/**
 * 应用与核心模块之间的 io 胶水：文件读入、导出、视图模型构建。
 *
 * 核心模块（src/core/nir）不依赖 Vue 与 h5wasm；本文件负责：
 * - 创建 h5wasm 后端单例；
 * - 把用户选的 File 读成 NirDocument；
 * - 把 NirDocument 变成画布/侧栏用的视图模型（含形状推断的类型标注）；
 * - 导出 .nir（当前文档原样写出，供人工验证往返）。
 */

import {
  createH5wasmBackend, getOperatorInfo, inferTypes, readNir, writeNir,
  valueToPreview, SERIALIZABLE_TYPES,
} from '../core/nir/index.js';
import { isNumericDtype, isStringDtype } from '../core/nir/value.js';

let backendPromise = null;

/** h5wasm 后端单例（异步：首次调用时加载 wasm） */
export function getBackend() {
  if (!backendPromise) backendPromise = createH5wasmBackend();
  return backendPromise;
}

/** 单个节点字段的中文标签（显示用；核心算子表只管数据） */
export const FIELD_LABELS = {
  shape: '形状',
  weight: '权重',
  bias: '偏置',
  scale: '缩放因子',
  threshold: '阈值',
  delay: '延迟',
  tau: '时间常数',
  tau_syn: '突触时间常数',
  tau_mem: '膜时间常数',
  r: '电阻',
  v_leak: '泄漏电压',
  v_threshold: '阈值电压',
  v_reset: '重置电压',
  w_in: '输入权重',
  input_shape: '输入形状',
  stride: '步长',
  padding: '填充',
  dilation: '扩张',
  groups: '分组',
  kernel_size: '核大小',
  input_type: '输入形状',
  start_dim: '起始维度',
  end_dim: '结束维度',
};

/**
 * 读取 .nir 文件（HDF5）。
 * 返回 { doc, fileName }；解析失败抛错（错误信息写明是哪个节点哪个数据集）。
 */
export async function loadNirBytes(bytes, fileName) {
  const backend = await getBackend();
  const doc = await readNir(bytes, backend);
  return { doc, fileName: fileName || 'model.nir' };
}

export async function loadNirFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return loadNirBytes(bytes, file.name);
}

/** 把当前文档按官方格式写出，返回 Blob（下载用） */
export async function exportNirDocument(doc) {
  const backend = await getBackend();
  const bytes = await writeNir(doc, backend);
  return new Blob([bytes], { type: 'application/x-hdf5' });
}

/**
 * 尽力推断形状：严格推断失败（图不完整等）就退化到逐节点字段推导，
 * 保证查看功能在怪文件上也不崩。
 */
export function computeTypes(doc) {
  try {
    const { types } = inferTypes(doc);
    return { types, ok: true };
  } catch (e) {
    // 逐节点退化：只用字段推导
    const types = {};
    const walk = (graph, prefix) => {
      for (const [name, node] of Object.entries(graph.children || {})) {
        const path = prefix ? `${prefix}.${name}` : name;
        const op = getOperatorInfo(node.type);
        let input = null;
        let output = null;
        if (node.type === 'Input' && node.fields.shape) {
          input = output = [...node.fields.shape.data].map(Number);
        } else if (node.type === 'Output' && node.fields.shape) {
          input = output = [...node.fields.shape.data].map(Number);
        } else if (op && op.deriveTypes) {
          const [i, o] = op.deriveTypes(node.fields);
          input = i;
          output = o;
        }
        types[path] = { input, output };
        if (node.children) walk(node, path);
      }
    };
    walk(doc.graph, '');
    return { types, ok: false, error: e.message };
  }
}

/** 格式化类型数组给显示：[784] -> "784"，[2,8,8] -> "2×8×8"；null -> '未知' */
function formatType(t) {
  if (!t) return '未知';
  return t.join('×');
}

/** 收集一个节点（含子图内部）里出现过的全部类型（给画布配色/统计用） */
function collectTypes(node, set) {
  set.add(node.type);
  if (node.children) {
    for (const child of Object.values(node.children)) collectTypes(child, set);
  }
}

/** 逐元素编辑的元素数上限:超过就只给形状/统计量/整体缩放 */
export const EDITABLE_ELEMENT_LIMIT = 64;

/**
 * 把数值 NirValue 转成普通 number 数组(BigInt 转 Number)。
 */
function numericListOf(v) {
  if (!v || !isNumericDtype(v.dtype)) return null;
  return Array.from(v.data, (x) => (typeof x === 'bigint' ? Number(x) : x));
}

/**
 * 参数的编辑元信息:侧栏据此渲染输入框。
 * kind 见核心算子表('array'/'int'/'str'/'shape');未知数据集 kind='unknown'。
 */
function paramEditInfo(key, field, v) {
  const kind = field ? field.kind : 'unknown';
  const info = {
    key,
    kind,
    dtype: v.dtype,
    shape: [...(v.shape || [])],
    preview: valueToPreview(v),
    isString: isStringDtype(v.dtype),
    isScalarNumeric: isNumericDtype(v.dtype) && v.shape.length === 0,
  };
  if (isNumericDtype(v.dtype) && v.shape.length > 0) {
    const nums = numericListOf(v);
    const count = nums.length;
    let min = null;
    let max = null;
    let sum = 0;
    for (const x of nums) {
      if (min === null || x < min) min = x;
      if (max === null || x > max) max = x;
      sum += x;
    }
    info.elementCount = count;
    info.isLarge = count > EDITABLE_ELEMENT_LIMIT;
    info.stats = { count, min, max, mean: count > 0 ? sum / count : null };
    if (!info.isLarge) info.elements = nums;
  }
  return info;
}

/**
 * 构建画布/侧栏视图模型：
 * {
 *   nodes: { id: { id, type, label, metadataText, params: [...], inputText, outputText, childCount } },
 *   edges: [[src, dst], ...],
 *   summary: { nodeCount, edgeCount, knownTypes }
 * }
 * params 每项带编辑元信息(kind/dtype/shape/preview,小数组含 elements,大数组含 stats)。
 */
export function buildViewData(doc, types) {
  const nodes = {};
  for (const [id, node] of Object.entries(doc.graph.children || {})) {
    const op = getOperatorInfo(node.type);
    const t = types[id] || { input: null, output: null };

    // 参数清单：算子表字段 + 保留的未知数据集
    const params = [];
    for (const field of (op ? op.fields : [])) {
      const v = node.fields[field.name];
      if (v === undefined) continue;
      params.push({
        ...paramEditInfo(field.name, field, v),
        label: FIELD_LABELS[field.name] || field.name,
        optionalInFile: Boolean(field.fileOptional) && !(field.name in node.fields),
        present: true,
      });
    }
    for (const [name, v] of Object.entries(node.otherDatasets || {})) {
      params.push({
        ...paramEditInfo(name, null, v),
        label: `${name}（非标准字段）`,
        present: true,
      });
    }
    if (node.type === 'NIRGraph' && node.children) {
      params.push({
        key: '__children',
        label: '子节点数',
        preview: String(Object.keys(node.children).length),
        present: true,
      });
    }

    // 元数据：字符串直接显示，数组/嵌套给预览
    const metadataText = {};
    for (const [key, v] of Object.entries(node.metadata || {})) {
      metadataText[key] = (v && typeof v === 'object' && 'dtype' in v)
        ? valueToPreview(v, 8)
        : JSON.stringify(v);
    }

    nodes[id] = {
      id,
      type: node.type,
      // 子图节点在画布上要能看出里面有几个节点
      label: node.type === 'NIRGraph'
        ? `${id}\n(子图·${Object.keys(node.children || {}).length}节点)`
        : `${id}\n(${op ? op.label : node.type})`,
      params,
      metadataText,
      inputText: formatType(t.input),
      outputText: formatType(t.output),
      childCount: node.children ? Object.keys(node.children).length : 0,
    };
  }

  const edges = (doc.graph.edgePairs || []).map(([a, b]) => [a, b]);

  const knownTypes = new Set();
  collectTypes(doc.graph, knownTypes);
  const knownCount = [...knownTypes].filter((t) => SERIALIZABLE_TYPES.includes(t)).length;

  return {
    nodes,
    edges,
    summary: {
      nodeCount: Object.keys(nodes).length,
      edgeCount: edges.length,
      knownTypes: knownCount,
      unknownTypes: knownTypes.size - knownCount,
    },
  };
}

/**
 * 读文件并一步构建视图模型（应用入口用）。
 * 返回 { doc, view, types, typeCheckOk, typeCheckError, fileName }。
 */
export async function openNirFile(file) {
  const { doc, fileName } = await loadNirFile(file);
  const { types, ok, error } = computeTypes(doc);
  const view = buildViewData(doc, types);
  return { doc, view, types, typeCheckOk: ok, typeCheckError: error, fileName };
}

/**
 * 导出"仅查看用"的 JSON:人类可读的模型摘要,不能作为 .nir 读回
 * (可往返的格式只有 HDF5 的 .nir;JSON 里数值是预览文本、不保 dtype 与原始位形)。
 * 返回 Blob。
 */
export function exportViewJson(doc, view, fileName) {
  const payload = {
    _note: '此 JSON 仅用于查看,不可往返:本工具只接受 .nir(HDF5)文件的载入与导出;这里的数组是预览文本,不含 dtype 与原始数据。',
    _fileName: fileName || 'model.nir',
    _exportedAt: new Date().toISOString(),
    version: doc.version,
    summary: view.summary,
    nodes: Object.fromEntries(Object.entries(view.nodes).map(([id, n]) => [id, {
      type: n.type,
      input: n.inputText,
      output: n.outputText,
      params: Object.fromEntries(n.params.map((p) => [p.key, p.preview])),
      metadata: n.metadataText,
    }])),
    edges: view.edges,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
