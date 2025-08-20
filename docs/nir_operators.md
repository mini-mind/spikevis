# NIR算子文档

NIR (Neuromorphic Intermediate Representation) 提供了丰富的算子来构建脉冲神经网络模型。本文档整理了所有可用的算子类型及其用法。

## 目录

- [基础算子](#基础算子)
- [神经元模型](#神经元模型)
- [卷积算子](#卷积算子)
- [池化算子](#池化算子)
- [变换算子](#变换算子)
- [图结构](#图结构)
- [文件操作](#文件操作)

## 基础算子

### Input
输入节点，用于向图中输入数据。

```python
from nir import Input

# 创建输入节点
input_node = Input(
    input_type={'input': np.array([10])},  # 输入形状
    metadata={'name': 'input_layer'}
)
```

### Output
输出节点，定义图的输出。

```python
from nir import Output

# 创建输出节点
output_node = Output(
    output_type={'output': np.array([5])},  # 输出形状
    metadata={'name': 'output_layer'}
)
```

### Linear
线性变换（无偏置）：

```python
from nir import Linear

# 创建线性层
linear = Linear(
    weight=np.random.randn(5, 10),  # 权重矩阵
    metadata={'name': 'linear_layer'}
)
```

### Affine
仿射变换（带偏置）：

```python
from nir import Affine

# 创建仿射层
affine = Affine(
    weight=np.random.randn(5, 10),  # 权重矩阵
    bias=np.random.randn(5),        # 偏置向量
    input_type={'input': np.array([10])},
    output_type={'output': np.array([5])},
    metadata={'name': 'affine_layer'}
)
```

### Scale
缩放算子，对信号进行逐元素缩放：

```python
from nir import Scale

# 创建缩放层
scale = Scale(
    scale=np.array([1.5, 0.8, 2.0]),  # 缩放因子
    metadata={'name': 'scale_layer'}
)
```

### Threshold
阈值算子，实现Heaviside阶跃函数：

```python
from nir import Threshold

# 创建阈值层
threshold = Threshold(
    threshold=np.array([0.5]),  # 阈值
    input_type={'input': np.array([10])},
    output_type={'output': np.array([10])},
    metadata={'name': 'threshold_layer'}
)
```

### Delay
延迟算子，用于时间延迟：

```python
from nir import Delay

# 创建延迟层
delay = Delay(
    delay=1,  # 延迟步数
    metadata={'name': 'delay_layer'}
)
```

## 神经元模型

### LIF (Leaky Integrate-and-Fire)
漏积分发放神经元模型：

```python
from nir import LIF

# 创建LIF神经元
lif = LIF(
    tau=np.array([20.0]),           # 时间常数
    r=np.array([1.0]),              # 电阻
    v_leak=np.array([0.0]),         # 漏电压
    v_threshold=np.array([1.0]),    # 阈值电压
    v_reset=np.array([0.0]),        # 重置电压
    input_type={'input': np.array([10])},
    output_type={'output': np.array([10])},
    metadata={'name': 'lif_neurons'}
)
```

### LI (Leaky Integrator)
漏积分器模型：

```python
from nir import LI

# 创建LI神经元
li = LI(
    tau=np.array([20.0]),           # 时间常数
    r=np.array([1.0]),              # 电阻
    v_leak=np.array([0.0]),         # 漏电压
    input_type={'input': np.array([10])},
    output_type={'output': np.array([10])},
    metadata={'name': 'li_neurons'}
)
```

### IF (Integrate-and-Fire)
积分发放神经元模型：

```python
from nir import IF

# 创建IF神经元
if_neuron = IF(
    r=np.array([1.0]),              # 电阻
    v_threshold=np.array([1.0]),    # 阈值电压
    v_reset=np.array([0.0]),        # 重置电压
    input_type={'input': np.array([10])},
    output_type={'output': np.array([10])},
    metadata={'name': 'if_neurons'}
)
```

### I (Integrator)
积分器模型：

```python
from nir import I

# 创建积分器
integrator = I(
    r=np.array([1.0]),              # 电阻
    input_type={'input': np.array([10])},
    output_type={'output': np.array([10])},
    metadata={'name': 'integrator'}
)
```

### CubaLIF (Current-based Leaky Integrate-and-Fire)
基于电流的漏积分发放神经元：

```python
from nir import CubaLIF

# 创建CubaLIF神经元
cubalif = CubaLIF(
    tau_syn=np.array([5.0]),        # 突触时间常数
    tau_mem=np.array([20.0]),       # 膜时间常数
    r=np.array([1.0]),              # 电阻
    v_leak=np.array([0.0]),         # 漏电压
    v_threshold=np.array([1.0]),    # 阈值电压
    v_reset=np.array([0.0]),        # 重置电压
    w_in=np.array([1.0]),           # 输入权重
    input_type={'input': np.array([10])},
    output_type={'output': np.array([10])},
    metadata={'name': 'cubalif_neurons'}
)
```

### CubaLI (Current-based Leaky Integrator)
基于电流的漏积分器：

```python
from nir import CubaLI

# 创建CubaLI神经元
cubali = CubaLI(
    tau_syn=np.array([5.0]),        # 突触时间常数
    tau_mem=np.array([20.0]),       # 膜时间常数
    r=np.array([1.0]),              # 电阻
    v_leak=np.array([0.0]),         # 漏电压
    w_in=np.array([1.0]),           # 输入权重
    input_type={'input': np.array([10])},
    output_type={'output': np.array([10])},
    metadata={'name': 'cubali_neurons'}
)
```

## 卷积算子

### Conv1d
一维卷积层：

```python
from nir import Conv1d

# 创建1D卷积层
conv1d = Conv1d(
    input_shape=100,                # 输入空间形状
    weight=np.random.randn(16, 1, 5),  # 权重 (输出通道, 输入通道, 核大小)
    stride=1,                       # 步长
    padding=2,                      # 填充
    dilation=1,                     # 膨胀
    groups=1,                       # 分组
    bias=np.random.randn(16),       # 偏置
    input_type={'input': np.array([1, 100])},
    output_type={'output': np.array([16, 100])},
    metadata={'name': 'conv1d_layer'}
)
```

### Conv2d
二维卷积层：

```python
from nir import Conv2d

# 创建2D卷积层
conv2d = Conv2d(
    input_shape=(28, 28),           # 输入空间形状
    weight=np.random.randn(16, 1, 5, 5),  # 权重 (输出通道, 输入通道, 核高, 核宽)
    stride=1,                       # 步长
    padding=2,                      # 填充
    dilation=1,                     # 膨胀
    groups=1,                       # 分组
    bias=np.random.randn(16),       # 偏置
    input_type={'input': np.array([1, 28, 28])},
    output_type={'output': np.array([16, 28, 28])},
    metadata={'name': 'conv2d_layer'}
)
```

## 池化算子

### SumPool2d
二维求和池化：

```python
from nir import SumPool2d

# 创建求和池化层
sumpool = SumPool2d(
    kernel_size=np.array([2, 2]),   # 核大小
    stride=np.array([2, 2]),        # 步长
    padding=np.array([0, 0]),       # 填充
    input_type={'input': np.array([16, 28, 28])},
    output_type={'output': np.array([16, 14, 14])},
    metadata={'name': 'sumpool_layer'}
)
```

### AvgPool2d
二维平均池化：

```python
from nir import AvgPool2d

# 创建平均池化层
avgpool = AvgPool2d(
    kernel_size=np.array([2, 2]),   # 核大小
    stride=np.array([2, 2]),        # 步长
    padding=np.array([0, 0]),       # 填充
    metadata={'name': 'avgpool_layer'}
)
```

## 变换算子

### Flatten
展平算子：

```python
from nir import Flatten

# 创建展平层
flatten = Flatten(
    input_type={'input': np.array([16, 7, 7])},
    output_type={'output': np.array([784])},
    metadata={'name': 'flatten_layer'}
)
```

## 图结构

### NIRGraph
NIR图结构，包含节点和边：

```python
from nir import NIRGraph

# 创建图
graph = NIRGraph(
    nodes={
        'input': input_node,
        'conv': conv2d,
        'pool': sumpool,
        'flatten': flatten,
        'output': output_node
    },
    edges=[
        ('input', 'conv'),
        ('conv', 'pool'),
        ('pool', 'flatten'),
        ('flatten', 'output')
    ],
    input_type={'input': np.array([1, 28, 28])},
    output_type={'output': np.array([10])},
    metadata={'name': 'cnn_model'}
)

# 从节点列表创建顺序图
sequential_graph = NIRGraph.from_list(
    input_node, conv2d, sumpool, flatten, output_node
)

# 推断所有节点的类型
graph.infer_types()

# 检查类型一致性
graph.check_types()
```

## 文件操作

### 读取NIR文件

```python
from nir import read

# 从HDF5文件读取NIR图
graph = read('model.nir')
```

### 写入NIR文件

```python
from nir import write

# 将NIR图写入HDF5文件
write('model.nir', graph)
```

## 工具函数

### dict2NIRNode
从字典创建NIR节点：

```python
from nir import dict2NIRNode

# 从字典创建节点
node_dict = {
    'type': 'LIF',
    'tau': np.array([20.0]),
    'r': np.array([1.0]),
    'v_leak': np.array([0.0]),
    'v_threshold': np.array([1.0]),
    'v_reset': np.array([0.0])
}
node = dict2NIRNode(node_dict)
```

## 使用示例

### 创建简单的SNN模型

```python
import numpy as np
from nir import Input, LIF, Affine, Output, NIRGraph

# 创建节点
input_node = Input(input_type={'input': np.array([784])})
hidden_layer = LIF(
    tau=np.array([20.0]),
    r=np.array([1.0]),
    v_leak=np.array([0.0]),
    v_threshold=np.array([1.0]),
    v_reset=np.array([0.0]),
    input_type={'input': np.array([784])},
    output_type={'output': np.array([100])}
)
output_layer = Affine(
    weight=np.random.randn(10, 100),
    bias=np.random.randn(10),
    input_type={'input': np.array([100])},
    output_type={'output': np.array([10])}
)
output_node = Output(output_type={'output': np.array([10])})

# 创建图
snn = NIRGraph(
    nodes={
        'input': input_node,
        'hidden': hidden_layer,
        'output': output_layer,
        'out': output_node
    },
    edges=[
        ('input', 'hidden'),
        ('hidden', 'output'),
        ('output', 'out')
    ]
)

# 保存模型
write('simple_snn.nir', snn)
```

## 注意事项

1. **类型推断**: 使用 `infer_types()` 方法可以自动推断节点的输入输出类型
2. **类型检查**: 使用 `check_types()` 方法可以检查图中所有节点的类型一致性
3. **元数据**: 每个节点都可以包含元数据，用于存储额外信息
4. **形状要求**: 卷积层需要指定 `input_shape` 参数来明确输入形状
5. **数值类型**: 所有参数都使用NumPy数组，支持批量处理

## 参考链接

- [NIR官方文档](https://neuroir.org/docs/api_nir.html)
- [NIR GitHub仓库](https://github.com/neuromorphs/NIR)
