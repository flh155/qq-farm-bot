/**
 * 前端密码加密工具
 * 使用 SHA-256 对密码进行哈希处理，避免明文传输
 */

/**
 * 将字符串转换为 ArrayBuffer
 */
function str2ab(str: string): ArrayBuffer {
  const encoder = new TextEncoder()
  const uint8Array = encoder.encode(str)
  return uint8Array.buffer as ArrayBuffer
}

/**
 * 将 ArrayBuffer 转换为十六进制字符串
 */
function ab2hex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 对密码进行 SHA-256 哈希
 * @param password 原始密码
 * @returns 哈希后的十六进制字符串
 */
export async function hashPassword(password: string): Promise<string> {
  const data = str2ab(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return ab2hex(hashBuffer)
}

/**
 * 加密密码对象（用于登录和初始化）
 * @param password 原始密码
 * @returns 加密后的密码字符串
 */
export async function encryptPassword(password: string): Promise<string> {
  return await hashPassword(password)
}
