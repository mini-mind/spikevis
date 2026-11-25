/**
 * 写 NIR 文件：把文档按官方序列化格式写回 HDF5，官方 Python 库（nir.read）可读。
 *
 * 与官方 nir.write 对齐的细节：
 * - /version 为变长 UTF-8 字符串数据集；
 * - 字符串一律变长 UTF-8（edges 例外：保留读入时的 dtype，vlen/定长都合法）；
 * - 非空数值数组 gzip 压缩，标量与字符串不压缩（h5py 对标量不支持压缩）；
 * - metadata 为空时整组跳过不写；
 * - 字段只在存在时写出：缺省过的字段（如旧文件的 v_reset）不会被凭空补上。
 */

import { assertBackend, joinPath } from './hdf5.js';
import { getOperatorInfo } from './operatorTable.js';
import { isNumericDtype, isStringDtype } from './value.js';

/** 写"键 -> NirValue | 嵌套字典"的组（metadata 与保留的未知子组共用） */
function writeKeyValueGroup(backend, handle, groupPath, entries, where) {
  backend.createGroup(handle, groupPath);
  for (const [key, value] of Object.entries(entries)) {
    const p = joinPath(groupPath, key);
    if (value && typeof value === 'object' && !('dtype' in value)) {
      // 嵌套组
      writeKeyValueGroup(backend, handle, p, value, where);
    } else if (value && typeof value === 'object' && 'dtype' in value) {
      writeValueDataset(backend, handle, p, value, where);
    } else {
      throw new Error(`${where}: cannot serialize metadata entry '${p}' of type ${typeof value}`);
    }
  }
}

function writeValueDataset(backend, handle, path, value, where) {
  if (!value || typeof value !== 'object' || !('dtype' in value)) {
    throw new Error(`${where}: '${path}' is not a NirValue`);
  }
  if (isStringDtype(value.dtype) || isNumericDtype(value.dtype)) {
    // 数值数组压缩；字符串、标量、空数组不压缩（与官方写出行为一致）
    const compress = isNumericDtype(value.dtype)
      && value.data.length > 0
      && value.shape.length > 0;
    backend.writeDataset(handle, path, value, { compress });
  } else {
    throw new Error(`${where}: '${path}' has unsupported dtype '${value.dtype}'`);
  }
}

function writeNode(backend, handle, groupPath, node, where) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
    throw new Error(`${where}: node at '${groupPath}' has no type`);
  }
  backend.createGroup(handle, groupPath);
  // type 数据集（变长 UTF-8 标量）
  backend.writeDataset(
    handle,
    joinPath(groupPath, 'type'),
    { dtype: 'vlen-str', shape: [], data: node.type },
    { compress: false },
  );

  const opInfo = getOperatorInfo(node.type);
  const written = new Set();

  // 已知字段按算子表顺序写出
  if (opInfo) {
    for (const field of opInfo.fields) {
      const v = node.fields ? node.fields[field.name] : undefined;
      if (v === undefined || v === null) continue; // 缺省字段不凭空补
      writeValueDataset(backend, handle, joinPath(groupPath, field.name), v, where);
      written.add(field.name);
    }
  }
  // 不认识的数据集原样保留写出
  if (node.otherDatasets) {
    for (const [name, v] of Object.entries(node.otherDatasets)) {
      if (written.has(name)) {
        throw new Error(`${where}: dataset '${name}' at '${groupPath}' exists both as known field and unknown dataset`);
      }
      writeValueDataset(backend, handle, joinPath(groupPath, name), v, where);
    }
  }

  // 元数据：空则整组跳过（官方行为）
  const metadataEntries = node.metadata || {};
  if (Object.keys(metadataEntries).length > 0) {
    writeKeyValueGroup(backend, handle, joinPath(groupPath, 'metadata'), metadataEntries, where);
  }

  // 未知子组原样保留
  if (node.otherGroups) {
    for (const [name, entries] of Object.entries(node.otherGroups)) {
      writeKeyValueGroup(backend, handle, joinPath(groupPath, name), entries, where);
    }
  }

  // 图节点：先写子节点组，再写 edges
  if (node.type === 'NIRGraph') {
    if (!node.children || typeof node.children !== 'object') {
      throw new Error(`${where}: graph node at '${groupPath}' has no children`);
    }
    const childNames = Object.keys(node.children);
    if (childNames.length === 0) {
      throw new Error(`${where}: graph node at '${groupPath}' has no children`);
    }
    for (const [childName, child] of Object.entries(node.children)) {
      writeNode(backend, handle, joinPath(joinPath(groupPath, 'nodes'), childName), child,
        `${where} > node '${childName}'`);
    }
    if (!Array.isArray(node.edgePairs)) {
      throw new Error(`${where}: graph node at '${groupPath}' is missing edgePairs`);
    }
    if (node.edges) {
      // 保留读入时的字符串 dtype（vlen/定长）
      writeValueDataset(backend, handle, joinPath(groupPath, 'edges'), node.edges, where);
    } else {
      // 新建的图：用 edgePairs 建变长字符串数据集
      const flat = [];
      for (const [a, b] of node.edgePairs) {
        if (typeof a !== 'string' || typeof b !== 'string') {
          throw new Error(`${where}: edge at '${groupPath}' has non-string endpoint: (${a}, ${b})`);
        }
        flat.push(a, b);
      }
      backend.writeDataset(
        handle,
        joinPath(groupPath, 'edges'),
        { dtype: 'vlen-str', shape: [node.edgePairs.length, 2], data: flat },
        { compress: false },
      );
    }
  }
}

/**
 * 把文档写成 .nir 字节（Uint8Array）。
 * doc = { version: string, graph: NirNodeRecord }
 */
export async function writeNir(doc, backend) {
  assertBackend(backend);
  if (!doc || typeof doc.version !== 'string') {
    throw new Error('document has no version string');
  }
  if (!doc.graph || doc.graph.type !== 'NIRGraph') {
    throw new Error("document root must be a NIRGraph node (got none)");
  }
  const handle = await backend.create();
  try {
    backend.writeDataset(
      handle,
      'version',
      { dtype: 'vlen-str', shape: [], data: doc.version },
      { compress: false },
    );
    writeNode(backend, handle, 'node', doc.graph, 'root');
    return backend.finish(handle);
  } catch (e) {
    backend.close(handle);
    throw e;
  }
}
