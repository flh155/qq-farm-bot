<script setup lang="ts">
import { useIntervalFn, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const farmStore = useFarmStore()
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()
const { lands, summary, loading, seeds } = storeToRefs(farmStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { status, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)
const { width } = useWindowSize()

const operating = ref(false)
const singleOperating = ref(false)
const confirmVisible = ref(false)
const confirmConfig = ref({
  title: '',
  message: '',
  opType: '',
})
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextLand = ref<any>(null)
const selectedLandId = ref(0)
const seedDialogVisible = ref(false)
const seedLoading = ref(false)
const selectedSeedId = ref<number | null>(null)

const contextMenuStyle = computed(() => ({
  left: `${contextMenuX.value}px`,
  top: `${contextMenuY.value}px`,
}))

const canSubmitSeedPlant = computed(() => {
  if (!selectedSeedId.value)
    return false
  const seed = seeds.value.find(s => Number(s.seedId) === Number(selectedSeedId.value))
  if (!seed)
    return false
  return Number(seed.count || 0) > 0 && Number(seed.plantSize || 1) <= 1
})

function getSafeImageUrl(url: string) {
  if (!url)
    return ''
  if (url.startsWith('http://'))
    return url.replace('http://', 'https://')
  return url
}

function closeContextMenu() {
  contextMenuVisible.value = false
}

function closeSeedDialog() {
  seedDialogVisible.value = false
  selectedSeedId.value = null
}

function handleWindowKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape')
    return
  closeContextMenu()
  closeSeedDialog()
}

function openLandContextMenu(e: MouseEvent, land: any) {
  const margin = 12
  const maxX = Math.max(margin, window.innerWidth - 180)
  const maxY = Math.max(margin, window.innerHeight - 168)
  contextMenuX.value = Math.max(margin, Math.min(e.clientX, maxX))
  contextMenuY.value = Math.max(margin, Math.min(e.clientY, maxY))
  contextLand.value = land
  selectedLandId.value = Number(land?.id || 0)
  contextMenuVisible.value = true
}

async function executeSingleLandAction(action: 'remove' | 'plant' | 'organic_fertilize', seedId = 0) {
  if (!currentAccountId.value || !selectedLandId.value)
    return
  singleOperating.value = true
  try {
    await farmStore.operateSingleLand(currentAccountId.value, {
      action,
      landId: selectedLandId.value,
      seedId,
    })
    const actionTextMap: Record<string, string> = {
      remove: '铲除',
      plant: '种植',
      organic_fertilize: '施有机肥',
    }
    toastStore.success(`地块 #${selectedLandId.value} 已执行${actionTextMap[action]}`)
  }
  catch (e: any) {
    toastStore.error(e?.response?.data?.error || e?.message || '单地块操作失败')
  }
  finally {
    singleOperating.value = false
  }
}

async function openSeedDialog() {
  if (!currentAccountId.value || !selectedLandId.value)
    return
  seedLoading.value = true
  try {
    await farmStore.fetchBagSeeds(currentAccountId.value)
    seedDialogVisible.value = true
    const firstEnabled = seeds.value.find(s => Number(s.count || 0) > 0 && Number(s.plantSize || 1) <= 1)
    selectedSeedId.value = firstEnabled ? Number(firstEnabled.seedId) : null
  }
  catch {
    toastStore.error('获取背包种子失败')
  }
  finally {
    seedLoading.value = false
  }
}

async function handleLandAction(action: 'remove' | 'plant' | 'organic_fertilize') {
  closeContextMenu()
  if (!selectedLandId.value)
    return
  if (action === 'plant') {
    await openSeedDialog()
    return
  }
  await executeSingleLandAction(action)
}

async function confirmSeedPlant() {
  if (!canSubmitSeedPlant.value || !selectedSeedId.value)
    return
  await executeSingleLandAction('plant', selectedSeedId.value)
  closeSeedDialog()
}

async function executeOperate() {
  if (!currentAccountId.value || !confirmConfig.value.opType)
    return
  confirmVisible.value = false
  operating.value = true
  try {
    await farmStore.operate(currentAccountId.value, confirmConfig.value.opType)
  }
  finally {
    operating.value = false
  }
}

function handleOperate(opType: string) {
  if (!currentAccountId.value)
    return

  const confirmMap: Record<string, string> = {
    harvest: '确定要收获所有成熟作物吗？',
    clear: '确定要一键除草/除虫吗？',
    plant: '确定要一键种植吗？(根据策略配置)',
    upgrade: '确定要升级所有可升级的土地吗？(消耗金币)',
    all: '确定要一键全收吗？(包含收获、除草、种植等)',
  }

  confirmConfig.value = {
    title: '确认操作',
    message: confirmMap[opType] || '确定执行此操作吗？',
    opType,
  }
  confirmVisible.value = true
}

const operations = [
  { type: 'harvest', label: '收获', icon: 'i-carbon-wheat', color: 'bg-blue-600 hover:bg-blue-700' },
  { type: 'clear', label: '除草/虫', icon: 'i-carbon-clean', color: 'bg-teal-600 hover:bg-teal-700' },
  { type: 'plant', label: '种植', icon: 'i-carbon-sprout', color: 'bg-green-600 hover:bg-green-700' },
  { type: 'upgrade', label: '升级土地', icon: 'i-carbon-upgrade', color: 'bg-purple-600 hover:bg-purple-700' },
  { type: 'all', label: '一键全收', icon: 'i-carbon-flash', color: 'bg-orange-600 hover:bg-orange-700' },
]

const displayLands = computed(() => {
  const list = Array.isArray(lands.value)
    ? [...lands.value].sort((a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0))
    : []

  if (width.value < 768)
    return list

  const columns = width.value >= 1024 ? 6 : 4
  const rows = Math.ceil(list.length / columns)
  const ordered: any[] = []

  // Farm land ids are numbered from the top-right corner downward in each column.
  // Reorder the cards so the rendered grid matches the in-game layout.
  for (let row = 0; row < rows; row++) {
    for (let col = columns - 1; col >= 0; col--) {
      const index = col * rows + row
      if (index < list.length)
        ordered.push(list[index])
    }
  }

  if (width.value < 1024)
    return ordered

  const groupMap = new Map<number, {
    plantSize: number
    members: Array<{ index: number, row: number, col: number, land: any }>
  }>()

  for (let i = 0; i < ordered.length; i++) {
    const land = ordered[i]
    const plantSize = Math.max(1, Number(land?.plantSize) || 1)
    const masterLandId = Number(land?.masterLandId || 0)
    if (plantSize <= 1 || !masterLandId)
      continue

    const row = Math.floor(i / columns)
    const col = i % columns
    if (!groupMap.has(masterLandId)) {
      groupMap.set(masterLandId, {
        plantSize,
        members: [],
      })
    }

    groupMap.get(masterLandId)!.members.push({ index: i, row, col, land })
  }

  const mergedAnchors = new Map<number, any>()
  const hiddenIndexes = new Set<number>()

  for (const [, group] of groupMap) {
    const size = Math.max(1, Number(group.plantSize) || 1)
    if (group.members.length < size * size)
      continue

    const rowsInGroup = group.members.map(member => member.row)
    const colsInGroup = group.members.map(member => member.col)
    const minRow = Math.min(...rowsInGroup)
    const maxRow = Math.max(...rowsInGroup)
    const minCol = Math.min(...colsInGroup)
    const maxCol = Math.max(...colsInGroup)

    if ((maxRow - minRow + 1) !== size || (maxCol - minCol + 1) !== size)
      continue

    const occupiedCells = new Set(group.members.map(member => `${member.row}:${member.col}`))
    let isFullRectangle = true
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (!occupiedCells.has(`${row}:${col}`)) {
          isFullRectangle = false
          break
        }
      }
      if (!isFullRectangle)
        break
    }

    if (!isFullRectangle)
      continue

    const anchor = group.members.find(member => member.row === minRow && member.col === minCol)
    if (!anchor)
      continue

    const mergedLandIds: number[][] = []
    for (let row = minRow; row <= maxRow; row++) {
      const rowIds: number[] = []
      for (let col = minCol; col <= maxCol; col++) {
        const member = group.members.find(item => item.row === row && item.col === col)
        if (member)
          rowIds.push(Number(member.land?.id || 0))
      }
      if (rowIds.length > 0)
        mergedLandIds.push(rowIds)
    }

    mergedAnchors.set(anchor.index, {
      ...anchor.land,
      mergedCard: true,
      mergedLandIds,
    })

    for (const member of group.members) {
      if (member.index !== anchor.index)
        hiddenIndexes.add(member.index)
    }
  }

  const merged: any[] = []
  for (let i = 0; i < ordered.length; i++) {
    if (hiddenIndexes.has(i))
      continue
    merged.push(mergedAnchors.get(i) || ordered[i])
  }

  return merged
})

function getLandWrapperClass(land: any) {
  if (land?.mergedCard)
    return 'lg:col-span-2 lg:row-span-2'
  return ''
}

async function refresh() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    if (!realtimeConnected.value)
      await statusStore.fetchStatus(currentAccountId.value)

    if (acc.running && status.value?.connection?.connected)
      farmStore.fetchLands(currentAccountId.value)
  }
}

watch(currentAccountId, () => {
  refresh()
})

const { pause, resume } = useIntervalFn(() => {
  if (lands.value) {
    lands.value = lands.value.map((l: any) =>
      l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
    )
  }
}, 1000)

const { pause: pauseRefresh, resume: resumeRefresh } = useIntervalFn(refresh, 60000)

onMounted(() => {
  refresh()
  resume()
  resumeRefresh()
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('scroll', closeContextMenu, true)
  window.addEventListener('keydown', handleWindowKeydown)
})

onUnmounted(() => {
  pause()
  pauseRefresh()
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('scroll', closeContextMenu, true)
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-lg bg-white shadow dark:bg-gray-800">
      <div class="flex flex-col items-center justify-between gap-4 border-b border-gray-100 p-4 sm:flex-row dark:border-gray-700">
        <h3 class="flex items-center gap-2 text-lg font-bold">
          <div class="i-carbon-grid text-xl" />
          土地详情
        </h3>
        <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button
            v-for="op in operations"
            :key="op.type"
            class="flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            :class="op.color"
            :disabled="operating"
            @click="handleOperate(op.type)"
          >
            <div :class="op.icon" />
            {{ op.label }}
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-4 border-b border-gray-100 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-900/50">
        <div class="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
          <div class="i-carbon-clean" />
          <span class="font-medium">可收: {{ summary?.harvestable || 0 }}</span>
        </div>
        <div class="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <div class="i-carbon-sprout" />
          <span class="font-medium">生长: {{ summary?.growing || 0 }}</span>
        </div>
        <div class="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
          <div class="i-carbon-checkbox" />
          <span class="font-medium">空闲: {{ summary?.empty || 0 }}</span>
        </div>
        <div class="flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <div class="i-carbon-warning" />
          <span class="font-medium">枯萎: {{ summary?.dead || 0 }}</span>
        </div>
      </div>

      <div class="p-4">
        <div v-if="loading || statusLoading" class="flex justify-center py-12">
          <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
        </div>

        <div v-else-if="!status?.connection?.connected" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
          <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
          <div>
            <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
              账号未登录
            </div>
            <div class="mt-1 text-sm text-gray-400">
              请先运行账号或检查网络连接
            </div>
          </div>
        </div>

        <div v-else-if="!displayLands.length" class="flex justify-center py-12 text-gray-500">
          暂无土地数据
        </div>

        <div v-else class="grid grid-cols-2 gap-4 lg:grid-cols-6 md:grid-cols-4 sm:grid-cols-3">
          <div
            v-for="land in displayLands"
            :key="land.id"
            :class="getLandWrapperClass(land)"
            @contextmenu.prevent="openLandContextMenu($event, land)"
          >
            <LandCard :land="land" />
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="confirmVisible"
      :title="confirmConfig.title"
      :message="confirmConfig.message"
      @confirm="executeOperate"
      @cancel="confirmVisible = false"
    />

    <div
      v-if="contextMenuVisible"
      class="fixed z-[70] min-w-35 border border-gray-200 rounded-lg bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      :style="contextMenuStyle"
      @click.stop
    >
      <button
        class="w-full rounded px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
        :disabled="singleOperating"
        @click="handleLandAction('remove')"
      >
        铲除
      </button>
      <button
        class="w-full rounded px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
        :disabled="singleOperating"
        @click="handleLandAction('plant')"
      >
        种植
      </button>
      <button
        class="w-full rounded px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
        :disabled="singleOperating"
        @click="handleLandAction('organic_fertilize')"
      >
        施有机肥
      </button>
    </div>

    <div
      v-if="seedDialogVisible"
      class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      @click="closeSeedDialog"
    >
      <div class="max-h-[80vh] max-w-xl w-full overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-800" @click.stop>
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <h3 class="text-lg font-bold">
            选择种子（地块 #{{ selectedLandId }}）
          </h3>
          <button class="text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-300" @click="closeSeedDialog">
            <div class="i-carbon-close text-lg" />
          </button>
        </div>
        <div class="max-h-[55vh] overflow-y-auto p-4">
          <div v-if="seedLoading" class="flex justify-center py-12">
            <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
          </div>
          <div v-else-if="!seeds.length" class="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            背包暂无种子
          </div>
          <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="seed in seeds"
              :key="seed.seedId"
              class="flex items-center gap-3 border rounded-lg px-3 py-2 text-left transition"
              :class="[
                Number(seed.plantSize || 1) > 1 || Number(seed.count || 0) <= 0
                  ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-gray-700/60 dark:text-gray-500'
                  : Number(selectedSeedId) === Number(seed.seedId)
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/60 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500 dark:hover:bg-blue-900/20',
              ]"
              :disabled="Number(seed.plantSize || 1) > 1 || Number(seed.count || 0) <= 0 || singleOperating"
              @click="selectedSeedId = Number(seed.seedId)"
            >
              <img
                v-if="seed.image"
                :src="getSafeImageUrl(seed.image)"
                :alt="seed.name"
                class="h-10 w-10 object-contain"
              >
              <div v-else class="h-10 w-10 rounded bg-gray-200 dark:bg-gray-700" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">
                  {{ seed.name }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  数量: {{ seed.count }} | {{ seed.requiredLevel }}级 | {{ seed.plantSize }}x{{ seed.plantSize }}
                </div>
                <div v-if="Number(seed.plantSize || 1) > 1" class="text-xs text-red-500 dark:text-red-400">
                  仅支持 1x1 种子
                </div>
              </div>
            </button>
          </div>
        </div>
        <div class="flex justify-end gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          <button
            class="rounded-lg px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            :disabled="singleOperating"
            @click="closeSeedDialog"
          >
            取消
          </button>
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition disabled:cursor-not-allowed hover:bg-blue-700 disabled:opacity-50"
            :disabled="singleOperating || !canSubmitSeedPlant"
            @click="confirmSeedPlant"
          >
            确认种植
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
