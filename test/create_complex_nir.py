#!/usr/bin/env python3
"""
创建包含多种NIR算子的复杂测试模型
放置在test目录下
"""

import numpy as np
from nir import *

def create_complex_nir_model():
    """创建一个包含多种NIR算子的复杂测试模型"""
    
    print("开始创建复杂的NIR测试模型...")
    
    # 1. 输入节点
    input_node = Input(
        input_type={'input': np.array([784])},
        metadata={'name': 'input_layer', 'description': 'MNIST图像输入'}
    )
    
    # 2. 线性层
    linear1 = Linear(
        weight=np.random.randn(512, 784).astype(np.float32),
        metadata={'name': 'linear1', 'description': '第一层线性变换'}
    )
    
    # 3. 缩放层
    scale1 = Scale(
        scale=np.random.randn(512).astype(np.float32),
        metadata={'name': 'scale1', 'description': '缩放层'}
    )
    
    # 4. 仿射层
    affine1 = Affine(
        weight=np.random.randn(256, 512).astype(np.float32),
        bias=np.random.randn(256).astype(np.float32),
        metadata={'name': 'affine1', 'description': '第一层仿射变换'}
    )
    
    # 5. 阈值层 - 修复维度问题
    threshold1 = Threshold(
        threshold=np.random.randn(256).astype(np.float32),  # 改为256维
        metadata={'name': 'threshold1', 'description': '阈值层'}
    )
    
    # 6. 延迟层 - 修复维度问题
    delay1 = Delay(
        delay=np.random.randn(256).astype(np.float32),  # 改为256维
        metadata={'name': 'delay1', 'description': '延迟层'}
    )
    
    # 7. LIF神经元层 - 修复参数
    lif1 = LIF(
        tau=np.random.randn(256).astype(np.float32) * 20.0 + 20.0,  # 256维，范围20-40
        r=np.random.randn(256).astype(np.float32) * 0.5 + 1.0,      # 256维，范围0.5-1.5
        v_leak=np.random.randn(256).astype(np.float32) * 0.1,        # 256维，范围-0.1到0.1
        v_threshold=np.random.randn(256).astype(np.float32) * 0.5 + 1.0,  # 256维，范围0.5-1.5
        v_reset=np.random.randn(256).astype(np.float32) * 0.1,       # 256维，范围-0.1到0.1
        metadata={'name': 'lif1', 'description': 'LIF神经元层'}
    )
    
    # 8. LI神经元层 - 修复参数
    li1 = LI(
        tau=np.random.randn(256).astype(np.float32) * 20.0 + 20.0,  # 256维，范围20-40
        r=np.random.randn(256).astype(np.float32) * 0.5 + 1.0,      # 256维，范围0.5-1.5
        v_leak=np.random.randn(256).astype(np.float32) * 0.1,        # 256维，范围-0.1到0.1
        metadata={'name': 'li1', 'description': 'LI神经元层'}
    )
    
    # 9. IF神经元层 - 修复参数
    if1 = IF(
        r=np.random.randn(256).astype(np.float32) * 0.5 + 1.0,      # 256维，范围0.5-1.5
        v_threshold=np.random.randn(256).astype(np.float32) * 0.5 + 1.0,  # 256维，范围0.5-1.5
        v_reset=np.random.randn(256).astype(np.float32) * 0.1,       # 256维，范围-0.1到0.1
        metadata={'name': 'if1', 'description': 'IF神经元层'}
    )
    
    # 10. 积分器层 - 修复参数
    integrator1 = I(
        r=np.random.randn(256).astype(np.float32) * 0.5 + 1.0,      # 256维，范围0.5-1.5
        metadata={'name': 'integrator1', 'description': '积分器层'}
    )
    
    # 11. 最终输出层
    output_layer = Affine(
        weight=np.random.randn(10, 256).astype(np.float32),
        bias=np.random.randn(10).astype(np.float32),
        metadata={'name': 'output_layer', 'description': '最终输出层'}
    )
    
    # 12. 输出节点
    output_node = Output(
        output_type={'output': np.array([10])},
        metadata={'name': 'output_node', 'description': '模型输出'}
    )
    
    # 创建图结构
    nodes = {
        'input': input_node,
        'linear1': linear1,
        'scale1': scale1,
        'affine1': affine1,
        'threshold1': threshold1,
        'delay1': delay1,
        'lif1': lif1,
        'li1': li1,
        'if1': if1,
        'integrator1': integrator1,
        'output_layer': output_layer,
        'output': output_node
    }
    
    # 定义边连接 - 创建一个包含所有算子的路径，确保维度一致性
    edges = [
        ('input', 'linear1'),           # 784 -> 512
        ('linear1', 'scale1'),          # 512 -> 512
        ('scale1', 'affine1'),          # 512 -> 256
        ('affine1', 'threshold1'),      # 256 -> 256
        ('threshold1', 'delay1'),       # 256 -> 256
        ('delay1', 'lif1'),             # 256 -> 256
        ('lif1', 'li1'),                # 256 -> 256
        ('li1', 'if1'),                 # 256 -> 256
        ('if1', 'integrator1'),         # 256 -> 256
        ('integrator1', 'output_layer'), # 256 -> 10
        ('output_layer', 'output')      # 10 -> 10
    ]
    
    # 创建NIR图
    graph = NIRGraph(
        nodes=nodes,
        edges=edges,
        input_type={'input': np.array([784])},
        output_type={'output': np.array([10])},
        metadata={
            'name': 'complex_nir_test_model',
            'description': '包含多种NIR算子的复杂测试模型',
            'author': 'NIR Test Suite',
            'version': '1.0.0',
            'created_date': '2024-01-01',
            'operators': [
                'Input', 'Linear', 'Scale', 'Affine', 'Threshold', 'Delay', 
                'LIF', 'LI', 'IF', 'I', 'Output'
            ]
        }
    )
    
    print("复杂测试模型创建完成！")
    print(f"节点数量: {len(nodes)}")
    print(f"边数量: {len(edges)}")
    print("\n包含的算子类型:")
    for node_id, node in nodes.items():
        print(f"  - {node_id}: {type(node).__name__}")
    
    return graph

def save_as_json(graph, filename):
    """将 NIR 图保存为 JSON 格式"""
    import json
    import numpy as np
    
    def convert_numpy_to_list(obj):
        """递归转换 numpy 数组为列表"""
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, dict):
            return {k: convert_numpy_to_list(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_numpy_to_list(item) for item in obj]
        elif isinstance(obj, tuple):
            return tuple(convert_numpy_to_list(item) for item in obj)
        else:
            return obj
    
    # 转换图数据
    json_data = {
        'nodes': {},
        'edges': convert_numpy_to_list(graph.edges),
        'input_type': convert_numpy_to_list(graph.input_type),
        'output_type': convert_numpy_to_list(graph.output_type),
        'metadata': convert_numpy_to_list(graph.metadata)
    }
    
    # 转换节点数据
    for node_id, node in graph.nodes.items():
        node_data = {
            'type': type(node).__name__,
            'metadata': convert_numpy_to_list(node.metadata) if hasattr(node, 'metadata') else {}
        }
        
        # 添加节点特有的属性
        for attr in ['weight', 'bias', 'scale', 'threshold', 'delay', 'tau', 'r', 
                     'v_leak', 'v_threshold', 'v_reset', 'input_type', 'output_type']:
            if hasattr(node, attr) and getattr(node, attr) is not None:
                node_data[attr] = convert_numpy_to_list(getattr(node, attr))
        
        json_data['nodes'][node_id] = node_data
    
    # 保存为 JSON 文件
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=True)

def save_simple_model_as_json(filename):
    """保存一个简单的 NIR 模型为 JSON 格式"""
    import json
    
    simple_model = {
        'nodes': {
            'input': {
                'type': 'Input',
                'input_type': {'input': [784]},
                'metadata': {'name': 'input_layer', 'description': '输入层'}
            },
            'linear1': {
                'type': 'Linear',
                'weight': [[0.1, 0.2, 0.3] * 261 + [0.1, 0.2]][:784],  # 简化权重
                'metadata': {'name': 'linear1', 'description': '线性层'}
            },
            'lif1': {
                'type': 'LIF',
                'tau': [20.0],
                'r': [1.0],
                'v_leak': [0.0],
                'v_threshold': [1.0],
                'v_reset': [0.0],
                'metadata': {'name': 'lif1', 'description': 'LIF神经元层'}
            },
            'output': {
                'type': 'Output',
                'output_type': {'output': [10]},
                'metadata': {'name': 'output_layer', 'description': '输出层'}
            }
        },
        'edges': [
            ['input', 'linear1'],
            ['linear1', 'lif1'],
            ['lif1', 'output']
        ],
        'input_type': {'input': [784]},
        'output_type': {'output': [10]},
        'metadata': {
            'name': 'simple_nir_model',
            'description': '简单的NIR测试模型',
            'version': '1.0'
        }
    }
    
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(simple_model, f, indent=2, ensure_ascii=True)

def main():
    """主函数"""
    try:
        # 创建复杂的测试模型
        complex_graph = create_complex_nir_model()
        
        # 保存多种格式的测试模型
        
        # 1. 保存为标准 NIR (HDF5) 格式
        nir_file = 'complex_nir_test_model.nir'
        write(nir_file, complex_graph)
        print(f"\n复杂测试模型已保存到: {nir_file} (HDF5格式)")
        
        # 2. 保存为 JSON 格式，用于前端直接加载
        json_file = 'complex_nir_test_model_json.json'
        save_as_json(complex_graph, json_file)
        print(f"复杂测试模型已保存到: {json_file} (JSON格式)")
        
        # 3. 保存为简化的 JSON 格式
        simple_json_file = 'simple_nir_model.json'
        save_simple_model_as_json(simple_json_file)
        print(f"简单测试模型已保存到: {simple_json_file} (JSON格式)")
        
        # 验证 HDF5 文件
        print("\n验证保存的 HDF5 文件...")
        loaded_graph = read(nir_file)
        print(f"测试模型加载成功！节点数: {len(loaded_graph.nodes)}")
        
        # 显示模型信息
        print(f"\n测试模型信息:")
        print(f"输入类型: {loaded_graph.input_type}")
        print(f"输出类型: {loaded_graph.output_type}")
        print(f"元数据: {loaded_graph.metadata}")
        
        # 显示所有算子类型
        print(f"\n包含的算子类型统计:")
        operator_types = {}
        for node_id, node in loaded_graph.nodes.items():
            op_type = type(node).__name__
            if op_type not in operator_types:
                operator_types[op_type] = []
            operator_types[op_type].append(node_id)
        
        for op_type, node_ids in operator_types.items():
            print(f"  {op_type}: {len(node_ids)}个 ({', '.join(node_ids)})")
        
        print(f"\n总共包含 {len(operator_types)} 种不同的算子类型")
        
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
