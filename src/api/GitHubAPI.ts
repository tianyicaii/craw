// src/api/GitHubAPI.ts

import fetch from 'node-fetch';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

export class GitHubAPI {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * 使用授权码换取访问令牌
   */
  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    try {
      console.log('🔄 正在用授权码换取访问令牌...');

      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Electron-OAuth-App'
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as TokenResponse;

      console.log('📋 令牌响应:', {
        access_token: data.access_token ? '***已获取***' : '未获取',
        token_type: data.token_type,
        scope: data.scope,
        error: data.error
      });

      if (data.error) {
        throw new Error(`GitHub 令牌错误: ${data.error} - ${data.error_description || ''}`);
      }

      if (!data.access_token) {
        throw new Error('未收到访问令牌');
      }

      console.log('✅ 成功获取访问令牌');
      return data;

    } catch (error) {
      console.error('❌ 换取访问令牌失败:', error);
      throw new Error(`换取访问令牌失败: ${(error as Error).message}`);
    }
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<GitHubUser> {
    try {
      console.log('👤 正在获取用户信息...');

      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Electron-OAuth-App'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const userData = await response.json() as GitHubUser;

      console.log('📋 用户信息:', {
        id: userData.id,
        login: userData.login,
        name: userData.name,
        email: userData.email,
        public_repos: userData.public_repos
      });

      console.log('✅ 成功获取用户信息');
      return userData;

    } catch (error) {
      console.error('❌ 获取用户信息失败:', error);
      throw new Error(`获取用户信息失败: ${(error as Error).message}`);
    }
  }

  /**
   * 获取用户邮箱列表
   */
  async getUserEmails(accessToken: string): Promise<GitHubEmail[]> {
    try {
      console.log('📧 正在获取用户邮箱...');

      const response = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Electron-OAuth-App'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const emails = await response.json() as GitHubEmail[];

      console.log('📧 邮箱信息:', emails.map(email => ({
        email: email.email,
        primary: email.primary,
        verified: email.verified
      })));

      console.log('✅ 成功获取邮箱信息');
      return emails;

    } catch (error) {
      console.error('❌ 获取邮箱信息失败:', error);
      throw new Error(`获取邮箱信息失败: ${(error as Error).message}`);
    }
  }

  /**
   * 获取主要邮箱
   */
  async getPrimaryEmail(accessToken: string): Promise<string | null> {
    try {
      const emails = await this.getUserEmails(accessToken);
      const primaryEmail = emails.find(email => email.primary && email.verified);
      return primaryEmail ? primaryEmail.email : null;
    } catch (error) {
      console.warn('获取主要邮箱失败，使用用户信息中的邮箱');
      return null;
    }
  }

  /**
   * 获取完整的用户档案（包含邮箱）
   */
  async getCompleteUserProfile(accessToken: string): Promise<GitHubUser & { primaryEmail?: string }> {
    const userInfo = await this.getUserInfo(accessToken);
    
    // 如果用户信息中没有邮箱，尝试从邮箱 API 获取
    if (!userInfo.email) {
      const primaryEmail = await this.getPrimaryEmail(accessToken);
      return {
        ...userInfo,
        primaryEmail: primaryEmail || undefined
      };
    }
    
    return userInfo;
  }
}
