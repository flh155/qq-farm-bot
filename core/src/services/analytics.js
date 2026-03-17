/**
 * 数据分析模块 - 作物效率分析
 */

const { getAllPlants, getFruitPrice, getSeedPrice, getItemImageById } = require('../config/gameConfig');

function parseGrowPhaseDurations(growPhases) {
    if (!growPhases) return 0;
    const phases = growPhases.split(';').filter(p => p.length > 0);
    const durations = [];
    for (const phase of phases) {
        const match = phase.match(/:(\d+)$/);
        if (match) {
            durations.push(Number.parseInt(match[1], 10) || 0);
        }
    }
    return durations;
}

function parseGrowTime(growPhases, seasons = 1) {
    const durations = parseGrowPhaseDurations(growPhases);
    if (!Array.isArray(durations) || durations.length === 0) return 0;

    const totalTime = durations.reduce((sum, duration) => sum + duration, 0);
    if (Number(seasons) !== 2) return totalTime;

    const nonZeroDurations = durations.filter(duration => duration > 0);
    const lastTwoDurations = nonZeroDurations.slice(-2);
    const extraTime = lastTwoDurations.reduce((sum, duration) => sum + duration, 0);
    return totalTime + extraTime;
}

function parseNormalFertilizerReduceSec(growPhases, seasons = 1) {
    const durations = parseGrowPhaseDurations(growPhases)
        .filter(duration => duration > 0);
    if (durations.length === 0) return 0;

    const maxDuration = Math.max(...durations);
    const applyCount = Number(seasons) === 2 ? 2 : 1;
    return maxDuration * applyCount;
}

function formatTime(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
}

function getPlantRankings(sortBy = 'exp') {
    const plants = getAllPlants();
    console.warn(`[分析] 获取到 ${plants.length} 种作物`);
    
    // 筛选普通作物
    const normalPlants = plants.filter(p => {
        // const idStr = String(p.id);
        // return idStr.startsWith('102') && p.seed_id && p.seed_id >= 20000 && p.seed_id < 30000;
        // 放宽条件，只要有种子ID且有生长阶段数据
        return p.seed_id > 0 && p.grow_phases;
    });
    console.warn(`[分析] 筛选出 ${normalPlants.length} 种作物`);



    const results = [];
    for (const plant of normalPlants) {
        const seasons = Number(plant.seasons) || 1;
        const baseGrowTime = parseGrowTime(plant.grow_phases, seasons);
        if (baseGrowTime <= 0) continue;
        const isTwoSeason = seasons === 2;
        const growTime = baseGrowTime;
        
        const harvestExpBase = Number.parseInt(plant.exp) || 0;
        const harvestExp = isTwoSeason ? (harvestExpBase * 2) : harvestExpBase;
        const expPerHour = (harvestExp / growTime) * 3600;
        // 普通化肥：减少最长非 0 生长阶段；两季作物按两次最长阶段计算
        const reduceSecApplied = parseNormalFertilizerReduceSec(plant.grow_phases, seasons);
        const fertilizedGrowTime = growTime - reduceSecApplied;
        const safeFertilizedTime = fertilizedGrowTime > 0 ? fertilizedGrowTime : 1;
        const normalFertilizerExpPerHour = (harvestExp / safeFertilizedTime) * 3600;
        
        const fruitId = Number(plant.fruit && plant.fruit.id) || 0;
        const fruitCount = Number(plant.fruit && plant.fruit.count) || 0;
        const fruitPrice = getFruitPrice(fruitId);
        const seedPrice = getSeedPrice(Number(plant.seed_id) || 0);

        // 单次收获总金币（毛收益）与净收益
        const income = (fruitCount * fruitPrice) * (isTwoSeason ? 2 : 1);
        const netProfit = income - seedPrice;
        const goldPerHour = (income / growTime) * 3600;
        const profitPerHour = (netProfit / growTime) * 3600;
        const normalFertilizerProfitPerHour = (netProfit / safeFertilizedTime) * 3600;

        const cfgLevel = Number(plant.land_level_need);
        const requiredLevel = (Number.isFinite(cfgLevel) && cfgLevel > 0) ? cfgLevel : null;
        results.push({
            id: plant.id,
            seedId: plant.seed_id,
            name: plant.name,
            seasons,
            level: requiredLevel,
            growTime,
            growTimeStr: formatTime(growTime),
            reduceSec: Number(seasons) === 2 ? (reduceSecApplied / 2) : reduceSecApplied,
            reduceSecApplied,
            expPerHour: Number.parseFloat(expPerHour.toFixed(2)),
            normalFertilizerExpPerHour: Number.parseFloat(normalFertilizerExpPerHour.toFixed(2)),
            goldPerHour: Number.parseFloat(goldPerHour.toFixed(2)), // 毛收益/时
            profitPerHour: Number.parseFloat(profitPerHour.toFixed(2)), // 净收益/时
            normalFertilizerProfitPerHour: Number.parseFloat(normalFertilizerProfitPerHour.toFixed(2)), // 普通肥净收益/时
            income,
            netProfit,
            fruitId,
            fruitCount,
            fruitPrice,
            seedPrice,
            image: getItemImageById(plant.seed_id),
        });
    }

    if (sortBy === 'exp') {
        results.sort((a, b) => b.expPerHour - a.expPerHour);
    } else if (sortBy === 'fert') {
        results.sort((a, b) => b.normalFertilizerExpPerHour - a.normalFertilizerExpPerHour);
    } else if (sortBy === 'gold') {
        results.sort((a, b) => b.goldPerHour - a.goldPerHour);
    } else if (sortBy === 'profit') {
        results.sort((a, b) => b.profitPerHour - a.profitPerHour);
    } else if (sortBy === 'fert_profit') {
        results.sort((a, b) => b.normalFertilizerProfitPerHour - a.normalFertilizerProfitPerHour);
    } else if (sortBy === 'level') {
        const lv = (v) => (v === null || v === undefined ? -1 : Number(v));
        results.sort((a, b) => lv(b.level) - lv(a.level));
    }

    return results;
}

module.exports = {
    getPlantRankings,
};
