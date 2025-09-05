#!/usr/bin/env node
/**
 * 测试解析器对Python生成的NIR模型文件的处理能力
 * 使用 CommonJS 语法，直接测试解析逻辑
 */

const fs = require('fs');
const path = require('path');

// 模拟浏览器环境的 TextDecoder
if (typeof TextDecoder === 'undefined') {
    global.TextDecoder = require('util').TextDecoder;
}

// 直接实现解析逻辑，避免ES模块导入问题
function parseJson(arrayBuffer) {
    try {
        const text = new TextDecoder().decode(arrayBuffer);
        const jsonData = JSON.parse(text);

        // 检查是否是有效的NIR格式
        if (jsonData.nodes && jsonData.edges) {
            console.log('✅ JSON格式解析成功');
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
        throw new Error(`无法将文件解析为JSON格式的NIR模型: ${error.message}`);
    }
}

function parseHdf5(arrayBuffer, fileName) {
    // 检查HDF5文件头
    const header = new Uint8Array(arrayBuffer.slice(0, 8));
    const hdf5Signature = [0x89, 0x48, 0x44, 0x46]; // "\x89HDF"
    
    let isHdf5 = true;
    for (let i = 0; i < 4; i++) {
        if (header[i] !== hdf5Signature[i]) {
            isHdf5 = false;
            break;
        }
    }
    
    if (isHdf5) {
        throw new Error(`检测到HDF5格式的NIR文件：${fileName}。浏览器无法直接解析HDF5格式，需要转换为JSON。`);
    } else {
        throw new Error(`文件 ${fileName} 不是有效的HDF5格式文件。`);
    }
}

function getParserForFile(fileName, arrayBuffer) {
    const fileExtension = path.extname(fileName).toLowerCase();

    if (fileExtension === '.json') {
        return parseJson(arrayBuffer);
    } else if (fileExtension === '.nir') {
        // .nir 文件可能是 JSON 或 HDF5 格式，需要检测
        try {
            // 首先尝试作为 JSON 解析
            return parseJson(arrayBuffer);
        } catch (jsonError) {
            // 如果 JSON 解析失败，检查是否为 HDF5 格式
            try {
                return parseHdf5(arrayBuffer, fileName);
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

// 测试单个文件
function testFile(filePath) {
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(fileName).toLowerCase();
    
    console.log(`\n🧪 测试文件: ${fileName}`);
    console.log(`📁 路径: ${filePath}`);
    console.log(`📄 扩展名: ${fileExtension}`);
    
    try {
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            console.log(`❌ 文件不存在`);
            return { success: false, fileName, fileExtension, error: '文件不存在' };
        }
        
        // 读取文件
        const buffer = fs.readFileSync(filePath);
        console.log(`📊 文件大小: ${buffer.length} 字节`);
        
        // 检查文件头部
        const header = buffer.slice(0, 20);
        console.log(`🔍 文件头部(hex): ${header.toString('hex').slice(0, 40)}...`);
        
        // 尝试显示文件头部的可读文本
        let headerText = '';
        for (let i = 0; i < Math.min(20, header.length); i++) {
            const char = header[i];
            if (char >= 32 && char <= 126) {
                headerText += String.fromCharCode(char);
            } else {
                headerText += '�';
            }
        }
        console.log(`📝 文件头部(文本): ${headerText}`);
        
        // 转换为 ArrayBuffer
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        
        // 使用解析器测试
        console.log(`⚙️  开始解析...`);
        const result = getParserForFile(fileName, arrayBuffer);
        
        // 检查解析结果
        if (result && typeof result === 'object') {
            console.log(`✅ 解析成功!`);
            console.log(`📋 节点数量: ${result.nodes ? Object.keys(result.nodes).length : '未知'}`);
            console.log(`🔗 边数量: ${result.edges ? result.edges.length : '未知'}`);
            
            if (result.nodes) {
                const nodeTypes = Object.values(result.nodes).map(node => node.type);
                const uniqueTypes = [...new Set(nodeTypes)];
                console.log(`🎯 节点类型: ${uniqueTypes.join(', ')}`);
            }
            
            if (result.input_type) {
                console.log(`📥 输入类型: ${JSON.stringify(result.input_type)}`);
            }
            
            if (result.output_type) {
                console.log(`📤 输出类型: ${JSON.stringify(result.output_type)}`);
            }
            
            return { success: true, fileName, fileExtension, result };
        } else {
            console.log(`❌ 解析失败: 返回结果无效`);
            return { success: false, fileName, fileExtension, error: '返回结果无效' };
        }
        
    } catch (error) {
        console.log(`❌ 解析失败: ${error.message}`);
        return { success: false, fileName, fileExtension, error: error.message };
    }
}

// 主测试函数
function main() {
    console.log('🚀 开始测试 NIR 解析器\n');
    console.log('='.repeat(50));
    
    const testDir = __dirname;
    console.log(`📂 测试目录: ${testDir}`);
    
    try {
        const files = fs.readdirSync(testDir);
        const testFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.json', '.nir'].includes(ext);
        });
        
        console.log(`📋 找到 ${testFiles.length} 个测试文件: ${testFiles.join(', ')}`);
        
        if (testFiles.length === 0) {
            console.log('⚠️  没有找到可测试的文件 (.json 或 .nir)');
            return;
        }
        
        // 测试结果统计
        const results = [];
        
        // 逐个测试文件
        for (const file of testFiles) {
            const filePath = path.join(testDir, file);
            const result = testFile(filePath);
            results.push(result);
        }
        
        // 生成测试报告
        console.log('\n' + '='.repeat(50));
        console.log('📊 测试报告');
        console.log('='.repeat(50));
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        console.log(`\n✅ 成功解析: ${successful.length} 个文件`);
        successful.forEach(result => {
            console.log(`   • ${result.fileName} (${result.fileExtension})`);
        });
        
        console.log(`\n❌ 解析失败: ${failed.length} 个文件`);
        failed.forEach(result => {
            console.log(`   • ${result.fileName} (${result.fileExtension})`);
            console.log(`     原因: ${result.error.split('\n')[0]}`); // 只显示第一行错误信息
        });
        
        // 按格式统计
        const formatStats = {};
        results.forEach(result => {
            const ext = result.fileExtension;
            if (!formatStats[ext]) {
                formatStats[ext] = { total: 0, success: 0, failed: 0 };
            }
            formatStats[ext].total++;
            if (result.success) {
                formatStats[ext].success++;
            } else {
                formatStats[ext].failed++;
            }
        });
        
        console.log(`\n📈 格式统计:`);
        Object.entries(formatStats).forEach(([ext, stats]) => {
            const percentage = Math.round(stats.success/stats.total*100);
            console.log(`   ${ext}: ${stats.success}/${stats.total} 成功 (${percentage}%)`);
        });
        
        // 最终结论
        console.log(`\n🎯 最终结论:`);
        const supportedFormats = [];
        const unsupportedFormats = [];
        
        Object.entries(formatStats).forEach(([ext, stats]) => {
            if (stats.success > 0) {
                supportedFormats.push(`${ext} (${Math.round(stats.success/stats.total*100)}%)`);
            } else {
                unsupportedFormats.push(ext);
            }
        });
        
        if (supportedFormats.length > 0) {
            console.log(`   ✅ 支持的格式: ${supportedFormats.join(', ')}`);
        }
        
        if (unsupportedFormats.length > 0) {
            console.log(`   ❌ 不支持的格式: ${unsupportedFormats.join(', ')}`);
        }
        
    } catch (error) {
        console.error('❌ 测试过程中出现错误:', error);
    }
}

// 运行测试
main();
