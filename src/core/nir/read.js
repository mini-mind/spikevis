/**
 * 读 NIR 文件：按官方序列化格式逐项读取，无损。
 *
 * 官方 HDF5 布局（nir 1.0.8，serialization.py）：
 *   /version             变长 UTF-8 字符串数据集（包版本号）
 *   /node                整张图（NIRNode），组内：
 *     type               类名数据集（无 n. 前缀，根图为 NIRGraph）
 *     nodes/<名>/...     每个节点一个子组（仅图节点有）
 *     edges              (源, 目标) 字符串二维数据集（仅图节点有）
 *     metadata/<键>      元数据组：字符串为变长 UTF-8 数据集，ndarray 为数据集，
 *                        嵌套字典为嵌套组（仅非空才写）
 *     <字段>             各类型字段数据集（weight、tau 等）
 *
 * 无损约定：
 * - 保留原始 dtype（含字符串 vlen/定长之分）；
 * - 保留不认识的字段数据集（otherDatasets）与不认识的元数据键；
 * - 字段缺省（如旧文件无 v_reset）如实记为"不存在"，绝不凭空补默认值；
 * - 没有任何"猜结构"的兜底分支，读不懂就抛错并写明位置。
 */

import { assertBackend, joinPath } from './hdf5.js';
import { getOperatorInfo, SERIALIZABLE_TYPES } from './operatorTable.js';

/** 读一个数据集并检查必须存在 */
function requireDataset(backend, handle, path, where) {
  if (backend.kind(handle, path) !== 'dataset') {
    throw new Error(`${where}: required dataset '${path}' is missing`);
  }
  try {
    return backend.readDataset(handle, path);
  } catch (e) {
    throw new Error(`${where}: failed to read dataset '${path}': ${e.message}`);
  }
}

/** 读元数据组：每个键一个数据集或嵌套组；组内成员原样保留 */
function readMetadataGroup(backend, handle, groupPath, where) {
  const metadata = {};
  if (backend.kind(handle, groupPath) !== 'group') {
    throw new Error(`${where}: 'metadata' exists but is not a group (${groupPath})`);
  }
  for (const key of backend.keys(handle, groupPath)) {
    const p = joinPath(groupPath, key);
    const k = backend.kind(handle, p);
    if (k === 'dataset') {
      try {
        metadata[key] = backend.readDataset(handle, p);
      } catch (e) {
        throw new Error(`${where}: failed to read metadata dataset '${p}': ${e.message}`);
      }
    } else if (k === 'group') {
      metadata[key] = readMetadataGroup(backend, handle, p, where);
    } else {
      throw new Error(`${where}: metadata entry '${p}' is neither dataset nor group`);
    }
  }
  return metadata;
}

/** 读一个节点组（NIR 节点或图节点），递归 */
function readNodeGroup(backend, handle, groupPath, where) {
  if (backend.kind(handle, groupPath) !== 'group') {
    throw new Error(`${where}: node '${groupPath}' is not a group`);
  }
  const typeValue = requireDataset(backend, handle, joinPath(groupPath, 'type'), where);
  if (typeValue.dtype !== 'vlen-str' && typeValue.dtype !== 'fixed-str') {
    throw new Error(`${where}: dataset '${groupPath}/type' is not a string dataset (dtype=${typeValue.dtype})`);
  }
  const type = typeof typeValue.data === 'string' ? typeValue.data : typeValue.data[0];

  const node = {
    type,
    fields: {},          // 算子表认得的字段
    otherDatasets: {},   // 不认识的数据集（含未知类型的全部数据集），原样保留
    metadata: {},        // 元数据（缺省时为空对象，不写出）
    children: null,      // NIRGraph 的 nodes
    edges: null,         // NIRGraph 的 edges（NirValue，字符串 [n,2]）
    otherGroups: {},     // 图节点下不认识的子组，原样保留
  };

  const opInfo = getOperatorInfo(type);
  const knownFieldNames = new Set((opInfo ? opInfo.fields : []).map((f) => f.name));
  const isGraph = type === 'NIRGraph';

  const names = backend.keys(handle, groupPath);
  for (const name of names) {
    const p = joinPath(groupPath, name);
    const k = backend.kind(handle, p);
    if (k === 'dataset') {
      if (name === 'type') continue; // 已经读过
      if (isGraph && name === 'edges') {
        node.edges = requireDataset(backend, handle, p, where);
        const nRows = node.edges.shape[0] || 0;
        const nCols = node.edges.shape[1] || 0;
        if (nCols !== 2) {
          throw new Error(`${where}: dataset '${p}' of edges must have shape [n, 2], got [${node.edges.shape}]`);
        }
        if (typeof node.edges.data === 'string' || !Array.isArray(node.edges.data)) {
          throw new Error(`${where}: dataset '${p}' of edges must be a string array`);
        }
        if (nRows * 2 !== node.edges.data.length) {
          throw new Error(`${where}: edges dataset '${p}' has ${node.edges.data.length} strings, expected ${nRows * 2}`);
        }
      } else if (knownFieldNames.has(name)) {
        try {
          node.fields[name] = backend.readDataset(handle, p);
        } catch (e) {
          throw new Error(`${where}: failed to read dataset '${p}': ${e.message}`);
        }
      } else {
        // 不认识的字段：未知类型，或官方清单之外的数据集，都原样保留
        try {
          node.otherDatasets[name] = backend.readDataset(handle, p);
        } catch (e) {
          throw new Error(`${where}: failed to read dataset '${p}': ${e.message}`);
        }
      }
    } else if (k === 'group') {
      if (name === 'metadata') {
        node.metadata = readMetadataGroup(backend, handle, p, where);
      } else if (isGraph && name === 'nodes') {
        node.children = {};
        const childNames = backend.keys(handle, p);
        if (childNames.length === 0) {
          throw new Error(`${where}: graph '${groupPath}' has an empty 'nodes' group`);
        }
        for (const childName of childNames) {
          node.children[childName] = readNodeGroup(
            backend, handle, joinPath(p, childName), `${where} > node '${childName}'`,
          );
        }
      } else {
        // 不认识的子组：作为原始子结构保留（读成"键->NirValue"的字典）
        node.otherGroups[name] = readMetadataGroup(backend, handle, p, where);
      }
    } else {
      throw new Error(`${where}: unexpected object '${p}' in node group (kind=${k})`);
    }
  }

  if (isGraph) {
    if (!node.children) {
      throw new Error(`${where}: graph '${groupPath}' is missing the 'nodes' group`);
    }
    if (!node.edges) {
      throw new Error(`${where}: graph '${groupPath}' is missing the 'edges' dataset`);
    }
    // 把 edges NirValue 解析成 [源, 目标] 对（写入端按此还原）
    node.edgePairs = [];
    for (let i = 0; i < node.edges.data.length; i += 2) {
      node.edgePairs.push([node.edges.data[i], node.edges.data[i + 1]]);
    }
  }

  // 边引用的完整性检查：边两端必须指向存在的节点
  if (isGraph) {
    const known = new Set(Object.keys(node.children));
    for (const [src, dst] of node.edgePairs) {
      if (!known.has(src)) {
        throw new Error(`${where}: edge source '${src}' does not exist among nodes of '${groupPath}'`);
      }
      if (!known.has(dst)) {
        throw new Error(`${where}: edge target '${dst}' does not exist among nodes of '${groupPath}'`);
      }
    }
  }

  return node;
}

/** 判断字节是否为 HDF5（魔数 \\x89HDF\\r\\n\\x1a\\n） */
export function isHdf5Bytes(bytes) {
  const magic = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * 读 NIR 文件，返回文档：
 * {
 *   version: string,
 *   graph: NirNodeRecord,      // /node
 * }
 * 非法文件抛 Error，错误信息写明位置。
 */
export async function readNir(bytes, backend) {
  assertBackend(backend);
  if (!isHdf5Bytes(bytes)) {
    throw new Error('not an HDF5 file (magic bytes mismatch); a .nir file must be HDF5');
  }
  const handle = await backend.open(bytes);
  try {
    const rootKeys = backend.keys(handle, '');
    if (!rootKeys.includes('version')) {
      throw new Error("not a NIR file: root group has no 'version' dataset");
    }
    if (!rootKeys.includes('node')) {
      throw new Error("not a NIR file: root group has no 'node' group");
    }
    const versionValue = requireDataset(backend, handle, 'version', 'root');
    if (typeof versionValue.data !== 'string') {
      throw new Error(`root dataset 'version' is not a scalar string (shape=[${versionValue.shape}])`);
    }
    if (backend.kind(handle, 'node') !== 'group') {
      throw new Error("root entry 'node' is not a group");
    }
    const graph = readNodeGroup(backend, handle, 'node', 'root');
    return Object.freeze({ version: versionValue.data, graph });
  } finally {
    backend.close(handle);
  }
}

/** 导出类型清单供 UI 判断"是否认识" */
export { SERIALIZABLE_TYPES };
