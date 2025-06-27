// src/main/main.ts

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { loadEnv, printEnvInfo } from '../config/env';
import { OAuthManager } from '../oauth/OAuthManager';
import { GitHubAPI } from '../api/GitHubAPI';
import { UserSessionManager } from '../oauth/UserSessionManager';
import { getGitHubOAuthConfig, validateGitHubConfig, getGitHubSetupInstructions } from '../config/github';

class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private oauthManager: OAuthManager | null = null;
  private githubAPI: GitHubAPI | null = null;
  private sessionManager: UserSessionManager | null = null;

  constructor() {
    // 首先加载环境变量
    this.loadEnvironment();
    
    this.setupAppEvents();
    this.setupIpcHandlers();
    this.initializeOAuth();
  }

  private loadEnvironment(): void {
    console.log('🔧 加载环境配置...');
    loadEnv();
    printEnvInfo();
  }

  private setupAppEvents(): void {
    // 当 Electron 完成初始化时
    app.whenReady().then(() => {
      this.createMainWindow();
    });

    // 当所有窗口都关闭时
    app.on('window-all-closed', () => {
      // 在 macOS 上，保持应用运行即使窗口关闭
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // macOS 上点击 dock 图标时重新创建窗口
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });

    // 应用即将退出时的清理
    app.on('before-quit', () => {
      console.log('🧹 应用即将退出，清理资源...');
      this.cleanup();
    });

    // Windows/Linux 上应用退出时的清理
    app.on('will-quit', () => {
      console.log('🧹 应用退出，最终清理...');
      this.cleanup();
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
      
      // 尝试加载已保存的用户会话
      this.loadSavedSession();
      
    } catch (error) {
      console.error('❌ OAuth 管理器初始化失败:', (error as Error).message);
      console.log('\n' + getGitHubSetupInstructions());
      
      // 创建一个 null 的管理器，这样应用仍然可以启动
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
        },
        onSessionError: (error) => {
          console.warn('⚠️ 会话错误:', error.message);
        },
        onAutoLogout: () => {
          console.log('🚪 自动退出登录');
          this.notifyRendererSessionChange(false);
        }
      });
      
      const session = await this.sessionManager.loadSession();
      if (session) {
        console.log('🎉 已加载用户会话，启动时跳过立即验证');
        console.log('👤 用户:', session.user.login, session.user.name);
        
        // 不在启动时立即验证，而是让自动维护机制处理
        // 这避免了网络暂时不可用时会话被错误清理
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
    // 处理获取版本信息
    ipcMain.handle('app:get-version', () => {
      return app.getVersion();
    });

    // 处理显示消息
    ipcMain.on('app:show-message', (event, message: string) => {
      console.log('收到来自渲染进程的消息:', message);
      
      // 可以在这里添加其他处理逻辑，比如显示通知
      if (this.mainWindow) {
        this.mainWindow.webContents.send('main:message-received', `主进程已收到: ${message}`);
      }
    });

    // OAuth 登录处理器 - 真实实现
    ipcMain.handle('oauth:login', async () => {
      console.log('🔐 GitHub OAuth 登录请求 - 开始处理');
      
      try {
        if (!this.oauthManager || !this.githubAPI || !this.sessionManager) {
          throw new Error('OAuth 管理器未初始化。请检查 .env 文件中的 GitHub OAuth 配置。');
        }

        console.log('📱 启动 OAuth 授权流程...');
        
        const result = await this.oauthManager.login();
        
        if (result.success && result.code) {
          console.log('🎉 GitHub OAuth 授权成功！');
          console.log('📋 授权码:', result.code);
          console.log('🔒 State:', result.state);
          
          // 使用授权码换取访问令牌
          console.log('🔄 正在换取访问令牌...');
          const tokenResponse = await this.githubAPI.exchangeCodeForToken(result.code);
          
          if (!tokenResponse.access_token) {
            throw new Error('未能获取访问令牌');
          }
          
          console.log('✅ 成功获取访问令牌');
          
          // 获取用户信息
          console.log('👤 正在获取用户信息...');
          const userProfile = await this.githubAPI.getCompleteUserProfile(tokenResponse.access_token);
          
          // 创建并保存用户会话
          const session = UserSessionManager.createSession(userProfile, tokenResponse);
          await this.sessionManager.saveSession(session);
          
          console.log('🎉 完整的用户登录流程成功！');
          console.log('👤 用户信息:', {
            id: userProfile.id,
            login: userProfile.login,
            name: userProfile.name,
            email: userProfile.email || userProfile.primaryEmail
          });
          
          return {
            success: true,
            user: {
              id: userProfile.id,
              login: userProfile.login,
              name: userProfile.name,
              email: userProfile.email || userProfile.primaryEmail,
              avatar_url: userProfile.avatar_url,
              public_repos: userProfile.public_repos,
              followers: userProfile.followers,
              following: userProfile.following
            },
            token: {
              access_token: tokenResponse.access_token,
              token_type: tokenResponse.token_type,
              scope: tokenResponse.scope
            }
          };
          
        } else {
          throw new Error('未能获取到授权码');
        }
        
      } catch (error) {
        console.error('❌ GitHub OAuth 登录失败:', (error as Error).message);
        return {
          success: false,
          error: (error as Error).message
        };
      }
    });

    // OAuth 退出登录处理器
    ipcMain.handle('oauth:logout', async () => {
      console.log('🚪 OAuth 退出登录请求');
      
      try {
        // 取消任何正在进行的授权流程
        if (this.oauthManager) {
          this.oauthManager.cancelAuth();
        }
        
        // 清理用户会话
        if (this.sessionManager) {
          await this.sessionManager.clearSession();
        }
        
        console.log('✅ 退出登录成功！');
        
        return { success: true };
        
      } catch (error) {
        console.error('❌ 退出登录失败:', error);
        return { 
          success: false,
          error: (error as Error).message
        };
      }
    });

    // OAuth 状态查询处理器
    ipcMain.handle('oauth:get-status', async () => {
      console.log('🔍 查询 OAuth 登录状态');
      
      try {
        if (!this.sessionManager) {
          return {
            isLoggedIn: false,
            error: 'Session manager not initialized'
          };
        }
        
        const currentSession = this.sessionManager.getCurrentSession();
        if (!currentSession) {
          return {
            isLoggedIn: false
          };
        }
        
        // 不在状态查询时进行验证，避免频繁的网络调用
        // 验证由自动维护机制处理
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

     // 刷新用户信息处理器
     ipcMain.handle('oauth:refresh-user', async () => {
       console.log('🔄 刷新用户信息请求');
       
       try {
         if (!this.sessionManager) {
           throw new Error('Session manager not initialized');
         }
         
         const updatedSession = await this.sessionManager.refreshUserInfo();
         
         if (updatedSession) {
           const user = updatedSession.user;
           console.log('✅ 用户信息刷新成功');
           
           return {
             success: true,
             user: {
               id: user.id,
               login: user.login,
               name: user.name,
               email: user.email || user.primaryEmail,
               avatar_url: user.avatar_url,
               public_repos: user.public_repos,
               followers: user.followers,
               following: user.following
             }
           };
         } else {
           throw new Error('No active session to refresh');
         }
         
       } catch (error) {
         console.error('❌ 刷新用户信息失败:', error);
         return {
           success: false,
           error: (error as Error).message
         };
       }
     });

     // 获取当前访问令牌处理器（用于 API 调用）
     ipcMain.handle('oauth:get-token', async () => {
       try {
         if (!this.sessionManager) {
           return null;
         }
         
         const token = this.sessionManager.getCurrentToken();
         if (token) {
           // 验证令牌是否仍然有效
           const isValid = await this.sessionManager.validateSession();
           if (isValid) {
             return token;
           }
         }
         
         return null;
         
       } catch (error) {
         console.error('❌ 获取访问令牌失败:', error);
         return null;
       }
     });

     // 手动刷新会话处理器
     ipcMain.handle('oauth:manual-refresh', async () => {
       console.log('🔄 手动刷新会话请求');
       
       try {
         if (!this.sessionManager) {
           throw new Error('Session manager not initialized');
         }
         
         const refreshedSession = await this.sessionManager.manualRefresh();
         
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
               public_repos: user.public_repos,
               followers: user.followers,
               following: user.following
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

     // 获取会话状态信息处理器
     ipcMain.handle('oauth:get-session-status', async () => {
       try {
         if (!this.sessionManager) {
           return {
             isLoggedIn: false,
             lastValidated: null,
             timeSinceLastValidation: null,
             isRefreshing: false,
             retryCount: 0
           };
         }
         
         return this.sessionManager.getSessionStatus();
         
       } catch (error) {
         console.error('❌ 获取会话状态失败:', error);
         return {
           isLoggedIn: false,
           lastValidated: null,
           timeSinceLastValidation: null,
           isRefreshing: false,
           retryCount: 0,
           error: (error as Error).message
         };
       }
     });
   }

  /**
   * 清理应用资源
   */
  private cleanup(): void {
    if (this.sessionManager) {
      console.log('🧹 销毁会话管理器...');
      this.sessionManager.destroy();
      this.sessionManager = null;
    }
    
    if (this.oauthManager) {
      this.oauthManager = null;
    }
    
    if (this.githubAPI) {
      this.githubAPI = null;
    }
  }

private createMainWindow(): void {
    // 创建浏览器窗口
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webSecurity: true,
        devTools: process.env.ENABLE_DEV_TOOLS === 'true', // 只有明确启用才允许 DevTools
        preload: path.join(__dirname, '../preload/preload.js')
      },
      show: false,
      title: 'Electron OAuth App'
    });

    // 设置安全策略
    this.setupSecurityPolicies();

    // 窗口准备好后再显示
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
      
      // 只在明确启用时才打开开发者工具
      if (process.env.ENABLE_DEV_TOOLS === 'true' && process.env.OPEN_DEV_TOOLS === 'true') {
        this.mainWindow?.webContents.openDevTools();
      }
    });

    // 只在开发模式下设置快捷键
    if (process.env.ENABLE_DEV_TOOLS === 'true') {
      this.setupKeyboardShortcuts();
    }

    // 加载应用的 HTML 文件
    this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // 当窗口关闭时
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      
      // 窗口关闭时不销毁会话管理器，保持会话持久性
      // 只有应用完全退出时才销毁会话管理器
      console.log('🚪 主窗口已关闭，会话管理器保持运行');
    });
  }

  private setupSecurityPolicies(): void {
    if (!this.mainWindow) return;

    const webContents = this.mainWindow.webContents;

    // 阻止新窗口创建
    webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });

    // 阻止导航到外部URL
    webContents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);
      
      // 只允许导航到本地文件
      if (parsedUrl.protocol !== 'file:') {
        event.preventDefault();
        console.warn('阻止导航到外部URL:', navigationUrl);
      }
    });

    // 阻止加载外部资源（除了特定的信任域名）
    webContents.session.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const url = new URL(details.url);
        const trustedDomains = [
          'github.com',
          'api.github.com',
          'avatars.githubusercontent.com'
        ];
        
        const isTrusted = trustedDomains.some(domain => 
          url.hostname === domain || url.hostname.endsWith(`.${domain}`)
        );
        
        if (isTrusted) {
          callback({ cancel: false });
        } else {
          console.warn('阻止加载外部资源:', details.url);
          callback({ cancel: true });
        }
      }
    );
  }

  private setupKeyboardShortcuts(): void {
    if (!this.mainWindow) return;

    // 设置快捷键 Ctrl+Shift+I (Windows/Linux) 或 Cmd+Option+I (macOS) 打开开发者工具
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      const isDev = process.env.NODE_ENV === 'development';
      if (!isDev) return;

      // Windows/Linux: Ctrl+Shift+I
      // macOS: Cmd+Option+I
      const isDevToolsShortcut = 
        (process.platform === 'darwin' && input.meta && input.alt && input.key === 'i') ||
        (process.platform !== 'darwin' && input.control && input.shift && input.key === 'I');

      if (isDevToolsShortcut) {
        this.mainWindow?.webContents.toggleDevTools();
      }
    });
  }

}

// 创建应用实例
new ElectronApp();