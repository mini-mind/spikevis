#!/usr/bin/env python3
"""用官方 nir 库生成覆盖全部 19 种可序列化节点类型的测试模型。

- test/all_types_model.nir：双分支图 + 嵌套子图；根元数据含字符串（中文）与数组两种；
  生成后手工删除嵌套 CubaLIF 的 v_reset 与 w_in 数据集，模拟"缺省字段"文件。
- test/legacy_no_vreset.nir：1.0.6 之前风格的极小图（LIF 无 v_reset）。

只依赖 .venv-nir 里的 nir / numpy / h5py。
"""

import numpy as np
import h5py
import nir
from nir import (
    Affine, AvgPool2d, Conv1d, Conv2d, CubaLI, CubaLIF, Delay, Flatten, I, IF,
    Input, LIF, LI, Linear, NIRGraph, Output, Scale, SumPool2d, Threshold,
)

OUT_ALL = 'test/all_types_model.nir'
OUT_LEGACY = 'test/legacy_no_vreset.nir'


def f32(*shape):
    rng = np.random.default_rng(42)
    return (rng.standard_normal(shape) * 0.1).astype(np.float32)


def build_all_types():
    # 分支 A：2D 卷积 -> 池化 -> 池化 -> 展平 -> 嵌套子图 -> 输出
    input_a = Input(input_type=np.array([1, 8, 8]), metadata={'name': 'image_input'})
    conv2d = Conv2d(
        input_shape=(8, 8), weight=f32(2, 1, 3, 3), stride=1, padding=0,
        dilation=1, groups=1, bias=f32(2),
    )
    avgpool = AvgPool2d(kernel_size=np.array([2, 2]), stride=np.array([2, 2]), padding=np.array([0, 0]))
    sumpool = SumPool2d(kernel_size=np.array([3, 3]), stride=np.array([1, 1]), padding=np.array([0, 0]))
    flatten = Flatten(input_type=None, start_dim=0, end_dim=-1)
    block = NIRGraph(
        nodes={
            'input': Input(input_type=np.array([2])),
            'cubalif': CubaLIF(
                tau_syn=f32(2) * 5 + 5, tau_mem=f32(2) * 10 + 10,
                r=np.ones(2, np.float32), v_leak=np.zeros(2, np.float32),
                v_threshold=np.ones(2, np.float32), w_in=1.0,
            ),
            'cubali': CubaLI(
                tau_syn=f32(2) * 5 + 5, tau_mem=f32(2) * 10 + 10,
                r=np.ones(2, np.float32), v_leak=np.zeros(2, np.float32), w_in=1.0,
            ),
            'lif': LIF(
                tau=f32(2) * 10 + 10, r=np.ones(2, np.float32),
                v_leak=np.zeros(2, np.float32), v_threshold=np.ones(2, np.float32),
            ),
            'delay': Delay(delay=np.zeros(2, np.float32)),
            'output': Output(output_type=np.array([2])),
        },
        edges=[
            ('input', 'cubalif'), ('cubalif', 'cubali'), ('cubali', 'lif'),
            ('lif', 'delay'), ('delay', 'output'),
        ],
    )
    output_a = Output(output_type=np.array([2]), metadata={'name': 'spikes_a'})

    # 分支 B：1D 卷积 -> 展平 -> 阈值 -> 缩放 -> 线性 -> 仿射 -> I -> IF -> LI -> LIF -> 输出
    input_b = Input(input_type=np.array([3, 10]))
    conv1d = Conv1d(
        input_shape=10, weight=f32(4, 3, 3), stride=1, padding=0,
        dilation=1, groups=1, bias=f32(4),
    )
    flatten_b = Flatten(input_type=None, start_dim=0, end_dim=-1)
    threshold = Threshold(threshold=f32(32))
    scale = Scale(scale=f32(32))
    linear = Linear(weight=f32(8, 32))
    affine = Affine(weight=f32(4, 8), bias=f32(4))
    i_node = I(r=np.ones(4, np.float32))
    if_node = IF(r=np.ones(4, np.float32), v_threshold=np.ones(4, np.float32))
    li_node = LI(tau=f32(4) * 10 + 10, r=np.ones(4, np.float32), v_leak=np.zeros(4, np.float32))
    lif_b = LIF(
        tau=f32(4) * 10 + 10, r=np.ones(4, np.float32),
        v_leak=np.zeros(4, np.float32), v_threshold=np.ones(4, np.float32),
        metadata={'name': 'lif_b', 'note': '神经元备注'},
    )
    output_b = Output(output_type=np.array([4]))

    nodes = {
        'input_a': input_a, 'conv2d': conv2d, 'avgpool': avgpool, 'sumpool': sumpool,
        'flatten': flatten, 'block': block, 'output_a': output_a,
        'input_b': input_b, 'conv1d': conv1d, 'flatten_b': flatten_b,
        'threshold': threshold, 'scale': scale,
        'linear': linear, 'affine': affine, 'i': i_node, 'if': if_node,
        'li': li_node, 'lif_b': lif_b, 'output_b': output_b,
    }
    edges = [
        ('input_a', 'conv2d'), ('conv2d', 'avgpool'), ('avgpool', 'sumpool'),
        ('sumpool', 'flatten'), ('flatten', 'block'), ('block', 'output_a'),
        ('input_b', 'conv1d'), ('conv1d', 'flatten_b'), ('flatten_b', 'threshold'),
        ('threshold', 'scale'), ('scale', 'linear'), ('linear', 'affine'),
        ('affine', 'i'), ('i', 'if'), ('if', 'li'), ('li', 'lif_b'),
        ('lif_b', 'output_b'),
    ]
    metadata = {
        'name': 'all_types_model',
        'description': '覆盖全部 19 种节点类型（含嵌套子图与缺省字段）',
        '中文备注': '你好，世界',
        'params': np.array([1.5, 2.5], dtype=np.float32),
        'labels': ['alpha', 'beta', '中文'],
    }
    return NIRGraph(nodes=nodes, edges=edges, metadata=metadata)


def main():
    graph = build_all_types()
    nir.write(OUT_ALL, graph)
    print(f'written {OUT_ALL}')
    # 读回自检（官方 read 含类型检查）
    g = nir.read(OUT_ALL)
    print(f'read back ok, nodes={len(g.nodes)}, edges={len(g.edges)}')

    # 模拟旧文件：删掉嵌套 CubaLIF 的 v_reset 与 w_in 数据集
    with h5py.File(OUT_ALL, 'r+') as f:
        del f['node/nodes/block/nodes/cubalif/v_reset']
        del f['node/nodes/block/nodes/cubalif/w_in']
    g = nir.read(OUT_ALL)
    cl = g.nodes['block'].nodes['cubalif']
    assert np.allclose(cl.v_reset, 0) and np.allclose(cl.w_in, 1), 'defaults not applied on read'
    print('defaults (v_reset=0, w_in=1) verified after deletion')

    # 旧式极小文件：LIF 无 v_reset
    legacy = NIRGraph.from_list(
        Input(input_type=np.array([4])),
        LIF(tau=np.ones(4, np.float32) * 20, r=np.ones(4, np.float32),
            v_leak=np.zeros(4, np.float32), v_threshold=np.ones(4, np.float32)),
    )
    nir.write(OUT_LEGACY, legacy)
    with h5py.File(OUT_LEGACY, 'r+') as f:
        del f['node/nodes/lif/v_reset']
    g = nir.read(OUT_LEGACY)
    print(f'written {OUT_LEGACY}, lif keys after read: v_reset={g.nodes["lif"].v_reset}')


if __name__ == '__main__':
    main()
