#!/usr/bin/env python3
"""
NIR模型可视化脚本
解析NIR模型并生成Mermaid图表文件
"""

import sys
import os
import argparse
from pathlib import Path

# 添加src目录到路径
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from nir_parser import NIRParser
from mermaid_generator import MermaidGenerator


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='NIR模型可视化工具')
    parser.add_argument('model_path', help='NIR模型文件路径')
    parser.add_argument('-o', '--output', help='输出文件路径 (默认: 模型名_diagram.mmd)')
    
    args = parser.parse_args()
    
    # 检查文件是否存在
    if not os.path.exists(args.model_path):
        print(f"错误: 文件不存在 - {args.model_path}")
        return 1
    
    # 确定输出路径
    if args.output:
        output_path = args.output
    else:
        model_name = Path(args.model_path).stem
        output_path = f"{model_name}_diagram.mmd"
    
    try:
        print(f"正在解析模型: {args.model_path}")
        
        # 解析模型
        nir_parser = NIRParser()
        model_structure = nir_parser.parse_nir_model(args.model_path)
        
        if not model_structure['success']:
            print(f"解析失败: {model_structure['error']}")
            return 1
        
        # 显示模型信息
        print(f"模型名称: {model_structure.get('model_name', 'Unknown')}")
        print(f"节点数量: {len(model_structure['structure'].get('nodes', []))}")
        
        # 生成Mermaid图表
        mermaid_gen = MermaidGenerator()
        mermaid_code = mermaid_gen.generate_mermaid_diagram(model_structure)
        
        # 保存Mermaid文件
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(mermaid_code)
        
        print(f"Mermaid图表已保存: {output_path}")
        return 0
        
    except Exception as e:
        print(f"处理错误: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
