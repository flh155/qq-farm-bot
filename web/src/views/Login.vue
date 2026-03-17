<script setup lang="ts">
// import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api, { tokenManager } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { encryptPassword } from '@/utils/crypto'

const router = useRouter()
const password = ref('')
const error = ref('')
const loading = ref(false)
// const token = useStorage('admin_token', '')

async function handleLogin() {
  loading.value = true
  error.value = ''
  try {
    // 对密码进行加密后再传输
    const encryptedPassword = await encryptPassword(password.value)
    const res = await api.post('/api/login', { password: encryptedPassword, encrypted: true })
    if (res.data.ok) {
      // 使用api导出的token管理器存储 token
      tokenManager.setToken({
        token: res.data.data.token,
        expiresAt: res.data.data.expiresAt,
        createdAt: res.data.data.createdAt || Date.now(),
      })

      // 显示 token 过期时间提示
      const expiresHours = ((res.data.data.expiresAt - Date.now()) / (1000 * 60 * 60)).toFixed(1)
      console.log(`登录成功，Token 将在 ${expiresHours} 小时后过期`)

      // token.value = res.data.data.token

      router.push('/')
    }
    else {
      error.value = res.data.error || '登录失败'
    }
  }
  catch (e: any) {
    // 处理 HTTP 错误（如 400、500 等）
    if (e.response) {
      const backendError = e.response.data?.error || e.response.data?.message
      error.value = backendError || `服务器错误 (${e.response.status})`
    } else if (e.request) {
      error.value = '网络错误，无法连接到服务器'
    } else {
      error.value = e.message || '登录异常'
    }
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="w-full flex items-start justify-center bg-gray-100 px-4 pt-[10vh] min-h-dvh sm:items-center dark:bg-gray-900 sm:pt-0">
    <div class="max-w-md w-full rounded-xl bg-white p-8 shadow-lg space-y-6 dark:bg-gray-800">
      <div class="mb-8 py-4 text-center">
        <h1 class="text-3xl text-gray-900 font-bold tracking-tight dark:text-white">
          QQ农场智能助手
        </h1>
        <p class="mt-3 text-sm text-gray-500 tracking-widest uppercase dark:text-gray-400">
          管理面板
        </p>
      </div>
      <form class="space-y-4" @submit.prevent="handleLogin">
        <div>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入管理密码"
            required
          />
        </div>
        <div v-if="error" class="text-sm text-red-600">
          {{ error }}
        </div>
        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="loading"
        >
          登录
        </BaseButton>
      </form>
    </div>
  </div>
</template>
