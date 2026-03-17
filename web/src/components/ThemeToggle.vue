<script setup lang="ts">
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
</script>

<template>
  <button
    class="icon-btn mx-2 !outline-none"
    title="切换主题"
    @click="appStore.toggleDark()"
  >
    <div i-carbon-sun dark:i-carbon-moon />
  </button>
</template>
