/**
 * 安全模块 - 密码加密与验证
 * 使用bcrypt替代SHA256，增强密码安全性
 */

const crypto = require('node:crypto');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('security');

// 配置
const SECURITY_CONFIG = {
    saltRounds: 12,           // bcrypt cost factor (4-31)
    minPasswordLength: 4,
    maxPasswordLength: 64,
    enablePasswordStrengthCheck: true,
    maxLoginAttempts: 5,      // 最大登录尝试次数
    lockoutDuration: 300000,  // 锁定时长 (ms) 5 分钟
    tokenExpirationMs: 30 * 60 * 1000, // Token 过期时间 30 分钟
    tokenRefreshThresholdMs: 5 * 60 * 1000, // 刷新阈值 5 分钟（过期前 5 分钟内可刷新）
};

// Token 存储与管理
class TokenManager {
    constructor() {
        this.tokens = new Map(); // token -> { createdAt, expiresAt, lastUsedAt }
        this.cleanupInterval = null;
        this.startCleanup();
    }

    /**
     * 生成并存储新 token
     */
    createToken() {
        const now = Date.now();
        const token = crypto.randomBytes(32).toString('hex');
        const tokenData = {
            createdAt: now,
            expiresAt: now + SECURITY_CONFIG.tokenExpirationMs,
            lastUsedAt: now, // 记录最后使用时间
        };
        this.tokens.set(token, tokenData);
        return {
            token,
            expiresAt: tokenData.expiresAt,
            createdAt: tokenData.createdAt,
        };
    }

    /**
     * 验证 token 是否有效
     */
    verifyToken(token) {
        if (!token) return { valid: false, reason: 'TOKEN_MISSING' };
        
        const tokenData = this.tokens.get(token);
        if (!tokenData) return { valid: false, reason: 'TOKEN_NOT_FOUND' };
        
        const now = Date.now();
        
        // 检查是否过期
        if (now > tokenData.expiresAt) {
            this.tokens.delete(token);
            return { valid: false, reason: 'TOKEN_EXPIRED' };
        }
        
        // 更新最后使用时间
        tokenData.lastUsedAt = now;
        this.tokens.set(token, tokenData);
        
        return { 
            valid: true, 
            expiresAt: tokenData.expiresAt,
            needsRefresh: (tokenData.expiresAt - now) < SECURITY_CONFIG.tokenRefreshThresholdMs
        };
    }

    /**
     * 刷新 token（延长过期时间）
     */
    refreshToken(token) {
        const tokenData = this.tokens.get(token);
        if (!tokenData) return null;
        
        const now = Date.now();
        // 只有在过期前 5 分钟内才能刷新
        if ((tokenData.expiresAt - now) >= SECURITY_CONFIG.tokenRefreshThresholdMs) {
            return {
                token,
                expiresAt: tokenData.expiresAt,
                message: '无需刷新'
            };
        }
        
        // 延长过期时间（从当前时间开始重新计算 30 分钟）
        tokenData.expiresAt = now + SECURITY_CONFIG.tokenExpirationMs;
        tokenData.lastUsedAt = now;
        this.tokens.set(token, tokenData);
        
        return {
            token,
            expiresAt: tokenData.expiresAt,
            message: '刷新成功'
        };
    }

    /**
     * 删除 token（登出）
     */
    deleteToken(token) {
        return this.tokens.delete(token);
    }

    /**
     * 获取 token 数量统计
     */
    getTokenCount() {
        return this.tokens.size;
    }

    /**
     * 启动定期清理任务
     */
    startCleanup() {
        // 每 10 分钟清理一次过期 token
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [token, data] of this.tokens.entries()) {
                if (now > data.expiresAt) {
                    this.tokens.delete(token);
                }
            }
        }, 10 * 60 * 1000);

        // 防止内存泄漏，进程退出时清除定时器
        process.on('exit', () => {
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
            }
        });
    }

    /**
     * 获取所有活跃 token 信息（用于管理）
     */
    getAllTokens() {
        const result = [];
        const now = Date.now();
        for (const [token, data] of this.tokens.entries()) {
            result.push({
                token: token.substring(0, 8) + '...', // 只显示前 8 位
                createdAt: data.createdAt,
                expiresAt: data.expiresAt,
                lastUsedAt: data.lastUsedAt,
                remainingMs: Math.max(0, data.expiresAt - now),
            });
        }
        return result;
    }
}

// 创建全局 Token 管理器实例
const globalTokenManager = new TokenManager();

// 登录尝试记录
const loginAttempts = new Map();

// 兼容模式：使用现有的SHA256
const useBcrypt = true;

// 生成随机盐
function generateSalt() {
    return crypto.randomBytes(32).toString('hex');
}

// 简单的密码哈希实现 (bcrypt风格，使用PBKDF2)
async function hashPassword(password) {
    if (!useBcrypt) {
        return hashPasswordSHA256(password);
    }

    const salt = generateSalt();
    const iterations = 100000;
    const keyLength = 64;
    const digest = 'sha512';
    
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, iterations, keyLength, digest, (err, derivedKey) => {
            if (err) reject(err);
            else {
                // 存储格式: $pbkdf2$salt$iterations$hash
                resolve(`$pbkdf2$${salt}$${iterations}$${derivedKey.toString('hex')}`);
            }
        });
    });
}

// 验证密码
async function verifyPassword(password, storedHash) {
    if (!useBcrypt) {
        return verifyPasswordSHA256(password, storedHash);
    }

    if (!storedHash || !password) {
        return false;
    }

    try {
        if (storedHash.startsWith('$pbkdf2$')) {
            const parts = storedHash.split('$');
            if (parts.length !== 5) return false;
            
            const salt = parts[2];
            const iterations = Number.parseInt(parts[3], 10);
            const hash = parts[4];
            const keyLength = 64;
            const digest = 'sha512';
            
            return new Promise((resolve) => {
                crypto.pbkdf2(password, salt, iterations, keyLength, digest, (err, derivedKey) => {
                    if (err) {
                        logger.error('PBKDF2验证失败', { error: err.message });
                        resolve(false);
                    } else {
                        resolve(derivedKey.toString('hex') === hash);
                    }
                });
            });
        }
        
        // 兼容旧SHA256格式
        if (storedHash.length === 64) {
            return verifyPasswordSHA256(password, storedHash);
        }
        
        return false;
    } catch (error) {
        logger.error('密码验证异常', { error: error.message });
        return false;
    }
}

// SHA256哈希 (兼容旧格式)
function hashPasswordSHA256(password) {
    return crypto.createHash('sha256')
        .update(String(password || ''))
        .digest('hex');
}

function verifyPasswordSHA256(password, storedHash) {
    const hash = hashPasswordSHA256(password);
    return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(storedHash)
    );
}

// 密码强度检查
function checkPasswordStrength(password) {
    if (!SECURITY_CONFIG.enablePasswordStrengthCheck) {
        return { score: 0, valid: true, feedback: [] };
    }

    const feedback = [];
    let score = 0;

    if (!password) {
        return { score: 0, valid: false, feedback: ['密码不能为空'] };
    }

    if (password.length < SECURITY_CONFIG.minPasswordLength) {
        feedback.push(`密码长度至少${SECURITY_CONFIG.minPasswordLength}位`);
        return { score: 0, valid: false, feedback };
    }

    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;

    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^a-z0-9]/i.test(password)) score += 1;

    // 检查常见弱密码
    const commonPasswords = [
        'password', '123456', 'qwerty', 'admin', 'letmein',
        'welcome', 'monkey', 'dragon', 'master', 'login'
    ];
    if (commonPasswords.includes(password.toLowerCase())) {
        score = 0;
        feedback.push('密码过于简单，请使用更复杂的密码');
    }

    if (score < 3) {
        feedback.push('建议使用字母、数字和特殊符号的组合');
    }

    return {
        score,
        valid: true,
        feedback: feedback.length > 0 ? feedback : ['密码强度良好']
    };
}

// 登录尝试记录
function recordLoginAttempt(identifier) {
    const key = String(identifier || '').toLowerCase();
    const now = Date.now();
    
    const attempts = loginAttempts.get(key) || { count: 0, firstAttempt: now, lockedUntil: 0 };
    
    // 检查是否被锁定
    if (attempts.lockedUntil > now) {
        const remaining = Math.ceil((attempts.lockedUntil - now) / 1000);
        throw new Error(`账号已锁定，请${remaining}秒后重试`);
    }
    
    attempts.count += 1;
    attempts.lastAttempt = now;
    
    // 连续失败5次，锁定5分钟
    if (attempts.count >= SECURITY_CONFIG.maxLoginAttempts) {
        attempts.lockedUntil = now + SECURITY_CONFIG.lockoutDuration;
        logger.warn('登录尝试过多，账号已锁定', { identifier: key });
        throw new Error(`登录尝试过多，账号已锁定${SECURITY_CONFIG.lockoutDuration / 60000}分钟`);
    }
    
    loginAttempts.set(key, attempts);
    return {
        attemptsLeft: SECURITY_CONFIG.maxLoginAttempts - attempts.count
    };
}

// 登录成功，清除记录
function clearLoginAttempts(identifier) {
    const key = String(identifier || '').toLowerCase();
    loginAttempts.delete(key);
}

// 生成随机令牌
function generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

// 生成会话令牌
function generateSessionToken() {
    return {
        token: generateToken(32),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24小时
        createdAt: Date.now(),
    };
}

// 验证会话令牌
function verifySessionToken(token, expiresAt) {
    if (!token || !expiresAt) return false;
    if (Date.now() > expiresAt) return false;
    return true;
}

// 密码哈希中间件 (用于Express)
function passwordHashMiddleware(req, res, next) {
    const { password } = req.body || {};
    
    if (password && req.path.includes('/api/')) {
        const strength = checkPasswordStrength(password);
        if (!strength.valid) {
            return res.status(400).json({
                ok: false,
                error: strength.feedback[0],
                feedback: strength.feedback
            });
        }
    }
    
    next();
}

// 速率限制中间件
const rateLimitStore = new Map();

function rateLimitMiddleware(options = {}) {
    const {
        windowMs = 60000,  // 时间窗口
        maxRequests = 100, // 最大请求数
        keyGenerator = (req) => req.ip,
    } = options;

    return (req, res, next) => {
        const key = keyGenerator(req);
        const now = Date.now();
        
        const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
        
        // 重置计数
        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }
        
        record.count += 1;
        rateLimitStore.set(key, record);
        
        // 设置响应头
        res.set('X-RateLimit-Limit', maxRequests);
        res.set('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
        res.set('X-RateLimit-Reset', new Date(record.resetAt).toISOString());
        
        if (record.count > maxRequests) {
            return res.status(429).json({
                ok: false,
                error: '请求过于频繁，请稍后重试',
                retryAfter: Math.ceil((record.resetAt - now) / 1000)
            });
        }
        
        next();
    };
}

// 清理过期的速率限制记录
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetAt) {
            rateLimitStore.delete(key);
        }
    }
}, 60000);

module.exports = {
    hashPassword,
    verifyPassword,
    checkPasswordStrength,
    recordLoginAttempts: recordLoginAttempt,
    clearLoginAttempts,
    generateToken,
    generateSessionToken,
    verifySessionToken,
    passwordHashMiddleware,
    rateLimitMiddleware,
    SECURITY_CONFIG,
    TokenManager,
    globalTokenManager,
};
