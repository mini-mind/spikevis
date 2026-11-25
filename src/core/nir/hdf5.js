/**
 * 薄 HDF5 访问接口（核心模块只认这套接口，不直接依赖 h5wasm）。
 *
 * backend 需要实现（全部路径是相对根的斜杠路径，如 'node/nodes/input/weight'）：
 * - open(bytes: Uint8Array) -> Promise<handle>   以只读方式打开内存中的 HDF5 字节
 * - create() -> Promise<handle>                  新建一个待写的 HDF5（在内存虚拟文件系统里）
 * - close(handle) -> void
 * - finish(handle) -> Uint8Array                 关闭写句柄并取出文件全部字节
 * - kind(handle, path) -> 'group' | 'dataset' | null
 * - keys(handle, path) -> string[]               列出组的直接子项名（不排序保证）
 * - readDataset(handle, path) -> NirValue        读数据集（含 dtype/shape/data）
 * - createGroup(handle, path) -> void            逐级建组（path 的父级若不存在也一并建）
 * - writeDataset(handle, path, value, opts) -> void
 *     opts.compress 为 true 时对数值数组施加 gzip（无损）；
 *     字符串/标量/空数组忽略 compress（官方写出路径同样如此）。
 *
 * 后端抛出的错误都原样向上传递，由读/写层补充上下文（哪个节点哪个数据集）。
 */

/** 简单校验 backend 是否具备所需方法（启动期抓配置错误） */
export function assertBackend(backend) {
  const required = ['open', 'create', 'close', 'finish', 'kind', 'keys', 'readDataset', 'createGroup', 'writeDataset'];
  const missing = required.filter((m) => typeof backend[m] !== 'function');
  if (missing.length > 0) {
    throw new Error(`HDF5 backend missing methods: ${missing.join(', ')}`);
  }
}

/** 把 (父路径, 名字) 拼成完整路径 */
export function joinPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}
