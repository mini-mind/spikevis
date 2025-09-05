/**
 * JSON格式NIR文件解析器
 */
export async function parseJson(arrayBuffer) {
    try {
        const text = new TextDecoder().decode(arrayBuffer);
        const jsonData = JSON.parse(text);

        // 检查是否是有效的NIR格式
        if (jsonData.nodes && jsonData.edges) {
            console.log('成功解析JSON格式的NIR文件');
            return {
                nodes: jsonData.nodes,
                edges: jsonData.edges,
                input_type: jsonData.input_type,
                output_type: jsonData.output_type,
                metadata: jsonData.metadata,
                version: jsonData.version || '1.0'
            };
        } else {
            throw new Error('JSON文件格式不正确，缺少nodes或edges字段');
        }
    } catch (error) {
        console.error('JSON解析失败:', error);
        throw new Error(`无法将文件解析为JSON格式的NIR模型: ${error.message}`);
    }
}
