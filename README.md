# NIR模型可视化工具

基于Vue.js和vis.js的NIR模型可视化工具，提供类似ONNX.js的交互式图形界面。

## 功能特性

- 🎯 **拖拽上传**: 支持拖拽上传JSON格式的NIR模型文件
- 📊 **交互式可视化**: 使用vis.js绘制网络图
- 🎨 **节点分类**: 不同类型节点使用不同颜色标识
- 📋 **详细信息**: 侧边栏显示模型和节点详细信息
- 🖼️ **图片导出**: 支持导出网络图为PNG图片
- 🔍 **节点选择**: 点击节点查看详细信息
- 🚀 **示例数据**: 内置示例数据，一键加载体验

## 技术栈

- **Vue 3**: 现代响应式框架
- **Element Plus**: UI组件库
- **vis.js**: 网络图可视化库
- **Vite**: 快速构建工具

## 安装和运行

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

应用将在 `http://localhost:3000` 启动

## 使用方法

1. 打开浏览器访问 `http://localhost:3000`
2. 点击"加载示例"按钮查看示例网络
3. 或点击"加载NIR文件"按钮上传JSON格式的模型文件
4. 在网络图中查看模型结构
5. 点击节点查看详细信息
6. 使用"导出图片"功能保存网络图

## 文件格式

支持JSON格式的NIR模型文件，结构如下：

```json
{
  "nodes": {
    "node_id": {
      "type": "节点类型",
      "input_type": { "input": [形状] },
      "output_type": { "output": [形状] },
      "metadata": { "name": "节点名称" }
    }
  },
  "edges": [
    ["源节点", "目标节点"]
  ]
}
```

## 项目结构

```
spikevis/
├── src/
│   ├── App.vue          # 主应用组件
│   └── main.js          # 应用入口
├── docs/
│   └── nir_operators.md # NIR算子文档
├── package.json         # 依赖配置
├── vite.config.js       # Vite配置
├── index.html           # HTML模板
└── README.md           # 说明文档
```

## 节点类型颜色说明

- 🔵 **蓝色**: 输入/输出节点
- 🟢 **绿色**: 神经元模型 (LIF, LI, IF等)
- 🟠 **橙色**: 线性变换层 (Linear, Affine, Conv等)
- ⚪ **灰色**: 其他类型节点

## 开发说明

### 开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## 注意事项

1. 前端需要Node.js 16+
2. 支持的文件格式: .json
3. 文件需要包含nodes和edges字段
4. 节点类型会自动识别并设置相应颜色

## 故障排除

### 常见问题

1. **依赖安装失败**
   ```bash
   npm cache clean --force
   npm install
   ```

2. **文件上传失败**
   - 检查文件格式是否为JSON
   - 确保文件包含nodes和edges字段

3. **网络图不显示**
   - 检查vis.js是否正确加载
   - 查看浏览器控制台错误信息
