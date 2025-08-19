"""
Mermaid图表生成器
将NIR模型结构转换为Mermaid流程图语法
"""

from typing import Dict, Any


class MermaidGenerator:
    """Mermaid图表生成器"""
    
    def generate_mermaid_diagram(self, model_structure: Dict[str, Any]) -> str:
        """
        生成Mermaid流程图语法
        
        Args:
            model_structure: 模型结构字典
            
        Returns:
            Mermaid语法字符串
        """
        if not model_structure.get('success', False):
            return self._generate_error_diagram(model_structure.get('error', '未知错误'))
        
        structure = model_structure['structure']
        nodes = structure.get('nodes', [])
        connections = structure.get('connections', [])
        
        # 生成Mermaid语法
        mermaid_code = "graph TD\n"
        
        # 添加节点
        for node in nodes:
            node_id = self._sanitize_id(node['id'])
            node_label = f"{node['type']}<br/>{node['name']}"
            
            mermaid_code += f"    {node_id}[{node_label}]\n"
        
        # 添加连接
        for conn in connections:
            from_id = self._sanitize_id(conn['from'])
            to_id = self._sanitize_id(conn['to'])
            mermaid_code += f"    {from_id} --> {to_id}\n"
        
        return mermaid_code
    
    def _sanitize_id(self, node_id: str) -> str:
        """清理节点ID，确保符合Mermaid语法"""
        # 替换特殊字符
        sanitized = node_id.replace('.', '_').replace('-', '_').replace(' ', '_')
        # 确保以字母开头
        if sanitized and not sanitized[0].isalpha():
            sanitized = 'node_' + sanitized
        return sanitized
    
    def _generate_error_diagram(self, error_msg: str) -> str:
        """生成错误提示图"""
        return f"""graph TD
    error[错误]
    msg["{error_msg}"]
    error --> msg"""
