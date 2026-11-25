#!/usr/bin/env python3
"""剪枝+成组的官方参考(对照 test/prune_group_e2e.test.mjs):
用官方 nir 库对两个模型做与 JS 侧完全相同的操作,写出:

- test/output/reference_pruned_grouped_complex.nir
    complex 模型:剪 scale1 保留下标 0..127(联动 linear1 权重行、affine1 权重列),
    再把 threshold1+delay1 编成子图节点 group(内部 input/output shape [256]);
- test/output/reference_pruned_grouped_all_types.nir
    all_types 模型:剪 conv1d 输入通道保留 [0,1](联动 input_b 的 shape 成 [2,10]),
    再把 threshold+scale 编成子图节点 group(内部 input/output shape [32])。

与官方写路径的三处刻意差别(仅测试参考文件,不涉及官方库行为,报告里写明):
1. nir.write 会把 /version 写成本包版本号,JS 侧无损保留原文件的版本
   (complex 是 1.0.6)——写出后用 h5py 改回原文件的版本;
2. all_types 的嵌套 CubaLIF 在原文件里没有 v_reset/w_in 数据集(官方读回时补默认值),
   官方重写会把补出来的数组写回文件——写出后用 h5py 删掉这两个数据集;
3. 组的内部结构按 JS 侧成组的确定性行为搭:组内边在成员边在前、
   内部 IO 边在后(input 先于 output),父图边保持原相对顺序。

用法:.venv-nir/bin/python tools/reference_prune_group.py
"""

import os
import sys

import h5py
import numpy as np

import nir

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'test', 'output')

KEEP_SCALE = list(range(128))   # 256 -> 128
KEEP_CONV1D = [0, 1]            # 3 -> 2


def prune_complex(g):
    """剪 scale1 keep 0..127:scale 参数、linear1 权重行、affine1 权重列"""
    nodes = dict(g.nodes)
    idx = np.array(KEEP_SCALE)
    nodes['scale1'].scale = nodes['scale1'].scale[idx]
    nodes['linear1'].weight = nodes['linear1'].weight[idx, :]
    nodes['affine1'].weight = nodes['affine1'].weight[:, idx]
    return nodes


def group_complex(nodes, edges):
    """把 threshold1+delay1 编成子图 group(内部 input/output shape [256])"""
    t1 = nodes.pop('threshold1')
    d1 = nodes.pop('delay1')
    sub = nir.NIRGraph(
        nodes={
            'input': nir.Input(input_type=np.array([256])),
            'threshold1': t1,
            'delay1': d1,
            'output': nir.Output(output_type=np.array([256])),
        },
        edges=[('threshold1', 'delay1'), ('input', 'threshold1'), ('delay1', 'output')],
        type_check=False,
    )
    nodes['group'] = sub
    # 父图边:原顺序保留,组内边移除,跨组边改接 group(端点是任一成员都换成组名)
    members = {'threshold1', 'delay1'}
    new_edges = []
    for a, b in edges:
        if a in members and b in members:
            continue
        new_edges.append(('group' if a in members else a, 'group' if b in members else b))
    return nodes, new_edges


def prune_all_types(g):
    """剪 conv1d 输入通道 keep [0,1]:权重第 1 轴、input_b 的 shape"""
    nodes = dict(g.nodes)
    idx = np.array(KEEP_CONV1D)
    nodes['conv1d'].weight = nodes['conv1d'].weight[:, idx, :]
    nodes['input_b'] = nir.Input(input_type=np.array([2, 10]))
    return nodes


def group_all_types(nodes, edges):
    """把 threshold+scale 编成子图 group(内部 input/output shape [32])"""
    th = nodes.pop('threshold')
    sc = nodes.pop('scale')
    sub = nir.NIRGraph(
        nodes={
            'input': nir.Input(input_type=np.array([32])),
            'threshold': th,
            'scale': sc,
            'output': nir.Output(output_type=np.array([32])),
        },
        edges=[('threshold', 'scale'), ('input', 'threshold'), ('scale', 'output')],
        type_check=False,
    )
    nodes['group'] = sub
    members = {'threshold', 'scale'}
    new_edges = []
    for a, b in edges:
        if a in members and b in members:
            continue
        new_edges.append(('group' if a in members else a, 'group' if b in members else b))
    return nodes, new_edges


def fix_all_types_defaults(f):
    """官方读回时把缺省的 v_reset/w_in 补成了内存数组,重写后又写回文件;
    原文件里这两个数据集不存在,删掉以恢复"缺省字段"的原状。"""
    base = 'node/nodes/block/nodes/cubalif'
    del f[f'{base}/v_reset']
    del f[f'{base}/w_in']


def write_reference(src_path, out_path, out_version, post_fix=None):
    g = nir.read(src_path, type_check=False)
    if 'complex' in os.path.basename(src_path):
        nodes = prune_complex(g)
        nodes, edges = group_complex(nodes, [tuple(e) for e in g.edges])
    else:
        nodes = prune_all_types(g)
        nodes, edges = group_all_types(nodes, [tuple(e) for e in g.edges])
    g2 = nir.NIRGraph(nodes=nodes, edges=edges, metadata=g.metadata, type_check=False)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    nir.write(out_path, g2)
    with h5py.File(out_path, 'r+') as f:
        # 版本改回原文件的(JS 侧无损保留原版本)
        del f['version']
        f.create_dataset('version', data=out_version)
        if post_fix:
            post_fix(f)
    # 自检:官方库能读回(默认 type_check=True)
    check = nir.read(out_path)
    print(f'reference written: {out_path}')
    print(f'  nodes: {sorted(nodes)}')
    print(f'  edges: {edges}')
    print(f'  read back ok: {len(check.nodes)} nodes')
    return 0


def main():
    rc = 0
    rc |= write_reference(
        os.path.join(ROOT, 'test', 'complex_nir_test_model.nir'),
        os.path.join(OUT, 'reference_pruned_grouped_complex.nir'),
        '1.0.6',
    )
    rc |= write_reference(
        os.path.join(ROOT, 'test', 'all_types_model.nir'),
        os.path.join(OUT, 'reference_pruned_grouped_all_types.nir'),
        '1.0.8',
        post_fix=fix_all_types_defaults,
    )
    return rc


if __name__ == '__main__':
    sys.exit(main())
