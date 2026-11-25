/**
 * 往返测试：读 -> 写 -> 再读，逐节点逐字段（含 dtype）深度相等；
 * "原文件读出"与"重写文件读出"也深度相等。
 * 写出的文件放到 test/output/ 供 tools/run_cross_checks.py 用官方 nir 库对数。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readNir, writeNir } from '../src/core/nir/index.js';
import { assertDocsEqual, getBackend } from './helpers.mjs';

const OUT_DIR = new URL('./output/', import.meta.url).pathname;

const FIXTURES = [
  ['complex_nir_test_model.nir', 'complex_roundtrip.nir'],
  ['all_types_model.nir', 'all_types_roundtrip.nir'],
  ['legacy_no_vreset.nir', 'legacy_roundtrip.nir'],
];

describe('往返：读 -> 写 -> 再读', () => {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const [fixture, outName] of FIXTURES) {
    it(`${fixture} 往返逐位相等`, async () => {
      const backend = await getBackend();
      const bytes = new Uint8Array(readFileSync(new URL(`../test/${fixture}`, import.meta.url)));
      const doc1 = await readNir(bytes, backend);
      const rewritten = await writeNir(doc1, backend);
      writeFileSync(OUT_DIR + outName, rewritten);
      const doc2 = await readNir(rewritten, backend);
      assertDocsEqual(doc1, doc2, `${fixture} read->write->read`);
    });
  }

  it('三次连续往返结果稳定（写出的字节内容可重复读出同一文档）', async () => {
    const backend = await getBackend();
    const bytes = new Uint8Array(readFileSync(new URL('../test/all_types_model.nir', import.meta.url)));
    const doc1 = await readNir(bytes, backend);
    const b1 = await writeNir(doc1, backend);
    const doc2 = await readNir(b1, backend);
    const b2 = await writeNir(doc2, backend);
    const doc3 = await readNir(b2, backend);
    assertDocsEqual(doc2, doc3, 'second hop');
    // 内容层面两次写出应当逐字节一致（同一文档、同一写路径、确定性）
    assert.deepEqual([...b1], [...b2], '两次写出的字节不一致');
  });

  it('dtype 逐字段保留（抽查关键 dtype）', async () => {
    const backend = await getBackend();
    const bytes = new Uint8Array(readFileSync(new URL('../test/complex_nir_test_model.nir', import.meta.url)));
    const doc = await readNir(bytes, backend);
    const doc2 = await readNir(await writeNir(doc, backend), backend);
    // 原文件 input/shape 是 int32
    assert.equal(doc2.graph.children.input.fields.shape.dtype, 'i32');
    assert.equal(doc2.graph.children.lif1.fields.tau.dtype, 'f32');
    assert.equal(doc2.graph.children.linear1.fields.weight.dtype, 'f32');
    assert.equal(doc2.graph.children.linear1.fields.weight.shape.join(','), '512,784');
    // 字符串是变长
    assert.equal(doc2.version, '1.0.6');
    assert.equal(doc2.graph.metadata.description.dtype, 'vlen-str');
    // 边数据集也保留变长字符串 [11,2]
    assert.equal(doc2.graph.edges.dtype, 'vlen-str');
    assert.deepEqual(doc2.graph.edges.shape, [11, 2]);
  });
});
