/**
 * NIR 算子表（对照官方 nir 1.0.8 的 nir/ir/*.py 移植）。
 *
 * 每种可序列化节点类型（共 19 种，Identity 不在官方序列化清单里，编辑器不写出）：
 * - fields: 字段名与元信息。fileOptional 表示官方旧文件里可能缺省的字段（读入时如实记缺，写出时不凭空补）。
 *   default 表示构造新节点时的缺省值；'zeros-like:<字段名>' 表示与某字段同形的零数组。
 * - deriveTypes(fields, helpers): 从字段推导 (input_type, output_type)，
 *   对应官方各类 __post_init__ 的行为，供形状推断使用。返回 [number[]|null, number[]|null]。
 *
 * 字段 kind：
 * - 'array'  数值数组（NirValue）
 * - 'int'    整数标量（NirValue，shape 为 []）
 * - 'str'    字符串标量或字符串数组（NirValue）
 * - 'shape'  形状数组（整数一维数组，Input/Output 的 shape、Conv 的 input_shape 视情况）
 */

import { stringValue, isStringDtype } from './value.js';

/** 官方可序列化类型清单（nir/ir/__init__.py 的 __all_ir） */
export const SERIALIZABLE_TYPES = [
  'Conv1d', 'Conv2d', 'Delay', 'Flatten', 'Input', 'NIRGraph', 'Output',
  'Affine', 'Linear', 'Scale', 'CubaLI', 'CubaLIF', 'I', 'IF', 'LI', 'LIF',
  'AvgPool2d', 'SumPool2d', 'Threshold',
];

/** 从数值 NirValue 取整数数组（形状数据用） */
export function valueToIntArray(value) {
  if (!value || value.data === undefined) return null;
  return Array.from(value.data, (x) => (typeof x === 'bigint' ? Number(x) : x));
}

/**
 * 卷积/池化单维输出尺寸，对应官方 nir/ir/utils.py calculate_conv_output。
 * inputShape: number | number[]；padding: number | number[] | 'same' | 'valid'；
 * dilation / kernelSize / stride: number | number[]。
 */
export function calculateConvOutput(inputShape, padding, dilation, kernelSize, stride) {
  const dims = typeof inputShape === 'number' ? [inputShape] : inputShape;
  const ndim = dims.length;
  const pad = padding === 'valid' ? dims.map(() => 0) : padding;
  const pick = (x, i, what) => {
    if (typeof x === 'number') return x; // 标量按维度重复
    if (Array.isArray(x)) {
      if (i >= x.length) {
        throw new Error(`calculateConvOutput: ${what} has ${x.length} element(s) but the input needs per-dimension values (index ${i})`);
      }
      return x[i];
    }
    throw new Error(`calculateConvOutput: ${what} must be a number or a number array, got ${JSON.stringify(x)}`);
  };
  const out = [];
  for (let i = 0; i < ndim; i += 1) {
    if (padding === 'same') {
      out.push(dims[i]);
    } else {
      const v = (dims[i] + 2 * pick(pad, i, 'padding') - pick(dilation, i, 'dilation') * (pick(kernelSize, i, 'kernelSize') - 1) - 1)
        / pick(stride, i, 'stride') + 1;
      out.push(Math.floor(v));
    }
  }
  return out;
}

/**
 * Flatten 输出形状，对应官方 nir/ir/utils.py calc_flatten_output。
 * end_dim = -1 表示压平到最后；end_dim 为最后一个下标时尾段为空。
 */
export function calcFlattenOutput(inputShape, startDim, endDim) {
  const prod = (xs) => xs.reduce((a, b) => a * b, 1);
  const startShape = startDim === 0 ? [] : inputShape.slice(0, startDim);
  const middle = endDim === -1
    ? prod(inputShape.slice(startDim))
    : prod(inputShape.slice(startDim, endDim + 1));
  const endShape = (endDim !== -1 && endDim !== inputShape.length - 1)
    ? inputShape.slice(endDim + 1)
    : [];
  return [...startShape, middle, ...endShape];
}

// 神经元类：输入/输出类型 = 参数数组的形状（官方 __post_init__ 用 shape，不是数值）
const neuronShape = (field) => (fields) => {
  const v = fields[field];
  return v ? [[...v.shape], [...v.shape]] : [null, null];
};

/** Linear / Affine：输入 = 权重最后一维，输出 = 权重倒数第二维（批量维原样保留） */
const linearShape = (fields) => {
  const w = fields.weight;
  if (!w) return [null, null];
  const dims = w.shape;
  return [dims.slice(0, -2).concat([dims[dims.length - 1]]), dims.slice(0, -2).concat([dims[dims.length - 2]])];
};

/** 把可能是字符串的卷积参数（padding='same'/'valid'）还原成字符串或整数数组 */
function convParam(value) {
  if (!value) return null;
  if (isStringDtype(value.dtype)) {
    return Array.isArray(value.data) ? value.data[0] : value.data;
  }
  return valueToIntArray(value);
}

/** Conv1d / Conv2d：有 input_shape 时按官方公式推，缺省时输入输出未知 */
const convShape = () => (fields) => {
  const is = fields.input_shape;
  const w = fields.weight;
  if (!w || !is) return [null, null];
  const inShape = valueToIntArray(is);
  const wDims = w.shape;
  const inputType = [wDims[1], ...inShape];
  const outSpatial = calculateConvOutput(
    inShape,
    convParam(fields.padding),
    convParam(fields.dilation),
    wDims.slice(2),
    convParam(fields.stride),
  );
  return [inputType, [wDims[0], ...outSpatial]];
};

/** Flatten：input_type 字段存在时按官方公式压平 */
const flattenShape = (fields) => {
  const it = fields.input_type;
  if (!it) return [null, null];
  const inShape = valueToIntArray(it);
  const start = fields.start_dim ? valueToIntArray(fields.start_dim)[0] : 1;
  const end = fields.end_dim ? valueToIntArray(fields.end_dim)[0] : -1;
  return [inShape, calcFlattenOutput(inShape, start, end)];
};

const poolShape = () => [null, null];

const shapeFieldShape = (fields) => {
  const v = fields.shape;
  return v ? [valueToIntArray(v), valueToIntArray(v)] : [null, null];
};

/**
 * 算子表本体。
 * 注：CubaLIF/CubaLI 的 w_in 在官方 __post_init__ 里会广播成数组；文件里若缺省读作缺省，
 * 编辑器建新节点时按缺省值补 1.0。
 */
export const NIR_OPERATORS = {
  Input: {
    label: '输入',
    fields: [{ name: 'shape', kind: 'shape', required: true }],
    deriveTypes: shapeFieldShape,
  },
  Output: {
    label: '输出',
    fields: [{ name: 'shape', kind: 'shape', required: true }],
    deriveTypes: shapeFieldShape,
  },
  Linear: {
    label: '线性层',
    fields: [{ name: 'weight', kind: 'array', required: true }],
    deriveTypes: linearShape,
  },
  Affine: {
    label: '仿射层',
    fields: [
      { name: 'weight', kind: 'array', required: true },
      { name: 'bias', kind: 'array', required: true },
    ],
    deriveTypes: linearShape,
  },
  Scale: {
    label: '缩放层',
    fields: [{ name: 'scale', kind: 'array', required: true }],
    deriveTypes: neuronShape('scale'),
  },
  Threshold: {
    label: '阈值',
    fields: [{ name: 'threshold', kind: 'array', required: true }],
    deriveTypes: neuronShape('threshold'),
  },
  Delay: {
    label: '延迟',
    fields: [{ name: 'delay', kind: 'array', required: true }],
    deriveTypes: neuronShape('delay'),
  },
  LIF: {
    label: 'LIF 神经元',
    fields: [
      { name: 'tau', kind: 'array', required: true },
      { name: 'r', kind: 'array', required: true },
      { name: 'v_leak', kind: 'array', required: true },
      { name: 'v_threshold', kind: 'array', required: true },
      { name: 'v_reset', kind: 'array', fileOptional: true, default: 'zeros-like:v_threshold' },
    ],
    deriveTypes: neuronShape('r'),
  },
  LI: {
    label: 'LI 神经元',
    fields: [
      { name: 'tau', kind: 'array', required: true },
      { name: 'r', kind: 'array', required: true },
      { name: 'v_leak', kind: 'array', required: true },
    ],
    deriveTypes: neuronShape('r'),
  },
  IF: {
    label: 'IF 神经元',
    fields: [
      { name: 'r', kind: 'array', required: true },
      { name: 'v_threshold', kind: 'array', required: true },
      { name: 'v_reset', kind: 'array', fileOptional: true, default: 'zeros-like:v_threshold' },
    ],
    deriveTypes: neuronShape('r'),
  },
  I: {
    label: '积分器',
    fields: [{ name: 'r', kind: 'array', required: true }],
    deriveTypes: neuronShape('r'),
  },
  CubaLIF: {
    label: 'CubaLIF 神经元',
    fields: [
      { name: 'tau_syn', kind: 'array', required: true },
      { name: 'tau_mem', kind: 'array', required: true },
      { name: 'r', kind: 'array', required: true },
      { name: 'v_leak', kind: 'array', required: true },
      { name: 'v_threshold', kind: 'array', required: true },
      { name: 'v_reset', kind: 'array', fileOptional: true, default: 'zeros-like:v_threshold' },
      { name: 'w_in', kind: 'array', fileOptional: true, default: 1.0 },
    ],
    deriveTypes: neuronShape('v_threshold'),
  },
  CubaLI: {
    label: 'CubaLI 神经元',
    fields: [
      { name: 'tau_syn', kind: 'array', required: true },
      { name: 'tau_mem', kind: 'array', required: true },
      { name: 'r', kind: 'array', required: true },
      { name: 'v_leak', kind: 'array', required: true },
      { name: 'w_in', kind: 'array', fileOptional: true, default: 1.0 },
    ],
    deriveTypes: neuronShape('v_leak'),
  },
  Conv1d: {
    label: '一维卷积',
    fields: [
      { name: 'input_shape', kind: 'shape', fileOptional: true },
      { name: 'weight', kind: 'array', required: true },
      { name: 'stride', kind: 'int', required: true },
      { name: 'padding', kind: 'str', required: true },
      { name: 'dilation', kind: 'int', required: true },
      { name: 'groups', kind: 'int', required: true },
      { name: 'bias', kind: 'array', required: true },
    ],
    deriveTypes: convShape(),
  },
  Conv2d: {
    label: '二维卷积',
    fields: [
      { name: 'input_shape', kind: 'shape', fileOptional: true },
      { name: 'weight', kind: 'array', required: true },
      { name: 'stride', kind: 'int', required: true },
      { name: 'padding', kind: 'str', required: true },
      { name: 'dilation', kind: 'int', required: true },
      { name: 'groups', kind: 'int', required: true },
      { name: 'bias', kind: 'array', required: true },
    ],
    deriveTypes: convShape(),
  },
  SumPool2d: {
    label: '二维和池化',
    fields: [
      { name: 'kernel_size', kind: 'array', required: true },
      { name: 'stride', kind: 'array', required: true },
      { name: 'padding', kind: 'array', required: true },
    ],
    deriveTypes: poolShape,
  },
  AvgPool2d: {
    label: '二维平均池化',
    fields: [
      { name: 'kernel_size', kind: 'array', required: true },
      { name: 'stride', kind: 'array', required: true },
      { name: 'padding', kind: 'array', required: true },
    ],
    deriveTypes: poolShape,
  },
  Flatten: {
    label: '展平',
    fields: [
      { name: 'input_type', kind: 'shape', fileOptional: true },
      { name: 'start_dim', kind: 'int', required: true, default: 1 },
      { name: 'end_dim', kind: 'int', required: true, default: -1 },
    ],
    deriveTypes: flattenShape,
  },
  NIRGraph: {
    label: '子图',
    // NIRGraph 自身字段是 nodes/edges，由文档模型单独处理；这里不列字段。
    fields: [],
    deriveTypes: null, // 图节点类型从其 Input/Output 子节点推导（见 shape.js）
  },
};

/** 查算子信息；未知类型返回 null（读入时未知类型原样保留） */
export function getOperatorInfo(type) {
  return NIR_OPERATORS[type] || null;
}

/** 某类型的某字段元信息 */
export function getFieldInfo(type, fieldName) {
  const op = NIR_OPERATORS[type];
  if (!op) return null;
  return op.fields.find((f) => f.name === fieldName) || null;
}

/**
 * 从字段构造字符串标量 NirValue 的便捷函数（padding='same' 这类场景备用）。
 */
export function makeStr(s) {
  return stringValue([], s);
}
