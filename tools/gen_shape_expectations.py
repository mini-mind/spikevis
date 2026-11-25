#!/usr/bin/env python3
"""用官方 nir 库对若干测试图运行 infer_types()，把期望结果转成 JSON 供 JS 测试对比。

输出 test/shape_expectations.json：
{
  "graphs": [
    {
      "name": ...,
      "nodes": { "名字": {"type": 类名, "input": [...]|null, "output": [...]|null,
                          "input_shape": [...]|null(仅 Conv 记录推断后的值),
                          "input_type": [...]|null(仅 Flatten 记录推断后的值)} },
      "edges": [["源","目标"], ...]   # 推断后（含自动加的 input_/output_ 边）
    }
  ]
}
"""

import json

import numpy as np
from nir import (
    Affine, AvgPool2d, Conv1d, Conv2d, Flatten, Input, LIF, LI, Linear,
    NIRGraph, Output, SumPool2d,
)


def f32(*shape):
    rng = np.random.default_rng(7)
    return (rng.standard_normal(shape) * 0.1).astype(np.float32)


def node_record(node):
    if type(node).__name__ == 'NIRGraph':
        # 子图：input/output 从其 Input/Output 节点取（单端口，取第一个）
        ins = [n for n in node.nodes.values() if type(n).__name__ == 'Input']
        outs = [n for n in node.nodes.values() if type(n).__name__ == 'Output']
        return {
            'type': 'NIRGraph',
            'input': [int(x) for x in np.atleast_1d(ins[0].input_type['input'])] if ins else None,
            'output': [int(x) for x in np.atleast_1d(outs[0].output_type['output'])] if outs else None,
        }
    rec = {
        'type': type(node).__name__,
        'input': None if node.input_type is None or node.input_type['input'] is None
        else [int(x) for x in np.atleast_1d(node.input_type['input'])],
        'output': None if node.output_type is None or node.output_type['output'] is None
        else [int(x) for x in np.atleast_1d(node.output_type['output'])],
    }
    if hasattr(node, 'input_shape') and node.input_shape is not None:
        rec['input_shape'] = [int(x) for x in np.atleast_1d(node.input_shape)]
    if type(node).__name__ == 'Flatten' and node.input_type['input'] is not None:
        rec['input_type'] = [int(x) for x in np.atleast_1d(node.input_type['input'])]
    return rec


def dump_graph(name, graph):
    graph.infer_types()
    return {
        'name': name,
        'nodes': {k: node_record(n) for k, n in graph.nodes.items()},
        'edges': [[a, b] for a, b in graph.edges],
    }


def build_graphs():
    graphs = []

    # 1. conv2d -> avgpool -> sumpool -> flatten -> lif -> output
    g1 = NIRGraph(
        nodes={
            'image': Input(input_type=np.array([1, 8, 8])),
            'conv': Conv2d(input_shape=(8, 8), weight=f32(2, 1, 3, 3), stride=1,
                           padding=0, dilation=1, groups=1, bias=f32(2)),
            'avg': AvgPool2d(kernel_size=np.array([2, 2]), stride=np.array([2, 2]),
                             padding=np.array([0, 0])),
            'sum': SumPool2d(kernel_size=np.array([3, 3]), stride=np.array([1, 1]),
                             padding=np.array([0, 0])),
            'flat': Flatten(input_type=None, start_dim=0, end_dim=-1),
            'neuron': LIF(tau=np.ones(2, np.float32) * 20, r=np.ones(2, np.float32),
                          v_leak=np.zeros(2, np.float32), v_threshold=np.ones(2, np.float32)),
            'out': Output(output_type=np.array([2])),
        },
        edges=[
            ('image', 'conv'), ('conv', 'avg'), ('avg', 'sum'), ('sum', 'flat'),
            ('flat', 'neuron'), ('neuron', 'out'),
        ],
    )
    graphs.append(dump_graph('conv_pool_flatten', g1))

    # 2. conv1d -> flatten -> linear -> affine -> output
    g2 = NIRGraph(
        nodes={
            'sig': Input(input_type=np.array([3, 10])),
            'conv': Conv1d(input_shape=10, weight=f32(4, 3, 3), stride=1, padding=0,
                           dilation=1, groups=1, bias=f32(4)),
            'flat': Flatten(input_type=None, start_dim=0, end_dim=-1),
            'lin': Linear(weight=f32(8, 32)),
            'aff': Affine(weight=f32(4, 8), bias=f32(4)),
            'out': Output(output_type=np.array([4])),
        },
        edges=[
            ('sig', 'conv'), ('conv', 'flat'), ('flat', 'lin'), ('lin', 'aff'),
            ('aff', 'out'),
        ],
    )
    graphs.append(dump_graph('conv1d_chain', g2))

    # 3. 嵌套子图
    sub = NIRGraph(
        nodes={
            'in': Input(input_type=np.array([4])),
            'lif': LIF(tau=np.ones(4, np.float32) * 20, r=np.ones(4, np.float32),
                       v_leak=np.zeros(4, np.float32), v_threshold=np.ones(4, np.float32)),
            'out': Output(output_type=np.array([4])),
        },
        edges=[('in', 'lif'), ('lif', 'out')],
    )
    g3 = NIRGraph(
        nodes={
            'inp': Input(input_type=np.array([4])),
            'block': sub,
            'out': Output(output_type=np.array([4])),
        },
        edges=[('inp', 'block'), ('block', 'out')],
    )
    graphs.append(dump_graph('nested_subgraph', g3))

    # 4. 根不是 Input、叶不是 Output：自动补 input_<名> / output_<名>
    g4 = NIRGraph(
        nodes={
            'a': LIF(tau=np.ones(4, np.float32) * 20, r=np.ones(4, np.float32),
                     v_leak=np.zeros(4, np.float32), v_threshold=np.ones(4, np.float32)),
            'b': LI(tau=np.ones(4, np.float32) * 20, r=np.ones(4, np.float32),
                    v_leak=np.zeros(4, np.float32)),
        },
        edges=[('a', 'b')],
    )
    graphs.append(dump_graph('auto_io', g4))

    # 5. 两输入汇到一个输出
    g5 = NIRGraph(
        nodes={
            'in1': Input(input_type=np.array([4])),
            'in2': Input(input_type=np.array([4])),
            'lif1': LIF(tau=np.ones(4, np.float32) * 20, r=np.ones(4, np.float32),
                        v_leak=np.zeros(4, np.float32), v_threshold=np.ones(4, np.float32)),
            'li1': LI(tau=np.ones(4, np.float32) * 20, r=np.ones(4, np.float32),
                      v_leak=np.zeros(4, np.float32)),
            'out': Output(output_type=np.array([4])),
        },
        edges=[('in1', 'lif1'), ('in2', 'li1'), ('lif1', 'out'), ('li1', 'out')],
    )
    graphs.append(dump_graph('two_branches', g5))

    # 6. same padding 的卷积（输出等于输入）
    g6 = NIRGraph(
        nodes={
            'img': Input(input_type=np.array([2, 8, 8])),
            'conv': Conv2d(input_shape=(8, 8), weight=f32(4, 2, 3, 3), stride=1,
                           padding='same', dilation=1, groups=1, bias=f32(4)),
            'out': Output(output_type=np.array([4, 8, 8])),
        },
        edges=[('img', 'conv'), ('conv', 'out')],
    )
    graphs.append(dump_graph('conv_same_padding', g6))

    return graphs


def main():
    graphs = build_graphs()
    with open('test/shape_expectations.json', 'w', encoding='utf-8') as f:
        json.dump({'graphs': graphs}, f, ensure_ascii=False, indent=1)
    for g in graphs:
        print(g['name'], 'nodes:', sorted(g['nodes']), 'edges:', g['edges'])


if __name__ == '__main__':
    main()
