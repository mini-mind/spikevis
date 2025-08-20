/**
 * NIR文件解析工具
 * 基于NIR序列化代码翻译为JavaScript
 * 参考: https://raw.githubusercontent.com/neuromorphs/NIR/refs/heads/main/nir/serialization.py
 */

// 读取元数据
function _readMetadata(node) {
  if (node.metadata) {
    return { metadata: node.metadata }
  }
  return {}
}

// 尝试将字节转换为字符串
function tryByteToStr(a) {
  if (typeof a === 'string') {
    return a
  }
  // 如果是ArrayBuffer或其他二进制格式，尝试转换为字符串
  if (a instanceof ArrayBuffer) {
    return new TextDecoder().decode(a)
  }
  return a
}

// 读取节点
function readNode(node) {
  const nodeType = tryByteToStr(node.type)
  
  switch (nodeType) {
    case 'Affine':
      return {
        type: 'Affine',
        weight: node.weight,
        bias: node.bias,
        ..._readMetadata(node)
      }
    
    case 'Conv1d':
      return {
        type: 'Conv1d',
        input_shape: node.input_shape || null,
        weight: node.weight,
        stride: node.stride,
        padding: node.padding,
        dilation: node.dilation,
        groups: node.groups,
        bias: node.bias,
        ..._readMetadata(node)
      }
    
    case 'Conv2d':
      return {
        type: 'Conv2d',
        input_shape: node.input_shape || null,
        weight: node.weight,
        stride: node.stride,
        padding: node.padding,
        dilation: node.dilation,
        groups: node.groups,
        bias: node.bias,
        ..._readMetadata(node)
      }
    
    case 'SumPool2d':
      return {
        type: 'SumPool2d',
        kernel_size: node.kernel_size,
        stride: node.stride,
        padding: node.padding,
        ..._readMetadata(node)
      }
    
    case 'AvgPool2d':
      return {
        type: 'AvgPool2d',
        kernel_size: node.kernel_size,
        stride: node.stride,
        padding: node.padding,
        ..._readMetadata(node)
      }
    
    case 'Delay':
      return {
        type: 'Delay',
        delay: node.delay
      }
    
    case 'Flatten':
      return {
        type: 'Flatten',
        start_dim: node.start_dim,
        end_dim: node.end_dim,
        input_type: {
          input: node.input_type || null
        },
        ..._readMetadata(node)
      }
    
    case 'I':
      return {
        type: 'I',
        r: node.r,
        ..._readMetadata(node)
      }
    
    case 'IF':
      return {
        type: 'IF',
        r: node.r,
        v_reset: node.v_reset || new Array(node.v_threshold.length).fill(0),
        v_threshold: node.v_threshold,
        ..._readMetadata(node)
      }
    
    case 'Input':
      return {
        type: 'Input',
        input_type: { input: node.shape },
        ..._readMetadata(node)
      }
    
    case 'LI':
      return {
        type: 'LI',
        tau: node.tau,
        r: node.r,
        v_leak: node.v_leak,
        ..._readMetadata(node)
      }
    
    case 'Linear':
      return {
        type: 'Linear',
        weight: node.weight,
        ..._readMetadata(node)
      }
    
    case 'LIF':
      return {
        type: 'LIF',
        tau: node.tau,
        r: node.r,
        v_leak: node.v_leak,
        v_reset: node.v_reset || new Array(node.v_threshold.length).fill(0),
        v_threshold: node.v_threshold,
        ..._readMetadata(node)
      }
    
    case 'CubaLI':
      return {
        type: 'CubaLI',
        tau_mem: node.tau_mem,
        tau_syn: node.tau_syn,
        r: node.r,
        v_leak: node.v_leak,
        w_in: node.w_in,
        ..._readMetadata(node)
      }
    
    case 'CubaLIF':
      return {
        type: 'CubaLIF',
        tau_mem: node.tau_mem,
        tau_syn: node.tau_syn,
        r: node.r,
        v_leak: node.v_leak,
        v_reset: node.v_reset || new Array(node.v_threshold.length).fill(0),
        v_threshold: node.v_threshold,
        w_in: node.w_in,
        ..._readMetadata(node)
      }
    
    case 'NIRGraph':
      return {
        type: 'NIRGraph',
        nodes: Object.fromEntries(
          Object.entries(node.nodes).map(([k, n]) => [k, readNode(n)])
        ),
        edges: node.edges.map(([a, b]) => [tryByteToStr(a), tryByteToStr(b)]),
        ..._readMetadata(node)
      }
    
    case 'Output':
      return {
        type: 'Output',
        output_type: { output: node.shape },
        ..._readMetadata(node)
      }
    
    case 'Scale':
      return {
        type: 'Scale',
        scale: node.scale,
        ..._readMetadata(node)
      }
    
    case 'Threshold':
      return {
        type: 'Threshold',
        threshold: node.threshold,
        ..._readMetadata(node)
      }
    
    default:
      throw new Error(`Unknown unit type: ${nodeType}`)
  }
}

// HDF5字典转换
function hdf2dict(node) {
  const ret = {}
  
  function readHdfToDict(node, dataDict) {
    for (const [key, item] of Object.entries(node)) {
      const cleanKey = tryByteToStr(key)
      
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        dataDict[cleanKey] = {}
        readHdfToDict(item, dataDict[cleanKey])
      } else {
        dataDict[cleanKey] = tryByteToStr(item)
      }
    }
  }
  
  readHdfToDict(node, ret)
  return ret
}

// 读取NIR文件
async function readNIRFile(file) {
  try {
    // 检查文件扩展名
    const validExtensions = ['.nir', '.h5', '.hdf5', '.json']
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    
    if (!validExtensions.includes(fileExtension)) {
      throw new Error('不支持的文件格式，请选择.nir、.h5、.hdf5或.json文件')
    }
    
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer()
    
    // 首先尝试JSON解析（适用于.nir和.json文件）
    try {
      const text = new TextDecoder().decode(arrayBuffer)
      const jsonData = JSON.parse(text)
      
      // 检查是否是有效的NIR格式
      if (jsonData.nodes && jsonData.edges) {
        console.log('成功解析JSON格式的NIR文件')
        return {
          nodes: jsonData.nodes,
          edges: jsonData.edges,
          input_type: jsonData.input_type,
          output_type: jsonData.output_type,
          version: jsonData.version || '1.0'
        }
      } else {
        throw new Error('JSON文件格式不正确，缺少nodes或edges字段')
      }
    } catch (jsonError) {
      console.log('文件不是有效的JSON格式:', jsonError.message)
      
      // 如果不是JSON格式，检查是否是HDF5文件
      if (fileExtension === '.h5' || fileExtension === '.hdf5') {
        throw new Error('HDF5文件解析需要额外的库支持，请使用JSON格式的NIR文件')
      } else {
        throw new Error('文件格式无法识别，请确保文件是有效的NIR格式')
      }
    }
    
  } catch (error) {
    console.error('读取NIR文件失败:', error)
    throw error
  }
}

// 导出函数
export {
  readNIRFile,
  readNode,
  hdf2dict,
  tryByteToStr
}
