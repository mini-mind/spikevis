<template>
  <el-dialog v-model="dialogVisible" title="加载NIR文件" width="400px">
    <el-upload
      ref="uploadRef"
      :auto-upload="false"
      :on-change="handleFileChange"
      :show-file-list="false"
      accept=".nir,.h5,.hdf5,.json"
      drag
    >
      <el-icon class="el-icon--upload"><upload-filled /></el-icon>
      <div class="el-upload__text">
        将NIR文件拖拽到此处，或<em>点击上传</em>
      </div>
      <template #tip>
        <div class="el-upload__tip">
          支持.nir、.h5、.hdf5、.json格式的NIR模型文件
        </div>
      </template>
    </el-upload>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="closeDialog">取消</el-button>
        <el-button type="primary" @click="confirmLoad">
          确认加载
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script>
import { ref, watch } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'

export default {
  name: 'FileUploadDialog',
  components: {
    UploadFilled
  },
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['confirm', 'close'],
  setup(props, { emit }) {
    const dialogVisible = ref(false)
    const selectedFile = ref(null)

    // 监听visible属性变化
    watch(() => props.visible, (newVal) => {
      dialogVisible.value = newVal
    })

    // 监听对话框状态变化
    watch(dialogVisible, (newVal) => {
      if (!newVal) {
        emit('close')
        selectedFile.value = null
      }
    })

    // 处理文件选择
    const handleFileChange = (file) => {
      selectedFile.value = file.raw
    }

    // 确认加载
    const confirmLoad = () => {
      if (selectedFile.value) {
        emit('confirm', selectedFile.value)
      }
    }

    // 关闭对话框
    const closeDialog = () => {
      dialogVisible.value = false
    }

    return {
      dialogVisible,
      selectedFile,
      handleFileChange,
      confirmLoad,
      closeDialog
    }
  }
}
</script>

<style scoped>
.el-upload__text {
  color: #606266;
}

.el-upload__text em {
  color: #409eff;
  font-style: normal;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
