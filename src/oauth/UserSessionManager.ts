import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { GitHubAPI, GitHubUser } from '../api/GitHubAPI';

const TOKEN_KEY = 'github_access_token';
const USER_KEY = 'github_user_data';

// 简单的文件存储函数
function getStoragePath(): string {
  return path.join(app.getPath('userData'), 'session_data');
}

function ensureStorageDir(): void {
  const storageDir = getStoragePath();
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
}

async function setStorageItem(key: string, value: string): Promise<void> {
  ensureStorageDir();
  const filePath = path.join(getStoragePath(), `${key}.json`);
  fs.writeFileSync(filePath, value, 'utf8');
}

async function getStorageItem(key: string): Promise<string | null> {
  try {
    const filePath = path.join(getStoragePath(), `${key}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

async function deleteStorageItem(key: string): Promise<void> {
  try {
    const filePath = path.join(getStoragePath(), `${key}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // 忽略错误
  }
}

// 自动刷新配置 - 适度的间隔时间
const AUTO_REFRESH_INTERVAL = 30 * 60 * 1000; // 30分钟刷新一次用户信息
const TOKEN_VALIDATION_INTERVAL = 60 * 60 * 1000; // 1小时验证一次token

export interface UserSession {
  user: GitHubUser & { primaryEmail?: string };
  token: {
    access_token: string;
    token_type: string;
    scope: string;
  };
  createdAt: number;
  lastValidatedAt: number; // 最后验证时间
}

export interface SessionEvents {
  onSessionExpired?: () => void;
  onSessionRefreshed?: (session: UserSession) => void;
}

export class UserSessionManager {
  private githubAPI: GitHubAPI;
  private currentSession: UserSession | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private validationTimer: NodeJS.Timeout | null = null;
  private eventCallbacks: SessionEvents = {};

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
      console.log('💾 保存用户会话...');
      
      // 存储访问令牌
      await setStorageItem(TOKEN_KEY, session.token.access_token);
      
      // 存储用户数据
      const sessionData = {
        user: session.user,
        token: {
          token_type: session.token.token_type,
          scope: session.token.scope
        },
        createdAt: session.createdAt,
        lastValidatedAt: session.lastValidatedAt
      };
      
      await setStorageItem(USER_KEY, JSON.stringify(sessionData));
      
      this.currentSession = session;
      console.log('✅ 用户会话保存成功');
      
      // 启动自动维护
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
      console.log('🔍 加载用户会话...');
      
      const accessToken = await getStorageItem(TOKEN_KEY);
      if (!accessToken) {
        console.log('📭 未找到存储的访问令牌');
        return null;
      }
      
      const sessionDataStr = await getStorageItem(USER_KEY);
      if (!sessionDataStr) {
        console.log('📭 未找到存储的会话数据');
        await deleteStorageItem(TOKEN_KEY);
        return null;
      }
      
      const sessionData = JSON.parse(sessionDataStr);
      
      const session: UserSession = {
        user: sessionData.user,
        token: {
          access_token: accessToken,
          token_type: sessionData.token.token_type,
          scope: sessionData.token.scope
        },
        createdAt: sessionData.createdAt,
        lastValidatedAt: sessionData.lastValidatedAt || sessionData.createdAt
      };
      
      this.currentSession = session;
      console.log('✅ 用户会话加载成功');
      
      // 启动自动维护
      this.startAutoMaintenance();
      
      return session;
      
    } catch (error) {
      console.error('❌ 加载用户会话失败:', error);
      await this.clearSession();
      return null;
    }
  }

  /**
   * 验证会话有效性
   */
  async validateSession(): Promise<boolean> {
    if (!this.currentSession) {
      return false;
    }
    
    try {
      console.log('🔐 验证会话有效性...');
      await this.githubAPI.getUserInfo(this.currentSession.token.access_token);
      
      // 更新最后验证时间
      this.currentSession.lastValidatedAt = Date.now();
      await this.updateSessionData();
      
      console.log('✅ 会话验证通过');
      return true;
    } catch (error) {
      console.warn('⚠️ 会话验证失败:', (error as Error).message);
      return false;
    }
  }

  /**
   * 刷新用户信息
   */
  async refreshUserInfo(): Promise<UserSession | null> {
    if (!this.currentSession) {
      return null;
    }

    try {
      console.log('🔄 刷新用户信息...');
      const userProfile = await this.githubAPI.getCompleteUserProfile(this.currentSession.token.access_token);
      
      const updatedSession: UserSession = {
        ...this.currentSession,
        user: userProfile,
        lastValidatedAt: Date.now()
      };
      
      await this.saveSession(updatedSession);
      
      // 触发刷新回调
      if (this.eventCallbacks.onSessionRefreshed) {
        this.eventCallbacks.onSessionRefreshed(updatedSession);
      }
      
      return updatedSession;
      
    } catch (error) {
      console.error('❌ 刷新用户信息失败:', error);
      
      // 如果刷新失败，可能是token过期，清理会话
      await this.clearSession();
      
      if (this.eventCallbacks.onSessionExpired) {
        this.eventCallbacks.onSessionExpired();
      }
      
      return null;
    }
  }

  /**
   * 启动自动维护
   */
  private startAutoMaintenance(): void {
    this.stopAutoMaintenance();
    
    console.log('🔄 启动会话自动维护...');
    
    // 定期验证token
    this.validationTimer = setInterval(async () => {
      if (this.currentSession) {
        const now = Date.now();
        const timeSinceLastValidation = now - this.currentSession.lastValidatedAt;
        
        // 如果距离上次验证超过1小时，进行验证
        if (timeSinceLastValidation > TOKEN_VALIDATION_INTERVAL) {
          console.log('⏰ 执行定期token验证...');
          const isValid = await this.validateSession();
          if (!isValid) {
            console.log('❌ Token验证失败，清理会话');
            await this.clearSession();
            if (this.eventCallbacks.onSessionExpired) {
              this.eventCallbacks.onSessionExpired();
            }
          }
        }
      }
    }, TOKEN_VALIDATION_INTERVAL);
    
    // 定期刷新用户信息
    this.refreshTimer = setInterval(async () => {
      if (this.currentSession) {
        console.log('⏰ 执行自动用户信息刷新...');
        await this.refreshUserInfo();
      }
    }, AUTO_REFRESH_INTERVAL);
    
    console.log('✅ 会话自动维护已启动');
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
    
    console.log('🛑 会话自动维护已停止');
  }

  /**
   * 更新会话数据到存储
   */
  private async updateSessionData(): Promise<void> {
    if (!this.currentSession) return;
    
    try {
      const sessionData = {
        user: this.currentSession.user,
        token: {
          token_type: this.currentSession.token.token_type,
          scope: this.currentSession.token.scope
        },
        createdAt: this.currentSession.createdAt,
        lastValidatedAt: this.currentSession.lastValidatedAt
      };
      
      await setStorageItem(USER_KEY, JSON.stringify(sessionData));
    } catch (error) {
      console.error('❌ 更新会话数据失败:', error);
    }
  }

  /**
   * 清理会话
   */
  async clearSession(): Promise<void> {
    try {
      console.log('🧹 清理用户会话...');
      
      this.stopAutoMaintenance();
      
      await deleteStorageItem(TOKEN_KEY);
      await deleteStorageItem(USER_KEY);
      
      this.currentSession = null;
      console.log('✅ 用户会话清理完成');
      
    } catch (error) {
      console.error('❌ 清理用户会话失败:', error);
    }
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): UserSession | null {
    return this.currentSession;
  }

  /**
   * 获取当前用户
   */
  getCurrentUser(): (GitHubUser & { primaryEmail?: string }) | null {
    return this.currentSession?.user || null;
  }

  /**
   * 获取当前令牌
   */
  getCurrentToken(): string | null {
    return this.currentSession?.token.access_token || null;
  }

  /**
   * 检查是否已登录
   */
  isLoggedIn(): boolean {
    return this.currentSession !== null;
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    console.log('🧹 销毁会话管理器...');
    this.stopAutoMaintenance();
  }

  /**
   * 创建会话
   */
  static createSession(
    user: GitHubUser & { primaryEmail?: string },
    token: { access_token: string; token_type: string; scope: string }
  ): UserSession {
    return {
      user,
      token,
      createdAt: Date.now(),
      lastValidatedAt: Date.now()
    };
  }
} 