<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api, { tokenManager } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { encryptPassword } from '@/utils/crypto'

const router = useRouter()
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

// 密码强度检查（前端初步验证）
function checkPasswordStrength(pwd: string): string | null {
  if (!pwd) {
    return '密码不能为空'
  }
  
  // 检查是否包含空格
  if (/\s/.test(pwd)) {
    return '密码不能包含空格'
  }
  
  // 检查是否只允许：字母、数字、特定符号（!@#$%^&*()_+-=[]{}|;:,.<>?）
  const validPattern = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]+$/
  if (!validPattern.test(pwd)) {
    return '密码只能包含字母、数字和特定符号（!@#$%^&*()_+-=[]{}|;:,.<>?）'
  }
  
  if (pwd.length < 8) {
    return '密码长度至少为 8 位'
  }
  
  if (pwd.length > 32) {
    return '密码长度不能超过 32 位'
  }
  
  // 检查是否包含数字
  const hasNumber = /\d/.test(pwd)
  // 检查是否包含字母
  const hasLetter = /[a-zA-Z]/.test(pwd)
  // 检查是否包含特殊字符
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(pwd)
  
  // 至少满足两种组合
  const conditionsMet = [hasNumber, hasLetter, hasSpecialChar].filter(Boolean).length
  
  if (conditionsMet < 2) {
    return '密码必须包含数字、字母、特殊字符中的至少两种'
  }
  
  // 检查是否为常见弱密码
  const weakPatterns = [
    /^(123|abc|password|admin|qwerty|iloveyou|123456|12345678|123456789|PassWord)(\d*)$/i,
    /^(\d{6,})$/, // 纯数字
    /^([a-zA-Z]{6,})$/, // 纯字母
    /^(.)\1{5,}$/, // 重复字符
  ]
  
  for (const pattern of weakPatterns) {
    if (pattern.test(pwd)) {
      return '请不要使用过于简单的密码'
    }
  }
  
  return null
}

async function handleInitPassword() {
  loading.value = true
  error.value = ''
  
  // 验证密码
  const strengthResult = checkPasswordStrength(password.value)
  if (strengthResult) {
    error.value = strengthResult
    loading.value = false
    return
  }
  
  // 验证确认密码
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    loading.value = false
    return
  }
  
  try {
    // 对密码进行加密后再传输
    const encryptedPassword = await encryptPassword(password.value)
    const res = await api.post('/api/init-password', { password: encryptedPassword, encrypted: true })
    if (res.data.ok) {
      // 初始化成功后自动登录, 使用 tokenManager 存储完整 token 数据
      tokenManager.setToken({
        token: res.data.data.token,
        expiresAt: res.data.data.expiresAt,
        createdAt: res.data.data.createdAt || Date.now(),
      })
      console.log('密码初始化成功，Token 已存储')

      // if (res.data.data.token) {
      //  localStorage.setItem('admin_token', res.data.data.token)
      // }

      // 直接跳转到首页，不再去登录页面
      router.push('/')
    }
    else {
      error.value = res.data.error || '初始化失败'
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
      error.value = e.message || '初始化异常'
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
          QQ 农场智能助手
        </h1>
        <p class="mt-3 text-sm text-gray-500 tracking-widest uppercase dark:text-gray-400">
          初始化管理员密码
        </p>
      </div>
      
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
        <p class="text-sm text-blue-800 dark:text-blue-300">
          <strong>密码要求：</strong>
        </p>
        <ul class="mt-2 text-xs text-blue-700 space-y-1 dark:text-blue-400">
          <li>• 长度至少 8 位，不超过 32 位</li>
          <li>• 必须包含数字、字母、特殊字符中的至少两种</li>
          <li>• 只能包含字母、数字和特定符号（!@#$%^&*()_+-=[]{}|;:,.<>?）</li>
          <li>• 不能包含空格或其他特殊字符</li>
          <li>• 避免使用常见弱密码（如 123456、password 等）</li>
        </ul>
      </div>
      
      <form class="space-y-4" @submit.prevent="handleInitPassword">
        <div>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入管理员密码"
            label="管理员密码"
            required
          />
        </div>
        
        <div>
          <BaseInput
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            label="确认密码"
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
          初始化密码并登录
        </BaseButton>
      </form>
    </div>
  </div>
</template>
