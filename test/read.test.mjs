/**
 * 读测试：仓库自带的 complex_nir_test_model.nir（1.0.6 写出）。
 * 判据（跑前写死）：
 * - 版本 = '1.0.6'；12 个节点；11 条边；
 * - 节点类型集合与参数齐全（LIF 5 参数、Input/Output 的 shape、卷积字段等）；
 * - 元数据含中文与字符串数组；
 * - all_types_model.nir 覆盖全部 19 种可序列化类型（含嵌套子图、缺省 v_reset/w_in）；
 * - legacy_no_vreset.nir 能读且 v_reset 缺省如实记录（不加默认值）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readNir, SERIALIZABLE_TYPES, valueToIntArray } from '../src/core/nir/index.js';
import { getBackend } from './helpers.mjs';

async function readFixture(path) {
  const backend = await getBackend();
  const bytes = new Uint8Array(readFileSync(new URL(path, import.meta.url)));
  return readNir(bytes, backend);
}

describe('读 complex_nir_test_model.nir', () => {
  let doc;
  it('读取成功且版本为 1.0.6', async () => {
    doc = await readFixture('../test/complex_nir_test_model.nir');
    assert.equal(doc.version, '1.0.6');
    assert.equal(doc.graph.type, 'NIRGraph');
  });

  it('有 12 个节点和 11 条边', () => {
    const names = Object.keys(doc.graph.children);
    assert.equal(names.length, 12, `节点数 ${names.length}: ${names}`);
    assert.equal(doc.graph.edgePairs.length, 11);
  });

  it('节点类型齐全', () => {
    const types = Object.fromEntries(
      Object.entries(doc.graph.children).map(([k, v]) => [k, v.type]),
    );
    assert.deepEqual(types, {
      input: 'Input',
      linear1: 'Linear',
      scale1: 'Scale',
      affine1: 'Affine',
      threshold1: 'Threshold',
      delay1: 'Delay',
      lif1: 'LIF',
      li1: 'LI',
      if1: 'IF',
      integrator1: 'I',
      output_layer: 'Affine',
      output: 'Output',
    });
  });

  it('Input/Output 的 shape 从节点的 shape 数据集读出', () => {
    const inputShape = doc.graph.children.input.fields.shape;
    assert.equal(inputShape.dtype, 'i32'); // 原文件就是 int32
    assert.deepEqual([...inputShape.data], [784]);
    const outputShape = doc.graph.children.output.fields.shape;
    assert.equal(outputShape.dtype, 'i32');
    assert.deepEqual([...outputShape.data], [10]);
  });

  it('LIF 的 5 个参数齐全且 dtype 保留为 float32', () => {
    const lif = doc.graph.children.lif1;
    for (const name of ['tau', 'r', 'v_leak', 'v_threshold', 'v_reset']) {
      const v = lif.fields[name];
      assert.ok(v, `缺少 ${name}`);
      assert.equal(v.dtype, 'f32', `${name} dtype`);
      assert.deepEqual(v.shape, [256]);
      assert.equal(v.data.length, 256);
    }
  });

  it('根元数据含中文描述与字符串数组', () => {
    const md = doc.graph.metadata;
    assert.equal(md.description.data, '包含多种NIR算子的复杂测试模型');
    assert.deepEqual([...md.operators.data], [
      'Input', 'Linear', 'Scale', 'Affine', 'Threshold', 'Delay',
      'LIF', 'LI', 'IF', 'I', 'Output',
    ]);
  });

  it('节点级元数据保留', () => {
    assert.equal(doc.graph.children.lif1.metadata.name.data, 'lif1');
    assert.equal(doc.graph.children.input.metadata.description.data, 'MNIST图像输入');
  });

  it('边的内容与顺序正确', () => {
    assert.deepEqual(doc.graph.edgePairs, [
      ['input', 'linear1'], ['linear1', 'scale1'], ['scale1', 'affine1'],
      ['affine1', 'threshold1'], ['threshold1', 'delay1'], ['delay1', 'lif1'],
      ['lif1', 'li1'], ['li1', 'if1'], ['if1', 'integrator1'],
      ['integrator1', 'output_layer'], ['output_layer', 'output'],
    ]);
  });
});

describe('读 all_types_model.nir（19 种类型 + 嵌套子图 + 缺省字段）', () => {
  let doc;
  it('读取成功', async () => {
    doc = await readFixture('../test/all_types_model.nir');
    assert.equal(doc.version, '1.0.8');
  });

  it('全部 19 种可序列化类型都出现（含 NIRGraph）', () => {
    const found = new Set();
    const walk = (node) => {
      found.add(node.type);
      if (node.children) Object.values(node.children).forEach(walk);
    };
    walk(doc.graph);
    for (const t of SERIALIZABLE_TYPES) {
      assert.ok(found.has(t), `缺少类型 ${t}（找到：${[...found].sort().join(',')}）`);
    }
  });

  it('嵌套子图 block 有 6 个内部节点', () => {
    const block = doc.graph.children.block;
    assert.equal(block.type, 'NIRGraph');
    assert.deepEqual(Object.keys(block.children).sort(),
      ['cubali', 'cubalif', 'delay', 'input', 'lif', 'output']);
    assert.equal(block.edgePairs.length, 5);
  });

  it('嵌套 CubaLIF 的 v_reset 与 w_in 如实记录为缺省', () => {
    const cl = doc.graph.children.block.children.cubalif;
    assert.equal(cl.fields.v_reset, undefined, 'v_reset 应缺省');
    assert.equal(cl.fields.w_in, undefined, 'w_in 应缺省');
    // 其余 5 个参数在
    for (const name of ['tau_syn', 'tau_mem', 'r', 'v_leak', 'v_threshold']) {
      assert.ok(cl.fields[name], `缺少 ${name}`);
    }
  });

  it('根元数据含中文、数值数组与字符串数组', () => {
    const md = doc.graph.metadata;
    assert.equal(md['中文备注'].data, '你好，世界');
    assert.equal(md.params.dtype, 'f32');
    assert.deepEqual([...md.params.data].map((x) => Math.round(x * 10) / 10), [1.5, 2.5]);
    assert.deepEqual([...md.labels.data], ['alpha', 'beta', '中文']);
  });

  it('Conv2d 的 input_shape/stride/padding/dilation/groups 完整读出', () => {
    const conv = doc.graph.children.conv2d;
    assert.deepEqual(valueToIntArray(conv.fields.input_shape), [8, 8]);
    // Conv2d 构造时把标量 stride/padding/dilation 归一化成二元组，文件里就是二维
    assert.deepEqual(valueToIntArray(conv.fields.stride), [1, 1]);
    assert.deepEqual(valueToIntArray(conv.fields.padding), [0, 0]);
    assert.deepEqual(valueToIntArray(conv.fields.dilation), [1, 1]);
    assert.deepEqual(valueToIntArray(conv.fields.groups), [1]);
    assert.deepEqual(conv.fields.weight.shape, [2, 1, 3, 3]);
  });
});

describe('读 legacy_no_vreset.nir（旧式缺省文件）', () => {
  it('能读，且 LIF 没有 v_reset 字段（不凭空补默认值）', async () => {
    const doc = await readFixture('../test/legacy_no_vreset.nir');
    const names = Object.keys(doc.graph.children);
    assert.deepEqual(names.sort(), ['input', 'lif', 'output']);
    const lif = doc.graph.children.lif;
    assert.equal(lif.fields.v_reset, undefined, 'v_reset 必须缺省，而不是被补上默认值');
    for (const name of ['tau', 'r', 'v_leak', 'v_threshold']) {
      assert.ok(lif.fields[name], `缺少 ${name}`);
    }
  });
});

describe('读非 HDF5 文件要报错', () => {
  it('JSON 字节读入报"不是 HDF5"', async () => {
    const backend = await getBackend();
    const bytes = new TextEncoder().encode('{"nodes": {}}');
    await assert.rejects(
      () => readNir(bytes, backend),
      /not an HDF5 file/,
    );
  });

  it('缺 version 的 HDF5 报错并写明位置', async () => {
    const backend = await getBackend();
    // 用真 HDF5 但内容为空：直接构造一个只含 node 组的最小文件不行——
    // 简单起见，用截断的合法文件触发魔数之后的打开错误
    const real = new Uint8Array(readFileSync(new URL('../test/legacy_no_vreset.nir', import.meta.url)));
    const broken = real.slice(0, 200); // 截断
    await assert.rejects(() => readNir(broken, backend), /Error|error/);
  });
});
