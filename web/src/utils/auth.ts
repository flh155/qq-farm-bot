
export interface TokenData {
  token: string
  expiresAt: number
  createdAt: number
}

export interface AuthValidateResponse {
  ok: boolean
  data: {
    valid: boolean
    passwordDisabled?: boolean
    needsInit?: boolean
    needsRefresh?: boolean
    expiresAt?: number
    reason?: string
  }
  error?: string
}

export interface TokenRefreshResponse {
  ok: boolean
  data: {
    token: string
    expiresAt: number
    createdAt?: number
    message: string
  }
  error?: string
}