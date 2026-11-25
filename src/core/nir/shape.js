/**
 * 形状推断与检查：移植官方 nir.NIRGraph.infer_types / check_types 的规则
 * （nir 1.0.8, nir/ir/graph.py + utils.py），行为逐条对齐：
 *
 * - 边两端必须指向存在的节点；重复边报错（validate_structure）；
 * - 根节点（没有任何入边）若不是 Input，需要其 input_type 已知，
 *   然后自动前置名为 input_<名> 的 Input 节点（重名时加 _0、_1 后缀）；
 * - 叶节点（没有任何出边）若不是 Output，需要其 output_type 已知，
 *   自动补名为 output_<名> 的 Output 节点；
 * - 沿边把前驱的输出类型抄给后继的输入类型；Output 的输出类型强制等于其输入类型；
 * - 类型不一致抛错（单端口；多端口官方也未支持）；
 * - Conv1d/Conv2d 逐维 floor((in + 2*padding - dilation*(kernel-1) - 1)/stride + 1)，
 *   输出通道 = weight.shape[0]；padding 'same' 时输出等于输入，'valid' 时 p=0；
 *   推断时会把 input_shape 字段补写进 Conv 节点（与官方一致）；
 * - 池化同公式且 dilation=1，通道数沿用输入；
 * - Flatten 压平 start_dim..end_dim 并断言元素数不变；
 * - 其余算子不推断（字段已给出类型的除外，见算子表 deriveTypes）。
 *
 * 本模块是纯函数：不修改传入文档，返回 { doc, types }。
 * types 以节点路径（嵌套子图用点号连接）为键：
 *   types[path] = { input: number[]|null, output: number[]|null }
 */

import { getOperatorInfo, valueToIntArray, calculateConvOutput, calcFlattenOutput } from './operatorTable.js';

/** 从节点字段推导 (input, output)，图节点交给图推断 */
function deriveFieldTypes(node) {
  const opInfo = getOperatorInfo(node.type);
  if (!opInfo || !opInfo.deriveTypes) return [null, null];
  return opInfo.deriveTypes(node.fields || {});
}

/** 类型是否"未知"（官方判断 input_type/output_type 为 None 或含 None） */
function typeUnknown(t) {
  return t === null || t === undefined || t.some((x) => x === null || x === undefined);
}

function typesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 生成不重名的 input_/output_ 节点名（对应官方的重名循环） */
function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  let i = 0;
  let name = `${base}_${i}`;
  while (taken.has(name)) {
    i += 1;
    name = `${base}_${i}`;
  }
  return name;
}

function makeInputNode(shape) {
  return {
    type: 'Input',
    fields: { shape: { dtype: 'i64', shape: [shape.length], data: new BigInt64Array(shape.map((n) => BigInt(n))) } },
    otherDatasets: {},
    metadata: {},
    children: null,
    edges: null,
    edgePairs: null,
    otherGroups: {},
  };
}

function makeOutputNode(shape) {
  return {
    type: 'Output',
    fields: { shape: { dtype: 'i64', shape: [shape.length], data: new BigInt64Array(shape.map((n) => BigInt(n))) } },
    otherDatasets: {},
    metadata: {},
    children: null,
    edges: null,
    edgePairs: null,
    otherGroups: {},
  };
}

/**
 * 对单个图节点做推断（对应官方 infer_types 的图级逻辑，含嵌套子图递归）。
 * graph 为文档中的图节点记录；直接在克隆后的记录上工作（调用方保证已克隆）。
 * pathPrefix 用于 types 键名。
 * 抛错条件与官方一致；错误信息用中文并写明节点。
 */
function inferGraph(graph, types, pathPrefix) {
  const nodes = graph.children;
  const edges = graph.edgePairs;
  if (!nodes || Object.keys(nodes).length === 0) {
    return; // 官方：空图直接返回
  }

  // validate_structure
  for (const [src, dst] of edges) {
    if (!(src in nodes)) {
      throw new Error(`edge (${src}, ${dst}) references source node '${src}' which does not exist`);
    }
    if (!(dst in nodes)) {
      throw new Error(`edge (${src}, ${dst}) references target node '${dst}' which does not exist`);
    }
  }
  const seenEdges = new Set();
  for (const [src, dst] of edges) {
    const key = `${src}->${dst}`;
    if (seenEdges.has(key)) {
      throw new Error(`duplicate edge: (${src}, ${dst})`);
    }
    seenEdges.add(key);
  }

  const pathOf = (name) => (pathPrefix ? `${pathPrefix}.${name}` : name);

  // 每个节点当前已知的 (input, output)
  const localTypes = {};
  for (const [name, node] of Object.entries(nodes)) {
    if (node.type === 'NIRGraph') {
      // 子图类型从其 Input/Output 节点取（官方 NIRGraph.input_type 语义）
      inferGraph(node, types, pathOf(name));
      const innerInput = Object.entries(node.children)
        .filter(([, n]) => n.type === 'Input')
        .map(([k, n]) => [k, valueToIntArray(n.fields.shape)]);
      const innerOutput = Object.entries(node.children)
        .filter(([, n]) => n.type === 'Output')
        .map(([k, n]) => [k, valueToIntArray(n.fields.shape)]);
      const firstIn = innerInput.length > 0 ? innerInput[0][1] : null;
      const firstOut = innerOutput.length > 0 ? innerOutput[0][1] : null;
      localTypes[name] = { input: firstIn, output: firstOut };
    } else {
      const [input, output] = deriveFieldTypes(node);
      localTypes[name] = { input, output };
    }
  }

  // 根节点必须是 Input，否则自动前置 input_<名>
  const destinationNodes = new Set(edges.map((e) => e[1]));
  const rootNodes = Object.keys(nodes).filter((n) => !destinationNodes.has(n));
  const newNodes = {};
  const newEdges = [];
  for (const rootKey of rootNodes) {
    const t = localTypes[rootKey];
    if (nodes[rootKey].type !== 'Input') {
      if (typeUnknown(t.input)) {
        throw new Error(`root node '${rootKey}' is not an Input node and has no defined input_type; cannot infer graph input`);
      }
      const inputNodeName = uniqueName(`input_${rootKey}`, new Set([...Object.keys(nodes), ...Object.keys(newNodes)]));
      newNodes[inputNodeName] = makeInputNode(t.input);
      newEdges.push([inputNodeName, rootKey]);
    } else if (typeUnknown(t.input)) {
      throw new Error(`Input node '${rootKey}' has no defined input_type; cannot infer graph without input types`);
    }
  }
  if (Object.keys(newNodes).length > 0) {
    Object.assign(nodes, newNodes);
    edges.push(...newEdges);
    for (const [name, node] of Object.entries(newNodes)) {
      const [input, output] = deriveFieldTypes(node);
      localTypes[name] = { input, output };
    }
  }

  // 从 Input 节点开始传播（官方用栈式遍历；顺序不影响最终结果）
  const inputsSet = new Set(Object.keys(nodes).filter((n) => nodes[n].type === 'Input'));
  let ready = edges.filter((e) => inputsSet.has(e[0]));
  if (ready.length === 0) {
    throw new Error('failed to start type inference: no input nodes found (cyclic dependency at graph input?)');
  }
  const seen = new Set(ready.map((e) => e[0]));
  while (ready.length > 0) {
    const [preKey, postKey] = ready.pop();
    const postNode = nodes[postKey];
    const preTypes = localTypes[preKey];
    const postTypes = localTypes[postKey];

    if (postNode.type === 'NIRGraph') {
      // 子图已在上面递归推断过；这里只做边上的类型核对
    }

    const undefPostInput = typeUnknown(postTypes.input);
    const mismatch = !undefPostInput && (
      preTypes.output === null
      || postTypes.input.length !== preTypes.output.length
      || !typesEqual(postTypes.input, preTypes.output)
    );
    if (undefPostInput) {
      if (preTypes.output === null) {
        throw new Error(`type inference error: pre node '${preKey}' has no output type for edge (${preKey}, ${postKey})`);
      }
      postTypes.input = [...preTypes.output];
    } else if (mismatch) {
      throw new Error(`type inference error: type mismatch: ${preKey}.output: [${preTypes.output}] -> ${postKey}.input: [${postTypes.input}]`);
    }

    // Output 的输出类型强制等于输入类型
    if (postNode.type === 'Output') {
      postTypes.output = [...postTypes.input];
    }

    // 未知的输出类型：Conv/Pool/Flatten 按官方公式计算
    if (typeUnknown(postTypes.output) && postNode.type !== 'NIRGraph') {
      if (postNode.type === 'Conv1d' || postNode.type === 'Conv2d') {
        const wDims = postNode.fields.weight.shape;
        const inSpatial = postNode.type === 'Conv1d'
          ? postTypes.input[1]
          : postTypes.input.slice(1);
        const padding = convParamOf(postNode.fields.padding);
        const dilation = convParamOf(postNode.fields.dilation);
        const stride = convParamOf(postNode.fields.stride);
        const outSpatial = calculateConvOutput(inSpatial, padding, dilation, wDims.slice(2), stride);
        postTypes.output = [wDims[0], ...outSpatial];
        // 官方推断会补写 input_shape 字段：Conv1d 是标量整数，Conv2d 是空间元组数组
        postNode.fields.input_shape = postNode.type === 'Conv1d'
          ? { dtype: 'i64', shape: [], data: new BigInt64Array([BigInt(inSpatial)]) }
          : intArrayValue(inSpatial);
      } else if (postNode.type === 'SumPool2d' || postNode.type === 'AvgPool2d') {
        const inSpatial = preTypes.output.slice(1);
        const padding = convParamOf(postNode.fields.padding);
        const kernel = convParamOf(postNode.fields.kernel_size);
        const stride = convParamOf(postNode.fields.stride);
        const outSpatial = calculateConvOutput(inSpatial, padding, 1, kernel, stride);
        postTypes.output = [postTypes.input[0], ...outSpatial];
      } else if (postNode.type === 'Flatten') {
        const start = postNode.fields.start_dim ? valueToIntArray(postNode.fields.start_dim)[0] : 1;
        const end = postNode.fields.end_dim ? valueToIntArray(postNode.fields.end_dim)[0] : -1;
        const out = calcFlattenOutput(postTypes.input, start, end);
        const prod = (xs) => xs.reduce((a, b) => a * b, 1);
        if (prod(postTypes.input) !== prod(out)) {
          throw new Error(`Flatten must not change the number of elements (node '${postKey}')`);
        }
        postTypes.output = out;
        // 官方推断会把 input_type 字段补写进 Flatten 节点
        postNode.fields.input_type = intArrayValue(postTypes.input);
      }
    }

    types[pathOf(postKey)] = { input: postTypes.input ? [...postTypes.input] : null, output: postTypes.output ? [...postTypes.output] : null };

    seen.add(postKey);
    for (const e of edges) {
      if (e[0] === postKey && !seen.has(e[1])) {
        ready.push(e);
      }
    }
  }

  // 叶节点必须是 Output，否则自动补 output_<名>
  const sourceNodes = new Set(edges.map((e) => e[0]));
  const leafNodes = Object.keys(nodes).filter((n) => !sourceNodes.has(n));
  if (leafNodes.length === 0) {
    throw new Error('type inference failed: no output nodes found (cyclic dependency at graph output?)');
  }
  const newLeafNodes = {};
  const newLeafEdges = [];
  for (const leafKey of leafNodes) {
    const t = localTypes[leafKey];
    if (nodes[leafKey].type !== 'Output') {
      if (typeUnknown(t.output)) {
        throw new Error(`leaf node '${leafKey}' is not an Output node and has no defined output_type; cannot infer graph output`);
      }
      const outputNodeName = uniqueName(`output_${leafKey}`, new Set([...Object.keys(nodes), ...Object.keys(newLeafNodes)]));
      newLeafNodes[outputNodeName] = makeOutputNode(t.output);
      newLeafEdges.push([leafKey, outputNodeName]);
    }
  }
  if (Object.keys(newLeafNodes).length > 0) {
    Object.assign(nodes, newLeafNodes);
    edges.push(...newLeafEdges);
    for (const [name, node] of Object.entries(newLeafNodes)) {
      const [input, output] = deriveFieldTypes(node);
      localTypes[name] = { input, output };
      types[pathOf(name)] = { input, output };
    }
  }

  // 落盘所有节点的最终类型
  for (const [name, t] of Object.entries(localTypes)) {
    const p = pathOf(name);
    if (!types[p]) {
      types[p] = { input: t.input ? [...t.input] : null, output: t.output ? [...t.output] : null };
    }
  }
}

function convParamOf(value) {
  if (!value) return null;
  if (typeof value.data === 'string') return value.data;
  if (Array.isArray(value.data)) return value.data[0];
  return valueToIntArray(value);
}

function intArrayValue(arr) {
  return { dtype: 'i64', shape: [arr.length], data: new BigInt64Array(arr.map((n) => BigInt(n))) };
}

/**
 * 对整份文档做形状推断。
 * 返回 { doc: 新文档（克隆，含补写与自动加的节点）, types: {路径: {input, output}} }。
 * 推断失败抛 Error（与官方 infer_types 的报错条件一致）。
 */
export function inferTypes(doc) {
  const graph = cloneGraph(doc.graph);
  const types = {};
  inferGraph(graph, types, '');
  const newDoc = { version: doc.version, graph };
  return { doc: newDoc, types };
}

/** 深拷贝图节点记录（推断与文档更新共用） */
export function cloneGraph(node) {
  const copy = {
    type: node.type,
    fields: {},
    otherDatasets: {},
    metadata: {},
    children: null,
    edges: node.edges || null,
    edgePairs: node.edgePairs ? node.edgePairs.map((e) => [...e]) : null,
    otherGroups: {},
  };
  for (const [k, v] of Object.entries(node.fields || {})) copy.fields[k] = { ...v };
  for (const [k, v] of Object.entries(node.otherDatasets || {})) copy.otherDatasets[k] = { ...v };
  for (const [k, v] of Object.entries(node.metadata || {})) copy.metadata[k] = v;
  for (const [k, v] of Object.entries(node.otherGroups || {})) copy.otherGroups[k] = v;
  if (node.children) {
    copy.children = {};
    for (const [k, v] of Object.entries(node.children)) copy.children[k] = cloneGraph(v);
  }
  return copy;
}

/**
 * checkTypes：推断之后调用，与官方 check_types 一致地核对每条边两端类型一致。
 * types 为 inferTypes 的返回值；有子图时对子图内部同样核对。
 */
export function checkTypes(graph, types, pathPrefix = '') {
  const nodes = graph.children;
  const edges = graph.edgePairs;
  const qualify = (name) => (pathPrefix ? `${pathPrefix}.${name}` : name);
  for (const [src, dst] of edges) {
    const pre = types[qualify(src)];
    const post = types[qualify(dst)];
    if (!pre || !post) {
      throw new Error(`checkTypes: missing inferred type for '${src}' or '${dst}'`);
    }
    if (pre.output === null) throw new Error(`pre node ${src} has no output type`);
    if (post.input === null) throw new Error(`post node ${dst} has no input type`);
    if (pre.output.length !== post.input.length) {
      throw new Error(`type length mismatch: len(${src}.output)=${pre.output.length} -> len(${dst}.input)=${post.input.length}`);
    }
    if (!typesEqual(pre.output, post.input)) {
      throw new Error(`type mismatch: ${src}.output: [${pre.output}] -> ${dst}.input: [${post.input}]`);
    }
  }
  for (const [name, node] of Object.entries(nodes || {})) {
    if (node.type === 'NIRGraph') {
      checkTypes(node, types, qualify(name));
    }
  }
  return true;
}
