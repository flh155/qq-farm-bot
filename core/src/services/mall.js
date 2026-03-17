const { Buffer } = require('node:buffer');
/**
 * 商城自动购买
 * 当前实现：自动购买有机化肥（item_id=1012）
 */

const { sendMsgAsync, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, log, sleep } = require('../utils/utils');
const { getDateKey, createDailyCooldown } = require('./common');
const { getCurrentContainerHours } = require('./warehouse');

const ORGANIC_10H_GOODS_ID = 1002;
const NORMAL_10H_GOODS_ID = 1003;
const BUY_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_ROUNDS = 100;
const FREE_GIFTS_DAILY_KEY = 'mall_free_gifts';

let lastBuyAt = 0;
let buyDoneDateKey = '';
let buyLastSuccessAt = 0;
let buyPausedNoGoldDateKey = '';
let freeGiftDoneDateKey = '';
let freeGiftLastAt = 0;

const freeGiftCooldown = createDailyCooldown({ cooldownMs: BUY_COOLDOWN_MS });

async function getMallListBySlotType(slotType = 1) {
    const body = types.GetMallListBySlotTypeRequest.encode(types.GetMallListBySlotTypeRequest.create({
        slot_type: Number(slotType) || 1,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMallListBySlotType', body);
    return types.GetMallListBySlotTypeResponse.decode(replyBody);
}

async function purchaseMallGoods(goodsId, count = 1) {
    const body = types.PurchaseRequest.encode(types.PurchaseRequest.create({
        goods_id: Number(goodsId) || 0,
        count: Number(count) || 1,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'Purchase', body);
    return types.PurchaseResponse.decode(replyBody);
}

async function getMallGoodsList(slotType = 1) {
    const mall = await getMallListBySlotType(slotType);
    const raw = Array.isArray(mall && mall.goods_list) ? mall.goods_list : [];
    const goods = [];
    for (const b of raw) {
        try {
            goods.push(types.MallGoods.decode(b));
        } catch {
            // ignore
        }
    }
    return goods;
}

function parseMallPriceValue(priceField) {
    if (priceField == null) return 0;
    if (typeof priceField === 'number') return Math.max(0, Math.floor(priceField));
    const bytes = Buffer.isBuffer(priceField) ? priceField : Buffer.from(priceField || []);
    if (!bytes.length) return 0;
    // 从 bytes 中读取 field=2 的 varint 作为价格
    let idx = 0;
    let parsed = 0;
    while (idx < bytes.length) {
        const key = bytes[idx++];
        const field = key >> 3;
        const wire = key & 0x07;
        if (wire !== 0) break;
        let val = 0;
        let shift = 0;
        while (idx < bytes.length) {
            const b = bytes[idx++];
            val |= (b & 0x7F) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
        }
        if (field === 2) parsed = val;
    }
    return Math.max(0, Math.floor(parsed || 0));
}

async function buyFertilizerViaMall(targetGoodsId, maxTotal = 10) {
    const goodsList = await getMallGoodsList(1);
    const goods = goodsList.find((g) => toNum(g && g.goods_id) === targetGoodsId) || null;
    if (!goods) return 0;

    const goodsId = toNum(goods.goods_id);
    if (goodsId <= 0) return 0;
    const singlePrice = parseMallPriceValue(goods.price);
    let ticket = Math.max(0, toNum((getUserState() || {}).ticket));
    let totalBought = 0;
    let perRound = Math.min(maxTotal, 10);
    if (singlePrice > 0 && ticket > 0) {
        perRound = Math.max(1, Math.min(perRound, Math.floor(ticket / singlePrice) || 1));
    }

    for (let i = 0; i < MAX_ROUNDS; i++) {
        const remaining = maxTotal - totalBought;
        if (remaining <= 0) break;
        const thisBuy = Math.min(perRound, remaining);

        if (singlePrice > 0 && ticket > 0 && ticket < singlePrice) {
            buyPausedNoGoldDateKey = getDateKey();
            break;
        }
        try {
            await purchaseMallGoods(goodsId, thisBuy);
            totalBought += thisBuy;
            if (singlePrice > 0 && ticket > 0) {
                ticket = Math.max(0, ticket - (singlePrice * thisBuy));
                if (ticket < singlePrice) break;
            }
            await sleep(120);
        } catch (e) {
            const msg = String((e && e.message) || '');
            if (msg.includes('余额不足') || msg.includes('点券不足') || msg.includes('code=1000019')) {
                if (thisBuy > 1) {
                    perRound = 1;
                    continue;
                }
                buyPausedNoGoldDateKey = getDateKey();
            }
            break;
        }
    }
    return totalBought;
}

async function autoBuyOrganicFertilizer(force = false, buyConfig = {}) {
    const type = ['organic', 'normal', 'both'].includes(buyConfig.type) ? buyConfig.type : 'organic';
    const max = Math.max(1, Math.min(10, Math.floor(Number(buyConfig.max) || 10)));
    const mode = buyConfig.mode === 'unlimited' ? 'unlimited' : 'threshold';
    const threshold = Math.max(0, Number(buyConfig.threshold ?? 100));
    const effectiveType = (mode === 'unlimited' && type === 'both') ? 'organic' : type;
    const now = Date.now();
    if (!force && now - lastBuyAt < BUY_COOLDOWN_MS) return 0;

    try {
        let buyOrganic = effectiveType === 'organic' || effectiveType === 'both';
        let buyNormal = effectiveType === 'normal' || effectiveType === 'both';
        let normalHours = 0;
        let organicHours = 0;

        if (mode === 'threshold') {
            ({ normal: normalHours, organic: organicHours } = await getCurrentContainerHours());
            if (threshold <= 0) {
                if (buyOrganic && organicHours > 0) buyOrganic = false;
                if (buyNormal && normalHours > 0) buyNormal = false;
            } else {
                if (buyOrganic && organicHours >= threshold) buyOrganic = false;
                if (buyNormal && normalHours >= threshold) buyNormal = false;
            }
            if (!buyOrganic && !buyNormal) {
                lastBuyAt = now;
                return 0;
            }
        }

        let totalBought = 0;
        let remaining = max;
        const plans = [];

        if (buyOrganic) {
            plans.push({
                goodsId: ORGANIC_10H_GOODS_ID,
                currentHours: organicHours,
            });
        }
        if (buyNormal) {
            plans.push({
                goodsId: NORMAL_10H_GOODS_ID,
                currentHours: normalHours,
            });
        }
        if (plans.length > 1 && mode === 'threshold') {
            plans.sort((a, b) => a.currentHours - b.currentHours);
        }

        lastBuyAt = now;
        for (const plan of plans) {
            if (remaining <= 0) break;
            const bought = await buyFertilizerViaMall(plan.goodsId, remaining);
            totalBought += bought;
            remaining -= bought;
        }

        if (totalBought > 0) {
            buyDoneDateKey = getDateKey();
            buyLastSuccessAt = Date.now();
            log('商城', `自动购买化肥 x${totalBought}`, {
                module: 'warehouse',
                event: 'fertilizer_buy',
                result: 'ok',
                count: totalBought,
            });
        }
        return totalBought;
    } catch {
        return 0;
    }
}

async function buyFreeGifts(force = false) {
    if (!freeGiftCooldown.canRun(force)) return 0;

    try {
        const mall = await getMallListBySlotType(1);
        const raw = Array.isArray(mall && mall.goods_list) ? mall.goods_list : [];
        const goods = [];
        for (const b of raw) {
            try {
                goods.push(types.MallGoods.decode(b));
            } catch {
                // ignore
            }
        }
        const free = goods.filter((g) => !!g && g.is_free === true && Number(g.goods_id || 0) > 0);
        if (!free.length) {
            freeGiftDoneDateKey = getDateKey();
            freeGiftCooldown.markRan();
            log('商城', '今日暂无可领取免费礼包', {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'none',
            });
            return 0;
        }

        let bought = 0;
        for (const g of free) {
            try {
                await purchaseMallGoods(Number(g.goods_id || 0), 1);
                bought += 1;
            } catch {
                // 单个失败跳过
            }
        }
        freeGiftDoneDateKey = getDateKey();
        if (bought > 0) {
            freeGiftLastAt = Date.now();
            freeGiftCooldown.markRan();
            log('商城', `自动购买免费礼包 x${bought}`, {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'ok',
                count: bought,
            });
        } else {
            freeGiftCooldown.markRan();
            log('商城', '本次未成功领取免费礼包', {
                module: 'task',
                event: FREE_GIFTS_DAILY_KEY,
                result: 'none',
            });
        }
        return bought;
    } catch (e) {
        log('商城', `领取免费礼包失败: ${e.message}`, {
            module: 'task',
            event: FREE_GIFTS_DAILY_KEY,
            result: 'error',
        });
        return 0;
    }
}

module.exports = {
    autoBuyOrganicFertilizer,
    buyFreeGifts,
    getFertilizerBuyDailyState: () => ({
        key: 'fertilizer_buy',
        doneToday: buyDoneDateKey === getDateKey(),
        pausedNoGoldToday: buyPausedNoGoldDateKey === getDateKey(),
        lastSuccessAt: buyLastSuccessAt,
    }),
    getFreeGiftDailyState: () => ({
        key: FREE_GIFTS_DAILY_KEY,
        doneToday: freeGiftDoneDateKey === getDateKey(),
        ...freeGiftCooldown.getState(),
        lastClaimAt: freeGiftLastAt,
    }),
};
