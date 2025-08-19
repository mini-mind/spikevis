# NIR模型可视化工具

使用nirtorch解析NIR格式的神经网络模型，并生成Mermaid流程图可视化。

## 功能

- 使用nirtorch解析NIR格式模型文件
- 使用nir库创建示例NIR模型
- 生成Mermaid流程图
- 支持命令行使用

## 安装依赖

```bash
# 激活conda环境
conda activate nir

# 安装依赖
pip install -r requirements.txt
```

## 使用方法

### 1. 创建示例模型

```bash
# 使用nir库创建示例NIR模型
python create_example_models.py
```

这将创建一个示例模型：
- `simple_snn.nir` - 简单的前馈神经网络

### 2. 生成可视化图表

```bash
# 解析模型并生成图表
python generate_mermaid.py simple_snn.nir

# 指定输出文件
python generate_mermaid.py simple_snn.nir -o my_diagram.mmd
```

### 3. 参数说明
- `model_path`: NIR模型文件路径
- `-o, --output`: 输出文件路径（可选，默认为模型名_diagram.mmd）

## 项目结构

```
spikevis/
├── src/
│   ├── nir_parser.py      # NIR解析器（使用nir库）
│   └── mermaid_generator.py # Mermaid生成器
├── generate_mermaid.py    # 主脚本
├── create_example_models.py # 示例模型创建脚本
├── requirements.txt      # 依赖包
└── README.md            # 说明文档
```

## 技术栈

- **nir**: NIR格式核心库
- **nirtorch**: NIR与PyTorch的桥接
- **snnTorch**: SNN模型创建
- **PyTorch**: 深度学习框架
- **Mermaid**: 图表生成

## 示例

```bash
# 1. 创建示例模型
python create_example_models.py

# 2. 生成可视化图表
python generate_mermaid.py simple_snn.nir

# 3. 查看生成的.mmd文件
```

生成的`.mmd`文件可以在支持Mermaid的编辑器或在线工具中查看。

## 当前状态

✅ 已完成功能：
- NIR模型创建（简单前馈网络）
- NIR模型解析
- Mermaid图表生成
- 命令行界面

🔄 待完善功能：
- 更复杂的网络结构（卷积、LIF神经元等）
- 更详细的节点信息显示
- 更美观的图表样式
