/**
 * 形状推断测试：用 tools/gen_shape_expectations.py（官方 nir 1.0.8）生成的
 * shape_expectations.json 作为参照，逐图对比 inferTypes 的结果：
 * - 推断后的节点集合（含自动前置 input_<名> / 自动补 output_<名>）；
 * - 每个节点的 input / output 类型；
 * - 推断补写的 Conv input_shape 与 Flatten input_type 字段；
 * - 边集合。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument, inferTypes, valueToIntArray } from '../src/core/nir/index.js';
import { makeGraph, makeNode, num } from './helpers.mjs';

const EXPECTATIONS = JSON.parse(
  readFileSync(new URL('./shape_expectations.json', import.meta.url), 'utf-8'),
);

/** 按照官方测试图的构造，用核心部件搭出同样的文档 */
function buildGraph(name) {
  const f32arr = (shape) => num('f32', shape, new Array(shape.reduce((a, b) => a * b, 1)).fill(0.5));
  const i64 = (values) => num('i64', [values.length], values);
  const i64scalar = (v) => num('i64', [], [v]);

  // 与官方构造一致：Conv1d 用标量，Conv2d 在 __post_init__ 里已归一化成二元组
  const convFields = (inShape, wShape, padding) => {
    const isConv2d = wShape.length === 4;
    return {
      input_shape: i64(inShape),
      weight: f32arr(wShape),
      stride: isConv2d ? i64([1, 1]) : i64scalar(1),
      padding: padding === 'same'
        ? { dtype: 'vlen-str', shape: [], data: 'same' }
        : (isConv2d ? i64([0, 0]) : i64scalar(0)),
      dilation: isConv2d ? i64([1, 1]) : i64scalar(1),
      groups: i64scalar(1),
      bias: f32arr([wShape[0]]),
    };
  };
  const poolFields = (k, s) => ({
    kernel_size: i64(k),
    stride: i64(s),
    padding: i64([0, 0]),
  });
  const neuronFields = (n, kind) => kind === 'IF'
    ? { r: f32arr([n]), v_threshold: f32arr([n]) }
    : {
      tau: f32arr([n]), r: f32arr([n]),
      v_leak: f32arr([n]), ...(kind === 'LIF' ? { v_threshold: f32arr([n]) } : {}),
    };
  const shapeNode = (shape) => makeNode('Input', { shape: i64(shape) });
  const outNode = (shape) => makeNode('Output', { shape: i64(shape) });

  if (name === 'conv_pool_flatten') {
    return makeGraph({
      image: shapeNode([1, 8, 8]),
      conv: makeNode('Conv2d', convFields([8, 8], [2, 1, 3, 3], 0)),
      avg: makeNode('AvgPool2d', poolFields([2, 2], [2, 2])),
      sum: makeNode('SumPool2d', poolFields([3, 3], [1, 1])),
      flat: makeNode('Flatten', { start_dim: i64scalar(0), end_dim: i64scalar(-1) }),
      neuron: makeNode('LIF', neuronFields(2, 'LIF')),
      out: outNode([2]),
    }, [
      ['image', 'conv'], ['conv', 'avg'], ['avg', 'sum'], ['sum', 'flat'],
      ['flat', 'neuron'], ['neuron', 'out'],
    ]);
  }
  if (name === 'conv1d_chain') {
    return makeGraph({
      sig: shapeNode([3, 10]),
      conv: makeNode('Conv1d', convFields([10], [4, 3, 3], 0)),
      flat: makeNode('Flatten', { start_dim: i64scalar(0), end_dim: i64scalar(-1) }),
      lin: makeNode('Linear', { weight: f32arr([8, 32]) }),
      aff: makeNode('Affine', { weight: f32arr([4, 8]), bias: f32arr([4]) }),
      out: outNode([4]),
    }, [
      ['sig', 'conv'], ['conv', 'flat'], ['flat', 'lin'], ['lin', 'aff'], ['aff', 'out'],
    ]);
  }
  if (name === 'nested_subgraph') {
    const block = makeGraph({
      in: shapeNode([4]),
      lif: makeNode('LIF', neuronFields(4, 'LIF')),
      out: outNode([4]),
    }, [['in', 'lif'], ['lif', 'out']]);
    block.children = {
      in: shapeNode([4]),
      lif: makeNode('LIF', neuronFields(4, 'LIF')),
      out: outNode([4]),
    };
    return makeGraph({
      inp: shapeNode([4]),
      block,
      out: outNode([4]),
    }, [['inp', 'block'], ['block', 'out']]);
  }
  if (name === 'auto_io') {
    return makeGraph({
      a: makeNode('LIF', neuronFields(4, 'LIF')),
      b: makeNode('LI', neuronFields(4, 'LI')),
    }, [['a', 'b']]);
  }
  if (name === 'two_branches') {
    return makeGraph({
      in1: shapeNode([4]),
      in2: shapeNode([4]),
      lif1: makeNode('LIF', neuronFields(4, 'LIF')),
      li1: makeNode('LI', neuronFields(4, 'LI')),
      out: outNode([4]),
    }, [['in1', 'lif1'], ['in2', 'li1'], ['lif1', 'out'], ['li1', 'out']]);
  }
  if (name === 'conv_same_padding') {
    return makeGraph({
      img: shapeNode([2, 8, 8]),
      conv: makeNode('Conv2d', convFields([8, 8], [4, 2, 3, 3], 'same')),
      out: outNode([4, 8, 8]),
    }, [['img', 'conv'], ['conv', 'out']]);
  }
  throw new Error(`unknown graph ${name}`);
}

function expectInt(v) {
  return v === null ? null : v;
}

describe('形状推断与官方 infer_types() 对比', () => {
  for (const exp of EXPECTATIONS.graphs) {
    it(`${exp.name}`, () => {
      const doc = createDocument('1.0.8', buildGraph(exp.name));
      const { doc: inferred, types } = inferTypes(doc);

      // 节点集合一致（含自动加的 input_/output_）
      const gotNodes = Object.keys(inferred.graph.children).sort();
      const wantNodes = Object.keys(exp.nodes).sort();
      assert.deepEqual(gotNodes, wantNodes,
        `节点集合不一致：got [${gotNodes}] want [${wantNodes}]`);

      // 边集合一致（有序）
      assert.deepEqual(inferred.graph.edgePairs, exp.edges,
        `边不一致：got ${JSON.stringify(inferred.graph.edgePairs)} want ${JSON.stringify(exp.edges)}`);

      // 每个节点类型与推断出的 input/output
      for (const [name, rec] of Object.entries(exp.nodes)) {
        const node = inferred.graph.children[name];
        assert.equal(node.type, rec.type, `节点 ${name} 类型`);
        const t = types[name];
        assert.ok(t, `types 里没有 ${name}`);
        assert.deepEqual(t.input, rec.input, `节点 ${name} input`);
        assert.deepEqual(t.output, rec.output, `节点 ${name} output`);
        // Conv 的 input_shape / Flatten 的 input_type 补写
        if (rec.input_shape !== undefined) {
          assert.deepEqual(valueToIntArray(node.fields.input_shape), expectInt(rec.input_shape),
            `节点 ${name} input_shape 补写`);
        }
        if (rec.input_type !== undefined) {
          assert.deepEqual(valueToIntArray(node.fields.input_type), expectInt(rec.input_type),
            `节点 ${name} input_type 补写`);
        }
      }
    });
  }

  it('类型不一致时报错且信息带节点名', () => {
    const doc = createDocument('1.0.8', makeGraph({
      a: makeNode('Input', { shape: num('i64', [1], [4]) }),
      b: makeNode('LIF', {
        tau: num('f32', [2], [1, 1]), r: num('f32', [2], [1, 1]),
        v_leak: num('f32', [2], [0, 0]), v_threshold: num('f32', [2], [1, 1]),
      }),
      c: makeNode('Output', { shape: num('i64', [1], [2]) }),
    }, [['a', 'b'], ['b', 'c']]));
    assert.throws(() => inferTypes(doc), /'a'\.output.*'b'\.input|type mismatch/);
  });

  it('边引用不存在的节点时报错', () => {
    const doc = createDocument('1.0.8', makeGraph({
      a: makeNode('Input', { shape: num('i64', [1], [4]) }),
      c: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['a', 'ghost'], ['ghost', 'c']]));
    assert.throws(() => inferTypes(doc), /ghost/);
  });

  it('重复边报错', () => {
    const doc = createDocument('1.0.8', makeGraph({
      a: makeNode('Input', { shape: num('i64', [1], [4]) }),
      b: makeNode('LIF', {
        tau: num('f32', [4], [1, 1, 1, 1]), r: num('f32', [4], [1, 1, 1, 1]),
        v_leak: num('f32', [4], [0, 0, 0, 0]), v_threshold: num('f32', [4], [1, 1, 1, 1]),
      }),
      c: makeNode('Output', { shape: num('i64', [1], [4]) }),
    }, [['a', 'b'], ['a', 'b'], ['b', 'c']]));
    assert.throws(() => inferTypes(doc), /duplicate edge/);
  });
});
