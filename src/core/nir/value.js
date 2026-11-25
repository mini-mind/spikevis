/**
 * NirValue：核心模块对 HDF5 数据集的规范表示（与 h5wasm、Vue 都解耦）。
 *
 * 数值型：{ dtype: 'f32'|'f64'|'i8'|'i16'|'i32'|'i64'|'u8'|'u16'|'u32'|'u64',
 *           shape: number[]（标量为 []）, data: TypedArray }
 *   - 64 位整数用 BigInt64Array / BigUint64Array，其余按位宽取对应 TypedArray。
 *   - data 永远是扁平一维数组，形状由 shape 描述。
 *
 * 字符串型：{ dtype: 'vlen-str' | 'fixed-str', charLength?: number,
 *             shape: number[]（标量为 []）, data: string | string[] }
 *   - vlen-str 对应 HDF5 变长 UTF-8 字符串（官方 NIR 库写出的形式）。
 *   - fixed-str 对应定长字符串，charLength 为定长字节数。
 */

/** 数值 dtype -> TypedArray 构造器 */
export const NUMERIC_DTYPES = {
  i8: Int8Array,
  i16: Int16Array,
  i32: Int32Array,
  i64: BigInt64Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  u64: BigUint64Array,
  f32: Float32Array,
  f64: Float64Array,
};

/** dtype 是否为 64 位整数（数据是 BigInt） */
export function isBigIntDtype(dtype) {
  return dtype === 'i64' || dtype === 'u64';
}

/** dtype 是否为数值型（区别于字符串型） */
export function isNumericDtype(dtype) {
  return dtype in NUMERIC_DTYPES;
}

/** dtype 是否为字符串型 */
export function isStringDtype(dtype) {
  return dtype === 'vlen-str' || dtype === 'fixed-str';
}

/**
 * 构造数值 NirValue。data 必须是与 dtype 匹配的 TypedArray（扁平一维）。
 */
export function numericValue(dtype, shape, data) {
  const Ctor = NUMERIC_DTYPES[dtype];
  if (!Ctor) throw new Error(`unknown numeric dtype: ${dtype}`);
  if (!(data instanceof Ctor)) throw new Error(`dtype ${dtype} requires ${Ctor.name}`);
  const expectedLen = shape.reduce((a, b) => a * b, 1);
  if (data.length !== expectedLen) {
    throw new Error(`data length ${data.length} does not match shape [${shape}] (expects ${expectedLen})`);
  }
  // TypedArray 不能冻结（V8 限制），只冻结包装对象；数据按约定不改写
  return Object.freeze({ dtype, shape: Object.freeze([...shape]), data });
}

/**
 * 构造字符串 NirValue。标量字符串 data 是 string；字符串数组 data 是 string[]。
 */
export function stringValue(shape, data, dtype = 'vlen-str', charLength = undefined) {
  if (!isStringDtype(dtype)) throw new Error(`unknown string dtype: ${dtype}`);
  const expectedLen = shape.reduce((a, b) => a * b, 1);
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length !== expectedLen) {
    throw new Error(`data length ${arr.length} does not match shape [${shape}] (expects ${expectedLen})`);
  }
  const v = { dtype, shape: Object.freeze([...shape]), data: Object.freeze(data) };
  if (dtype === 'fixed-str') v.charLength = charLength;
  return Object.freeze(v);
}

/** 元素个数（标量为 1） */
export function valueElementCount(value) {
  return value.shape.reduce((a, b) => a * b, 1);
}

/** 两个 NirValue 是否逐位相等（dtype、shape、data 全部比较） */
export function valuesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.dtype !== b.dtype) return false;
  if (a.charLength !== b.charLength) return false;
  if (a.shape.length !== b.shape.length) return false;
  for (let i = 0; i < a.shape.length; i += 1) {
    if (a.shape[i] !== b.shape[i]) return false;
  }
  if (typeof a.data !== typeof b.data) return false;
  if (typeof a.data === 'string') return a.data === b.data;
  if (Array.isArray(a.data)) {
    if (!Array.isArray(b.data) || a.data.length !== b.data.length) return false;
    for (let i = 0; i < a.data.length; i += 1) {
      if (a.data[i] !== b.data[i]) return false;
    }
    return true;
  }
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i += 1) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/**
 * 生成给 UI 看的简短预览文本。
 * 数值标量直接给数；数组给"首尾样本 + 形状"；字符串原样（数组取首尾）。
 */
export function valueToPreview(value, maxSamples = 6) {
  if (!value) return '';
  const shapeTag = value.shape.length === 0 ? '' : ` shape=[${value.shape.join(',')}]`;
  if (typeof value.data === 'string') return `${value.data}${shapeTag}`;
  if (Array.isArray(value.data)) {
    if (value.data.length <= maxSamples) return `[${value.data.join(', ')}]${shapeTag}`;
    const head = value.data.slice(0, Math.ceil(maxSamples / 2));
    const tail = value.data.slice(-Math.floor(maxSamples / 2));
    return `[${head.join(', ')}, ...${tail.join(', ')}] (${value.data.length} items)${shapeTag}`;
  }
  // 数值 TypedArray
  const show = (x) => (typeof x === 'bigint' ? x.toString() : String(x));
  if (value.data.length === 1) return `${show(value.data[0])}${shapeTag}`;
  if (value.data.length <= maxSamples) {
    return `[${Array.from(value.data, show).join(', ')}]${shapeTag}`;
  }
  const half = Math.floor(maxSamples / 2);
  const head = Array.from(value.data.slice(0, half), show);
  const tail = Array.from(value.data.slice(-half), show);
  return `[${head.join(', ')}, ...${tail.join(', ')}] (${value.data.length} elements)${shapeTag}`;
}

/**
 * 把 NirValue 深拷贝一份（历史栈与不可变文档需要）。
 */
export function cloneValue(value) {
  if (!value) return value;
  const copy = { dtype: value.dtype, shape: [...value.shape] };
  if (typeof value.data === 'string') copy.data = value.data;
  else if (Array.isArray(value.data)) copy.data = [...value.data];
  else copy.data = new value.data.constructor(value.data);
  if (value.charLength !== undefined) copy.charLength = value.charLength;
  return Object.freeze(copy);
}
