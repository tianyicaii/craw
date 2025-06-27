// src/types/oauth.ts

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri?: string;
  scopes?: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number;
}

export interface AuthResult {
  success: boolean;
  tokens?: AuthTokens;
  error?: string;
}

export interface UserInfo {
  id: string;
  name?: string;
  email?: string;
  avatar?: string;
}
