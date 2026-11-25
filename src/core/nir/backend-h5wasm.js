/**
 * h5wasm 适配器：把 h5wasm 0.10.x 包装成核心模块定义的 HDF5 backend 接口。
 *
 * h5wasm 在内存虚拟文件系统（Emscripten FS）里开文件：
 * - 读：把字节写进虚拟 FS 再以 'r' 打开；
 * - 写：以 'w' 新建虚拟文件，close 后用 FS.readFile 取回字节。
 *
 * h5wasm 读出的 dtype 元数据 { type, size, signed, vlen, cset } 映射为核心
 * dtype 字符串；写出时反向映射：
 *   数值 -> 对应 TypedArray + dtype 串（如 '<f4'）
 *   变长字符串 -> 直接传 JS 字符串（h5wasm 自动建成 vlen UTF-8）
 *   定长字符串 -> dtype 'S<长度>'
 */

import { NUMERIC_DTYPES } from './value.js';

/** h5wasm metadata -> 核心 dtype 字符串 */
function metadataToDtype(meta) {
  const H5T_INTEGER = 0;
  const H5T_FLOAT = 1;
  const H5T_STRING = 3;
  if (meta.type === H5T_STRING) {
    if (meta.vlen) return 'vlen-str';
    return 'fixed-str';
  }
  const size = Number(meta.size);
  if (meta.type === H5T_FLOAT) {
    if (size === 8) return 'f64';
    if (size === 4) return 'f32';
    throw new Error(`unsupported float size in HDF5 dataset: ${size}`);
  }
  if (meta.type === H5T_INTEGER) {
    const key = `${meta.signed ? 'i' : 'u'}${size * 8}`;
    if (!(key in NUMERIC_DTYPES)) {
      throw new Error(`unsupported integer dtype in HDF5 dataset: signed=${meta.signed} size=${size}`);
    }
    return key;
  }
  throw new Error(`unsupported HDF5 type class: ${meta.type}`);
}

/** 核心 dtype 字符串 -> h5wasm dtype 串 */
const DTYPE_TO_H5WASM = {
  i8: '<b', i16: '<h', i32: '<i', i64: '<q',
  u8: 'B', u16: '<H', u32: '<I', u64: '<Q',
  f32: '<f', f64: '<d',
};

export async function createH5wasmBackend() {
  const h5wasm = await import('h5wasm');
  await h5wasm.ready;

  let counter = 0;
  const genName = () => `nir_edit_${Date.now()}_${counter += 1}.h5`;

  const open = async (bytes) => {
    const name = genName();
    h5wasm.FS.writeFile(name, bytes);
    const file = new h5wasm.File(name, 'r');
    return { file, name };
  };

  const create = async () => {
    const name = genName();
    // libver 钉 earliest：与官方 h5py 写出的文件兼容（否则 HDF5 2.0 的最新格式
    // 老版本读不了）
    const file = new h5wasm.File(name, 'w', { libver: 'earliest' });
    return { file, name };
  };

  const close = (handle) => {
    handle.file.close();
    try {
      h5wasm.FS.unlink(handle.name);
    } catch (e) {
      // 虚拟文件可能已被清理，忽略
    }
  };

  const readBytes = (handle) => h5wasm.FS.readFile(handle.name);

  // 写完先关文件再取字节（不关就读会拿到未完整落盘的数据）
  const finish = (handle) => {
    handle.file.close();
    const bytes = h5wasm.FS.readFile(handle.name);
    try {
      h5wasm.FS.unlink(handle.name);
    } catch (e) {
      // 忽略
    }
    return bytes;
  };

  // 根路径统一归一成 '/'
  const norm = (p) => (p === '' || p === undefined || p === null ? '/' : p);

  const kind = (handle, path) => {
    const entity = handle.file.get(norm(path));
    if (!entity) return null;
    if (typeof entity.keys === 'function') return 'group';
    return 'dataset';
  };

  const keys = (handle, path) => handle.file.get(norm(path)).keys();

  const readDataset = (handle, path) => {
    const ds = handle.file.get(path);
    const meta = ds.metadata;
    const dtype = metadataToDtype(meta);
    const shape = (ds.shape || []).map((n) => Number(n));
    const raw = ds.value;
    if (dtype === 'vlen-str' || dtype === 'fixed-str') {
      const charLength = dtype === 'fixed-str' ? Number(meta.size) : undefined;
      if (Array.isArray(raw)) {
        return Object.freeze({ dtype, shape, charLength, data: Object.freeze([...raw]) });
      }
      return Object.freeze({ dtype, shape, charLength, data: raw });
    }
    // 注意：TypedArray 本身不能 Object.freeze（会抛错），数据按约定不改写。
    // 标量数值数据集 h5wasm 返回裸 number/BigInt，这里包成长度 1 的 TypedArray。
    const Ctor = NUMERIC_DTYPES[dtype];
    const normalized = ArrayBuffer.isView(raw) ? raw : (() => {
      const wrapped = new Ctor(1);
      wrapped[0] = raw;
      return wrapped;
    })();
    const data = new Ctor(normalized);
    return Object.freeze({ dtype, shape, data });
  };

  const createGroup = (handle, path) => {
    // 逐级建组，父级不存在时一并创建
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (kind(handle, cur) !== 'group') {
        const parent = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '/';
        const name = cur.includes('/') ? cur.slice(cur.lastIndexOf('/') + 1) : cur;
        (parent === '/' ? handle.file : handle.file.get(parent)).create_group(name);
      }
    }
  };

  const writeDataset = (handle, path, value, opts = {}) => {
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
    const group = parentPath ? handle.file.get(parentPath) : handle.file;
    const isString = value.dtype === 'vlen-str' || value.dtype === 'fixed-str';
    if (isString) {
      const isScalar = value.shape.length === 0;
      if (value.dtype === 'vlen-str') {
        group.create_dataset({
          name,
          data: isScalar ? value.data : [...value.data],
          shape: value.shape,
        });
      } else {
        group.create_dataset({
          name,
          data: isScalar ? value.data : [...value.data],
          dtype: `S${value.charLength}`,
          shape: value.shape,
        });
      }
      return;
    }
    // 数值型
    const canCompress = opts.compress === true && value.data.length > 0;
    if (canCompress) {
      // h5wasm 要求压缩数据集显式给 chunks；取每维不超过 4096 的块
      const chunks = value.shape.map((n) => Math.max(1, Math.min(n, 4096)));
      group.create_dataset({
        name,
        data: value.data,
        dtype: DTYPE_TO_H5WASM[value.dtype],
        shape: value.shape,
        chunks,
        compression: 'gzip',
      });
    } else {
      group.create_dataset({
        name,
        data: value.data,
        dtype: DTYPE_TO_H5WASM[value.dtype],
        shape: value.shape,
      });
    }
  };

  return {
    open,
    create,
    close,
    finish,
    kind,
    keys,
    readDataset,
    createGroup,
    writeDataset,
  };
}
