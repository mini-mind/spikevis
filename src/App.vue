<template>
  <div id="app">
    <!-- 功能菜单 -->
    <FunctionMenu
      :has-doc="!!doc"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :undo-label="undoLabel"
      :redo-label="redoLabel"
      :connect-mode="connectMode"
      @file-drop="handleFileDrop"
      @show-about="showAbout"
      @export-nir="handleExport"
      @export-json="handleExportJson"
      @new-node="newNodeDialogVisible = true"
      @undo="undo"
      @redo="redo"
      @toggle-connect="toggleConnectMode"
    />

    <!-- 顶部状态条 -->
    <div v-if="hasModel" class="status-bar">
      <span :class="modified ? 'status-modified' : 'status-clean'">
        {{ modified ? '已修改（未导出）' : '与载入文件一致' }}
      </span>
      <span :class="validation && validation.ok ? 'status-ok' : 'status-bad'">
        {{ validationText }}
      </span>
      <span>{{ statusCounts }}</span>
      <span class="status-hint">右键画布/节点/边可编辑;Ctrl+Z 撤销,Ctrl+Shift+Z 重做</span>
    </div>

    <!-- 校验未过时的具体问题清单(紧跟状态条下方,一眼看到每个原因) -->
    <div v-if="hasModel && validation && !validation.ok" class="issue-list">
      <div v-for="(issue, i) in validation.issues" :key="i" class="issue-entry">
        <span class="issue-where">{{ issueWhere(issue) }}</span>
        <span class="issue-msg">{{ issue.message }}</span>
      </div>
    </div>

    <!-- 主视图 - 充满整个页面 -->
    <div class="main-view">
      <NetworkCanvas
        :model-data="viewData"
        :has-model="hasModel"
        :changed-names="changedNames"
        :issue-nodes="issueNodeNames"
        :issue-edges="issueEdgeKeys"
        :connect-mode="connectMode"
        :session-key="loadSeq"
        @node-select="handleNodeSelect"
        @node-deselect="handleNodeDeselect"
        @selection-change="handleSelectionChange"
        @file-drop="handleFileDrop"
        @open-file="loadFile"
        @action="handleCanvasAction"
        ref="networkCanvasRef"
      />
    </div>

    <!-- 右侧悬浮侧边栏 -->
    <ModelSidebar
      :is-visible="sidebarVisible"
      :selected-node="selectedNode"
      :node-issues="selectedNodeIssues"
      @action="handleCanvasAction"
    />

    <!-- 新建节点对话框 -->
    <NewNodeDialog
      :visible="newNodeDialogVisible"
      @close="newNodeDialogVisible = false"
      @create="handleCreateNode"
    />

    <!-- 通道剪枝对话框 -->
    <PruneDialog
      :visible="pruneDialog.visible"
      :doc="doc"
      :node-name="pruneDialog.name"
      @close="pruneDialog.visible = false"
      @confirm="onPruneConfirm"
    />

    <!-- 关于对话框 -->
    <AboutDialog
      :visible="aboutDialogVisible"
      @close="aboutDialogVisible = false"
    />
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import NetworkCanvas from './components/NetworkCanvas.vue'
import ModelSidebar from './components/ModelSidebar.vue'
import FunctionMenu from './components/FunctionMenu.vue'
import AboutDialog from './components/AboutDialog.vue'
import NewNodeDialog from './components/NewNodeDialog.vue'
import PruneDialog from './components/PruneDialog.vue'
import { createHistory, suggestGroupName, suggestNodeName } from './core/nir/index.js'
import { applyEditAction } from './io/editorActions.js'
import { exportNirDocument, exportViewJson, buildViewData } from './io/nirIO.js'
import { validateDocument, changedNodeNames } from './core/nir/validate.js'

export default {
  name: 'App',
  components: {
    NetworkCanvas,
    ModelSidebar,
    FunctionMenu,
    AboutDialog,
    NewNodeDialog,
    PruneDialog
  },
  setup() {
    const networkCanvasRef = ref(null)

    const aboutDialogVisible = ref(false)
    const newNodeDialogVisible = ref(false)
    // 通道剪枝对话框:{ visible, name }
    const pruneDialog = ref({ visible: false, name: '' })
    // doc:核心文档模型(不可变);originalDoc:最近一次载入的文件,用来算"是否已修改"
    const doc = ref(null)
    const originalDoc = ref(null)
    const fileName = ref('')
    const viewData = ref(null)
    const validation = ref(null)
    const changedNames = ref([])
    const selectedNode = ref(null)
    const sidebarVisible = ref(false)
    const connectMode = ref(false)
    // 画布当前多选的节点 id 清单(成组用)
    const selectedIds = ref([])
    // 会话序号:每载入一次新文件 +1,画布据此整体重排;编辑不换号,画布只做差量更新
    const loadSeq = ref(0)
    // 历史栈:每次编辑 commit,undo/redo 直接回引用
    const history = createHistory(null)

    const hasModel = computed(() => !!viewData.value)
    const modified = computed(() => !!doc.value && doc.value !== originalDoc.value)
    const canUndo = computed(() => !!doc.value && history.canUndo())
    const canRedo = computed(() => !!doc.value && history.canRedo())
    const undoLabel = computed(() => history.lastLabel())
    const redoLabel = computed(() => history.nextRedoLabel())

    const validationText = computed(() => {
      if (!validation.value) return '未校验'
      if (validation.value.ok) return '校验通过(形状推断 + 节点检查)'
      const n = validation.value.issues.length
      return `校验未过:${n} 个问题(导出被阻止)`
    })
    // 问题清单里的定位标签:边 / 节点 / 整体
    const issueWhere = (issue) => {
      if (issue.edge) return `边 ${issue.edge[0]} → ${issue.edge[1]}`
      if (issue.path) return `节点 ${issue.path}`
      return '模型'
    }
    const statusCounts = computed(() => {
      if (!viewData.value) return ''
      const s = viewData.value.summary
      return `${s.nodeCount} 节点 / ${s.edgeCount} 边`
    })

    // 画布标红:有 path 的 issue 标节点,type-mismatch 的边标边
    const issueNodeNames = computed(() => {
      if (!validation.value) return []
      const names = new Set()
      for (const issue of validation.value.issues) {
        if (issue.path) names.add(issue.path)
        if (issue.edge) {
          names.add(issue.edge[0])
          names.add(issue.edge[1])
        }
      }
      return [...names]
    })
    const issueEdgeKeys = computed(() => {
      if (!validation.value) return []
      return validation.value.issues
        .filter((i) => i.kind === 'type-mismatch' && i.edge)
        .map((i) => `${i.edge[0]}->${i.edge[1]}`)
    })
    // 侧栏里显示当前节点的问题文字
    const selectedNodeIssues = computed(() => {
      if (!validation.value || !selectedNode.value) return []
      return validation.value.issues
        .filter((i) => i.path === selectedNode.value.id)
        .map((i) => i.message)
    })

    // 编辑后重建视图:校验 + 视图模型 + 脏标记
    const refreshView = (docValue) => {
      doc.value = docValue
      if (!docValue) {
        viewData.value = null
        validation.value = null
        changedNames.value = []
        return
      }
      const v = validateDocument(docValue)
      validation.value = v
      viewData.value = buildViewData(docValue, v.types)
      changedNames.value = originalDoc.value ? [...changedNodeNames(originalDoc.value, docValue)] : []
      // 侧栏选中的节点跟着刷新(编辑参数后数值要更新)
      if (selectedNode.value && viewData.value) {
        selectedNode.value = viewData.value.nodes[selectedNode.value.id] || null
        if (!selectedNode.value) sidebarVisible.value = false
      }
    }

    // 编辑动作统一入口:警告确认 -> 应用 -> 进历史栈 -> 刷新
    const dispatch = async (action) => {
      if (!doc.value) {
        ElMessage.warning('请先载入 .nir 模型(JSON 视图不支持编辑)')
        return
      }
      try {
        let result = applyEditAction(doc.value, action)
        // 删除等动作带连通性预警:未确认就弹确认框
        if (!result.applied && result.warnings.length > 0) {
          try {
            await ElMessageBox.confirm(
              `${result.warnings.join(';')}。仍要执行"${result.label}"吗?`,
              '此操作会断开图',
              { type: 'warning', confirmButtonText: '仍要执行', cancelButtonText: '取消' }
            )
          } catch (e) {
            return // 用户取消
          }
          result = applyEditAction(doc.value, { ...action, confirmed: true })
        }
        if (!result.applied) {
          ElMessage.warning('操作未执行')
          return
        }
        history.commit(result.doc, result.label)
        refreshView(result.doc)
        ElMessage.success(`${result.label} 完成`)
      } catch (error) {
        // 非法输入被核心拒绝:提示原因,文档不动
        ElMessage.error(error.message)
      }
    }

    const undo = () => {
      const prev = history.undo()
      if (!prev) {
        ElMessage.info('没有可撤销的操作')
        return
      }
      refreshView(history.current)
      ElMessage.success(`已撤销:${history.nextRedoLabel()}`)
    }

    const redo = () => {
      const next = history.redo()
      if (!next) {
        ElMessage.info('没有可重做的操作')
        return
      }
      refreshView(history.current)
      ElMessage.success(`已重做:${history.lastLabel()}`)
    }

    // 全局快捷键:输入框聚焦时不触发
    const handleKeydown = (event) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') {
        return
      }
      event.preventDefault()
      if (event.shiftKey) {
        redo()
      } else {
        undo()
      }
    }
    onMounted(() => window.addEventListener('keydown', handleKeydown))
    onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

    // 处理节点选择
    const handleNodeSelect = (node) => {
      selectedNode.value = node
      sidebarVisible.value = true
    }
    const handleNodeDeselect = () => {
      selectedNode.value = null
      sidebarVisible.value = false
    }
    // 多选清单变化(画布 select/deselect 事件都会走这里)
    const handleSelectionChange = (ids) => {
      selectedIds.value = ids
      if (ids.length === 1) {
        selectedNode.value = viewData.value ? viewData.value.nodes[ids[0]] || null : null
        sidebarVisible.value = !!selectedNode.value
      } else {
        selectedNode.value = null
        sidebarVisible.value = false
      }
    }

    // 画布/侧栏发来的编辑动作
    const handleCanvasAction = async (action) => {
      switch (action.kind) {
        case 'request-remove':
          await dispatch({ kind: 'removeNode', name: action.name })
          break
        case 'request-rename': {
          if (!doc.value || !doc.value.graph.children[action.name]) {
            ElMessage.warning('请先载入 .nir 模型')
            return
          }
          try {
            const { value } = await ElMessageBox.prompt(
              `把节点 "${action.name}" 重命名为:`,
              '重命名节点',
              { inputValue: action.name, inputPattern: /^[^./]+$/, inputErrorMessage: '名字不能为空,且不能含 . 或 /' }
            )
            await dispatch({ kind: 'rename', oldName: action.name, newName: value.trim() })
          } catch (e) {
            // 用户取消
          }
          break
        }
        case 'request-disconnect':
          await dispatch({ kind: 'disconnect', src: action.src, dst: action.dst })
          break
        case 'request-connect-mode':
          connectMode.value = true
          break
        case 'request-connect-mode-off':
          connectMode.value = false
          break
        case 'request-add-node':
          newNodeDialogVisible.value = true
          break
        case 'request-prune':
          if (!doc.value) {
            ElMessage.warning('请先载入 .nir 模型')
            return
          }
          pruneDialog.value = { visible: true, name: action.name }
          break
        case 'request-group': {
          if (!doc.value) {
            ElMessage.warning('请先载入 .nir 模型')
            return
          }
          const names = Array.isArray(action.names) ? action.names : []
          if (names.length < 2) {
            ElMessage.warning('请先按住 Ctrl 点选至少两个节点,再右键"编成一组"')
            return
          }
          try {
            const suggested = suggestGroupName(doc.value, [])
            const { value } = await ElMessageBox.prompt(
              `把选中的 ${names.length} 个节点（${names.join(', ')}）打包成一个子图节点,组名:`,
              '编成一组',
              { inputValue: suggested, inputPattern: /^[^./]+$/, inputErrorMessage: '名字不能为空,且不能含 . 或 /' }
            )
            await dispatch({ kind: 'group', path: [], names, name: value.trim() })
          } catch (e) {
            // 用户取消
          }
          break
        }
        case 'request-ungroup':
          await dispatch({ kind: 'ungroup', path: [action.name] })
          break
        case 'connect':
          await dispatch(action)
          break
        default:
          await dispatch(action)
      }
    }

    // 新建节点:名字留空时按当前文档自动建议
    const handleCreateNode = (payload) => {
      if (!doc.value) {
        ElMessage.warning('请先载入 .nir 模型(JSON 视图不支持编辑)')
        return
      }
      const withName = { kind: 'addNode', ...payload, path: [] }
      if (!withName.name) withName.name = suggestNodeName(doc.value, [], payload.type)
      newNodeDialogVisible.value = false
      dispatch(withName)
    }

    // 剪枝对话框确认:按预览过的 keep 清单执行
    const onPruneConfirm = async ({ axis, keep }) => {
      const name = pruneDialog.value.name
      pruneDialog.value.visible = false
      await dispatch({ kind: 'pruneChannels', path: [name], axis, keep })
    }

    const toggleConnectMode = () => {
      if (!doc.value) {
        ElMessage.warning('请先载入模型')
        return
      }
      connectMode.value = !connectMode.value
    }

    // 处理文件拖拽/选择(NetworkCanvas 与 FunctionMenu 都走这里)
    const handleFileDrop = ({ file, data }) => {
      if (!data || !data.view) {
        ElMessage.error('文件解析结果为空')
        return
      }
      originalDoc.value = data.doc || null
      fileName.value = data.fileName || (file ? file.name : '')
      connectMode.value = false
      selectedNode.value = null
      selectedIds.value = []
      sidebarVisible.value = false
      loadSeq.value += 1 // 换了文件:画布整体重排
      history.reset(data.doc || null)
      refreshView(data.doc || null)
      const s = data.view.summary
      const typeNote = data.typeCheckOk === false
        ? `（形状推断未完全通过:${data.typeCheckError || '未知原因'};已按字段推导显示）`
        : ''
      ElMessage.success(`已载入 ${fileName.value}:${s.nodeCount} 个节点、${s.edgeCount} 条边${typeNote}`)
    }

    const loadFile = () => {
      if (networkCanvasRef.value) {
        networkCanvasRef.value.openFileBrowser()
      }
    }

    // 导出 .nir:必须先过校验(官方库默认读回时会做类型推断,不通过的文件读不回来)
    const handleExport = async () => {
      if (!doc.value) {
        ElMessage.warning('当前没有可导出的模型(JSON 视图不参与导出)')
        return
      }
      const v = validateDocument(doc.value)
      if (!v.ok) {
        const reasons = v.issues.slice(0, 3).map((i) => i.message).join(';')
        ElMessage.error(`校验未过,导出被阻止(${v.issues.length} 个问题):${reasons}${v.issues.length > 3 ? ' …' : ''}`)
        return
      }
      try {
        const blob = await exportNirDocument(doc.value)
        const base = (fileName.value || 'model.nir').replace(/\.(nir|json)$/i, '')
        const link = document.createElement('a')
        link.download = `${base}_exported.nir`
        link.href = URL.createObjectURL(blob)
        link.click()
        URL.revokeObjectURL(link.href)
        ElMessage.success(`已导出 ${base}_exported.nir(校验通过,官方 nir 库可读回)`)
      } catch (error) {
        console.error('导出失败:', error)
        ElMessage.error(error.message || '导出失败')
      }
    }

    // 导出"仅查看用"JSON(明确标注不可往返)
    const handleExportJson = () => {
      if (!doc.value || !viewData.value) {
        ElMessage.warning('当前没有可导出的模型')
        return
      }
      const blob = exportViewJson(doc.value, viewData.value, fileName.value)
      const base = (fileName.value || 'model.nir').replace(/\.(nir|json)$/i, '')
      const link = document.createElement('a')
      link.download = `${base}_view.json`
      link.href = URL.createObjectURL(blob)
      link.click()
      URL.revokeObjectURL(link.href)
      ElMessage.success(`已导出 ${base}_view.json(仅供查看,不能作为 .nir 读回)`)
    }

    const showAbout = () => {
      aboutDialogVisible.value = true
    }

    return {
      networkCanvasRef,
      aboutDialogVisible,
      newNodeDialogVisible,
      pruneDialog,
      doc,
      viewData,
      validation,
      changedNames,
      selectedNode,
      selectedIds,
      sidebarVisible,
      connectMode,
      loadSeq,
      hasModel,
      modified,
      canUndo,
      canRedo,
      undoLabel,
      redoLabel,
      validationText,
      issueWhere,
      statusCounts,
      issueNodeNames,
      issueEdgeKeys,
      selectedNodeIssues,
      handleNodeSelect,
      handleNodeDeselect,
      handleSelectionChange,
      handleFileDrop,
      handleCanvasAction,
      handleCreateNode,
      onPruneConfirm,
      toggleConnectMode,
      loadFile,
      handleExport,
      handleExportJson,
      undo,
      redo,
      showAbout
    }
  }
}
</script>

<style>
#app {
  height: 100vh;
  width: 100vw;
  font-family: var(--sv-font);
  position: relative;
  overflow: hidden;
  margin: 0;
  padding: 0;
  background-color: var(--sv-bg-base);
  color: var(--sv-text-regular);
}

.main-view {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--sv-bg-canvas);
  width: 100%;
  height: 100%;
}

.status-bar {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1400;
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--sv-bg-panel);
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius);
  padding: 8px 16px;
  font-size: 14px;
  color: var(--sv-text-regular);
  box-shadow: var(--sv-shadow-panel);
  white-space: nowrap;
}

.status-clean {
  color: var(--sv-success-bright);
}

.status-modified {
  color: var(--sv-warning-bright);
  font-weight: 600;
}

.status-ok {
  color: var(--sv-success-bright);
}

.status-bad {
  color: var(--sv-danger);
  font-weight: 600;
}

.status-hint {
  color: var(--sv-text-secondary);
  font-size: 14px;
}

/* 校验问题清单:状态条正下方,与状态条同宽居中,每条给定位标签 + 原因 */
.issue-list {
  position: fixed;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1400;
  max-width: min(880px, 92vw);
  max-height: 34vh;
  overflow-y: auto;
  background: var(--sv-bg-panel);
  border: 1px solid var(--sv-node-border-issue);
  border-radius: var(--sv-radius);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: var(--sv-shadow-panel);
}

.issue-entry {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 14px;
  line-height: 1.5;
}

.issue-where {
  flex: none;
  color: var(--sv-danger);
  font-weight: 600;
  font-family: var(--sv-font-mono);
  font-size: 14px;
}

.issue-msg {
  color: var(--sv-text-regular);
  word-break: break-all;
  min-width: 0;
}
</style>
