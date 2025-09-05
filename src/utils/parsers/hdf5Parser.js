/**
 * HDF5格式NIR文件解析器
 * 使用 h5wasm 库解析真正的 HDF5 文件
 */

import * as h5wasm from 'h5wasm';

// 初始化 h5wasm（只需要初始化一次）
let h5wasmReady = false;
let h5wasmInitPromise = null;

async function initH5wasm() {
    if (h5wasmReady) return;
    if (h5wasmInitPromise) return h5wasmInitPromise;
    
    h5wasmInitPromise = h5wasm.ready.then(() => {
        h5wasmReady = true;
        console.log('✅ h5wasm 初始化成功');
    });
    
    return h5wasmInitPromise;
}

/**
 * 解析HDF5格式的NIR文件
 * @param {ArrayBuffer} arrayBuffer - 文件内容
 * @param {string} fileName - 文件名
 * @returns {Promise<object>} NIR图数据对象
 */
export async function parseHdf5(arrayBuffer, fileName) {
    console.log(`🔄 开始解析HDF5文件: ${fileName}`);
    
    try {
        // 初始化 h5wasm
        await initH5wasm();
        
        // 将 ArrayBuffer 写入虚拟文件系统
        const uint8Array = new Uint8Array(arrayBuffer);
        h5wasm.FS.writeFile(fileName, uint8Array);
        
        // 打开 HDF5 文件
        const file = new h5wasm.File(fileName, 'r');
        console.log('✅ HDF5 文件打开成功');
        
        // 解析 NIR 结构
        const nirData = parseNIRFromHDF5(file, fileName);
        
        // 关闭文件
        file.close();
        
        // 清理虚拟文件系统中的文件
        try {
            h5wasm.FS.unlink(fileName);
        } catch (e) {
            console.warn('清理临时文件失败:', e.message);
        }
        
        console.log('✅ HDF5 文件解析成功');
        return nirData;
        
    } catch (error) {
        console.error('❌ HDF5 文件解析失败:', error);
        
        // 清理可能残留的文件
        try {
            h5wasm.FS.unlink(fileName);
        } catch (e) {
            // 忽略清理错误
        }
        
        throw new Error(`无法解析 HDF5 格式的 NIR 文件 "${fileName}": ${error.message}`);
    }
}

/**
 * 从 HDF5 文件中解析 NIR 数据结构
 * @param {h5wasm.File} file - HDF5 文件对象
 * @param {string} fileName - 文件名
 * @returns {object} NIR图数据对象
 */
function parseNIRFromHDF5(file, fileName) {
    const nirData = {
        nodes: {},
        edges: [],
        input_type: {},
        output_type: {},
        metadata: {}
    };
    
    try {
        // 读取根级别的属性和数据集
        const rootKeys = file.keys();
        console.log(`📋 HDF5 根级别包含: ${rootKeys.join(', ')}`);
        
        // 解析 edges（连接关系）
        if (rootKeys.includes('edges')) {
            try {
                const edgesData = file.get('edges').value;
                nirData.edges = parseEdgesFromHDF5(edgesData);
                console.log(`🔗 解析到 ${nirData.edges.length} 条边`);
            } catch (e) {
                console.warn('解析 edges 失败:', e.message);
                nirData.edges = [];
            }
        }
        
        // 解析 input_type
        if (rootKeys.includes('input_type')) {
            try {
                nirData.input_type = parseTypeFromHDF5(file.get('input_type'));
                console.log('📥 解析到输入类型:', nirData.input_type);
            } catch (e) {
                console.warn('解析 input_type 失败:', e.message);
            }
        }
        
        // 解析 output_type
        if (rootKeys.includes('output_type')) {
            try {
                nirData.output_type = parseTypeFromHDF5(file.get('output_type'));
                console.log('📤 解析到输出类型:', nirData.output_type);
            } catch (e) {
                console.warn('解析 output_type 失败:', e.message);
            }
        }
        
        // 解析 metadata
        if (rootKeys.includes('metadata')) {
            try {
                nirData.metadata = parseMetadataFromHDF5(file.get('metadata'));
                console.log('📋 解析到元数据:', Object.keys(nirData.metadata));
            } catch (e) {
                console.warn('解析 metadata 失败:', e.message);
            }
        }
        
        // 解析 nodes（节点）
        if (rootKeys.includes('nodes')) {
            try {
                const nodesGroup = file.get('nodes');
                nirData.nodes = parseNodesFromHDF5(nodesGroup);
                console.log(`🎯 解析到 ${Object.keys(nirData.nodes).length} 个节点`);
            } catch (e) {
                console.warn('解析 nodes 失败:', e.message);
                nirData.nodes = {};
            }
        }
        
        // 检查是否有 'node' (单数形式，NIR HDF5 的标准格式)
        if (rootKeys.includes('node')) {
            try {
                const nodeGroup = file.get('node');
                const nodeGroupKeys = nodeGroup.keys();
                console.log(`📋 node 组包含: ${nodeGroupKeys.join(', ')}`);
                
                // 解析 node 组下的各个部分
                if (nodeGroupKeys.includes('nodes')) {
                    const actualNodesGroup = nodeGroup.get('nodes');
                    nirData.nodes = parseNodesFromHDF5(actualNodesGroup);
                    console.log(`🎯 解析到 ${Object.keys(nirData.nodes).length} 个节点 (从 node/nodes 组)`);
                }
                
                if (nodeGroupKeys.includes('edges')) {
                    try {
                        const edgesData = nodeGroup.get('edges').value;
                        nirData.edges = parseEdgesFromHDF5(edgesData);
                        console.log(`🔗 解析到 ${nirData.edges.length} 条边 (从 node/edges)`);
                    } catch (e) {
                        console.warn('解析 node/edges 失败:', e.message);
                    }
                }
                
                if (nodeGroupKeys.includes('metadata')) {
                    try {
                        nirData.metadata = parseMetadataFromHDF5(nodeGroup.get('metadata'));
                        console.log('📋 解析到元数据 (从 node/metadata)');
                    } catch (e) {
                        console.warn('解析 node/metadata 失败:', e.message);
                    }
                }
                
                if (nodeGroupKeys.includes('type')) {
                    try {
                        const typeData = nodeGroup.get('type').value;
                        nirData.input_type = { input: typeData };
                        nirData.output_type = { output: typeData };
                        console.log('📥📤 解析到类型信息 (从 node/type)');
                    } catch (e) {
                        console.warn('解析 node/type 失败:', e.message);
                    }
                }
                
            } catch (e) {
                console.warn('解析 node 组失败:', e.message);
            }
        }
        
        // 如果没有找到标准的 NIR 结构，尝试自动检测
        if (Object.keys(nirData.nodes).length === 0) {
            console.log('⚠️ 未找到标准 NIR 结构，尝试自动检测...');
            nirData.nodes = autoDetectNodes(file, rootKeys);
        }
        
        // 添加解析信息到元数据
        nirData.metadata = {
            ...nirData.metadata,
            parsed_from: 'HDF5',
            original_filename: fileName,
            parsed_date: new Date().toISOString(),
            h5wasm_version: 'latest'
        };
        
        return nirData;
        
    } catch (error) {
        throw new Error(`解析 NIR 数据结构失败: ${error.message}`);
    }
}

/**
 * 解析边数据
 */
function parseEdgesFromHDF5(edgesData) {
    console.log('🔍 原始边数据类型:', typeof edgesData, '长度:', edgesData?.length);
    console.log('🔍 边数据样本:', Array.isArray(edgesData) ? edgesData.slice(0, 4) : edgesData);
    
    // 如果是二维数组 (形状为 [n, 2])
    if (Array.isArray(edgesData) && edgesData.length > 0) {
        // 检查是否是二维数组
        if (Array.isArray(edgesData[0]) && edgesData[0].length === 2) {
            console.log('✅ 检测到二维边数组');
            return edgesData;
        }
        
        // 检查是否是扁平化的边数组
        if (edgesData.length % 2 === 0) {
            console.log('✅ 检测到扁平化边数组，进行重构');
            const edges = [];
            for (let i = 0; i < edgesData.length; i += 2) {
                edges.push([edgesData[i], edgesData[i + 1]]);
            }
            return edges;
        }
    }
    
    // 如果是 TypedArray 或其他格式，尝试转换
    if (edgesData && typeof edgesData.length === 'number') {
        const arr = Array.from(edgesData);
        console.log('🔄 转换为数组:', arr.slice(0, 6));
        
        if (arr.length % 2 === 0) {
            const edges = [];
            for (let i = 0; i < arr.length; i += 2) {
                edges.push([arr[i], arr[i + 1]]);
            }
            console.log('✅ 成功解析边数据:', edges.slice(0, 3));
            return edges;
        }
    }
    
    console.warn('⚠️ 无法解析边数据，返回空数组');
    return [];
}

/**
 * 解析类型信息
 */
function parseTypeFromHDF5(typeGroup) {
    const result = {};
    try {
        const keys = typeGroup.keys();
        for (const key of keys) {
            const value = typeGroup.get(key).value;
            result[key] = Array.isArray(value) ? value : [value];
        }
    } catch (e) {
        console.warn('解析类型信息失败:', e.message);
    }
    return result;
}

/**
 * 解析元数据
 */
function parseMetadataFromHDF5(metadataGroup) {
    const result = {};
    try {
        const keys = metadataGroup.keys();
        for (const key of keys) {
            try {
                result[key] = metadataGroup.get(key).value;
            } catch (e) {
                console.warn(`解析元数据 ${key} 失败:`, e.message);
            }
        }
    } catch (e) {
        console.warn('解析元数据失败:', e.message);
    }
    return result;
}

/**
 * 解析节点数据
 */
function parseNodesFromHDF5(nodesGroup) {
    const nodes = {};
    try {
        const nodeIds = nodesGroup.keys();
        console.log(`📋 找到节点: ${nodeIds.join(', ')}`);
        
        for (const nodeId of nodeIds) {
            try {
                const nodeGroup = nodesGroup.get(nodeId);
                nodes[nodeId] = parseNodeFromHDF5(nodeGroup, nodeId);
            } catch (e) {
                console.warn(`解析节点 ${nodeId} 失败:`, e.message);
                // 创建一个基本节点作为后备
                nodes[nodeId] = {
                    type: 'Unknown',
                    metadata: { name: nodeId, error: e.message }
                };
            }
        }
    } catch (e) {
        console.warn('解析节点组失败:', e.message);
    }
    return nodes;
}

/**
 * 解析单个节点
 */
function parseNodeFromHDF5(nodeGroup, nodeId) {
    const node = {
        type: 'Unknown',
        metadata: { name: nodeId }
    };
    
    try {
        const keys = nodeGroup.keys();
        
        // 查找节点类型
        if (keys.includes('type')) {
            node.type = nodeGroup.get('type').value;
        }
        
        // 解析各种属性
        const attributeNames = ['weight', 'bias', 'scale', 'threshold', 'delay', 'tau', 'r', 
                               'v_leak', 'v_threshold', 'v_reset', 'input_type', 'output_type'];
        
        for (const attr of attributeNames) {
            if (keys.includes(attr)) {
                try {
                    const value = nodeGroup.get(attr).value;
                    node[attr] = Array.isArray(value) ? value : [value];
                } catch (e) {
                    console.warn(`解析节点 ${nodeId} 的属性 ${attr} 失败:`, e.message);
                }
            }
        }
        
        // 解析元数据
        if (keys.includes('metadata')) {
            try {
                node.metadata = { ...node.metadata, ...parseMetadataFromHDF5(nodeGroup.get('metadata')) };
            } catch (e) {
                console.warn(`解析节点 ${nodeId} 的元数据失败:`, e.message);
            }
        }
        
    } catch (e) {
        console.warn(`解析节点 ${nodeId} 失败:`, e.message);
    }
    
    return node;
}

/**
 * 自动检测节点（当没有找到标准结构时）
 */
function autoDetectNodes(file, rootKeys) {
    const nodes = {};
    
    // 简单的启发式检测
    for (const key of rootKeys) {
        if (!['edges', 'input_type', 'output_type', 'metadata'].includes(key)) {
            try {
                const item = file.get(key);
                const itemKeys = item.keys ? item.keys() : [];
                
                // 如果包含常见的神经网络参数，认为是一个节点
                const commonParams = ['weight', 'bias', 'tau', 'threshold'];
                if (itemKeys.some(k => commonParams.includes(k))) {
                    nodes[key] = parseNodeFromHDF5(item, key);
                }
            } catch (e) {
                console.warn(`自动检测节点 ${key} 失败:`, e.message);
            }
        }
    }
    
    return nodes;
}