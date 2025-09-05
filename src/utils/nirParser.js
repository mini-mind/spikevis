/**
 * NIR文件解析工具入口
 * 负责读取文件并委托给相应的解析器
 */
import { getParserForFile } from './parsers';

/**
 * 读取并解析任何支持的NIR模型文件
 * @param {File} file - 用户上传的文件对象
 * @returns {Promise<object>} 解析后的NIR图数据对象
 */
export async function readNIRFile(file) {
    try {
        // 读取文件内容为ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        
        // 获取并使用合适的解析器
        return await getParserForFile(file, arrayBuffer);
        
    } catch (error) {
        console.error('读取或解析NIR文件失败:', error);
        // 将底层错误信息传递给上层UI
        throw error;
    }
}
