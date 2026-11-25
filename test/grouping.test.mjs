/**
 * 成组与解组测试:
 * - 成组结构(组内边/跨组边/内部 Input/Output);
 * - 成组 -> 解组往返:节点集合、边集合、参数与原图相等(无名字冲突时不加后缀);
 * - 名字冲突加后缀;Input/Output 成员与单节点成组被拒绝;
 * - 多端口子图给 warnings,校验按官方单端口限制拦截导出;
 * - 多端口解组按类型匹配端口;
 * - 剪枝 + 成组 + 解组的撤销重做序列。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory, createNode, groupNodes, planGroupNodes,
  suggestGroupName, ungroupNode, validateDocument,
} from '../src/core/nir/index.js';
import { applyEditAction } from '../src/io/editorActions.js';
import { assertDocsEqual, makeGraph, makeNode, num } from './helpers.mjs';

/** input(8) -> linear -> scale -> output(4) */
function chainDoc() {
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [8]) }),
      linear: makeNode('Linear', { weight: num('f32', [4, 8], Array.from({ length: 32 }, (_, i) => i + 1)) }),
      scale: makeNode('Scale', { scale: num('f32', [4], [1, 2, 3, 4]) }),
      output: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['input', 'linear'], ['linear', 'scale'], ['scale', 'output']]),
  };
}

/** 边集合比较用:排序后的 [源,目标] 串清单 */
function edgeSet(doc) {
  return [...doc.graph.edgePairs].map(([a, b]) => `${a}->${b}`).sort();
}

/** 递归按名字排序 children 键(对象键顺序不影响文件内容,HDF5 按名字序存放) */
function normalize(doc) {
  const copy = structuredClone(doc);
  const walk = (n) => {
    if (n.children) {
      const sorted = {};
      for (const k of Object.keys(n.children).sort()) sorted[k] = walk(n.children[k]);
      n.children = sorted;
    }
    return n;
  };
  copy.graph = walk(copy.graph);
  return copy;
}

/** 忽略边顺序与 children 键序后比较两份文档(解组会重排边) */
function assertDocsEqualIgnoreEdgeOrder(a, b, label) {
  assert.deepEqual(edgeSet(a), edgeSet(b), `${label}: 边集合应相等`);
  const na = normalize(a);
  const nb = normalize(b);
  na.graph.edgePairs = [...na.graph.edgePairs].sort();
  nb.graph.edgePairs = [...nb.graph.edgePairs].sort();
  assertDocsEqual(na, nb, label);
}

describe('成组 groupNodes', () => {
  it('正向:中间两个节点编成组,组内边/跨组边/内部 IO 都正确', () => {
    const doc = chainDoc();
    const { doc: grouped, groupName } = groupNodes(doc, [], ['linear', 'scale'], { name: 'block' });
    assert.equal(groupName, 'block');
    // 父图:input -> block -> output
    assert.deepEqual(Object.keys(grouped.graph.children).sort(), ['block', 'input', 'output']);
    assert.deepEqual(edgeSet(grouped), ['block->output', 'input->block']);
    // 子图:成员 + 内部 input/output,边为 [input,linear],[linear,scale],[scale,output]
    const g = grouped.graph.children.block;
    assert.equal(g.type, 'NIRGraph');
    assert.deepEqual(Object.keys(g.children).sort(), ['input', 'linear', 'output', 'scale']);
    assert.deepEqual(g.edgePairs.map(([a, b]) => `${a}->${b}`).sort(), ['input->linear', 'linear->scale', 'scale->output']);
    // 内部 IO 的 shape 来自推断类型
    assert.deepEqual(Array.from(g.children.input.fields.shape.data), [8n]);
    assert.deepEqual(Array.from(g.children.output.fields.shape.data), [4n]);
    assert.equal(g.children.input.fields.shape.dtype, 'i64');
    assert.equal(g.children.output.fields.shape.dtype, 'i64');
    // 成员参数原样进组
    assert.deepEqual(Array.from(g.children.scale.fields.scale.data), [1, 2, 3, 4]);
    // 校验通过(单入单出)
    const v = validateDocument(grouped);
    assert.equal(v.ok, true, `成组后应通过校验: ${JSON.stringify(v.issues)}`);
    // 原文档不动
    assert.ok(doc.graph.children.linear, '原文档不应被改动');
  });

  it('名字自动建议:suggestGroupName 避开占用名', () => {
    const doc = chainDoc();
    assert.equal(suggestGroupName(doc, []), 'group');
    const g1 = groupNodes(doc, [], ['linear', 'scale'], { name: 'group' });
    assert.equal(suggestGroupName(g1.doc, []), 'group_1');
  });

  it('反向:单节点/含 Input/重名组名被拒绝且文档不变', () => {
    const doc = chainDoc();
    const snap = structuredClone(doc);
    assert.throws(() => groupNodes(doc, [], ['linear']), /至少要选 2 个/);
    assert.throws(() => groupNodes(doc, [], ['input', 'linear']), /边界|Input/);
    assert.throws(() => groupNodes(doc, [], ['linear', 'scale'], { name: 'linear' }), /已被占用/);
    assertDocsEqual(doc, snap, '被拒绝的成组不得改动文档');
  });

  it('多端口组:计划给 warnings,校验按官方单端口限制拦截', () => {
    // a(4) -> m1(4), b(8) -> m2(8);m1、m2 分别接自己的 output
    const doc = {
      version: '1.0.8',
      graph: makeGraph({
        a: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        b: makeNode('Scale', { scale: num('f32', [8], Array(8).fill(1)) }),
        m1: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        m2: makeNode('Scale', { scale: num('f32', [8], Array(8).fill(1)) }),
        out1: makeNode('Output', { shape: num('i64', [1], [4]) }),
        out2: makeNode('Output', { shape: num('i64', [1], [8]) }),
      }, [['a', 'm1'], ['b', 'm2'], ['m1', 'out1'], ['m2', 'out2']]),
    };
    const plan = planGroupNodes(doc, [], ['m1', 'm2'], { name: 'grp' });
    assert.equal(plan.ok, true);
    assert.equal(plan.inPortCount, 2);
    assert.equal(plan.outPortCount, 2);
    assert.equal(plan.warnings.length, 2, '双入双出应给两条官方限制警告');
    const grouped = groupNodes(doc, [], ['m1', 'm2'], { name: 'grp' }).doc;
    const v = validateDocument(grouped);
    assert.equal(v.ok, false, '多端口子图应被校验拦截(官方库读不回)');
    assert.ok(v.issues.some((i) => i.kind === 'subgraph-ports'), '应报 subgraph-ports 问题');
    // 解组还原(多端口按类型匹配端口)
    const { doc: restored } = ungroupNode(grouped, ['grp']);
    assertDocsEqualIgnoreEdgeOrder(doc, restored, '多端口组解组后应与原图相等');
  });

  it('动作分发:单入单出组没有 warnings,直接应用', () => {
    const doc = chainDoc();
    const paused = applyEditAction(doc, { kind: 'group', path: [], names: ['linear', 'scale'] });
    // 单入单出组没有 warnings,直接应用
    assert.equal(paused.applied, true);
    assert.ok(paused.doc.graph.children.group);
  });
});

describe('解组 ungroupNode', () => {
  it('往返:成组再解组,与原图在节点集合、边、参数上相等(名字不变)', () => {
    const doc = chainDoc();
    const { doc: grouped } = groupNodes(doc, [], ['linear', 'scale'], { name: 'block' });
    const { doc: restored, moved } = ungroupNode(grouped, ['block']);
    assert.deepEqual(moved.sort(), ['linear', 'scale']);
    assertDocsEqualIgnoreEdgeOrder(doc, restored, '往返后应与原图相等');
    // 参数逐位相等
    assert.deepEqual(Array.from(restored.graph.children.linear.fields.weight.data), Array.from(doc.graph.children.linear.fields.weight.data));
    assert.deepEqual(Array.from(restored.graph.children.scale.fields.scale.data), [1, 2, 3, 4]);
  });

  it('名字冲突:解组时成员名自动加后缀,边同步', () => {
    const doc = chainDoc();
    const { doc: grouped } = groupNodes(doc, [], ['linear', 'scale'], { name: 'block' });
    // 成组后往父图加一个叫 linear 的节点(挡住解组时的名字)
    const withConflict = createNode(grouped, { type: 'Linear', name: 'linear', inSize: 4, outSize: 2 });
    const { doc: restored, renamed } = ungroupNode(withConflict, ['block']);
    assert.deepEqual(renamed, [{ from: 'linear', to: 'linear_1' }]);
    assert.ok(restored.graph.children.linear_1, '成员被改名 linear_1');
    assert.ok(restored.graph.children.linear, '父图已有的 linear 不受影响');
    assert.ok(renamed && !restored.graph.children.block);
    // 边都指向 linear_1
    assert.ok(edgeSet(restored).includes('input->linear_1'));
    const v = validateDocument(restored);
    assert.equal(v.ok, true, `解组后应通过校验: ${JSON.stringify(v.issues)}`);
  });

  it('反向:不是子图的节点解组被拒绝', () => {
    const doc = chainDoc();
    assert.throws(() => ungroupNode(doc, ['linear']), /不是子图节点/);
  });

  it('多端口解组的类型匹配失败时拒绝(两个同形端口无法区分)', () => {
    const doc = {
      version: '1.0.8',
      graph: makeGraph({
        a: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        b: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        m1: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        m2: makeNode('Scale', { scale: num('f32', [4], [1, 1, 1, 1]) }),
        out1: makeNode('Output', { shape: num('i64', [1], [4]) }),
        out2: makeNode('Output', { shape: num('i64', [1], [4]) }),
      }, [['a', 'm1'], ['b', 'm2'], ['m1', 'out1'], ['m2', 'out2']]),
    };
    const grouped = groupNodes(doc, [], ['m1', 'm2'], { name: 'grp' }).doc;
    // 两个入端口 shape 同为 [4]:类型匹配不唯一,解组应拒绝并说明
    assert.throws(() => ungroupNode(grouped, ['grp']), /同形.*无法确定|无法确定/);
  });
});

describe('剪枝 + 成组 + 解组:撤销重做序列', () => {
  it('整个序列可逐步撤销回初始文档,可逐步重做到最终文档', () => {
    const doc = chainDoc();
    const h = createHistory(doc);

    // 1. 剪枝:scale 保留 [0,1]
    h.commit(
      applyEditAction(h.current, { kind: 'pruneChannels', path: ['scale'], axis: 'out', keep: [0, 1] }).doc,
      '通道剪枝 scale(保留 2 个通道)',
    );
    // 2. 成组
    h.commit(
      applyEditAction(h.current, { kind: 'group', path: [], names: ['linear', 'scale'], name: 'block' }).doc,
      '编成一组 block',
    );
    // 3. 解组
    h.commit(
      applyEditAction(h.current, { kind: 'ungroup', path: ['block'] }).doc,
      '展开子图 block',
    );
    const finalDoc = h.current;
    assert.equal(h.lastLabel(), '展开子图 block');

    // 逐步撤销到头:回到初始文档(同一引用)
    let back = h.current;
    while (h.canUndo()) back = h.undo();
    assert.equal(back, doc, 'undo 到底应回到初始文档(同一引用)');

    // 逐步重做到头:回到最终文档(同一引用)
    let fwd = back;
    while (h.canRedo()) fwd = h.redo();
    assert.equal(fwd, finalDoc, 'redo 到底应回到最终文档(同一引用)');
    assert.equal(h.nextRedoLabel(), '');

    // 撤销一步:回到成组状态(解组被撤销),可重做标签是"展开子图"
    h.undo();
    assert.ok(h.current.graph.children.block, '撤销一步后应回到成组状态');
    assert.equal(h.nextRedoLabel(), '展开子图 block');
    h.undo();
    assert.ok(h.current.graph.children.linear && h.current.graph.children.scale, '撤销两步后应回到剪枝后的平铺状态');
    assert.equal(h.lastLabel(), '通道剪枝 scale(保留 2 个通道)');
  });
});
