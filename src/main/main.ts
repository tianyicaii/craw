// src/main/main.ts

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { loadEnv, printEnvInfo } from '../config/env';
import { OAuthManager } from '../oauth/OAuthManager';
import { getGitHubOAuthConfig, validateGitHubConfig, getGitHubSetupInstructions } from '../config/github';

class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private oauthManager: OAuthManager | null = null;

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
  }

  private initializeOAuth(): void {
    try {
      console.log('🔐 初始化 OAuth 管理器...');
      
      const config = getGitHubOAuthConfig();
      validateGitHubConfig(config);
      
      this.oauthManager = new OAuthManager(config);
      console.log('✅ OAuth 管理器初始化成功');
      
    } catch (error) {
      console.error('❌ OAuth 管理器初始化失败:', (error as Error).message);
      console.log('\n' + getGitHubSetupInstructions());
      
      // 创建一个 null 的管理器，这样应用仍然可以启动
      this.oauthManager = null;
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
        if (!this.oauthManager) {
          throw new Error('OAuth 管理器未初始化。请检查 .env 文件中的 GitHub OAuth 配置。');
        }

        console.log('📱 启动 OAuth 授权流程...');
        
        const result = await this.oauthManager.login();
        
        if (result.success && result.code) {
          console.log('🎉 GitHub OAuth 授权成功！');
          console.log('📋 授权码:', result.code);
          console.log('🔒 State:', result.state);
          
          // TODO: 下一步将使用这个授权码换取访问令牌
          
          // 暂时返回模拟的用户数据
          const mockUser = {
            id: 'github_user_123',
            name: 'GitHub 用户',
            email: 'user@github.com'
          };
          
          return {
            success: true,
            user: mockUser,
            authCode: result.code // 临时返回授权码用于调试
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
        
        console.log('🗑️ 清理用户数据...');
        
        // TODO: 清理存储的令牌等
        
        console.log('✅ 退出登录成功！');
        
        return { success: true };
        
      } catch (error) {
        console.error('❌ 退出登录失败:', error);
        return { success: false };
      }
    });

    // OAuth 状态查询处理器
    ipcMain.handle('oauth:get-status', async () => {
      console.log('🔍 查询 OAuth 登录状态');
      
      // TODO: 实现真实的状态检查逻辑
      // 目前返回未登录状态
      return {
        isLoggedIn: false
      };
    });
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