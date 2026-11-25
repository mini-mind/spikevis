/**
 * 文档校验:不改动文档,产出"问题清单 + 每节点类型",供界面标注与导出闸门使用。
 *
 * 三层检查(对照官方 nir 1.0.8 的行为实测定下):
 * 1. 图级形状推断(inferTypes 移植,规则与官方 infer_types 一致):失败抛错,
 *    这里捕获后转成 issue,并退化到逐边诊断(见第 3 层)。
 * 2. 节点级内部一致性(官方各类型 __post_init__ 的 assert 移植):神经元各参数
 *    数组必须同形、Linear/Affine 权重至少二维、卷积 padding 字符串只允许
 *    same/valid。官方库在 nir.read 时无条件执行这些断言(type_check=False 也
 *    会抛 AssertionError,已实测),所以导出闸门必须包含这一层。
 * 3. 逐边类型对照(推断失败时的退化诊断):用字段声明的输入/输出类型沿边比对,
 *    两端都已知且不一致的边标出 type-mismatch,界面上据此给边和节点标红。
 *
 * 返回 { ok, issues, types }:
 *   ok = true  当且仅当无任何 error 级 issue(推断通过 + 节点级检查通过);
 *   issues: [{ severity: 'error', kind, path?, edge?, message }];
 *   types: 推断成功用推断结果,失败用字段声明退化值(路径为键)。
 */

import { inferTypes } from './shape.js';
import { getOperatorInfo, valueToIntArray } from './operatorTable.js';
import { isStringDtype, valuesEqual } from './value.js';

/** 取节点字段声明的 (input, output) 类型;Input/Output 用 shape 字段 */
function declaredTypes(node) {
  if (node.type === 'Input' || node.type === 'Output') {
    const v = node.fields.shape;
    const t = v ? valueToIntArray(v) : null;
    return [t, t];
  }
  const opInfo = getOperatorInfo(node.type);
  if (!opInfo || !opInfo.deriveTypes) return [null, null];
  try {
    return opInfo.deriveTypes(node.fields || {});
  } catch (e) {
    // 字段本身坏到推导都崩(如维度不足),当作未知类型,由节点级检查负责报错
    return [null, null];
  }
}

/** 收集节点级问题(官方 __post_init__ 断言的移植) */
function nodeIssues(node, path, issues) {
  const fields = node.fields || {};
  const shapeOf = (name) => (fields[name] ? fields[name].shape : null);

  const sameShape = (names) => {
    const present = names.filter((n) => fields[n]);
    if (present.length === 0) return;
    const first = shapeOf(present[0]);
    for (const n of present.slice(1)) {
      const s = shapeOf(n);
      if (!s || !first || s.length !== first.length || s.some((d, i) => d !== first[i])) {
        const dims = present.map((n) => `${n}=[${shapeOf(n) ? shapeOf(n).join(',') : '?'}]`).join(', ');
        issues.push({
          severity: 'error',
          kind: 'node-shape',
          path,
          message: `节点 '${path}' 的参数形状不一致(官方要求同形): ${dims}`,
        });
        return;
      }
    }
  };

  const wInCheck = () => {
    const v = fields.w_in;
    if (!v) return;
    const s = v.shape;
    const scalarLike = s.length === 0 || (s.length === 1 && s[0] === 1);
    if (scalarLike) return;
    const ref = shapeOf('v_leak') || shapeOf('r');
    if (!ref || s.length !== ref.length || s.some((d, i) => d !== ref[i])) {
      issues.push({
        severity: 'error',
        kind: 'node-shape',
        path,
        message: `节点 '${path}' 的 w_in 形状 [${s.join(',')}] 与参数形状 [${ref ? ref.join(',') : '?'}] 不兼容(官方只接受标量或同形)`,
      });
    }
  };

  switch (node.type) {
    case 'LIF': sameShape(['tau', 'r', 'v_leak', 'v_threshold', 'v_reset']); break;
    case 'LI': sameShape(['tau', 'r', 'v_leak']); break;
    case 'IF': sameShape(['r', 'v_threshold', 'v_reset']); break;
    case 'CubaLIF':
      sameShape(['tau_syn', 'tau_mem', 'r', 'v_leak', 'v_threshold', 'v_reset']);
      wInCheck();
      break;
    case 'CubaLI':
      sameShape(['tau_syn', 'tau_mem', 'r', 'v_leak']);
      wInCheck();
      break;
    case 'Linear':
    case 'Affine': {
      const w = fields.weight;
      if (w && w.shape.length < 2) {
        issues.push({
          severity: 'error',
          kind: 'node-shape',
          path,
          message: `节点 '${path}' 的 weight 至少要二维(官方断言 Weight must be at least 2D),现在是 [${w.shape.join(',')}]`,
        });
      }
      break;
    }
    case 'Conv1d':
    case 'Conv2d': {
      const p = fields.padding;
      if (p && isStringDtype(p.dtype)) {
        const s = typeof p.data === 'string' ? p.data : p.data[0];
        if (s !== 'same' && s !== 'valid') {
          issues.push({
            severity: 'error',
            kind: 'node-shape',
            path,
            message: `节点 '${path}' 的 padding 字符串只允许 'same' 或 'valid'(官方断言),现在是 '${s}'`,
          });
        }
      }
      break;
    }
    default:
      break;
  }
}

/** 逐边对照:两端类型都声明且不一致的边报 type-mismatch */
function edgeIssues(graph, types, pathPrefix, issues) {
  const nodes = graph.children || {};
  const edges = graph.edgePairs || [];
  const qualify = (name) => (pathPrefix ? `${pathPrefix}.${name}` : name);
  for (const [src, dst] of edges) {
    const [srcIn, srcOut] = declaredTypes(nodes[src]);
    const [dstIn] = declaredTypes(nodes[dst]);
    if (srcOut && dstIn && (srcOut.length !== dstIn.length || srcOut.some((d, i) => d !== dstIn[i]))) {
      issues.push({
        severity: 'error',
        kind: 'type-mismatch',
        path: qualify(dst),
        edge: [qualify(src), qualify(dst)],
        message: `类型不一致: '${src}' 的输出 [${srcOut.join(',')}] 与 '${dst}' 的输入 [${dstIn.join(',')}] 对不上`,
      });
    }
  }
  for (const [name, node] of Object.entries(nodes)) {
    if (node.type === 'NIRGraph' && node.children) {
      edgeIssues(node, types, qualify(name), issues);
    }
  }
}

/** 字段声明的退化类型表(推断失败时给界面显示用) */
function declaredTypeMap(graph, types, pathPrefix) {
  const nodes = graph.children || {};
  const qualify = (name) => (pathPrefix ? `${pathPrefix}.${name}` : name);
  for (const [name, node] of Object.entries(nodes)) {
    const [input, output] = declaredTypes(node);
    types[qualify(name)] = { input: input ? [...input] : null, output: output ? [...output] : null };
    if (node.type === 'NIRGraph' && node.children) {
      declaredTypeMap(node, types, qualify(name));
    }
  }
}

/**
 * 子图端口检查(官方库实测依据):nir.read(type_check=True) 的类型检查只支持
 * 单入单出子图——内部 Input 或内部 Output 超过 1 个时,官方沿边核对
 * len(input_type)/len(output_type) 必然抛 type mismatch。导出闸门据此拦截,
 * 避免写出官方库读不回的文件。
 */
function subgraphPortIssues(graph, pathPrefix, issues) {
  for (const [name, node] of Object.entries(graph.children || {})) {
    const p = pathPrefix ? `${pathPrefix}.${name}` : name;
    if (node.type === 'NIRGraph' && node.children) {
      const nIn = Object.values(node.children).filter((c) => c.type === 'Input').length;
      const nOut = Object.values(node.children).filter((c) => c.type === 'Output').length;
      if (nIn > 1) {
        issues.push({
          severity: 'error',
          kind: 'subgraph-ports',
          path: p,
          message: `子图 '${p}' 有 ${nIn} 个内部 Input 节点;官方库类型检查只支持单入单出子图,导出后 nir.read 将失败(实测)`,
        });
      }
      if (nOut > 1) {
        issues.push({
          severity: 'error',
          kind: 'subgraph-ports',
          path: p,
          message: `子图 '${p}' 有 ${nOut} 个内部 Output 节点;官方库类型检查只支持单入单出子图,导出后 nir.read 将失败(实测)`,
        });
      }
      subgraphPortIssues(node, p, issues);
    }
  }
}

/**
 * 校验整份文档。不修改文档。
 * 返回 { ok, issues, types }。
 */
export function validateDocument(doc) {
  const issues = [];
  // 第 2 层:节点级内部一致性(无论推断是否成功都要做)
  const walkNodes = (graph, pathPrefix) => {
    for (const [name, node] of Object.entries(graph.children || {})) {
      const p = pathPrefix ? `${pathPrefix}.${name}` : name;
      nodeIssues(node, p, issues);
      if (node.type === 'NIRGraph' && node.children) walkNodes(node, p);
    }
  };
  walkNodes(doc.graph, '');
  subgraphPortIssues(doc.graph, '', issues);

  // 第 1 层:图级形状推断
  let types = {};
  let inferredOk = false;
  try {
    const { types: inferred } = inferTypes(doc);
    types = inferred;
    inferredOk = true;
  } catch (e) {
    issues.push({
      severity: 'error',
      kind: 'inference-failed',
      message: `形状推断失败: ${e.message}`,
    });
    declaredTypeMap(doc.graph, types, '');
    // 第 3 层:逐边退化诊断
    edgeIssues(doc.graph, types, '', issues);
  }

  return { ok: inferredOk && issues.length === 0, issues, types };
}

/**
 * 比较"原文档 -> 当前文档"里被改动的根图节点名(画布上的脏标记)。
 * 字段或元数据任何变化、以及边端点变化牵连的节点,都算被改动;新节点也算。
 */
export function changedNodeNames(originalDoc, currentDoc) {
  const changed = new Set();
  const beforeNodes = (originalDoc && originalDoc.graph.children) || {};
  const afterNodes = (currentDoc && currentDoc.graph.children) || {};
  const metaSame = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  for (const [name, after] of Object.entries(afterNodes)) {
    const before = beforeNodes[name];
    if (!before) {
      changed.add(name);
      continue;
    }
    const keys = new Set([...Object.keys(before.fields || {}), ...Object.keys(after.fields || {})]);
    let differs = !metaSame(before.metadata, after.metadata);
    for (const k of keys) {
      const va = (before.fields || {})[k];
      const vb = (after.fields || {})[k];
      if (!va || !vb || !valuesEqual(va, vb)) {
        differs = true;
        break;
      }
    }
    if (differs) changed.add(name);
  }
  // 边端点被牵连的节点:只标真正增删的边,不动其余
  const beforeEdges = ((originalDoc && originalDoc.graph.edgePairs) || []).map((e) => e.join('->'));
  const afterEdges = ((currentDoc && currentDoc.graph.edgePairs) || []).map((e) => e.join('->'));
  const beforeSet = new Set(beforeEdges);
  const afterSet = new Set(afterEdges);
  const touched = [];
  for (const key of beforeEdges) {
    if (!afterSet.has(key)) touched.push(key);
  }
  for (const key of afterEdges) {
    if (!beforeSet.has(key)) touched.push(key);
  }
  for (const key of touched) {
    const [a, b] = key.split('->');
    if (afterNodes[a]) changed.add(a);
    if (afterNodes[b]) changed.add(b);
  }
  return changed;
}
