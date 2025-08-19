#!/usr/bin/env python3
"""
使用snnTorch创建示例NIR模型
"""

import nir
import numpy as np
from pathlib import Path


def create_simple_snn():
    """创建简单的SNN模型"""
    print("创建简单SNN模型...")
    
    # 直接创建NIR节点
    input_node = nir.Input(input_type=np.array([784]))
    linear1_node = nir.Linear(
        weight=np.random.randn(128, 784).astype(np.float32)
    )
    linear2_node = nir.Linear(
        weight=np.random.randn(10, 128).astype(np.float32)
    )
    output_node = nir.Output(output_type=np.array([10]))
    
    # 创建NIR图
    nir_graph = nir.NIRGraph.from_list(
        input_node, linear1_node, linear2_node, output_node
    )
    
    # 保存NIR文件
    output_path = "simple_snn.nir"
    nir.write(output_path, nir_graph)
    print(f"简单SNN模型已保存: {output_path}")
    
    return output_path


def main():
    """主函数"""
    print("开始创建示例NIR模型...")
    
    try:
        # 创建简单SNN
        simple_model = create_simple_snn()
        
        print("\n模型创建完成！")
        print(f"简单SNN: {simple_model}")
        print("\n现在可以使用以下命令生成可视化图表：")
        print(f"python generate_mermaid.py {simple_model}")
        
    except Exception as e:
        print(f"创建模型时出错: {e}")


if __name__ == "__main__":
    main()
