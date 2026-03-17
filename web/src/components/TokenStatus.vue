<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { tokenManager } from '@/api'
import type { TokenData } from '@/utils/auth'

const remainingTime = ref('')
const isExpiringSoon = ref(false)

function updateRemainingTime() {
  const tokenData = tokenManager.getTokenData() as TokenData | null
  if (!tokenData || !tokenData.expiresAt) {
    remainingTime.value = ''
    return
  }
  
  const now = Date.now()
  const remaining = tokenData.expiresAt - now
  
  if (remaining <= 0) {
    remainingTime.value = '已过期'
    isExpiringSoon.value = true
  } else {
    const hours = Math.floor(remaining / (1000 * 60 * 60))
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
    
    if (hours > 0) {
      remainingTime.value = `${hours}小时${minutes}分钟`
    } else {
      remainingTime.value = `${minutes}分钟`
    }
    
    // 剩余时间少于 0.08 小时，标记为即将过期
    isExpiringSoon.value = remaining < (0.08 * 60 * 60 * 1000)
  }
}

let timer: number

onMounted(() => {
  updateRemainingTime()
  timer = window.setInterval(updateRemainingTime, 60000) // 每分钟更新
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
})

const statusClass = computed(() => {
  if (isExpiringSoon.value) return 'text-red-600 dark:text-red-400'
  return 'text-green-600 dark:text-green-400'
})
</script>

<template>
  <div v-if="remainingTime" class="text-xs mt-2">
    <span :class="['font-medium', statusClass]">
      {{ isExpiringSoon ? '⚠️ Token 即将过期：' : '✅ Token 剩余时间：' }}
      {{ remainingTime }}
    </span>
  </div>
</template>