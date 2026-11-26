/**
 * 旧版 JSON 模型的查看支持（只看不导出）。
 *
 * 历史上本应用支持把 JSON 文件画出来（如 test/complex_nir_test_model_json.json）。
 * 核心模块只管官方 HDF5 格式；这里把 JSON 直接转成视图模型，不进文档模型。
 */

import { getOperatorInfo } from '../core/nir/index.js';
import { FIELD_LABELS } from './nirIO.js';

function previewValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length <= 8) return `[${v.join(', ')}]`;
    const half = 4;
    return `[${v.slice(0, half).join(', ')}, ...${v.slice(-half).join(', ')}] (${v.length} items)`;
  }
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

/**
 * 把 JSON 文本转成视图模型。不是预期的形状（缺 nodes/edges）抛错。
 */
export function loadJsonModel(text, fileName = 'model.json') {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || !data.nodes || !data.edges) {
    throw new Error('JSON 文件缺少 nodes 或 edges 字段，不是可查看的 NIR JSON 模型');
  }

  const nodes = {};
  for (const [id, node] of Object.entries(data.nodes)) {
    const type = node.type || 'Unknown';
    const op = getOperatorInfo(type);
    const params = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'metadata') continue;
      params.push({
        key,
        label: FIELD_LABELS[key] || key,
        value: previewValue(value),
        present: true,
      });
    }
    const metadataText = {};
    for (const [key, value] of Object.entries(node.metadata || {})) {
      metadataText[key] = previewValue(value);
    }
    nodes[id] = {
      id,
      type,
      label: `${id}\n(${op ? op.label : type})`,
      params,
      metadataText,
      // '?' 为语言无关占位符,侧栏显示时按当前语言本地化(与 nirIO.formatType 一致)
      inputText: node.input_type ? Object.values(node.input_type).map((x) => (x ? x.join('×') : '?')).join(', ') : '?',
      outputText: node.output_type ? Object.values(node.output_type).map((x) => (x ? x.join('×') : '?')).join(', ') : '?',
      childCount: 0,
    };
  }

  const edges = data.edges.map((e) => (Array.isArray(e) ? [String(e[0]), String(e[1])] : [String(e.source), String(e.target)]));

  return {
    view: {
      nodes,
      edges,
      summary: {
        nodeCount: Object.keys(nodes).length,
        edgeCount: edges.length,
        knownTypes: 0,
        unknownTypes: 0,
      },
    },
    fileName,
  };
}
