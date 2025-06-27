import * as keytar from 'keytar';
import { GitHubAPI, GitHubUser } from '../api/GitHubAPI';

const SERVICE_NAME = 'ElectronOAuthApp';
const TOKEN_KEY = 'github_access_token';
const USER_KEY = 'github_user_data';

// 自动刷新配置
const AUTO_REFRESH_INTERVAL = 30 * 60 * 1000; // 30分钟检查一次
const TOKEN_VALIDATION_INTERVAL = 60 * 60 * 1000; // 1小时验证一次
const MAX_RETRY_ATTEMPTS = 3; // 最大重试次数

export interface UserSession {
  user: GitHubUser & { primaryEmail?: string };
  token: {
    access_token: string;
    token_type: string;
    scope: string;
  };
  createdAt: number; // timestamp
  lastValidatedAt: number; // 最后验证时间
  expiresAt?: number; // GitHub tokens don't expire, but we can add this for future use
}

export interface SessionEvents {
  onSessionExpired?: () => void;
  onSessionRefreshed?: (session: UserSession) => void;
  onSessionError?: (error: Error) => void;
  onAutoLogout?: () => void;
}

export class UserSessionManager {
  private githubAPI: GitHubAPI;
  private currentSession: UserSession | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private validationTimer: NodeJS.Timeout | null = null;
  private eventCallbacks: SessionEvents = {};
  private isRefreshing = false;
  private retryCount = 0;

  constructor(githubAPI: GitHubAPI) {
    this.githubAPI = githubAPI;
  }

  /**
   * 设置会话事件回调
   */
  setEventCallbacks(callbacks: SessionEvents): void {
    this.eventCallbacks = { ...this.eventCallbacks, ...callbacks };
  }

  /**
   * 保存用户会话到安全存储
   */
  async saveSession(session: UserSession): Promise<void> {
    try {
      console.log('💾 保存用户会话到安全存储...');
      
      // 使用 keytar 安全存储访问令牌
      await keytar.setPassword(SERVICE_NAME, TOKEN_KEY, session.token.access_token);
      
      // 存储用户数据和其他会话信息
      const sessionData = {
        user: session.user,
        token: {
          token_type: session.token.token_type,
          scope: session.token.scope
        },
        createdAt: session.createdAt,
        lastValidatedAt: session.lastValidatedAt,
        expiresAt: session.expiresAt
      };
      
      await keytar.setPassword(SERVICE_NAME, USER_KEY, JSON.stringify(sessionData));
      
      this.currentSession = session;
      console.log('✅ 用户会话保存成功');
      
      // 启动自动刷新和验证
      this.startAutoMaintenance();
      
    } catch (error) {
      console.error('❌ 保存用户会话失败:', error);
      throw new Error(`保存用户会话失败: ${(error as Error).message}`);
    }
  }

  /**
   * 从安全存储加载用户会话
   */
  async loadSession(): Promise<UserSession | null> {
    try {
      console.log('🔍 从安全存储加载用户会话...');
      
      // 获取访问令牌
      const accessToken = await keytar.getPassword(SERVICE_NAME, TOKEN_KEY);
      if (!accessToken) {
        console.log('📭 未找到存储的访问令牌');
        return null;
      }
      
      // 获取会话数据
      const sessionDataStr = await keytar.getPassword(SERVICE_NAME, USER_KEY);
      if (!sessionDataStr) {
        console.log('📭 未找到存储的会话数据');
        // 清理孤立的令牌
        await keytar.deletePassword(SERVICE_NAME, TOKEN_KEY);
        return null;
      }
      
      const sessionData = JSON.parse(sessionDataStr);
      
      // 重构完整的会话对象
      const session: UserSession = {
        user: sessionData.user,
        token: {
          access_token: accessToken,
          token_type: sessionData.token.token_type,
          scope: sessionData.token.scope
        },
        createdAt: sessionData.createdAt,
        lastValidatedAt: sessionData.lastValidatedAt || sessionData.createdAt,
        expiresAt: sessionData.expiresAt
      };
      
      this.currentSession = session;
      console.log('✅ 用户会话加载成功');
      console.log('👤 用户:', session.user.login, session.user.name);
      
      // 重置重试计数，因为会话已成功加载
      this.retryCount = 0;
      
      // 启动自动刷新和验证
      this.startAutoMaintenance();
      
      return session;
      
    } catch (error) {
      console.error('❌ 加载用户会话失败:', error);
      // 如果数据损坏，清理存储
      await this.clearSession();
      return null;
    }
  }

  /**
   * 验证当前会话是否有效（通过API调用测试令牌）
   */
  async validateSession(session?: UserSession): Promise<boolean> {
    try {
      const targetSession = session || this.currentSession;
      if (!targetSession) {
        return false;
      }
      
      console.log('🔐 验证用户会话有效性...');
      
      // 尝试使用令牌获取用户信息
      await this.githubAPI.getUserInfo(targetSession.token.access_token);
      
      // 更新最后验证时间
      targetSession.lastValidatedAt = Date.now();
      if (targetSession === this.currentSession) {
        await this.updateSessionData(targetSession);
      }
      
      console.log('✅ 用户会话验证通过');
      this.retryCount = 0; // 重置重试计数
      return true;
      
    } catch (error) {
      console.warn('⚠️ 用户会话验证失败，可能令牌已过期:', (error as Error).message);
      
      // 增加重试计数，不要立即清理会话
      this.retryCount++;
      
      if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
        console.error('❌ 达到最大重试次数，清理会话');
        
        // 调用会话过期回调
        if (this.eventCallbacks.onSessionExpired) {
          this.eventCallbacks.onSessionExpired();
        }
        
        // 如果多次验证失败，才清理无效的会话
        await this.clearSession();
      } else {
        console.warn(`⚠️ 验证失败，将在后续自动维护中重试 (${this.retryCount}/${MAX_RETRY_ATTEMPTS})`);
      }
      
      return false;
    }
  }

  /**
   * 启动自动维护（自动刷新和验证）
   */
  private startAutoMaintenance(): void {
    // 清理现有的定时器
    this.stopAutoMaintenance();
    
    console.log('🔄 启动自动会话维护...');
    
    // 设置定期验证定时器
    this.validationTimer = setInterval(async () => {
      await this.performPeriodicValidation();
    }, TOKEN_VALIDATION_INTERVAL);
    
    // 设置自动刷新定时器
    this.refreshTimer = setInterval(async () => {
      await this.performAutoRefresh();
    }, AUTO_REFRESH_INTERVAL);
    
    console.log('✅ 自动会话维护已启动');
  }

  /**
   * 停止自动维护
   */
  private stopAutoMaintenance(): void {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
    
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    console.log('🛑 自动会话维护已停止');
  }

  /**
   * 执行定期验证
   */
  private async performPeriodicValidation(): Promise<void> {
    if (!this.currentSession) {
      return;
    }
    
    try {
      console.log('🔍 执行定期会话验证...');
      
      const now = Date.now();
      const timeSinceLastValidation = now - this.currentSession.lastValidatedAt;
      
      // 如果距离上次验证时间超过阈值，则进行验证
      if (timeSinceLastValidation > TOKEN_VALIDATION_INTERVAL) {
        const isValid = await this.validateSession();
        if (!isValid && this.retryCount >= MAX_RETRY_ATTEMPTS) {
          console.log('❌ 定期验证失败且达到最大重试次数，会话已失效');
          if (this.eventCallbacks.onAutoLogout) {
            this.eventCallbacks.onAutoLogout();
          }
        }
      }
    } catch (error) {
      console.error('❌ 定期验证过程中出错:', error);
      this.handleSessionError(error as Error);
    }
  }

  /**
   * 执行自动刷新
   */
  private async performAutoRefresh(): Promise<void> {
    if (!this.currentSession || this.isRefreshing) {
      return;
    }
    
    try {
      this.isRefreshing = true;
      console.log('🔄 执行自动会话刷新...');
      
      // 刷新用户信息
      const refreshedSession = await this.refreshUserInfo();
      if (refreshedSession) {
        console.log('✅ 自动会话刷新成功');
        if (this.eventCallbacks.onSessionRefreshed) {
          this.eventCallbacks.onSessionRefreshed(refreshedSession);
        }
      }
      
    } catch (error) {
      console.error('❌ 自动刷新过程中出错:', error);
      this.handleSessionError(error as Error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * 处理会话错误
   */
  private async handleSessionError(error: Error): Promise<void> {
    this.retryCount++;
    
    if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
      console.error('❌ 达到最大重试次数，清理会话');
      await this.clearSession();
      
      if (this.eventCallbacks.onAutoLogout) {
        this.eventCallbacks.onAutoLogout();
      }
    } else {
      console.warn(`⚠️ 会话错误，将重试 (${this.retryCount}/${MAX_RETRY_ATTEMPTS})`);
      
      if (this.eventCallbacks.onSessionError) {
        this.eventCallbacks.onSessionError(error);
      }
    }
  }

  /**
   * 更新会话数据到存储
   */
  private async updateSessionData(session: UserSession): Promise<void> {
    try {
      const sessionData = {
        user: session.user,
        token: {
          token_type: session.token.token_type,
          scope: session.token.scope
        },
        createdAt: session.createdAt,
        lastValidatedAt: session.lastValidatedAt,
        expiresAt: session.expiresAt
      };
      
      await keytar.setPassword(SERVICE_NAME, USER_KEY, JSON.stringify(sessionData));
    } catch (error) {
      console.error('❌ 更新会话数据失败:', error);
    }
  }

  /**
   * 清理用户会话
   */
  async clearSession(): Promise<void> {
    try {
      console.log('🗑️ 清理用户会话...');
      
      // 停止自动维护
      this.stopAutoMaintenance();
      
      // 从安全存储中删除数据
      await keytar.deletePassword(SERVICE_NAME, TOKEN_KEY);
      await keytar.deletePassword(SERVICE_NAME, USER_KEY);
      
      this.currentSession = null;
      this.retryCount = 0;
      console.log('✅ 用户会话清理完成');
      
    } catch (error) {
      console.error('❌ 清理用户会话失败:', error);
      // 即使清理失败，也要重置内存中的会话
      this.currentSession = null;
      this.retryCount = 0;
    }
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): UserSession | null {
    return this.currentSession;
  }

  /**
   * 检查是否已登录
   */
  isLoggedIn(): boolean {
    return this.currentSession !== null;
  }

  /**
   * 获取当前用户信息
   */
  getCurrentUser(): (GitHubUser & { primaryEmail?: string }) | null {
    return this.currentSession?.user || null;
  }

  /**
   * 获取当前访问令牌
   */
  getCurrentToken(): string | null {
    return this.currentSession?.token.access_token || null;
  }

  /**
   * 刷新用户信息（使用当前令牌重新获取）
   */
  async refreshUserInfo(): Promise<UserSession | null> {
    if (!this.currentSession) {
      return null;
    }
    
    try {
      console.log('🔄 刷新用户信息...');
      
      const userProfile = await this.githubAPI.getCompleteUserProfile(
        this.currentSession.token.access_token
      );
      
      // 更新会话中的用户信息
      const updatedSession: UserSession = {
        ...this.currentSession,
        user: userProfile,
        lastValidatedAt: Date.now()
      };
      
      // 保存更新后的会话
      await this.saveSession(updatedSession);
      
      console.log('✅ 用户信息刷新成功');
      return updatedSession;
      
    } catch (error) {
      console.error('❌ 刷新用户信息失败:', error);
      throw new Error(`刷新用户信息失败: ${(error as Error).message}`);
    }
  }

  /**
   * 手动刷新会话
   */
  async manualRefresh(): Promise<UserSession | null> {
    if (this.isRefreshing) {
      console.log('⏳ 正在刷新中，请稍候...');
      return this.currentSession;
    }
    
    return await this.refreshUserInfo();
  }

  /**
   * 获取会话状态信息
   */
  getSessionStatus(): {
    isLoggedIn: boolean;
    lastValidated: number | null;
    timeSinceLastValidation: number | null;
    isRefreshing: boolean;
    retryCount: number;
  } {
    return {
      isLoggedIn: this.isLoggedIn(),
      lastValidated: this.currentSession?.lastValidatedAt || null,
      timeSinceLastValidation: this.currentSession 
        ? Date.now() - this.currentSession.lastValidatedAt 
        : null,
      isRefreshing: this.isRefreshing,
      retryCount: this.retryCount
    };
  }

  /**
   * 创建新的用户会话
   */
  static createSession(
    user: GitHubUser & { primaryEmail?: string },
    token: { access_token: string; token_type: string; scope: string }
  ): UserSession {
    const now = Date.now();
    return {
      user,
      token,
      createdAt: now,
      lastValidatedAt: now,
      // GitHub tokens don't expire by default, but we can add this for future use
      expiresAt: undefined
    };
  }

  /**
   * 销毁会话管理器
   */
  destroy(): void {
    console.log('🧹 销毁会话管理器...');
    this.stopAutoMaintenance();
    this.currentSession = null;
    this.eventCallbacks = {};
  }
} 