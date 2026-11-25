/**
 * 通道剪枝(纯函数):按"保留下标"裁剪节点通道,并沿边联动裁剪上下游。
 *
 * 通道维分类(对照官方 nir 1.0.8 各类型的字段形状):
 * - tied(输入输出通道相同,参数数组一维 [C]):Input、Output、LIF、LI、IF、I、
 *   CubaLIF、CubaLI、Scale、Threshold、Delay。裁剪 = 全部参数数组按同一下标裁
 *   (Input/Output 是改 shape 字段的通道元素)。
 * - weight(权重映射型,输入输出通道独立):Linear、Affine、Conv1d、Conv2d。
 *   官方权重约定:weight 第 0 维是输出通道(行),最后一维是输入通道(列);
 *   Linear weight [out,in],Conv1d weight [out,in,k],Conv2d weight [out,in,kh,kw];
 *   Affine/Conv 的 bias 长度 = 输出通道数。裁输出通道 = 裁行 + bias 并向下游传播;
 *   裁输入通道 = 裁列并向上游传播(conv 的 groups != 1 时拒绝裁输入通道,
 *   分组卷积的列裁剪会破坏组结构)。
 * - blocker(传播到它就停,列入"需要人工处理"):Flatten(把通道和空间维混在一起)、
 *   SumPool2d/AvgPool2d(按任务约定不穿过池化继续传播)、NIRGraph(子图内部本轮
 *   不进)、其余未知类型(语义不明,不许静默裁错)。
 *
 * 传播语义(单一端口假设,与官方 check_types 一致):
 * - tied 节点被裁时,上游各分支(输出端)与下游各分支(输入端)都按同一下标传播
 *   ——分叉时所有下游都裁;汇合(多上游)时所有上游都裁;
 * - weight 节点:裁输出端只裁自己的行+bias 并向下游传播;裁输入端只裁自己的列
 *   并向上游传播;另一端不动;
 * - 同一节点的同一端口被多条路径以不同下标传播到 = 汇合处下标不一致,整单拒绝;
 * - 遇到 blocker:不动它,列入 manual 清单,不再穿过它继续传播。
 */

import { cloneGraph } from './shape.js';
import { NUMERIC_DTYPES, isBigIntDtype, isNumericDtype } from './value.js';
import { valueToIntArray } from './operatorTable.js';
import { graphAt } from './edits.js';

/** 输入输出通道相同的类型(tied) */
export const TIED_TYPES = new Set([
  'Input', 'Output', 'LIF', 'LI', 'IF', 'I', 'CubaLIF', 'CubaLI',
  'Scale', 'Threshold', 'Delay',
]);

/** 权重映射型(输入输出通道独立,weight 行=输出通道,列=输入通道) */
export const WEIGHT_TYPES = new Set(['Linear', 'Affine', 'Conv1d', 'Conv2d']);

/** tied 类型取通道数的权威字段(与算子表 deriveTypes 用的字段一致) */
const WIDTH_FIELD = {
  LIF: 'r', LI: 'r', IF: 'r', I: 'r',
  CubaLIF: 'v_threshold', CubaLI: 'v_leak',
  Scale: 'scale', Threshold: 'threshold', Delay: 'delay',
};

/** 节点类型 -> 通道维分类 */
export function channelKind(nodeType) {
  if (TIED_TYPES.has(nodeType)) return 'tied';
  if (WEIGHT_TYPES.has(nodeType)) return 'weight';
  return 'blocker'; // Flatten、池化、NIRGraph、未知类型
}

function isGraphRecord(node) {
  return node && node.type === 'NIRGraph';
}

/** tied 节点的通道数;Input/Output 用 shape 字段的第 0 个元素 */
function tiedWidth(node) {
  if (node.type === 'Input' || node.type === 'Output') {
    const shapeValue = node.fields.shape;
    if (!shapeValue) return null;
    const arr = valueToIntArray(shapeValue);
    if (!arr || arr.length === 0) return null;
    return arr[0]; // 通道维约定在第 0 个元素([C] 或 [C,H,W])
  }
  const fieldName = WIDTH_FIELD[node.type];
  const v = fieldName ? node.fields[fieldName] : null;
  if (!v || v.shape.length === 0) return null;
  return v.shape[0];
}

/**
 * weight 节点的 (输入通道, 输出通道) 与裁剪轴。
 * 官方约定:Linear/Affine weight [out, in](输入通道=最后一维,列);
 * Conv1d/Conv2d weight [out, in, *kernel](输入通道=第 1 维,输出通道=第 0 维)。
 */
function weightWidths(node) {
  const w = node.fields.weight;
  if (!w || w.shape.length < 2) return null;
  const isConv = node.type === 'Conv1d' || node.type === 'Conv2d';
  return {
    inWidth: isConv ? w.shape[1] : w.shape[w.shape.length - 1],
    outWidth: w.shape[0],
    inAxis: isConv ? 1 : w.shape.length - 1,
  };
}

/** conv 的 groups 整数值(缺省当 1) */
function convGroups(node) {
  const g = node.fields.groups;
  if (!g) return 1;
  const arr = valueToIntArray(g);
  return arr && arr.length > 0 ? arr[0] : 1;
}

/**
 * 单节点通道信息(界面与测试用)。
 * blocker 返回 { kind:'blocker', reason }。
 */
export function channelInfo(doc, nodePath) {
  const parentPath = nodePath.slice(0, -1);
  const name = nodePath[nodePath.length - 1];
  const graph = graphAt(doc, parentPath);
  const node = graph.children[name];
  if (!node) throw new Error(`channelInfo: node '${name}' not found`);
  const kind = channelKind(node.type);
  if (kind === 'blocker') {
    const reason = node.type === 'Flatten'
      ? 'Flatten 把通道和空间维混在一起,不能自动剪枝'
      : (isGraphRecord(node) ? '子图节点:需先展开(解组)或进入内部手工处理'
        : `${node.type} 传播到它就停,不能自动剪枝`);
    return { kind, type: node.type, name, reason, canPruneIn: false, canPruneOut: false };
  }
  if (kind === 'tied') {
    const width = tiedWidth(node);
    return {
      kind,
      type: node.type,
      name,
      inWidth: width,
      outWidth: width,
      canPruneIn: true,
      canPruneOut: true,
      note: '该节点输入输出通道相同,剪哪个方向效果一样(参数数组按同一下标裁)',
    };
  }
  const widths = weightWidths(node);
  const isConv = node.type === 'Conv1d' || node.type === 'Conv2d';
  return {
    kind,
    type: node.type,
    name,
    inWidth: widths ? widths.inWidth : null,
    outWidth: widths ? widths.outWidth : null,
    hasBias: node.fields.bias !== undefined,
    canPruneIn: true,
    canPruneOut: true,
    groups: isConv ? convGroups(node) : undefined,
    note: isConv
      ? `weight [out, in, kernel...]:第 0 维(输出通道)=行,第 1 维(输入通道)=列;${convGroups(node) !== 1 ? `groups=${convGroups(node)},裁输入通道会被拒绝` : '裁输入通道要求 groups=1'}`
      : 'weight [out, in]:第 0 维(输出通道)=行,最后一维(输入通道)=列',
  };
}

/** 保留下标规范化:去重、升序、范围检查;有错返回 { error } */
function normalizeKeep(keep, width, what, errors) {
  if (!Array.isArray(keep) || keep.length === 0) {
    errors.push(`${what}: 保留下标不能为空`);
    return null;
  }
  const seen = new Set();
  const out = [];
  for (const raw of keep) {
    const i = typeof raw === 'bigint' ? Number(raw) : raw;
    if (!Number.isInteger(i) || i < 0) {
      errors.push(`${what}: 下标必须是 >= 0 的整数,收到 ${JSON.stringify(raw)}`);
      return null;
    }
    if (i >= width) {
      errors.push(`${what}: 下标 ${i} 越界(通道数只有 ${width})`);
      return null;
    }
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * 按下标裁剪数值 NirValue 的一个轴:同 dtype、其余维度不动。
 * 行主序扁平存储,逐元素做下标映射。
 */
export function sliceAxis(value, axis, keep) {
  if (!isNumericDtype(value.dtype)) {
    throw new Error(`sliceAxis: field dtype '${value.dtype}' is not numeric`);
  }
  const dims = value.shape;
  if (axis < 0 || axis >= dims.length) {
    throw new Error(`sliceAxis: axis ${axis} out of range for shape [${dims}]`);
  }
  const strides = [];
  let acc = 1;
  for (let i = dims.length - 1; i >= 0; i -= 1) {
    strides[i] = acc;
    acc *= dims[i];
  }
  const newShape = dims.map((d, i) => (i === axis ? keep.length : d));
  const total = newShape.reduce((a, b) => a * b, 1);
  const Ctor = NUMERIC_DTYPES[value.dtype];
  const out = new Ctor(total);
  const idx = new Array(dims.length).fill(0);
  for (let linear = 0; linear < total; linear += 1) {
    // 把新数组的线性下标拆成各维下标
    let rest = linear;
    for (let i = dims.length - 1; i >= 0; i -= 1) {
      idx[i] = rest % newShape[i];
      rest = Math.floor(rest / newShape[i]);
    }
    const srcIdx = idx.map((v, i) => (i === axis ? keep[v] : v));
    let srcOffset = 0;
    for (let i = 0; i < dims.length; i += 1) srcOffset += srcIdx[i] * strides[i];
    out[linear] = value.data[srcOffset];
  }
  return { dtype: value.dtype, shape: newShape, data: out };
}

/** 新的 Input/Output shape 字段值:通道元素(第 0 个)换成保留数,其余维度原样 */
function newShapeFieldValue(node, keepCount) {
  const old = valueToIntArray(node.fields.shape);
  const next = old.map((d, i) => (i === 0 ? keepCount : d));
  return {
    dtype: node.fields.shape.dtype,
    shape: node.fields.shape.shape,
    data: new (NUMERIC_DTYPES[node.fields.shape.dtype])(next.map((n) => (isBigIntDtype(node.fields.shape.dtype) ? BigInt(n) : n))),
  };
}

/** 人类可读的形状串 */
const shapeText = (v) => `[${v.shape.join(',')}]`;

/**
 * 计算剪枝计划(不改文档)。
 * specs: [{ path: [...父图名, 节点名], axis: 'out'|'in', keep: number[] }]
 * 多个 spec 必须指向同一个图(同一层);返回:
 *   { ok, parentPath, pruned: [{name, field, value, detail}], manual: [{name, type, port, reason}], errors }
 * pruned 每项带可直接落盘的 (field, value)。
 */
export function planPruneChannels(doc, specs) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error('planPruneChannels: specs must be a non-empty array');
  }
  const parentKeys = new Set(specs.map((s) => (s.path.slice(0, -1)).join('.')));
  if (parentKeys.size > 1) {
    throw new Error('planPruneChannels: 多个起点的父图不一致(必须剪同一个图里的节点)');
  }
  const parentPath = specs[0].path.slice(0, -1);
  const graph = graphAt(doc, parentPath);
  const errors = [];
  const manual = [];
  const pruned = [];
  const visited = new Map(); // key -> keep 串(汇合一致性检查)
  const queue = [];

  for (const spec of specs) {
    const name = spec.path[spec.path.length - 1];
    const node = graph.children[name];
    if (!node) throw new Error(`planPruneChannels: node '${name}' not found`);
    if (spec.axis !== 'in' && spec.axis !== 'out') {
      errors.push(`节点 '${name}': axis 必须是 'in' 或 'out'`);
      continue;
    }
    const kind = channelKind(node.type);
    let width = null;
    if (kind === 'tied') width = tiedWidth(node);
    else if (kind === 'weight') {
      const w = weightWidths(node);
      width = spec.axis === 'out' ? (w ? w.outWidth : null) : (w ? w.inWidth : null);
    } else {
      errors.push(`节点 '${name}'(${node.type})没有可剪的通道维,传播会停在 blocker 上`);
      continue;
    }
    if (width == null) {
      errors.push(`节点 '${name}'(${node.type})读不出通道数,请先修好该节点的参数`);
      continue;
    }
    const keep = normalizeKeep(spec.keep, width, `节点 '${name}'`, errors);
    if (keep) queue.push({ name, axis: spec.axis, keep });
  }

  const edges = graph.edgePairs || [];
  const describeEdit = (node, fields, from, to, keep) =>
    `${node.type} 参数 ${fields.join(', ')} 按下标 [${keep}] 裁剪: ${from} -> ${to}`;

  while (queue.length > 0) {
    const ev = queue.shift();
    const node = graph.children[ev.name];
    if (!node) {
      errors.push(`边引用了不存在的节点 '${ev.name}'`);
      continue;
    }
    const kind = channelKind(node.type);
    const key = kind === 'tied' ? `n:${ev.name}` : `p:${ev.axis}:${ev.name}`;
    const keepKey = ev.keep.join(',');
    if (visited.has(key)) {
      if (visited.get(key) !== keepKey) {
        errors.push(
          `节点 '${ev.name}' 的${ev.axis === 'in' ? '输入' : '输出'}端汇合处下标不一致:`
          + ` 先前要保留 [${visited.get(key)}],这条传播要保留 [${keepKey}];操作整体拒绝`,
        );
      }
      continue;
    }
    visited.set(key, keepKey);

    if (kind === 'blocker') {
      const reason = node.type === 'Flatten'
        ? 'Flatten 会把通道和空间维混在一起,传播到它停止;其输入/输出类型需人工核对'
        : (isGraphRecord(node)
          ? '子图节点内部本轮不自动裁剪;如需剪枝请先展开(解组)或手工进内部处理'
          : `${node.type} 按约定不自动穿过,传播到它停止;其下游是否需要人工调整请核对`);
      manual.push({ name: ev.name, type: node.type, port: ev.axis, reason });
      continue;
    }

    if (kind === 'tied') {
      // 自己的全部参数按下标裁;Input/Output 改 shape 字段
      if (node.type === 'Input' || node.type === 'Output') {
        const old = node.fields.shape;
        const next = newShapeFieldValue(node, ev.keep.length);
        pruned.push({
          name: ev.name, field: 'shape', value: next,
          detail: `shape [${valueToIntArray(old).join(',')}] -> [${valueToIntArray(next).join(',')}]`,
        });
      } else {
        const width = tiedWidth(node);
        const touched = [];
        let bad = null;
        for (const [fieldName, v] of Object.entries(node.fields)) {
          if (!isNumericDtype(v.dtype) || v.shape.length === 0) continue; // 标量(如标量 w_in)跳过
          if (v.shape[0] !== width) {
            bad = fieldName;
            break;
          }
          touched.push(fieldName);
        }
        if (bad) {
          errors.push(`节点 '${ev.name}' 的字段 '${bad}' 首维 (${node.fields[bad].shape[0]}) 与通道数 (${width}) 不一致,拒绝裁剪`);
          continue;
        }
        for (const fieldName of touched) {
          const next = sliceAxis(node.fields[fieldName], 0, ev.keep);
          pruned.push({
            name: ev.name, field: fieldName, value: next,
            detail: describeEdit(node, [fieldName], shapeText(node.fields[fieldName]), shapeText(next), ev.keep),
          });
        }
        if (touched.length === 0) {
          errors.push(`节点 '${ev.name}' 没有可裁的一维参数数组`);
          continue;
        }
      }
      // tied:上下游都传播(分叉全裁;汇合由 visited 一致性把关)
      for (const [src, dst] of edges) {
        if (dst === ev.name) queue.push({ name: src, axis: 'out', keep: ev.keep });
        if (src === ev.name) queue.push({ name: dst, axis: 'in', keep: ev.keep });
      }
      continue;
    }

    // weight 型
    const widths = weightWidths(node);
    if (ev.axis === 'out') {
      if (widths.outWidth == null || node.fields.weight.shape[0] !== widths.outWidth) {
        errors.push(`节点 '${ev.name}' 的 weight 形状读不出输出通道数`);
        continue;
      }
      const wNext = sliceAxis(node.fields.weight, 0, ev.keep);
      pruned.push({
        name: ev.name, field: 'weight', value: wNext,
        detail: `weight ${shapeText(node.fields.weight)} -> ${shapeText(wNext)}(裁输出通道=行)`,
      });
      const bias = node.fields.bias;
      if (bias) {
        if (bias.shape.length !== 1 || bias.shape[0] !== widths.outWidth) {
          errors.push(`节点 '${ev.name}' 的 bias 形状 ${shapeText(bias)} 与输出通道数 (${widths.outWidth}) 不一致,拒绝裁剪`);
          continue;
        }
        const bNext = sliceAxis(bias, 0, ev.keep);
        pruned.push({
          name: ev.name, field: 'bias', value: bNext,
          detail: `bias ${shapeText(bias)} -> ${shapeText(bNext)}`,
        });
      }
      for (const [src, dst] of edges) {
        if (src === ev.name) queue.push({ name: dst, axis: 'in', keep: ev.keep });
      }
    } else {
      const isConv = node.type === 'Conv1d' || node.type === 'Conv2d';
      if (isConv && convGroups(node) !== 1) {
        errors.push(`节点 '${ev.name}' 是分组卷积(groups=${convGroups(node)}),裁输入通道会破坏分组结构,已拒绝`);
        continue;
      }
      const lastAxis = widths.inAxis;
      const wNext = sliceAxis(node.fields.weight, lastAxis, ev.keep);
      pruned.push({
        name: ev.name, field: 'weight', value: wNext,
        detail: `weight ${shapeText(node.fields.weight)} -> ${shapeText(wNext)}(裁输入通道=列)`,
      });
      for (const [src, dst] of edges) {
        if (dst === ev.name) queue.push({ name: src, axis: 'out', keep: ev.keep });
      }
    }
  }

  return {
    ok: errors.length === 0,
    parentPath,
    pruned,
    manual,
    errors,
  };
}

/**
 * 执行剪枝:先算计划,有错整体拒绝(文档不动);否则一次性应用全部字段替换。
 * 返回 { doc, plan }。
 */
export function applyPruneChannels(doc, specs) {
  const plan = planPruneChannels(doc, specs);
  if (!plan.ok) {
    throw new Error(`通道剪枝被拒绝: ${plan.errors.join('; ')}`);
  }
  const parentPath = plan.parentPath;
  const next = transformGraph(doc, parentPath, (graph) => {
    for (const edit of plan.pruned) {
      const node = graph.children[edit.name];
      if (!node) throw new Error(`applyPruneChannels: node '${edit.name}' vanished`);
      node.fields[edit.field] = edit.value;
    }
  });
  return { doc: next, plan };
}

/**
 * 在指定图上做一次性变换:深拷贝整棵图,mutator 直接改目标图节点草稿,
 * 返回新的冻结文档。供 prune 与 grouping 共用。
 */
export function transformGraph(doc, parentPath, mutator) {
  const cloned = cloneGraph(doc.graph);
  let target = cloned;
  for (const name of parentPath || []) {
    if (target.type !== 'NIRGraph' || !target.children || !(name in target.children)) {
      throw new Error(`transformGraph: graph not found at [${(parentPath || []).join(', ')}]`);
    }
    target = target.children[name];
  }
  mutator(target);
  return deepFreezeDocs({ version: doc.version, graph: cloned });
}

function deepFreezeDocs(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    if (ArrayBuffer.isView(obj)) return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) deepFreezeDocs(obj[key]);
  }
  return obj;
}
