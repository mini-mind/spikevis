"""
NIR模型解析器
使用nirtorch解析NIR格式的神经网络模型
"""

import json
import nir
from typing import Dict, Any


class NIRParser:
    """NIR模型解析器"""
    
    def parse_nir_model(self, model_path: str) -> Dict[str, Any]:
        """
        解析NIR模型文件
        
        Args:
            model_path: 模型文件路径
            
        Returns:
            包含模型结构的字典
        """
        try:
            # 使用nir.read加载NIR文件
            nir_graph = nir.read(model_path)
            
            # 提取模型结构
            model_structure = {
                'nodes': [],
                'connections': []
            }
            
            # 提取节点信息
            for i, node in enumerate(nir_graph.nodes):
                node_info = {
                    'id': f"node_{i}",
                    'type': type(node).__name__,
                    'name': f"node_{i}"
                }
                model_structure['nodes'].append(node_info)
            
            # 提取连接信息（简化版本，假设顺序连接）
            for i in range(len(model_structure['nodes']) - 1):
                connection = {
                    'from': model_structure['nodes'][i]['id'],
                    'to': model_structure['nodes'][i + 1]['id'],
                    'type': 'forward'
                }
                model_structure['connections'].append(connection)
            
            return {
                'success': True,
                'model_name': model_path.split('/')[-1],
                'structure': model_structure,
                'metadata': {
                    'model_type': 'NIR',
                    'total_parameters': len(nir_graph.nodes)
                }
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def export_to_json(self, model_structure: Dict[str, Any], output_path: str) -> bool:
        """
        导出模型结构为JSON文件
        
        Args:
            model_structure: 模型结构字典
            output_path: 输出文件路径
            
        Returns:
            是否成功导出
        """
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(model_structure, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"导出失败: {e}")
            return False
