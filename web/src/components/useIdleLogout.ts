import { onMounted, onUnmounted } from 'vue'
import { tokenManager } from '@/api'
import { useToastStore } from '@/stores/toast'
import { useRouter } from 'vue-router'

interface UseIdleLogoutOptions {
  timeout?: number // 超时时间（毫秒），默认 30 分钟
  warningBefore?: number // 提前多久警告（毫秒），默认 5 分钟
}

export function useIdleLogout(options: UseIdleLogoutOptions = {}) {
  const {
    timeout = 30 * 60 * 1000, // 30 分钟
    warningBefore = 5 * 60 * 1000, // 5 分钟
  } = options

  const toast = useToastStore()
  const router = useRouter()

  let idleTimer: number | null = null
  let warningTimer: number | null = null
  let warned = false

  // 重置定时器
  function resetTimer() {
    clearTimers()

    // 设置警告定时器
    warningTimer = window.setTimeout(() => {
      if (!warned && tokenManager.getToken()) {
        warned = true
        toast.warning('您已长时间未操作，即将自动退出登录')
      }
    }, timeout - warningBefore)

    // 设置登出定时器
    idleTimer = window.setTimeout(() => {
      handleLogout()
    }, timeout)
  }

  // 清除所有定时器
  function clearTimers() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (warningTimer) {
      clearTimeout(warningTimer)
      warningTimer = null
    }
  }

  // 执行登出
  function handleLogout() {
    if (!tokenManager.getToken()) return

    console.log('用户长时间未操作，自动退出登录')
    tokenManager.clearToken()
    
    // 如果当前不在登录页，跳转到登录页
    if (!window.location.pathname.includes('/login')) {
      toast.warning('您已长时间未操作，已自动退出登录')
      router.push('/login')
    }
  }

  // 用户活动事件处理
  function handleUserActivity() {
    if (!tokenManager.getToken()) return
    
    warned = false
    resetTimer()
  }

  // 监听的事件列表
  const events = [
    'mousedown',
    'keydown',
    'scroll',
    'touchstart',
    'mousemove',
    'keypress',
  ]

  onMounted(() => {
    // 启动定时器
    resetTimer()

    // 添加事件监听
    events.forEach(event => {
      window.addEventListener(event, handleUserActivity)
    })
  })

  onUnmounted(() => {
    // 清除定时器
    clearTimers()

    // 移除事件监听
    events.forEach(event => {
      window.removeEventListener(event, handleUserActivity)
    })
  })

  // 返回控制函数（可选）
  return {
    reset: resetTimer,
    logout: handleLogout,
  }
}