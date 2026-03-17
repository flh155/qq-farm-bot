const { Buffer } = require('node:buffer');
const WebSocket = require('ws');
const { CONFIG } = require('../config/config');
const { loadProto, types } = require('../utils/proto');
const { toLong, toNum } = require('../utils/utils');
const cryptoWasm = require('../utils/crypto-wasm');

function buildDeviceInfo() {
    const cfg = (CONFIG.device_info && typeof CONFIG.device_info === 'object') ? CONFIG.device_info : {};
    return {
        client_version: String(CONFIG.clientVersion || cfg.client_version || ''),
        sys_software: String(cfg.sys_software || 'iOS 26.2.1'),
        network: String(cfg.network || 'wifi'),
        memory: String(cfg.memory || '7672'),
        device_id: String(cfg.device_id || 'iPhone X<iPhone18,3>'),
    };
}

async function encodeGateMessage(serviceName, methodName, bodyBytes, clientSeq, serverSeq) {
    let finalBody = bodyBytes || Buffer.alloc(0);
    try {
        finalBody = await cryptoWasm.encryptBuffer(finalBody);
    } catch {
        // 与主网络层保持一致：加密失败时继续尝试发送原始包
    }

    const msg = types.GateMessage.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1,
            client_seq: toLong(clientSeq),
            server_seq: toLong(serverSeq),
        },
        body: finalBody,
    });
    return types.GateMessage.encode(msg).finish();
}

async function fetchProfileByCode(code, options = {}) {
    await loadProto();

    const loginCode = String(code || '').trim();
    if (!loginCode) {
        throw new Error('Missing code');
    }

    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000);
    const platform = String(options.platform || CONFIG.platform || 'qq');
    const os = String(options.os || CONFIG.os || 'iOS');
    const clientVersion = String(options.clientVersion || CONFIG.clientVersion || '');
    const url = `${CONFIG.serverUrl}?platform=${encodeURIComponent(platform)}&os=${encodeURIComponent(os)}&ver=${encodeURIComponent(clientVersion)}&code=${encodeURIComponent(loginCode)}&openID=`;

    return new Promise((resolve, reject) => {
        let settled = false;
        let serverSeq = 0;
        let timer = null;
        let ws = null;

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (ws) {
                ws.removeAllListeners();
                try {
                    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                        ws.close();
                    }
                } catch {
                    // ignore close errors
                }
            }
            ws = null;
        };

        const finish = (err, data) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (err) reject(err);
            else resolve(data);
        };

        timer = setTimeout(() => {
            finish(new Error('获取账号资料超时'));
        }, timeoutMs);

        ws = new WebSocket(url);

        ws.on('open', async () => {
            try {
                const loginBody = types.LoginRequest.encode(types.LoginRequest.create({
                    sharer_id: toLong(0),
                    sharer_open_id: '',
                    device_info: buildDeviceInfo(),
                    share_cfg_id: toLong(0),
                    scene_id: '1256',
                    report_data: {
                        callback: '', cd_extend_info: '', click_id: '', clue_token: '',
                        minigame_channel: 'other', minigame_platid: 2, req_id: '', trackid: '',
                    },
                })).finish();
                const packet = await encodeGateMessage('gamepb.userpb.UserService', 'Login', loginBody, 1, serverSeq);
                ws.send(packet);
            } catch (error) {
                finish(error);
            }
        });

        ws.on('message', (data) => {
            try {
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                const msg = types.GateMessage.decode(buf);
                const meta = msg.meta || {};

                if (meta.server_seq) {
                    const nextServerSeq = toNum(meta.server_seq);
                    if (nextServerSeq > serverSeq) serverSeq = nextServerSeq;
                }

                if (toNum(meta.error_code) !== 0) {
                    finish(new Error(`${meta.service_name || 'unknown'}.${meta.method_name || 'unknown'} 错误: code=${toNum(meta.error_code)} ${meta.error_message || ''}`));
                    return;
                }

                if ((meta.message_type || 0) !== 2) return;
                if (meta.service_name !== 'gamepb.userpb.UserService' || meta.method_name !== 'Login') return;

                const reply = types.LoginReply.decode(msg.body);
                const basic = reply.basic || null;
                if (!basic) {
                    finish(new Error('登录成功但未返回基础资料'));
                    return;
                }

                finish(null, {
                    gid: toNum(basic.gid),
                    name: String(basic.name || '').trim(),
                    level: toNum(basic.level),
                    exp: toNum(basic.exp),
                    gold: toNum(basic.gold),
                    openId: String(basic.open_id || '').trim(),
                    avatar: String(basic.avatar_url || '').trim(),
                    remark: String(basic.remark || '').trim(),
                    signature: String(basic.signature || '').trim(),
                    gender: Number(basic.gender) || 0,
                });
            } catch (error) {
                finish(error);
            }
        });

        ws.on('error', (error) => {
            finish(error);
        });

        ws.on('close', (closeCode) => {
            if (!settled) {
                finish(new Error(`连接关闭(code=${closeCode})`));
            }
        });
    });
}

module.exports = {
    fetchProfileByCode,
};
