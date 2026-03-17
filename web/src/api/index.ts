import { useStorage } from '@vueuse/core'
import axios from 'axios'
import { useToastStore } from '@/stores/toast'
import type { TokenData } from '@/utils/auth'

const tokenRef = useStorage<TokenData>('admin_token', {
  token: '',
  expiresAt: 0,
  createdAt: 0,
})
const accountIdRef = useStorage('current_account_id', '')

// Token 刷新阈值（毫秒）- 与后端保持一致（5 分钟）
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000

// 检查 token 是否需要刷新
function needsTokenRefresh(): boolean {
  const tokenData = tokenRef.value
  if (!tokenData || !tokenData.expiresAt) return false
  
  const now = Date.now()
  const remainingTime = tokenData.expiresAt - now
  
  // 过期前 2 小时内可以刷新
  return remainingTime > 0 && remainingTime < TOKEN_REFRESH_THRESHOLD_MS
}

// 检查 token 是否已过期
function isTokenExpired(): boolean {
  const tokenData = tokenRef.value
  if (!tokenData || !tokenData.expiresAt) return true
  
  return Date.now() > tokenData.expiresAt
}

// 自动刷新 token
async function refreshToken(): Promise<boolean> {
  const tokenData = tokenRef.value
  if (!needsTokenRefresh() || !tokenData.token) return true
  
  try {
    const response = await axios.post('/api/token/refresh', null, {
      headers: {
        'x-admin-token': tokenData.token,
      },
    })
    
    if (response.data.ok) {
      tokenRef.value = {
        token: response.data.data.token,
        expiresAt: response.data.data.expiresAt,
        createdAt: response.data.data.createdAt || Date.now(),
      }
      return true
    }
    
    return false
  } catch (error) {
    console.error('Token refresh failed:', error)
    return false
  }
}

// 定期刷新 token 的定时器
let refreshTimer: number | undefined

// 启动 token 自动刷新
function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
  
  // 每 30 分钟检查一次
  refreshTimer = window.setInterval(async () => {
    const tokenData = tokenRef.value
    if (tokenData && tokenData.token && needsTokenRefresh()) {
      const success = await refreshToken()
      if (!success) {
        // 刷新失败，但 token 还未过期，继续等待
        console.warn('Token auto-refresh failed, will retry later')
      }
    }
  }, 30 * 60 * 1000)
}

// 停止 token 自动刷新
function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}

const api = axios.create({
  baseURL: '/',
  timeout: 10000,
})

api.interceptors.request.use((config) => {
  const tokenData = tokenRef.value
  const token = tokenData?.token
  if (token) {
    config.headers['x-admin-token'] = token
    
    // 检查 token 是否即将过期，如果是则刷新
    if (needsTokenRefresh() && !config.url?.includes('/token/refresh')) {
      // 异步刷新，不阻塞当前请求
      refreshToken().then(success => {
        if (success) {
          console.log('Token refreshed successfully')
        }
      })
    }
  }
  const accountId = accountIdRef.value
  if (accountId) {
    config.headers['x-account-id'] = accountId
  }
  return config
}, (error) => {
  return Promise.reject(error)
})

api.interceptors.response.use((response) => {
  // 响应中也可以检查是否需要刷新
  const tokenData = tokenRef.value
  if (tokenData && tokenData.token && needsTokenRefresh()) {
    // 在后台刷新 token
    refreshToken()
  }
  return response
}, (error) => {
  const toast = useToastStore()

  if (error.response) {
    if (error.response.status === 401) {
      const reason = error.response.data?.reason
      
      // Token 过期
      if (reason === 'TOKEN_EXPIRED') {
        tokenRef.value = { token: '', expiresAt: 0, createdAt: 0 }
        stopAutoRefresh()
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login'
          toast.error('登录已过期，请重新登录')
        }
      }
      // Token 无效或未找到
      else if (reason === 'TOKEN_NOT_FOUND' || reason === 'TOKEN_MISSING') {
        tokenRef.value = { token: '', expiresAt: 0, createdAt: 0 }
        stopAutoRefresh()
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login'
          toast.warning('登录状态异常，请重新登录')
        }
      }
      // 其他 401 错误
      else {
        tokenRef.value = { token: '', expiresAt: 0, createdAt: 0 }
        stopAutoRefresh()
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login'
          toast.warning('登录已过期，请重新登录')
        }
      }
    }
    else if (error.response.status >= 500) {
      const backendError = String(error.response.data?.error || error.response.data?.message || '')
      // 后端运行态可预期错误：不弹全局 500，交给页面状态处理
      if (backendError === '账号未运行' || backendError === 'API Timeout') {
        return Promise.reject(error)
      }
      toast.error(`服务器错误：${error.response.status} ${error.response.statusText}`)
    }
    else {
      const msg = error.response.data?.message || error.message
      // Don't show toast for 404 if it's expected in some logic?
      // Generally for API calls, 404 is an error.
      toast.error(`请求失败：${msg}`)
    }
  }
  else if (error.request) {
    toast.error('网络错误，无法连接到服务器')
  }
  else {
    toast.error(`错误：${error.message}`)
  }

  return Promise.reject(error)
})

// 导出 token 管理函数
export const tokenManager = {
  getToken: () => tokenRef.value?.token || '',
  getTokenData: () => tokenRef.value,
  setToken: (data: TokenData) => {
    tokenRef.value = data
    startAutoRefresh()
  },
  clearToken: () => {
    tokenRef.value = { token: '', expiresAt: 0, createdAt: 0 }
    stopAutoRefresh()
  },
  isExpired: isTokenExpired,
  needsRefresh: needsTokenRefresh,
  refresh: refreshToken,
  startAutoRefresh,
  stopAutoRefresh,
}

// 应用启动时检查是否需要恢复自动刷新
if (tokenRef.value && tokenRef.value.token && !isTokenExpired()) {
  startAutoRefresh()
}

export default api