<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import { useIdleLogout } from '@/components/useIdleLogout'

const route = useRoute()

// 只在非登录页面启用空闲登出
if (route.name !== 'login' && route.name !== 'init-password') {
  // 30 分钟无操作自动登出，提前 5 分钟警告
  useIdleLogout({
    timeout: 30 * 60 * 1000,
    warningBefore: 5 * 60 * 1000,
  })
}
</script>

<template>
  <RouterView />
</template>

<style>
/* Global styles */
body {
  margin: 0;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'WenQuanYi Micro Hei', sans-serif;
}
</style>
