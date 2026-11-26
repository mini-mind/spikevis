<template>
  <!-- el-config-provider:Element Plus 内置文案的 locale 跟随界面语言切换 -->
  <el-config-provider :locale="elLocale">
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

      <!-- 顶部浮层:状态条 / 校验问题清单 / 子图面包屑统一收进一个居中限宽容器,
           内部按行排列,任何窗口宽度下都互不重叠、不被左上角菜单按钮压住 -->
      <div class="top-overlay">
        <!-- 顶部状态条 -->
        <div v-if="hasModel" class="status-bar">
          <span :class="modified ? 'status-modified' : 'status-clean'">
            {{ modified ? t('status.modified') : t('status.clean') }}
          </span>
          <span :class="validation && validation.ok ? 'status-ok' : 'status-bad'">
            {{ validationText }}
          </span>
          <span>{{ statusCounts }}</span>
          <span class="status-hint">{{ t('status.hint') }}</span>
        </div>

        <!-- 校验未过时的具体问题清单(紧跟状态条下方,一眼看到每个原因) -->
        <div v-if="hasModel && validation && !validation.ok" class="issue-list">
          <div v-for="(issue, i) in validation.issues" :key="i" class="issue-entry">
            <span class="issue-where">{{ issueWhere(issue) }}</span>
            <span class="issue-msg">{{ tv(issue) }}</span>
          </div>
        </div>

        <!-- 子图导航条:进入子图后显示层级面包屑与返回按钮(状态条正下方的第二行) -->
        <SubgraphBar
          :path="viewPath"
          @navigate="navigateTo"
        />
      </div>

      <!-- 主视图 - 充满整个页面 -->
      <div class="main-view">
        <NetworkCanvas
          :model-data="viewData"
          :has-model="hasModel"
          :changed-names="changedNamesLocal"
          :issue-nodes="issueNodeNamesLocal"
          :issue-edges="issueEdgeKeysLocal"
          :connect-mode="connectMode"
          :session-key="loadSeq"
          :view-key="viewKey"
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
        :base-path="viewPath"
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
        :base-path="viewPath"
        @close="pruneDialog.visible = false"
        @confirm="onPruneConfirm"
      />

      <!-- 关于对话框 -->
      <AboutDialog
        :visible="aboutDialogVisible"
        @close="aboutDialogVisible = false"
      />
    </div>
  </el-config-provider>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import enLocale from 'element-plus/es/locale/lang/en'
import NetworkCanvas from './components/NetworkCanvas.vue'
import ModelSidebar from './components/ModelSidebar.vue'
import FunctionMenu from './components/FunctionMenu.vue'
import AboutDialog from './components/AboutDialog.vue'
import NewNodeDialog from './components/NewNodeDialog.vue'
import PruneDialog from './components/PruneDialog.vue'
import SubgraphBar from './components/SubgraphBar.vue'
import { createHistory, suggestGroupName, suggestNodeName, graphAt } from './core/nir/index.js'
import { applyEditAction } from './io/editorActions.js'
import { exportNirDocument, exportViewJson, buildViewDataAt, clampViewPath } from './io/nirIO.js'
import { validateDocument, changedNodeNames, changedNamesAt } from './core/nir/validate.js'
import { t, tv, tvError, tLabel, locale } from './i18n/index.js'

export default {
  name: 'App',
  components: {
    NetworkCanvas,
    ModelSidebar,
    FunctionMenu,
    AboutDialog,
    NewNodeDialog,
    PruneDialog,
    SubgraphBar
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

    // Element Plus 语言包跟随界面语言(组件内置文案:空状态、日期选择器等)
    const elLocale = computed(() => (locale.value === 'en' ? enLocale : zhCn))

    // ---- 进入子图:视图层状态 ----
    // viewPath 是从根图出发的子图名序列([] = 根层);它是"视图"状态,不进历史栈——
    // 文档由不可变历史管理,进出子图只是换一层看。撤销删掉所在子图时由
    // refreshView 里的 clampViewPath 夹回上层。
    const viewPath = ref([])
    const viewKey = computed(() => viewPath.value.join('/'))
    const viewPrefix = computed(() => viewPath.value.join('.'))
    // 当前层局部名 -> 文档全路径键(类型/校验问题的键都是点号限定的全路径)
    const qualifyLocal = (name) => (viewPrefix.value ? `${viewPrefix.value}.${name}` : name)
    const localOfQualified = (q) => {
      if (viewPath.value.length === 0) return q
      return q.startsWith(`${viewPrefix.value}.`) ? q.slice(viewPrefix.value.length + 1) : null
    }
    // 校验问题映射到当前层(画布标红用局部名)
    const issueNodeNamesLocal = computed(() => {
      if (viewPath.value.length === 0) return issueNodeNames.value
      const out = new Set()
      for (const q of issueNodeNames.value) {
        const local = localOfQualified(q)
        if (local) out.add(local)
      }
      return [...out]
    })
    const issueEdgeKeysLocal = computed(() => {
      if (viewPath.value.length === 0) return issueEdgeKeys.value
      const out = []
      for (const key of issueEdgeKeys.value) {
        const [a, b] = key.split('->')
        const la = localOfQualified(a)
        const lb = localOfQualified(b)
        if (la && lb) out.push(`${la}->${lb}`)
      }
      return out
    })
    // 脏标记映射到当前层:根层用 changedNodeNames(子图内部改动会把组节点标脏),
    // 子图内部用 changedNamesAt 取该层的局部名
    const changedNamesLocal = computed(() => {
      if (viewPath.value.length === 0) return changedNames.value
      if (!originalDoc.value || !doc.value) return []
      return [...changedNamesAt(originalDoc.value, doc.value, viewPath.value)]
    })
    // 换层后清掉旧层的选中与连线模式(选中节点属于旧层,不跨层保留)
    const clearLayerState = () => {
      selectedNode.value = null
      selectedIds.value = []
      sidebarVisible.value = false
      connectMode.value = false
    }
    // 进入子图(双击/右键/侧栏按钮):目标必须是当前层里的子图节点
    const enterSubgraph = (name) => {
      if (!doc.value) return
      let graph
      try {
        graph = graphAt(doc.value, viewPath.value)
      } catch (e) {
        return
      }
      if (!graph.children || !(name in graph.children)) return
      if (graph.children[name].type !== 'NIRGraph') return
      viewPath.value = [...viewPath.value, name]
      clearLayerState()
      // 视图数据是"路径 -> 视图"的派生:换层后重建(文档没变,只换看的那层)
      refreshView(doc.value)
    }
    // 面包屑/返回按钮:回到第 depth 层(0 = 根层)
    const navigateTo = (depth) => {
      const d = Math.max(0, Math.min(Number(depth) || 0, viewPath.value.length))
      if (d === viewPath.value.length) return
      viewPath.value = viewPath.value.slice(0, d)
      clearLayerState()
      refreshView(doc.value)
    }

    const hasModel = computed(() => !!viewData.value)
    const modified = computed(() => !!doc.value && doc.value !== originalDoc.value)
    const canUndo = computed(() => !!doc.value && history.canUndo())
    const canRedo = computed(() => !!doc.value && history.canRedo())
    // 历史栈标签是结构化对象 { label, code, params }:菜单/提示用它按当前语言显示
    const undoLabel = computed(() => history.lastLabel())
    const redoLabel = computed(() => history.nextRedoLabel())

    const validationText = computed(() => {
      if (!validation.value) return t('status.unvalidated')
      if (validation.value.ok) return t('status.validated')
      const n = validation.value.issues.length
      return t('status.invalid', { n })
    })
    // 问题清单里的定位标签:边 / 节点 / 整体
    const issueWhere = (issue) => {
      if (issue.edge) return t('issue.whereEdge', { src: issue.edge[0], dst: issue.edge[1] })
      if (issue.path) return t('issue.whereNode', { node: issue.path })
      return t('issue.whereModel')
    }
    const statusCounts = computed(() => {
      if (!viewData.value) return ''
      const s = viewData.value.summary
      return t('status.counts', { nodes: s.nodeCount, edges: s.edgeCount })
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
    // 侧栏里显示当前节点的问题文字(校验问题的 path 是全路径键,要按当前层限定;
    // 显示走 tv():按当前语言出核心层结构化文案)
    const selectedNodeIssues = computed(() => {
      if (!validation.value || !selectedNode.value) return []
      const qualifiedId = qualifyLocal(selectedNode.value.id)
      return validation.value.issues
        .filter((i) => i.path === qualifiedId)
        .map((i) => tv(i))
    })

    // 编辑后重建视图:校验 + 视图模型(按当前所在层) + 脏标记
    const refreshView = (docValue) => {
      doc.value = docValue
      if (!docValue) {
        viewPath.value = []
        viewData.value = null
        validation.value = null
        changedNames.value = []
        return
      }
      // 撤销可能把当前所在的子图删掉:先把视图路径夹回仍然存在的最深一层
      const clamped = clampViewPath(docValue, viewPath.value)
      if (clamped.length !== viewPath.value.length) {
        viewPath.value = clamped
        clearLayerState()
        ElMessage.info(t('subgraph.undoDropped'))
      }
      const v = validateDocument(docValue)
      validation.value = v
      viewData.value = buildViewDataAt(docValue, viewPath.value, v.types)
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
        ElMessage.warning(t('msg.loadFirst'))
        return
      }
      try {
        let result = applyEditAction(doc.value, action)
        // 删除等动作带连通性预警:未确认就弹确认框(预警文字按当前语言显示)
        if (!result.applied && result.warnings.length > 0) {
          const warningText = (result.warningsX && result.warningsX.length > 0)
            ? result.warningsX.map((w) => tv(w)).join(';')
            : result.warnings.join(';')
          try {
            await ElMessageBox.confirm(
              t('msg.boxDisconnectBody', { warnings: warningText, label: tLabel(result) }),
              t('msg.boxDisconnectTitle'),
              {
                type: 'warning',
                confirmButtonText: t('msg.boxConfirmProceed'),
                cancelButtonText: t('common.cancel'),
              }
            )
          } catch (e) {
            return // 用户取消
          }
          result = applyEditAction(doc.value, { ...action, confirmed: true })
        }
        if (!result.applied) {
          ElMessage.warning(t('msg.opNotApplied'))
          return
        }
        // 历史栈存结构化标签 { label, code, params }:菜单与提示按当前语言显示
        history.commit(result.doc, { label: result.label, code: result.code, params: result.params })
        refreshView(result.doc)
        ElMessage.success(t('msg.done', { label: tLabel(result) }))
      } catch (error) {
        // 非法输入被核心拒绝:提示原因,文档不动(剪枝拒绝按当前语言重建)
        ElMessage.error(tvError(error))
      }
    }

    const undo = () => {
      const prev = history.undo()
      if (!prev) {
        ElMessage.info(t('msg.noUndo'))
        return
      }
      refreshView(history.current)
      ElMessage.success(t('msg.undone', { label: tLabel(history.nextRedoLabel()) }))
    }

    const redo = () => {
      const next = history.redo()
      if (!next) {
        ElMessage.info(t('msg.noRedo'))
        return
      }
      refreshView(history.current)
      ElMessage.success(t('msg.redone', { label: tLabel(history.lastLabel()) }))
    }

    // 批量删除当前层选中的节点:走 dispatch 的预警确认流程(一次确认、一条历史)
    const removeSelectedNodes = async () => {
      const names = [...selectedIds.value]
      if (!doc.value || names.length === 0) return
      await dispatch({ kind: 'removeNodes', path: [...viewPath.value], names })
    }

    // 全局快捷键:输入框聚焦时不触发
    const handleKeydown = (event) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedIds.value.length > 0 && doc.value) {
          event.preventDefault()
          removeSelectedNodes()
        }
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

    // 画布/侧栏发来的编辑动作(界面只给局部名,这里统一补上当前层路径前缀)
    const handleCanvasAction = async (action) => {
      switch (action.kind) {
        case 'request-enter':
          enterSubgraph(action.name)
          break
        case 'request-remove':
          await dispatch({ kind: 'removeNode', path: [...viewPath.value], name: action.name })
          break
        case 'request-rename': {
          if (!doc.value) {
            ElMessage.warning(t('msg.loadFirstShort'))
            return
          }
          let graph
          try {
            graph = graphAt(doc.value, viewPath.value)
          } catch (e) {
            graph = null
          }
          if (!graph || !graph.children || !graph.children[action.name]) {
            ElMessage.warning(t('msg.loadFirstShort'))
            return
          }
          try {
            const { value } = await ElMessageBox.prompt(
              t('msg.boxRenamePrompt', { name: action.name }),
              t('msg.boxRenameTitle'),
              { inputValue: action.name, inputPattern: /^[^./]+$/, inputErrorMessage: t('msg.boxNameRule') }
            )
            await dispatch({ kind: 'rename', path: [...viewPath.value], oldName: action.name, newName: value.trim() })
          } catch (e) {
            // 用户取消
          }
          break
        }
        case 'request-disconnect':
          await dispatch({ kind: 'disconnect', path: [...viewPath.value], src: action.src, dst: action.dst })
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
            ElMessage.warning(t('msg.loadFirstShort'))
            return
          }
          pruneDialog.value = { visible: true, name: action.name }
          break
        case 'request-group': {
          if (!doc.value) {
            ElMessage.warning(t('msg.loadFirstShort'))
            return
          }
          const names = Array.isArray(action.names) ? action.names : []
          if (names.length < 2) {
            ElMessage.warning(t('msg.boxGroupNeedMore'))
            return
          }
          try {
            const suggested = suggestGroupName(doc.value, viewPath.value)
            const { value } = await ElMessageBox.prompt(
              t('msg.boxGroupPrompt', { count: names.length, names: names.join(', ') }),
              t('msg.boxGroupTitle'),
              { inputValue: suggested, inputPattern: /^[^./]+$/, inputErrorMessage: t('msg.boxNameRule') }
            )
            await dispatch({ kind: 'group', path: [...viewPath.value], names, name: value.trim() })
          } catch (e) {
            // 用户取消
          }
          break
        }
        case 'request-ungroup':
          await dispatch({ kind: 'ungroup', path: [...viewPath.value, action.name] })
          break
        case 'connect':
          await dispatch({ ...action, path: [...viewPath.value] })
          break
        default:
          await dispatch(action)
      }
    }

    // 新建节点:名字留空时按当前层自动建议;加到当前所在层(可能是子图内部)
    const handleCreateNode = (payload) => {
      if (!doc.value) {
        ElMessage.warning(t('msg.loadFirst'))
        return
      }
      const withName = { kind: 'addNode', ...payload, path: [...viewPath.value] }
      if (!withName.name) withName.name = suggestNodeName(doc.value, viewPath.value, payload.type)
      newNodeDialogVisible.value = false
      dispatch(withName)
    }

    // 剪枝对话框确认:按预览过的 keep 清单执行(路径带当前层前缀)
    const onPruneConfirm = async ({ axis, keep }) => {
      const name = pruneDialog.value.name
      pruneDialog.value.visible = false
      await dispatch({ kind: 'pruneChannels', path: [...viewPath.value, name], axis, keep })
    }

    const toggleConnectMode = () => {
      if (!doc.value) {
        ElMessage.warning(t('msg.loadFirstModel'))
        return
      }
      connectMode.value = !connectMode.value
    }

    // 处理文件拖拽/选择(NetworkCanvas 与 FunctionMenu 都走这里)
    const handleFileDrop = ({ file, data }) => {
      if (!data || !data.view) {
        ElMessage.error(t('msg.emptyParse'))
        return
      }
      originalDoc.value = data.doc || null
      fileName.value = data.fileName || (file ? file.name : '')
      connectMode.value = false
      selectedNode.value = null
      selectedIds.value = []
      sidebarVisible.value = false
      viewPath.value = [] // 换了文件:回到根层
      loadSeq.value += 1 // 换了文件:画布整体重排
      history.reset(data.doc || null)
      refreshView(data.doc || null)
      const s = data.view.summary
      const typeNote = data.typeCheckOk === false
        ? t('msg.loadNoteBad', { reason: data.typeCheckError || '-' })
        : ''
      ElMessage.success(t('msg.loaded', { name: fileName.value, nodes: s.nodeCount, edges: s.edgeCount, note: typeNote }))
    }

    const loadFile = () => {
      if (networkCanvasRef.value) {
        networkCanvasRef.value.openFileBrowser()
      }
    }

    // 导出 .nir:必须先过校验(官方库默认读回时会做类型推断,不通过的文件读不回来)
    const handleExport = async () => {
      if (!doc.value) {
        ElMessage.warning(t('msg.noExportDoc'))
        return
      }
      const v = validateDocument(doc.value)
      if (!v.ok) {
        const reasons = v.issues.slice(0, 3).map((i) => tv(i)).join(';')
        ElMessage.error(t('msg.exportBlocked', {
          n: v.issues.length,
          reasons,
          more: v.issues.length > 3 ? ' …' : '',
        }))
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
        ElMessage.success(t('msg.exported', { name: `${base}_exported.nir` }))
      } catch (error) {
        console.error('导出失败:', error)
        ElMessage.error(tvError(error) || t('msg.exportFailed'))
      }
    }

    // 导出"仅查看用"JSON(明确标注不可往返)
    const handleExportJson = () => {
      if (!doc.value || !viewData.value) {
        ElMessage.warning(t('msg.noExportJson'))
        return
      }
      const blob = exportViewJson(doc.value, viewData.value, fileName.value)
      const base = (fileName.value || 'model.nir').replace(/\.(nir|json)$/i, '')
      const link = document.createElement('a')
      link.download = `${base}_view.json`
      link.href = URL.createObjectURL(blob)
      link.click()
      URL.revokeObjectURL(link.href)
      ElMessage.success(t('msg.exportedJson', { name: `${base}_view.json` }))
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
      viewPath,
      viewKey,
      navigateTo,
      elLocale,
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
      showAbout,
      t
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

/* 顶部浮层容器:状态条/问题清单/面包屑按列排布,居中且限宽——
 * 限宽算入左上角菜单按钮(约 68px)的安全距离,任何窗口宽度都不重叠不截断。
 * 内容多时条内换行、容器内加行,高度自然增长。 */
.top-overlay {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1400;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  max-width: min(960px, calc(100vw - 200px));
}

.status-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 16px;
  background: var(--sv-bg-panel);
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius);
  padding: 8px 16px;
  font-size: 14px;
  color: var(--sv-text-regular);
  /* ComfyUI floating-panel 质感:顶缘 1px 高光 + 面板投影 */
  box-shadow: var(--sv-inset-highlight), var(--sv-shadow-panel);
  min-width: 0;
}

.status-bar > span {
  white-space: nowrap;
}

/* 中英文提示较长:窄屏下收进无障碍折衷——直接隐藏(快捷键与右键能力仍在),
 * >=1380px 恢复显示,保证单行放得下、与校验文字不挤压 */
@media (max-width: 1379px) {
  .status-hint {
    display: none;
  }
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

/* 校验问题清单:top-overlay 容器内第二行,与状态条同宽,每条给定位标签 + 原因 */
.issue-list {
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
  min-width: 0;
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
