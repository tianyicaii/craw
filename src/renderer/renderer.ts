// src/renderer/renderer.ts

// 定义用户信息类型（与预加载脚本保持一致）
interface UserInfo {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  public_repos: number;
  followers?: number;
  following?: number;
}

// 定义会话状态类型（与预加载脚本保持一致）
interface SessionStatus {
  isLoggedIn: boolean;
  lastValidated: number | null;
  timeSinceLastValidation: number | null;
  isRefreshing: boolean;
  retryCount: number;
  error?: string;
}

class GitHubOAuthApp {
  private loginButton!: HTMLButtonElement;
  private logoutButton!: HTMLButtonElement;
  private refreshButton!: HTMLButtonElement;
  private loadingSection!: HTMLDivElement;
  private loginSection!: HTMLDivElement;
  private userSection!: HTMLDivElement;
  private statusMessage!: HTMLDivElement;

  // 用户信息元素
  private userAvatar!: HTMLImageElement;
  private userName!: HTMLDivElement;
  private userLogin!: HTMLDivElement;
  private userRepos!: HTMLSpanElement;
  private userFollowers!: HTMLSpanElement;
  private userFollowing!: HTMLSpanElement;

  // 会话状态相关
  private sessionStatusCleanup: (() => void) | null = null;
  private sessionStatusTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeElements();
    this.setupEventListeners();
    this.setupSessionStatusListener();
    this.checkInitialLoginStatus();
    this.startSessionStatusMonitor();
  }

  private initializeElements(): void {
    // 获取主要控制元素
    this.loginButton = this.getElement('login-button') as HTMLButtonElement;
    this.logoutButton = this.getElement('logout-button') as HTMLButtonElement;
    this.loadingSection = this.getElement('loading-section') as HTMLDivElement;
    this.loginSection = this.getElement('login-section') as HTMLDivElement;
    this.userSection = this.getElement('user-section') as HTMLDivElement;
    this.statusMessage = this.getElement('status-message') as HTMLDivElement;

    // 获取用户信息显示元素
    this.userAvatar = this.getElement('user-avatar') as HTMLImageElement;
    this.userName = this.getElement('user-name') as HTMLDivElement;
    this.userLogin = this.getElement('user-login') as HTMLDivElement;
    this.userRepos = this.getElement('user-repos') as HTMLSpanElement;
    this.userFollowers = this.getElement('user-followers') as HTMLSpanElement;
    this.userFollowing = this.getElement('user-following') as HTMLSpanElement;

    // 尝试获取刷新按钮（可能不存在）
    try {
      this.refreshButton = this.getElement('refresh-button') as HTMLButtonElement;
    } catch {
      // 如果没有刷新按钮，我们创建一个
      this.createRefreshButton();
    }
  }

  private createRefreshButton(): void {
    // 创建刷新按钮并添加到用户界面
    this.refreshButton = document.createElement('button');
    this.refreshButton.id = 'refresh-button';
    this.refreshButton.className = 'refresh-button';
    this.refreshButton.innerHTML = '🔄 刷新';
    this.refreshButton.title = '手动刷新用户信息';
    
    // 添加到退出按钮之前
    const logoutButton = this.getElement('logout-button');
    logoutButton.parentNode?.insertBefore(this.refreshButton, logoutButton);
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`元素未找到: ${id}`);
    }
    return element;
  }

  private setupEventListeners(): void {
    this.loginButton.addEventListener('click', () => this.handleLogin());
    this.logoutButton.addEventListener('click', () => this.handleLogout());
    this.refreshButton.addEventListener('click', () => this.handleManualRefresh());
  }

  /**
   * 设置会话状态变化监听器
   */
  private setupSessionStatusListener(): void {
    if (!window.electronAPI?.onSessionStatusChange) {
      console.warn('⚠️ 会话状态监听器不可用');
      return;
    }

    this.sessionStatusCleanup = window.electronAPI.onSessionStatusChange((event) => {
      console.log('📡 收到会话状态变化:', event);
      
      if (event.isLoggedIn && event.user) {
        this.showStatus('会话已自动刷新', 'success');
        this.showUserInterface(event.user);
      } else {
        this.showStatus('会话已过期，请重新登录', 'error');
        this.showLoginInterface();
      }
    });
  }

  /**
   * 启动会话状态监控
   */
  private startSessionStatusMonitor(): void {
    // 每30秒检查一次会话状态
    this.sessionStatusTimer = setInterval(async () => {
      try {
        await this.checkSessionHealth();
      } catch (error) {
        console.warn('⚠️ 会话健康检查失败:', error);
      }
    }, 30000); // 30秒
  }

  /**
   * 检查会话健康状态
   */
  private async checkSessionHealth(): Promise<void> {
    if (!window.electronAPI?.oauth?.getSessionStatus) {
      return;
    }

    try {
      const status = await window.electronAPI.oauth.getSessionStatus();
      
      if (status.isLoggedIn) {
        // 检查是否需要显示刷新状态
        if (status.isRefreshing) {
          this.showRefreshingStatus();
        }

        // 检查重试次数
        if (status.retryCount > 0) {
          this.showStatus(`连接不稳定，正在重试 (${status.retryCount}/3)`, 'info');
        }

        // 检查最后验证时间
        if (status.timeSinceLastValidation && status.timeSinceLastValidation > 2 * 60 * 60 * 1000) {
          console.log('⚠️ 会话验证时间过久，建议刷新');
        }
      }
    } catch (error) {
      console.error('❌ 检查会话健康状态失败:', error);
    }
  }

  private async checkInitialLoginStatus(): Promise<void> {
    try {
      if (!window.electronAPI?.oauth) {
        this.showStatus('OAuth API 未就绪', 'error');
        this.showLoginInterface();
        return;
      }

      console.log('🔍 检查初始登录状态...');
      this.showLoadingInterface();
      
      const status = await window.electronAPI.oauth.getStatus();
      
      if (status.isLoggedIn && status.user) {
        console.log('✅ 发现有效的登录会话');
        this.showUserInterface(status.user);
      } else {
        console.log('📭 未发现登录会话');
        this.showLoginInterface();
      }
    } catch (error) {
      console.error('检查登录状态失败:', error);
      this.showStatus('检查登录状态失败', 'error');
      this.showLoginInterface();
    }
  }

  private async handleLogin(): Promise<void> {
    try {
      if (!window.electronAPI?.oauth) {
        throw new Error('OAuth API 未就绪');
      }

      // 显示加载状态
      this.setLoginButtonLoading(true);
      this.showStatus('正在跳转到 GitHub 授权页面...', 'info');

      console.log('🔐 开始 GitHub OAuth 登录流程');
      
      const result = await window.electronAPI.oauth.login();
      
      if (result.success && result.user) {
        console.log('✅ 登录成功');
        this.showStatus('登录成功！会话将自动维护', 'success');
        this.showUserInterface(result.user);
      } else {
        throw new Error(result.error || '登录失败');
      }
      
    } catch (error) {
      console.error('❌ 登录失败:', error);
      this.showStatus(`登录失败: ${(error as Error).message}`, 'error');
    } finally {
      this.setLoginButtonLoading(false);
    }
  }

  private async handleLogout(): Promise<void> {
    try {
      if (!window.electronAPI?.oauth) {
        throw new Error('OAuth API 未就绪');
      }

      this.setLogoutButtonLoading(true);
      this.showStatus('正在退出登录...', 'info');

      console.log('🚪 开始退出登录流程');
      
      const result = await window.electronAPI.oauth.logout();
      
      if (result.success) {
        console.log('✅ 退出登录成功');
        this.showStatus('已成功退出登录', 'success');
        this.showLoginInterface();
      } else {
        throw new Error(result.error || '退出登录失败');
      }
      
    } catch (error) {
      console.error('❌ 退出登录失败:', error);
      this.showStatus(`退出登录失败: ${(error as Error).message}`, 'error');
    } finally {
      this.setLogoutButtonLoading(false);
    }
  }

  /**
   * 处理手动刷新
   */
  private async handleManualRefresh(): Promise<void> {
    try {
      if (!window.electronAPI?.oauth) {
        throw new Error('OAuth API 未就绪');
      }

      this.setRefreshButtonLoading(true);
      this.showStatus('正在刷新用户信息...', 'info');

      console.log('🔄 开始手动刷新用户信息');
      
      const result = await window.electronAPI.oauth.manualRefresh();
      
      if (result.success && result.user) {
        console.log('✅ 手动刷新成功');
        this.showStatus('用户信息已刷新', 'success');
        this.updateUserInfo(result.user);
      } else {
        throw new Error(result.error || '刷新失败');
      }
      
    } catch (error) {
      console.error('❌ 手动刷新失败:', error);
      this.showStatus(`刷新失败: ${(error as Error).message}`, 'error');
      
      // 如果刷新失败，可能是会话过期了，跳转到登录页面
      if ((error as Error).message.includes('过期') || (error as Error).message.includes('expired')) {
        setTimeout(() => this.showLoginInterface(), 2000);
      }
    } finally {
      this.setRefreshButtonLoading(false);
    }
  }

  private showLoadingInterface(): void {
    this.loadingSection.classList.remove('hidden');
    this.loginSection.classList.remove('visible');
    this.userSection.classList.remove('visible');
    this.hideStatus();
  }

  private showLoginInterface(): void {
    this.loadingSection.classList.add('hidden');
    this.loginSection.classList.add('visible');
    this.userSection.classList.remove('visible');
    this.hideStatus();
  }

  private showUserInterface(user: UserInfo): void {
    // 隐藏加载和登录界面，显示用户界面
    this.loadingSection.classList.add('hidden');
    this.loginSection.classList.remove('visible');
    this.userSection.classList.add('visible');

    // 更新用户信息
    this.updateUserInfo(user);
    
    // 隐藏状态消息
    setTimeout(() => this.hideStatus(), 3000);
  }

  private showRefreshingStatus(): void {
    if (this.userSection.classList.contains('visible')) {
      this.showStatus('正在后台刷新会话...', 'info');
    }
  }

  private updateUserInfo(user: UserInfo): void {
    // 更新头像
    this.userAvatar.src = user.avatar_url;
    this.userAvatar.alt = `${user.login}的头像`;

    // 更新基本信息
    this.userName.textContent = user.name || user.login;
    this.userLogin.textContent = `@${user.login}`;

    // 更新统计信息
    this.userRepos.textContent = user.public_repos.toString();
    this.userFollowers.textContent = (user.followers || 0).toString();
    this.userFollowing.textContent = (user.following || 0).toString();

    console.log('👤 用户信息已更新:', {
      login: user.login,
      name: user.name,
      repos: user.public_repos,
      followers: user.followers,
      following: user.following
    });
  }

  private showStatus(message: string, type: 'info' | 'success' | 'error'): void {
    this.statusMessage.textContent = message;
    this.statusMessage.className = `status-message ${type} visible`;

    // 自动隐藏成功和错误消息
    if (type !== 'info') {
      setTimeout(() => this.hideStatus(), 4000);
    }
  }

  private hideStatus(): void {
    this.statusMessage.classList.remove('visible');
  }

  private setLoginButtonLoading(loading: boolean): void {
    if (loading) {
      this.loginButton.disabled = true;
      this.loginButton.innerHTML = `
        <div class="loading"></div>
        登录中...
      `;
    } else {
      this.loginButton.disabled = false;
      this.loginButton.innerHTML = `
        <svg class="github-icon" viewBox="0 0 16 16">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
        使用 GitHub 登录
      `;
    }
  }

  private setLogoutButtonLoading(loading: boolean): void {
    if (loading) {
      this.logoutButton.disabled = true;
      this.logoutButton.textContent = '退出中...';
    } else {
      this.logoutButton.disabled = false;
      this.logoutButton.textContent = '退出登录';
    }
  }

  private setRefreshButtonLoading(loading: boolean): void {
    if (loading) {
      this.refreshButton.disabled = true;
      this.refreshButton.innerHTML = '🔄 刷新中...';
    } else {
      this.refreshButton.disabled = false;
      this.refreshButton.innerHTML = '🔄 刷新';
    }
  }

  /**
   * 清理资源
   */
  public destroy(): void {
    console.log('🧹 清理 GitHubOAuthApp 资源...');
    
    // 清理会话状态监听器
    if (this.sessionStatusCleanup) {
      this.sessionStatusCleanup();
      this.sessionStatusCleanup = null;
    }
    
    // 清理定时器
    if (this.sessionStatusTimer) {
      clearInterval(this.sessionStatusTimer);
      this.sessionStatusTimer = null;
    }
  }
}

// 全局应用实例
let appInstance: GitHubOAuthApp | null = null;

// 当页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 GitHub OAuth 应用启动');
  appInstance = new GitHubOAuthApp();
});

// 当页面卸载时清理资源
window.addEventListener('beforeunload', () => {
  if (appInstance) {
    appInstance.destroy();
    appInstance = null;
  }
});
