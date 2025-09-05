import { parseJson } from './jsonParser';
import { parseHdf5 } from './hdf5Parser';

/**
 * 根据文件类型选择合适的解析器
 * @param {File} file - 用户上传的文件对象
 * @param {ArrayBuffer} arrayBuffer - 文件内容的ArrayBuffer
 * @returns {Promise<object>} 解析后的NIR图数据对象
 */
export async function getParserForFile(file, arrayBuffer) {
    const fileName = file.name;
    const fileExtension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));

    if (fileExtension === '.json') {
        return parseJson(arrayBuffer);
    } else if (fileExtension === '.nir') {
        // .nir 文件可能是 JSON 或 HDF5 格式，需要检测
        try {
            // 首先尝试作为 JSON 解析
            return await parseJson(arrayBuffer);
        } catch (jsonError) {
            // 如果 JSON 解析失败，检查是否为 HDF5 格式
            try {
                return await parseHdf5(arrayBuffer, fileName);
            } catch (hdf5Error) {
                // 如果都不是，抛出更详细的错误信息
                throw new Error(`无法解析 .nir 文件 "${fileName}"。
                
该文件既不是有效的 JSON 格式，也不是有效的 HDF5 格式。

JSON 解析错误: ${jsonError.message}
HDF5 检测错误: ${hdf5Error.message}

请确保文件是有效的 NIR 格式文件。`);
            }
        }
    } else {
        throw new Error(`不支持的文件格式: ${fileExtension}。目前只支持 .nir 和 .json 文件。`);
    }
}
