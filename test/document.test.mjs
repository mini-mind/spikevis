/**
 * 文档模型与历史栈测试：不可变变换 + 撤销/重做。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, createHistory, makeNodeRecord, removeNode, renameNode,
  setEdges, setNodeField, setNodeMetadata, withVersion,
} from '../src/core/nir/index.js';
import { makeGraph, makeNode, num } from './helpers.mjs';

function tinyDoc() {
  return {
    version: '1.0.8',
    graph: makeGraph({
      input: makeNode('Input', { shape: num('i64', [1], [4]) }),
      lif: makeNode('LIF', {
        tau: num('f32', [4], [1, 1, 1, 1]),
        r: num('f32', [4], [1, 1, 1, 1]),
        v_leak: num('f32', [4], [0, 0, 0, 0]),
        v_threshold: num('f32', [4], [1, 1, 1, 1]),
      }),
      output: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['input', 'lif'], ['lif', 'output']]),
  };
}

describe('不可变文档', () => {
  it('setNodeField 返回新文档且不动原文档', () => {
    const doc = tinyDoc();
    const next = setNodeField(doc, ['lif'], 'tau', num('f32', [4], [5, 5, 5, 5]));
    assert.equal(doc.graph.children.lif.fields.tau.data[0], 1, '原文档被改了');
    assert.equal(next.graph.children.lif.fields.tau.data[0], 5);
    assert.equal(next, next, 'same ref trivial');
    assert.notEqual(doc.graph.children.lif, next.graph.children.lif);
    // 未触达的子树内容不变
    assert.deepEqual(doc.graph.children.input, next.graph.children.input);
  });

  it('setNodeField 传 null 删除字段', () => {
    const doc = tinyDoc();
    const next = setNodeField(doc, ['lif'], 'v_threshold', null);
    assert.equal(next.graph.children.lif.fields.v_threshold, undefined);
    assert.ok(doc.graph.children.lif.fields.v_threshold, '原文档应保留');
  });

  it('withVersion / setNodeMetadata / setEdges', () => {
    const doc = tinyDoc();
    const d2 = withVersion(doc, '2.0.0');
    assert.equal(d2.version, '2.0.0');
    assert.equal(doc.version, '1.0.8');
    const d3 = setNodeMetadata(d2, ['lif'], 'note', { dtype: 'vlen-str', shape: [], data: '备注' });
    assert.equal(d3.graph.children.lif.metadata.note.data, '备注');
    const d4 = setEdges(d3, [['input', 'lif']]);
    assert.deepEqual(d4.graph.edgePairs, [['input', 'lif']]);
    assert.equal(d3.graph.edgePairs.length, 2);
  });

  it('renameNode 同步改边；removeNode 删相连边；addNode 拒重名', () => {
    const doc = tinyDoc();
    const d2 = renameNode(doc, [], 'lif', 'neuron1');
    assert.ok(d2.graph.children.neuron1);
    assert.deepEqual(d2.graph.edgePairs, [['input', 'neuron1'], ['neuron1', 'output']]);
    assert.throws(() => renameNode(doc, [], 'input', 'output'), /already exists/);
    const d3 = removeNode(d2, 'neuron1');
    assert.deepEqual(d3.graph.edgePairs, []);
    assert.equal(Object.keys(d3.graph.children).length, 2);
    const d4 = addNode(d3, 'lif', makeNodeRecord('LIF'));
    assert.ok(d4.graph.children.lif);
    assert.throws(() => addNode(d4, 'lif', makeNodeRecord('LIF')), /already exists/);
  });

  it('嵌套子图路径的字段修改', () => {
    const doc = tinyDoc();
    const withBlock = addNode(doc, 'block', (() => {
      const g = makeGraph(
        { lif: makeNode('LIF', {
          tau: num('f32', [4], [1, 1, 1, 1]),
          r: num('f32', [4], [1, 1, 1, 1]),
          v_leak: num('f32', [4], [0, 0, 0, 0]),
          v_threshold: num('f32', [4], [1, 1, 1, 1]),
        }) },
        [],
      );
      return g;
    })());
    const next = setNodeField(withBlock, ['block', 'lif'], 'tau', num('f32', [4], [9, 9, 9, 9]));
    assert.equal(next.graph.children.block.children.lif.fields.tau.data[0], 9);
    assert.equal(withBlock.graph.children.block.children.lif.fields.tau.data[0], 1);
  });
});

describe('历史栈', () => {
  it('commit/undo/redo 基本循环', () => {
    const h = createHistory(tinyDoc());
    assert.equal(h.canUndo(), false);
    const d1 = setNodeField(h.current, ['lif'], 'tau', num('f32', [4], [2, 2, 2, 2]));
    h.commit(d1, '改 tau');
    assert.equal(h.current.graph.children.lif.fields.tau.data[0], 2);
    assert.equal(h.canUndo(), true);
    const back = h.undo();
    assert.equal(back.graph.children.lif.fields.tau.data[0], 1);
    assert.equal(h.canUndo(), false);
    assert.equal(h.canRedo(), true);
    const fwd = h.redo();
    assert.equal(fwd.graph.children.lif.fields.tau.data[0], 2);
    assert.equal(h.canRedo(), false);
  });

  it('commit 会清空 redo 栈', () => {
    const h = createHistory(tinyDoc());
    const d1 = setNodeField(h.current, ['lif'], 'tau', num('f32', [4], [2, 2, 2, 2]));
    h.commit(d1);
    h.undo();
    const d2 = setNodeField(h.current, ['lif'], 'r', num('f32', [4], [3, 3, 3, 3]));
    h.commit(d2, '改 r');
    assert.equal(h.canRedo(), false);
    assert.equal(h.lastLabel(), '改 r');
  });

  it('undo 到头返回 null', () => {
    const h = createHistory(tinyDoc());
    assert.equal(h.undo(), null);
    h.reset(withVersion(h.current, '9'));
    assert.equal(h.current.version, '9');
    assert.equal(h.canUndo(), false);
  });
});
