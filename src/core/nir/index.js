/**
 * NIR 核心模块统一出口。
 *
 * 分层：
 * - value.js       NirValue（数据集的规范表示）与比较/预览工具
 * - operatorTable  19 种可序列化算子的字段表与类型推导
 * - hdf5.js        HDF5 访问接口约定（核心不直接依赖 h5wasm）
 * - backend-h5wasm h5wasm 适配器
 * - read.js        无损读 .nir -> 文档
 * - write.js       文档 -> .nir 字节（官方库可读）
 * - shape.js       形状推断与检查（移植官方 infer_types / check_types）
 * - document.js    不可变文档与纯变换
 * - prune.js       通道剪枝(沿边联动传播,分叉/汇合/阻停)
 * - grouping.js    成组/解组(嵌套子图节点的打包与展开)
 * - history.js     撤销/重做栈
 */

export * from './value.js';
export * from './operatorTable.js';
export { assertBackend, joinPath } from './hdf5.js';
export { createH5wasmBackend } from './backend-h5wasm.js';
export { readNir, isHdf5Bytes } from './read.js';
export { writeNir } from './write.js';
export { inferTypes, checkTypes, cloneGraph } from './shape.js';
export * from './edits.js';
export * from './prune.js';
export * from './grouping.js';
export { validateDocument, changedNodeNames, changedNamesAt } from './validate.js';
export * from './document.js';
export { createHistory } from './history.js';
