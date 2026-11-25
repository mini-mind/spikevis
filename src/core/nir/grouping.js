/**
 * 成组与解组(纯函数):把选中的若干节点打包成嵌套子图节点(NIRGraph),或反向展开。
 *
 * 成组结构(依官方 nir 1.0.8 实测,见 README"成组与解组"一节):
 * - 组内边(两端都在选中集合里)进子图;
 * - 跨组边留在父图,端点换成子图节点名;
 * - 每个有跨组边接入的成员,子图内补一个内部 Input 节点(命名 input、input_1、
 *   input_2……避开成员名),shape 取该成员的推断输入类型;每个有跨组边接出的
 *   成员,补一个内部 Output 节点(命名 output、output_1……),shape 取推断输出类型;
 * - 实测约束:官方 nir.read(type_check=True) 的类型检查只支持单入单出子图
 *   (>1 个内部 Input 或 >1 个内部 Output 时必然抛 type mismatch)。本模块照常
 *   生成多端口子图(结构本身合法),但会在 plan 的 warnings 里明说,校验层也会
 *   把多端口子图标为 error 挡在导出闸门;
 * - 不允许把父图的 Input/Output 节点编入组(它们定义图的边界,包裹后官方库
 *   对根图入口的推断会退化到脆弱路径)。
 *
 * 解组:
 * - 成员节点放回父图,重名时按 _1、_2 加后缀;
 * - 组内成员间边还原成父图边;跨组边按子图的内部 Input/Output 端口还原:
 *   单端口直接映射;多端口按类型(shape)匹配,匹配不唯一或对不上则拒绝;
 * - 内部 Input/Output 节点本身丢弃(它们是成组时造出来的)。
 */

import { cloneGraph, inferTypes } from './shape.js';
import { makeNodeRecord } from './document.js';
import { assertValidName, graphAt } from './edits.js';
import { getOperatorInfo, valueToIntArray } from './operatorTable.js';

/** 建议一个不重名的组名:group、group_1、group_2…… */
export function suggestGroupName(doc, parentPath = []) {
  const graph = graphAt(doc, parentPath || []);
  const taken = new Set(Object.keys(graph.children || {}));
  if (!taken.has('group')) return 'group';
  let i = 1;
  while (taken.has(`group_${i}`)) i += 1;
  return `group_${i}`;
}

/** 在名字集合里找 input/output 系的不重名(避开 alreadyTaken) */
function uniqueIoName(base, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let i = 1;
  while (taken.has(`${base}_${i}`)) i += 1;
  const name = `${base}_${i}`;
  taken.add(name);
  return name;
}

function intShapeValue(shapeArr) {
  return { dtype: 'i64', shape: [shapeArr.length], data: new BigInt64Array(shapeArr.map((n) => BigInt(n))) };
}

function sameShape(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((d, i) => d === b[i]);
}

/** 节点字段直接推导的 (输入, 输出) 类型(整图推断失败时的兜底,与 validate.js 同源) */
function declaredMemberTypes(node) {
  const op = getOperatorInfo(node.type);
  if (!op || !op.deriveTypes) return [null, null];
  try {
    return op.deriveTypes(node.fields || {});
  } catch (e) {
    return [null, null];
  }
}

/**
 * 类型解析器:优先整图推断(与校验一致),推断失败(如文档里已有多端口子图时
 * 必失败)退化为逐节点字段推导。只推断一次,结果缓存。
 */
function makeTypesResolver(doc, parentPath, graph) {
  let inferred = null;
  let tried = false;
  const prefix = (parentPath || []).join('.');
  const keyOf = (m) => (prefix ? `${prefix}.${m}` : m);
  return (name) => {
    if (!tried) {
      tried = true;
      try {
        inferred = inferTypes(doc).types;
      } catch (e) {
        inferred = null;
      }
    }
    if (inferred) {
      const t = inferred[keyOf(name)];
      if (t) return [t.input, t.output];
    }
    return declaredMemberTypes(graph.children[name]);
  };
}

/**
 * 成组计划(不改文档):
 *   { ok, errors, warnings, groupName, inPortCount, outPortCount, memberCount }
 */
export function planGroupNodes(doc, parentPath, names, opts = {}) {
  const errors = [];
  const warnings = [];
  const graph = graphAt(doc, parentPath || []);

  if (!Array.isArray(names) || names.length < 2) {
    errors.push('成组至少要选 2 个节点');
  } else {
    const seen = new Set();
    for (const name of names) {
      if (typeof name !== 'string' || !graph.children[name]) {
        errors.push(`节点 '${name}' 不存在于当前图`);
        continue;
      }
      if (seen.has(name)) {
        errors.push(`节点 '${name}' 重复出现`);
        continue;
      }
      seen.add(name);
      const t = graph.children[name].type;
      if (t === 'Input' || t === 'Output') {
        errors.push(`不能把 '${name}'(${t})编入组:Input/Output 定义图的边界,包裹后官方库无法推断根图入口`);
      }
    }
  }

  let groupName = opts.name;
  if (groupName === undefined || groupName === null || groupName === '') {
    groupName = suggestGroupName(doc, parentPath || []);
  }
  try {
    assertValidName(groupName);
    if (groupName in graph.children) {
      errors.push(`组名 '${groupName}' 已被占用`);
    }
  } catch (e) {
    errors.push(`组名非法: ${e.message}`);
  }

  let inPortCount = 0;
  let outPortCount = 0;
  if (errors.length === 0) {
    // 端口形状:优先整图推断,失败时退化为逐节点字段推导
    const resolve = makeTypesResolver(doc, parentPath, graph);
    const memberSet = new Set(names);
    const inMembers = new Set();
    const outMembers = new Set();
    for (const [src, dst] of graph.edgePairs || []) {
      if (memberSet.has(src) && memberSet.has(dst)) continue; // 组内边
      if (memberSet.has(dst)) inMembers.add(dst);
      if (memberSet.has(src)) outMembers.add(src);
    }
    for (const m of inMembers) {
      const [input] = resolve(m);
      if (input === null || input === undefined) errors.push(`节点 '${m}' 的输入类型未知,无法确定子图输入端口的 shape;请先修好图`);
    }
    for (const m of outMembers) {
      const [, output] = resolve(m);
      if (output === null || output === undefined) errors.push(`节点 '${m}' 的输出类型未知,无法确定子图输出端口的 shape;请先修好图`);
    }
    inPortCount = inMembers.size;
    outPortCount = outMembers.size;
    // 官方库实测:nir.read(type_check=True) 只接受单入单出子图
    if (inPortCount > 1) {
      warnings.push(`该组将有 ${inPortCount} 个输入端口;官方库类型检查只支持单入单出子图,导出时会被校验闸门拦下`);
    }
    if (outPortCount > 1) {
      warnings.push(`该组将有 ${outPortCount} 个输出端口;官方库类型检查只支持单入单出子图,导出时会被校验闸门拦下`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    groupName,
    inPortCount,
    outPortCount,
    memberCount: Array.isArray(names) ? names.length : 0,
  };
}

/**
 * 成组:返回 { doc, groupName, plan }。plan.errors 非空时抛错(文档不动)。
 * plan.warnings 非空不阻止(由调用方决定是否先向用户确认)。
 */
export function groupNodes(doc, parentPath, names, opts = {}) {
  const plan = planGroupNodes(doc, parentPath || [], names, opts);
  if (!plan.ok) {
    throw new Error(`成组被拒绝: ${plan.errors.join('; ')}`);
  }
  const graph = graphAt(doc, parentPath || []);
  const groupName = plan.groupName;
  const memberSet = new Set(names);

  // 子图 children:成员的深拷贝
  const children = {};
  for (const m of names) children[m] = cloneGraph(graph.children[m]);

  // 跨组边 -> 内部 Input/Output 端口(形状与 plan 阶段同一来源)
  const taken = new Set(Object.keys(children));
  const internalEdges = [];
  const resolve = makeTypesResolver(doc, parentPath || [], graph);

  for (const [src, dst] of graph.edgePairs || []) {
    if (memberSet.has(src) && memberSet.has(dst)) {
      internalEdges.push([src, dst]); // 组内边
    }
  }
  for (const m of memberSet) {
    const [input, output] = resolve(m);
    const hasIn = (graph.edgePairs || []).some(([src, dst]) => dst === m && !memberSet.has(src));
    const hasOut = (graph.edgePairs || []).some(([src, dst]) => src === m && !memberSet.has(dst));
    if (hasIn) {
      if (input === null || input === undefined) throw new Error(`成组被拒绝: 节点 '${m}' 的输入类型未知,无法确定子图输入端口的 shape`);
      const nm = uniqueIoName('input', taken);
      const rec = makeNodeRecord('Input');
      rec.fields.shape = intShapeValue(input);
      children[nm] = rec;
      internalEdges.push([nm, m]);
    }
    if (hasOut) {
      if (output === null || output === undefined) throw new Error(`成组被拒绝: 节点 '${m}' 的输出类型未知,无法确定子图输出端口的 shape`);
      const nm = uniqueIoName('output', taken);
      const rec = makeNodeRecord('Output');
      rec.fields.shape = intShapeValue(output);
      children[nm] = rec;
      internalEdges.push([m, nm]);
    }
  }

  const groupRecord = makeNodeRecord('NIRGraph');
  groupRecord.children = children;
  groupRecord.edgePairs = internalEdges;

  // 父图:删成员、加组、跨组边改接组名(组内边从父图移除,已进子图)
  const nextDoc = transformParent(doc, parentPath || [], (parent) => {
    const newChildren = {};
    for (const [name, rec] of Object.entries(parent.children)) {
      if (!memberSet.has(name)) newChildren[name] = rec;
    }
    newChildren[groupName] = groupRecord;
    parent.children = newChildren;
    parent.edgePairs = (parent.edgePairs || [])
      .filter(([src, dst]) => !(memberSet.has(src) && memberSet.has(dst)))
      .map(([src, dst]) => [
        memberSet.has(src) ? groupName : src,
        memberSet.has(dst) ? groupName : dst,
      ]);
    parent.edges = null;
  });
  return { doc: nextDoc, groupName, plan };
}

/**
 * 解组:groupPath 指向子图节点(如 ['group'])。返回 { doc, moved, renamed }。
 * 名字冲突时成员名加 _1、_2 后缀(renamed 记录映射)。
 */
export function ungroupNode(doc, groupPath) {
  const parentPath = (groupPath || []).slice(0, -1);
  const gname = groupPath[groupPath.length - 1];
  const graph = graphAt(doc, parentPath || []);
  const group = graph.children[gname];
  if (!group || group.type !== 'NIRGraph' || !group.children) {
    throw new Error(`ungroupNode: '${gname}' 不是子图节点`);
  }
  if (!Array.isArray(group.edgePairs)) {
    throw new Error(`ungroupNode: 子图 '${gname}' 缺少边列表`);
  }

  // 多端口组的类型匹配:优先整图推断,失败(多端口子图必失败)退化为字段推导
  const resolve = makeTypesResolver(doc, parentPath || [], graph);
  const typeOf = (name) => resolve(name)[1];
  const inTypeOf = (name) => resolve(name)[0];

  // 子图的内部端口:每个 Input/Output 节点必须恰好一条内边
  const inputs = [];
  const outputs = [];
  const memberNames = [];
  for (const [nm, rec] of Object.entries(group.children)) {
    if (rec.type === 'Input') {
      const outs = group.edgePairs.filter(([a]) => a === nm);
      if (outs.length !== 1) {
        throw new Error(`ungroupNode: 子图内部 Input '${nm}' 应恰有一条出边,现在有 ${outs.length} 条`);
      }
      inputs.push({ name: nm, target: outs[0][1], shape: valueToIntArray(rec.fields.shape) });
    } else if (rec.type === 'Output') {
      const ins = group.edgePairs.filter(([, b]) => b === nm);
      if (ins.length !== 1) {
        throw new Error(`ungroupNode: 子图内部 Output '${nm}' 应恰有一条入边,现在有 ${ins.length} 条`);
      }
      outputs.push({ name: nm, source: ins[0][0], shape: valueToIntArray(rec.fields.shape) });
    } else {
      memberNames.push(nm);
    }
  }

  // 成员放回父图:重名加后缀
  const taken = new Set(Object.keys(graph.children).filter((n) => n !== gname));
  const mapping = {};
  const renamed = [];
  for (const m of memberNames) {
    let nm = m;
    if (taken.has(nm)) {
      let i = 1;
      while (taken.has(`${m}_${i}`)) i += 1;
      nm = `${m}_${i}`;
      renamed.push({ from: m, to: nm });
    }
    taken.add(nm);
    mapping[m] = nm;
  }

  // 跨组边还原(端点是成员在父图里的新名字,要套冲突改名映射)
  const parentEdges = graph.edgePairs || [];
  const inEdges = parentEdges.filter(([, b]) => b === gname);
  const outEdges = parentEdges.filter(([a]) => a === gname);
  const mapInTarget = (srcName) => {
    if (inputs.length === 0) {
      throw new Error(`ungroupNode: 父图有指向 '${gname}' 的边,但子图没有内部 Input 节点,无法还原`);
    }
    let member;
    if (inputs.length === 1) {
      member = inputs[0].target;
    } else {
      const srcOut = typeOf(srcName);
      const matches = srcOut ? inputs.filter((p) => sameShape(p.shape, srcOut)) : [];
      if (matches.length === 0) {
        throw new Error(`ungroupNode: 边 ${srcName} -> ${gname} 找不到 shape 匹配的内部 Input 端口(边类型 [${srcOut}],组内端口 [${inputs.map((p) => p.shape).join('], [')}])`);
      }
      if (matches.length > 1) {
        throw new Error(`ungroupNode: '${gname}' 有 ${matches.length} 个同形内部 Input 端口,无法确定边 ${srcName} -> ${gname} 对应哪个`);
      }
      member = matches[0].target;
    }
    if (mapping[member] === undefined) {
      throw new Error(`ungroupNode: 内部 Input 端口指向的 '${member}' 不是组内成员,无法还原`);
    }
    return mapping[member];
  };
  const mapOutSource = (dstName) => {
    if (outputs.length === 0) {
      throw new Error(`ungroupNode: 父图有 '${gname}' 出发的边,但子图没有内部 Output 节点,无法还原`);
    }
    let member;
    if (outputs.length === 1) {
      member = outputs[0].source;
    } else {
      const dstIn = inTypeOf(dstName);
      const matches = dstIn ? outputs.filter((p) => sameShape(p.shape, dstIn)) : [];
      if (matches.length === 0) {
        throw new Error(`ungroupNode: 边 ${gname} -> ${dstName} 找不到 shape 匹配的内部 Output 端口(边类型 [${dstIn}],组内端口 [${outputs.map((p) => p.shape).join('], [')}])`);
      }
      if (matches.length > 1) {
        throw new Error(`ungroupNode: '${gname}' 有 ${matches.length} 个同形内部 Output 端口,无法确定边 ${gname} -> ${dstName} 对应哪个`);
      }
      member = matches[0].source;
    }
    if (mapping[member] === undefined) {
      throw new Error(`ungroupNode: 内部 Output 端口来自的 '${member}' 不是组内成员,无法还原`);
    }
    return mapping[member];
  };

  const mappedIn = inEdges.map(([src]) => [src, mapInTarget(src)]);
  const mappedOut = outEdges.map(([, dst]) => [mapOutSource(dst), dst]);
  // 组内成员边从子图边表还原;跨组边按父图当前顺序逐条替换。
  // (成组时组内边已从父图移除,原相对顺序不可恢复;解组按
  //  [组内边..., 跨组边(父图原序)...] 排列,内容与成组前的边集合相等。)
  const internalRestored = group.edgePairs
    .filter(([a, b]) => mapping[a] !== undefined && mapping[b] !== undefined)
    .map(([a, b]) => [mapping[a], mapping[b]]);
  const newEdges = [...internalRestored];
  let inIdx = 0;
  let outIdx = 0;
  for (const [a, b] of parentEdges) {
    if (b === gname) {
      newEdges.push(mappedIn[inIdx]);
      inIdx += 1;
    } else if (a === gname) {
      newEdges.push(mappedOut[outIdx]);
      outIdx += 1;
    } else {
      newEdges.push([a, b]);
    }
  }

  const nextDoc = transformParent(doc, parentPath || [], (parent) => {
    const newChildren = {};
    for (const [name, rec] of Object.entries(parent.children)) {
      if (name === gname) continue;
      newChildren[name] = rec;
    }
    for (const [m, nm] of Object.entries(mapping)) {
      newChildren[nm] = cloneGraph(group.children[m]);
    }
    parent.children = newChildren;
    parent.edgePairs = newEdges;
    parent.edges = null;
  });
  return { doc: nextDoc, moved: memberNames, renamed };
}

/** 在指定父图上做一次结构变换(深拷贝 + mutator + 冻结),供本模块两个操作共用 */
function transformParent(doc, parentPath, mutator) {
  const cloned = cloneGraph(doc.graph);
  let target = cloned;
  for (const name of parentPath) {
    target = target.children[name];
  }
  mutator(target);
  return deepFreeze({ version: doc.version, graph: cloned });
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    if (ArrayBuffer.isView(obj)) return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) deepFreeze(obj[key]);
  }
  return obj;
}
