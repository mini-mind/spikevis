/**
 * 编辑操作测试:每个操作至少一个正向用例和一个反向用例;
 * 非法输入必须被拒绝,且文档保持不变(与操作前的深拷贝快照逐项相等)。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, connectEdge, createHistory, createNode, disconnectEdge, disconnectWarnings,
  makeNodeRecord, removeNode, renameNodeChecked, scaleField, suggestNodeName,
  setFieldIndices, setFieldUniform, setIntArrayField, setScalarField, setSimpleMetadata,
  setStringField, describeField,
} from '../src/core/nir/index.js';
import { applyEditAction } from '../src/io/editorActions.js';
import { assertDocsEqual, makeGraph, makeNode, num, strVal } from './helpers.mjs';

/** 操作前的深拷贝快照(抓"被拒绝还改了文档"的事故) */
function snapshot(doc) {
  return structuredClone(doc);
}

function chainDoc() {
  // input(4) -> lif(4) -> output(4),外加一个孤立Delay备删
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [4]) }),
      lif: makeNode('LIF', {
        tau: num('f32', [4], [1, 1, 1, 1]),
        r: num('f32', [4], [1, 1, 1, 1]),
        v_leak: num('f32', [4], [0, 0, 0, 0]),
        v_threshold: num('f32', [4], [1, 1, 1, 1]),
        v_reset: num('f32', [4], [0, 0, 0, 0]),
      }),
      delay: makeNode('Delay', { delay: num('f32', [4], [0, 0, 0, 0]) }),
      output: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['input', 'lif'], ['lif', 'output']]),
  };
}

function expectRejected(fn, doc, re) {
  const snap = snapshot(doc);
  assert.throws(fn, re, '非法输入应当抛错');
  assertDocsEqual(doc, snap, '被拒绝的操作不得改动文档');
}

describe('新建节点 createNode', () => {
  it('正向:按缺省值建 LIF,名字自动建议', () => {
    const doc = chainDoc();
    const next = createNode(doc, { type: 'LIF', shape: [8] });
    assert.equal(next.graph.children.lif_1.type, 'LIF');
    const f = next.graph.children.lif_1.fields;
    assert.equal(f.tau.dtype, 'f32');
    assert.deepEqual(f.tau.shape, [8], '形状必须是一维 [8]');
    assert.equal(f.tau.data.length, 8);
    assert.deepEqual(Array.from(f.v_reset.data), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.ok(next.graph.edgePairs.every(([a, b]) => a !== 'lif_1' && b !== 'lif_1'), '新节点不连边');
  });

  it('正向:Linear 按输入输出维度建权重', () => {
    const doc = chainDoc();
    const next = createNode(doc, { type: 'Linear', inSize: 4, outSize: 2, name: 'proj' });
    assert.deepEqual(next.graph.children.proj.fields.weight.shape, [2, 4]);
  });

  it('反向:重名拒绝;非法名字拒绝;未知类型拒绝', () => {
    const doc = chainDoc();
    expectRejected(() => createNode(doc, { type: 'LIF', shape: [4], name: 'lif' }), doc, /already exists/);
    expectRejected(() => createNode(doc, { type: 'LIF', shape: [4], name: 'a/b' }), doc, /must not contain/);
    expectRejected(() => createNode(doc, { type: 'NIRGraph', name: 'x' }), doc, /unknown node type|unsupported node type/);
    expectRejected(() => createNode(doc, { type: 'LIF', shape: [] }), doc, /channel count/);
  });

  it('suggestNodeName 避开占用名', () => {
    const doc = chainDoc();
    assert.equal(suggestNodeName(doc, [], 'Input'), 'input_1', "'input' 已被占用");
    assert.equal(suggestNodeName(doc, [], 'LIF'), 'lif_1', "'lif' 已被占用");
    assert.equal(suggestNodeName(doc, [], 'Conv1d'), 'conv1d', '未占用的类型名直接用');
  });
});

describe('删除节点 removeNode', () => {
  it('正向:删节点同步删相连边', () => {
    const doc = chainDoc();
    const next = removeNode(doc, 'lif');
    assert.ok(!next.graph.children.lif);
    assert.deepEqual(next.graph.edgePairs, []);
    assert.ok(next.graph.children.input && next.graph.children.output, '其余节点保留');
  });

  it('反向:删不存在的节点拒绝且文档不变', () => {
    const doc = chainDoc();
    expectRejected(() => removeNode(doc, 'ghost'), doc, /not found/);
  });

  it('disconnectWarnings:删链中节点给全量预警,删孤立节点无预警', () => {
    const doc = chainDoc();
    const warns = disconnectWarnings(doc, [], 'lif');
    // 删 lif 后 input 到不了 output:input 与 output 都进预警
    assert.deepEqual(warns.sort(), [
      "节点 'input' 删除后将无法到达任何 Output",
      "节点 'output' 删除后将无法从任何 Input 到达",
    ]);
    assert.deepEqual(disconnectWarnings(doc, [], 'delay'), [], '孤立节点删除无预警');
    // 删除前图就没有 Input 时,不报老问题
    const broken = removeNode(chainDoc(), 'input');
    assert.deepEqual(disconnectWarnings(broken, [], 'lif'), []);
  });
});

describe('连线 connectEdge / 断线 disconnectEdge', () => {
  it('正向:加一条边', () => {
    const doc = chainDoc();
    const next = connectEdge(doc, [], 'input', 'delay');
    assert.deepEqual(next.graph.edgePairs, [['input', 'lif'], ['lif', 'output'], ['input', 'delay']]);
  });

  it('反向:自环、重复边、指向 Input、从 Output 出发、端点不存在,全部拒绝', () => {
    const doc = chainDoc();
    expectRejected(() => connectEdge(doc, [], 'lif', 'lif'), doc, /self-loop/);
    expectRejected(() => connectEdge(doc, [], 'input', 'lif'), doc, /duplicate edge/);
    expectRejected(() => connectEdge(doc, [], 'lif', 'input'), doc, /must not point at Input/);
    expectRejected(() => connectEdge(doc, [], 'output', 'lif'), doc, /must not leave Output/);
    expectRejected(() => connectEdge(doc, [], 'ghost', 'lif'), doc, /does not exist/);
  });

  it('环:造环的边被接受(官方库实测接受带环图)', () => {
    // input -> delay -> lif 加上 lif -> delay,构成 delay 与 lif 之间的真环
    const doc = chainDoc();
    const d3 = connectEdge(doc, [], 'input', 'delay');
    const d4 = connectEdge(d3, [], 'delay', 'lif');
    const d5 = connectEdge(d4, [], 'lif', 'delay');
    const pairs = d5.graph.edgePairs;
    assert.ok(pairs.some(([a, b]) => a === 'delay' && b === 'lif'));
    assert.ok(pairs.some(([a, b]) => a === 'lif' && b === 'delay'));
  });

  it('反向:断不存在的边拒绝', () => {
    const doc = chainDoc();
    expectRejected(() => disconnectEdge(doc, [], 'input', 'output'), doc, /does not exist/);
    const next = disconnectEdge(doc, [], 'input', 'lif');
    assert.deepEqual(next.graph.edgePairs, [['lif', 'output']]);
  });
});

describe('重命名 renameNodeChecked', () => {
  it('正向:重命名同步边', () => {
    const doc = chainDoc();
    const next = renameNodeChecked(doc, [], 'lif', 'neuron_a');
    assert.ok(next.graph.children.neuron_a);
    assert.ok(!next.graph.children.lif);
    assert.deepEqual(next.graph.edgePairs, [['input', 'neuron_a'], ['neuron_a', 'output']]);
  });

  it('反向:重名、空名、带斜杠的名字拒绝', () => {
    const doc = chainDoc();
    expectRejected(() => renameNodeChecked(doc, [], 'lif', 'input'), doc, /already exists/);
    expectRejected(() => renameNodeChecked(doc, [], 'lif', '  '), doc, /non-empty/);
    expectRejected(() => renameNodeChecked(doc, [], 'lif', 'a/b'), doc, /must not contain/);
  });
});

describe('参数编辑', () => {
  it('setScalarField 正向:标量赋值,缺省字段按类型建 i64', () => {
    const doc = chainDoc();
    const d2 = addNode(doc, 'conv', makeNode('Conv1d', {
      weight: num('f32', [4, 4, 3], new Float32Array(48)),
      stride: num('i64', [], [1]),
      padding: strVal('valid'),
      dilation: num('i64', [], [1]),
      groups: num('i64', [], [1]),
      bias: num('f32', [4], [0, 0, 0, 0]),
    }), []);
    const next = setScalarField(d2, ['conv'], 'stride', 3);
    assert.deepEqual(next.graph.children.conv.fields.stride.data, new BigInt64Array([3n]));
    assert.equal(next.graph.children.conv.fields.stride.dtype, 'i64');
    // 缺省字段:Conv1d 没有 input_shape,kind 是 shape -> i64
    const d4 = setScalarField(next, ['conv'], 'input_shape', 10);
    assert.equal(d4.graph.children.conv.fields.input_shape.dtype, 'i64');
  });

  it('setScalarField 反向:NaN 与非整数(i64)拒绝', () => {
    const doc = chainDoc();
    expectRejected(() => setScalarField(doc, ['lif'], 'tau', NaN), doc, /finite/);
    expectRejected(() => setIntArrayField(doc, ['input'], 'shape', [1.5]), doc, /integer/);
    expectRejected(() => setStringField(doc, ['lif'], 'v_threshold', 'oops'), doc, /is numeric/);
  });

  it('setIntArrayField 正向:整数元组(如 stride 数组、Input 形状)', () => {
    const doc = chainDoc();
    const next = setIntArrayField(doc, ['input'], 'shape', [2, 8, 8]);
    assert.deepEqual(next.graph.children.input.fields.shape.data, new BigInt64Array([2n, 8n, 8n]));
    assert.deepEqual(next.graph.children.input.fields.shape.shape, [3]);
  });

  it('setFieldUniform 正向:数组整体设同值,保持形状与 dtype', () => {
    const doc = chainDoc();
    const next = setFieldUniform(doc, ['lif'], 'v_threshold', 0.25);
    const v = next.graph.children.lif.fields.v_threshold;
    assert.deepEqual(Array.from(v.data), [0.25, 0.25, 0.25, 0.25]);
    assert.equal(v.dtype, 'f32');
    assert.deepEqual(v.shape, [4]);
  });

  it('setFieldUniform 反向:缺字段拒绝', () => {
    const doc = chainDoc();
    expectRejected(() => setFieldUniform(doc, ['lif'], 'ghost_field', 1), doc, /does not exist/);
  });

  it('scaleField 正向:逐元素缩放;反向:整型数组拒绝', () => {
    const doc = chainDoc();
    const next = scaleField(doc, ['lif'], 'tau', 10);
    assert.deepEqual(Array.from(next.graph.children.lif.fields.tau.data), [10, 10, 10, 10]);
    expectRejected(() => scaleField(doc, ['input'], 'shape', 2), doc, /integer array .* cannot be scaled/);
    expectRejected(() => scaleField(doc, ['lif'], 'tau', Infinity), doc, /finite/);
  });

  it('setFieldIndices 正向:只改指定下标;反向:越界拒绝', () => {
    const doc = chainDoc();
    const next = setFieldIndices(doc, ['lif'], 'v_threshold', [{ index: 1, value: 5 }, { index: 3, value: 7 }]);
    assert.deepEqual(Array.from(next.graph.children.lif.fields.v_threshold.data), [1, 5, 1, 7]);
    expectRejected(
      () => setFieldIndices(doc, ['lif'], 'v_threshold', [{ index: 4, value: 1 }]),
      doc, /out of range/,
    );
    expectRejected(() => setFieldIndices(doc, ['lif'], 'v_threshold', []), doc, /at least one/);
  });

  it('describeField 给形状与统计量(大数组入口)', () => {
    const doc = chainDoc();
    const s = describeField(doc, ['lif'], 'tau');
    assert.deepEqual(s.shape, [4]);
    assert.equal(s.count, 4);
    assert.equal(s.min, 1);
    assert.equal(s.max, 1);
    assert.equal(s.mean, 1);
    expectRejected(() => describeField(doc, ['lif'], 'ghost'), doc, /does not exist/);
  });

  it('setSimpleMetadata 正反向与历史栈标签', () => {
    const doc = chainDoc();
    const next = setSimpleMetadata(doc, ['lif'], 'note', '手术备注');
    assert.equal(next.graph.children.lif.metadata.note.data, '手术备注');
    const removed = setSimpleMetadata(next, ['lif'], 'note', null);
    assert.ok(!removed.graph.children.lif.metadata.note);
    expectRejected(() => setSimpleMetadata(doc, ['lif'], '', 'x'), doc, /non-empty/);
  });
});

describe('编辑动作分发 applyEditAction', () => {
  it('删除带预警的节点:未确认不应用,确认后应用', () => {
    const doc = chainDoc();
    const paused = applyEditAction(doc, { kind: 'removeNode', name: 'lif' });
    assert.equal(paused.applied, false);
    assert.ok(paused.warnings.length > 0);
    assertDocsEqual(doc, paused.doc, '未确认时文档不变');
    const done = applyEditAction(doc, { kind: 'removeNode', name: 'lif', confirmed: true });
    assert.equal(done.applied, true);
    assert.equal(done.label, '删除节点 lif');
    assert.ok(!done.doc.graph.children.lif);
  });

  it('无预警的删除直接应用', () => {
    const doc = chainDoc();
    const done = applyEditAction(doc, { kind: 'removeNode', name: 'delay' });
    assert.equal(done.applied, true);
    assert.deepEqual(done.warnings, []);
  });

  it('未知动作拒绝', () => {
    const doc = chainDoc();
    assert.throws(() => applyEditAction(doc, { kind: 'explode' }), /unknown action kind/);
  });
});

describe('撤销重做(带操作名)', () => {
  it('编辑序列 undo/redo 逐位回到原文档(引用相等)', () => {
    const doc = chainDoc();
    const h = createHistory(doc);
    h.commit(setFieldUniform(h.current, ['lif'], 'tau', 2), '改 tau');
    h.commit(applyEditAction(h.current, { kind: 'connect', src: 'input', dst: 'delay' }).doc, '连线 input → delay');
    h.commit(renameNodeChecked(h.current, [], 'lif', 'neuron_a'), '重命名 lif → neuron_a');
    assert.equal(h.lastLabel(), '重命名 lif → neuron_a');

    const back1 = h.undo();
    assert.ok(back1.graph.children.lif, '撤销重命名后名字回到 lif');
    assert.equal(h.lastLabel(), '连线 input → delay');
    assert.equal(h.nextRedoLabel(), '重命名 lif → neuron_a');

    const back2 = h.undo();
    assert.deepEqual(back2.graph.edgePairs, [['input', 'lif'], ['lif', 'output']]);
    assert.equal(h.lastLabel(), '改 tau');

    const back3 = h.undo();
    assert.equal(back3, doc, 'undo 到头应回到初始文档(同一引用)');

    const fwd1 = h.redo();
    assert.equal(fwd1, back2, 'redo 恢复的文档与 undo 前逐位相同(同一引用)');
    const fwd2 = h.redo();
    const fwd3 = h.redo();
    assert.equal(h.canRedo(), false);
    assert.ok(fwd3.graph.children.neuron_a);
    assert.deepEqual(fwd3.graph.edgePairs.at(-1), ['input', 'delay']);
  });

  it('提交后重做栈被清空', () => {
    const doc = chainDoc();
    const h = createHistory(doc);
    h.commit(setFieldUniform(h.current, ['lif'], 'tau', 2), '改 tau');
    h.undo();
    assert.equal(h.nextRedoLabel(), '改 tau');
    h.commit(setFieldUniform(h.current, ['lif'], 'r', 3), '改 r');
    assert.equal(h.nextRedoLabel(), '');
  });
});
