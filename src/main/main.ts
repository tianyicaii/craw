// src/main/main.ts

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { loadEnv } from '../config/env';
import { OAuthManager } from '../oauth/OAuthManager';
import { GitHubAPI } from '../api/GitHubAPI';
import { UserSessionManager } from '../oauth/UserSessionManager';
import { getGitHubOAuthConfig, validateGitHubConfig } from '../config/github';

class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private oauthManager: OAuthManager | null = null;
  private githubAPI: GitHubAPI | null = null;
  private sessionManager: UserSessionManager | null = null;

  constructor() {
    this.loadEnvironment();
    this.setupAppEvents();
    this.setupIpcHandlers();
    this.initializeOAuth();
  }

  private loadEnvironment(): void {
    console.log('🔧 加载环境配置...');
    loadEnv();
  }

  private setupAppEvents(): void {
    app.whenReady().then(() => {
      this.createMainWindow();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });

    app.on('before-quit', () => {
      console.log('🧹 应用即将退出，清理资源...');
      if (this.sessionManager) {
        this.sessionManager.destroy();
      }
    });
  }

  private initializeOAuth(): void {
    try {
      console.log('🔐 初始化 OAuth 管理器...');
      
      const config = getGitHubOAuthConfig();
      validateGitHubConfig(config);
      
      this.oauthManager = new OAuthManager(config);
      this.githubAPI = new GitHubAPI(config.clientId, config.clientSecret);
      this.sessionManager = new UserSessionManager(this.githubAPI);
      
      console.log('✅ OAuth 管理器初始化成功');
      this.loadSavedSession();
      
    } catch (error) {
      console.error('❌ OAuth 管理器初始化失败:', (error as Error).message);
      this.oauthManager = null;
      this.githubAPI = null;
      this.sessionManager = null;
    }
  }

  private async loadSavedSession(): Promise<void> {
    if (!this.sessionManager) return;
    
    try {
      // 设置会话事件回调
      this.sessionManager.setEventCallbacks({
        onSessionExpired: () => {
          console.log('⚠️ 会话已过期');
          this.notifyRendererSessionChange(false);
        },
        onSessionRefreshed: (session) => {
          console.log('✅ 会话已自动刷新');
          this.notifyRendererSessionChange(true, session.user);
        }
      });
      
      const session = await this.sessionManager.loadSession();
      if (session) {
        console.log('🎉 已加载用户会话，自动维护已启动');
        console.log('👤 用户:', session.user.login, session.user.name);
      } else {
        console.log('📭 未找到已保存的用户会话');
      }
    } catch (error) {
      console.error('❌ 加载用户会话失败:', error);
    }
  }

  /**
   * 通知渲染进程会话状态变化
   */
  private notifyRendererSessionChange(isLoggedIn: boolean, user?: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('session:status-changed', {
        isLoggedIn,
        user: user || null
      });
    }
  }

  private setupIpcHandlers(): void {
    // OAuth 登录
    ipcMain.handle('oauth:login', async () => {
      console.log('🔐 GitHub OAuth 登录请求');
      
      try {
        if (!this.oauthManager || !this.githubAPI || !this.sessionManager) {
          throw new Error('OAuth 管理器未初始化');
        }

        const result = await this.oauthManager.login();
        
        if (result.success && result.code) {
          const tokenResponse = await this.githubAPI.exchangeCodeForToken(result.code);
          
          if (!tokenResponse.access_token) {
            throw new Error('未能获取访问令牌');
          }
          
          const userProfile = await this.githubAPI.getCompleteUserProfile(tokenResponse.access_token);
          const session = UserSessionManager.createSession(userProfile, tokenResponse);
          await this.sessionManager.saveSession(session);
          
          console.log('🎉 登录成功！自动维护已启动');
          
          return {
            success: true,
            user: {
              id: userProfile.id,
              login: userProfile.login,
              name: userProfile.name,
              email: userProfile.email || userProfile.primaryEmail,
              avatar_url: userProfile.avatar_url,
              public_repos: userProfile.public_repos
            }
          };
          
        } else {
          throw new Error('未能获取到授权码');
        }
        
      } catch (error) {
        console.error('❌ 登录失败:', (error as Error).message);
        return {
          success: false,
          error: (error as Error).message
        };
      }
    });

    // OAuth 退出登录
    ipcMain.handle('oauth:logout', async () => {
      console.log('🚪 退出登录请求');
      
      try {
        if (this.oauthManager) {
          this.oauthManager.cancelAuth();
        }
        
        if (this.sessionManager) {
          await this.sessionManager.clearSession();
        }
        
        console.log('✅ 退出登录成功');
        return { success: true };
        
      } catch (error) {
        console.error('❌ 退出登录失败:', error);
        return { 
          success: false,
          error: (error as Error).message
        };
      }
    });

    // 获取登录状态
    ipcMain.handle('oauth:get-status', async () => {
      console.log('🔍 查询登录状态');
      
      try {
        if (!this.sessionManager) {
          return { isLoggedIn: false };
        }
        
        const currentSession = this.sessionManager.getCurrentSession();
        if (!currentSession) {
          return { isLoggedIn: false };
        }
        
        const user = this.sessionManager.getCurrentUser();
        return {
          isLoggedIn: true,
          user: {
            id: user?.id,
            login: user?.login,
            name: user?.name,
            email: user?.email || user?.primaryEmail,
            avatar_url: user?.avatar_url,
            public_repos: user?.public_repos
          }
        };
        
      } catch (error) {
        console.error('❌ 查询登录状态失败:', error);
        return {
          isLoggedIn: false,
          error: (error as Error).message
        };
      }
    });

    // 手动刷新用户信息
    ipcMain.handle('oauth:manual-refresh', async () => {
      console.log('🔄 手动刷新请求');
      
      try {
        if (!this.sessionManager) {
          throw new Error('Session manager not initialized');
        }
        
        const refreshedSession = await this.sessionManager.refreshUserInfo();
        
        if (refreshedSession) {
          const user = refreshedSession.user;
          console.log('✅ 手动刷新成功');
          
          return {
            success: true,
            user: {
              id: user.id,
              login: user.login,
              name: user.name,
              email: user.email || user.primaryEmail,
              avatar_url: user.avatar_url,
              public_repos: user.public_repos
            }
          };
        } else {
          throw new Error('No active session to refresh');
        }
        
      } catch (error) {
        console.error('❌ 手动刷新失败:', error);
        return {
          success: false,
          error: (error as Error).message
        };
      }
    });
  }

  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        preload: path.join(__dirname, '../preload/preload.js')
      },
      show: false,
      title: 'OAuth App with Auto Refresh'
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      console.log('🚪 主窗口已关闭，会话自动维护继续运行');
    });
  }
}

// 创建应用实例
new ElectronApp();