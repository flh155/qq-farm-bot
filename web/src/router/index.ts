// import { useStorage } from '@vueuse/core'
import axios from 'axios'
import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

// const adminToken = useStorage('admin_token', '')


async function ensureTokenValid() {
  // const token = String(adminToken.value || '').trim()

  // 从 localStorage 读取完整的 token 数据
  const tokenDataRaw = localStorage.getItem('admin_token')

  let token: string | null = null
  
  
  if (tokenDataRaw) {
    let tokenData: any = null
    
    try {
      tokenData = JSON.parse(tokenDataRaw)
    } catch {
      // 如果是旧版本的纯字符串 token，兼容处理
      if (tokenDataRaw && tokenDataRaw.length > 0) {
        tokenData = {
          token: tokenDataRaw,
          expiresAt: 0,
          createdAt: 0,
        }
      }
    }
    
    if (tokenData && tokenData.token) {
      token = tokenData.token
    }
  }

  // 首先检查是否禁用了密码认证
  try {
    const authCheckResponse = await axios.get('/api/auth/validate', {
      headers: token ? { 'x-admin-token': token } : {},
      timeout: 6000,
    })

    if (authCheckResponse.data && authCheckResponse.data.ok) {
      const { valid, passwordDisabled, needsInit } = authCheckResponse.data.data

      // 如果需要初始化密码，返回特殊标记
      if (needsInit) {
        return 'needsInit'
      }

      // 如果禁用了密码认证，直接返回 true
      if (passwordDisabled) {
        return true
      }

      // 如果启用了密码认证，检查 token 有效性
      if (valid && token) {
        return true
      }
    }

    return false
  }
  catch (error: any) {
    // 如果是 401 错误，说明 token 无效
    if (error.response && error.response.status === 401) {
      // 检查响应中是否有 needsInit 信息
      const responseData = error.response.data
      if (responseData && responseData.data && responseData.data.needsInit) {
        return 'needsInit'
      }
      return false
    }
    // 网络错误等其他情况，暂时认为 token 有效（避免频繁登出）
    return true
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: menuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
      })),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/init-password',
      name: 'init-password',
      component: () => import('@/views/InitPassword.vue'),
    },
  ],
})

router.beforeEach(async (to, _from) => {
  NProgress.start()

  // 首先检查认证状态
  const authValid = await ensureTokenValid()

  // 如果需要初始化密码
  if (authValid === 'needsInit') {
    // 只允许访问初始化页面，其他所有页面都重定向到初始化页面
    if (to.name !== 'init-password') {
      return { name: 'init-password' }
    }
    return true
  }

  // 如果在初始化页面但不需要初始化了（已初始化或禁用密码），跳转到首页
  if (to.name === 'init-password') {
    if (authValid === true) {
      return { name: 'dashboard' }
    }
    // 如果还需要初始化，允许访问（这个情况理论上不会发生，因为上面已经处理了）
    return true
  }

  // 登录页面的特殊处理
  if (to.name === 'login') {
    // 如果已经通过认证（包括禁用密码认证的情况），跳转到首页
    if (authValid === true) {
      return { name: 'dashboard' }
    }
    // 否则显示登录页
    return true
  }

  // 对于其他页面，检查认证状态
  if (!authValid) {
    // 如果认证失败，清除 token 并跳转到登录页
    // adminToken.value = ''
    localStorage.removeItem('admin_token')
    return { name: 'login' }
  }

  return true
})

// 添加路由后置守卫，每次路由切换后触发用户活动
router.afterEach((_to, _from) => {
  NProgress.done()
  
  // 触发自定义事件，通知空闲检测重置定时器
  window.dispatchEvent(new CustomEvent('user-active'))
})

export default router
