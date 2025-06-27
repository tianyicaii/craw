// src/renderer/renderer.ts

// 定义用户信息类型（与预加载脚本保持一致）
interface UserInfo {
  id: string;
  name: string;
  email: string;
}

class RendererApp {
  private testButton!: HTMLButtonElement;
  private versionButton!: HTMLButtonElement;
  private testStatus!: HTMLDivElement;
  
  // OAuth 相关元素
  private loginButton!: HTMLButtonElement;
  private logoutButton!: HTMLButtonElement;
  private loginStatus!: HTMLDivElement;
  private userInfo!: HTMLDivElement;
  private authStatus!: HTMLDivElement;

  constructor() {
    this.initializeElements();
    this.setupEventListeners();
    this.loadAppInfo();
    this.checkLoginStatus();
  }

  private initializeElements(): void {
    // 原有元素
    this.testButton = this.getElement('test-button') as HTMLButtonElement;
    this.versionButton = this.getElement('version-button') as HTMLButtonElement;
    this.testStatus = this.getElement('test-status') as HTMLDivElement;
    
    // OAuth 相关元素
    this.loginButton = this.getElement('login-button') as HTMLButtonElement;
    this.logoutButton = this.getElement('logout-button') as HTMLButtonElement;
    this.loginStatus = this.getElement('login-status') as HTMLDivElement;
    this.userInfo = this.getElement('user-info') as HTMLDivElement;
    this.authStatus = this.getElement('auth-status') as HTMLDivElement;
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`无法找到 ID 为 "${id}" 的元素`);
    }
    return element;
  }

  private setupEventListeners(): void {
    // 原有事件监听器
    this.testButton.addEventListener('click', () => {
      this.testIPC();
    });

    this.versionButton.addEventListener('click', () => {
      this.getVersionInfo();
    });
    
    // OAuth 事件监听器
    this.loginButton.addEventListener('click', () => {
      this.handleLogin();
    });
    
    this.logoutButton.addEventListener('click', () => {
      this.handleLogout();
    });
  }

  private async loadAppInfo(): Promise<void> {
    try {
      // 显示基础应用信息
      this.updateElement('app-name', 'Electron OAuth App');
      
      // 获取系统信息
      if (window.electronAPI) {
        const systemInfo = window.electronAPI.getSystemInfo();
        this.updateElement('electron-version', systemInfo.electron);
        this.updateElement('node-version', systemInfo.node);
        
        // 尝试获取应用版本
        try {
          const version = await window.electronAPI.getVersion();
          this.updateElement('app-version', version);
        } catch (error) {
          this.updateElement('app-version', '获取失败');
          console.warn('获取应用版本失败:', error);
        }
      } else {
        this.updateElement('electron-version', '未知');
        this.updateElement('node-version', '未知');
        this.updateElement('app-version', 'API 未就绪');
      }
    } catch (error) {
      console.error('加载应用信息失败:', error);
      // 设置默认值
      this.updateElement('electron-version', '获取失败');
      this.updateElement('node-version', '获取失败');
      this.updateElement('app-version', '获取失败');
    }
  }

  private async checkLoginStatus(): Promise<void> {
    try {
      if (!window.electronAPI?.oauth) {
        return;
      }

      const status = await window.electronAPI.oauth.getStatus();
      this.updateLoginUI(status.isLoggedIn, status.user);
    } catch (error) {
      console.error('检查登录状态失败:', error);
    }
  }

  private async handleLogin(): Promise<void> {
    try {
      if (!window.electronAPI?.oauth) {
        throw new Error('OAuth API 未就绪');
      }

      this.showLoginStatus('正在登录...', 'info');
      this.loginButton.disabled = true;

      console.log('🔐 开始 OAuth 登录流程');
      
      const result = await window.electronAPI.oauth.login();
      
      if (result.success && result.user) {
        this.showLoginStatus('登录成功！', 'success');
        this.updateLoginUI(true, result.user);
        console.log('✅ 登录成功');
      } else {
        throw new Error(result.error || '登录失败');
      }
      
    } catch (error) {
      console.error('❌ 登录失败:', error);
      this.showLoginStatus(`登录失败: ${(error as Error).message}`, 'error');
      this.updateLoginUI(false);
    } finally {
      this.loginButton.disabled = false;
    }
  }

  private async handleLogout(): Promise<void> {
    try {
      if (!window.electronAPI?.oauth) {
        throw new Error('OAuth API 未就绪');
      }

      this.showLoginStatus('正在退出登录...', 'info');
      this.logoutButton.disabled = true;

      console.log('🚪 开始退出登录流程');
      
      const result = await window.electronAPI.oauth.logout();
      
      if (result.success) {
        this.showLoginStatus('已退出登录', 'info');
        this.updateLoginUI(false);
        console.log('✅ 退出登录成功');
      } else {
        throw new Error('退出登录失败');
      }
      
    } catch (error) {
      console.error('❌ 退出登录失败:', error);
      this.showLoginStatus(`退出失败: ${(error as Error).message}`, 'error');
    } finally {
      this.logoutButton.disabled = false;
    }
  }

  private updateLoginUI(isLoggedIn: boolean, user?: UserInfo): void {
    if (isLoggedIn && user) {
      // 显示已登录状态
      this.loginButton.style.display = 'none';
      this.logoutButton.style.display = 'inline-block';
      this.userInfo.style.display = 'block';
      
      // 更新基本用户信息
      this.updateElement('user-name', user.name);
      this.updateElement('user-email', user.email || '未公开');
      this.updateElement('user-id', user.id);
      
      // 更新扩展用户信息（如果有的话）
      if ('login' in user) {
        this.updateElement('user-login', (user as any).login);
      }
      if ('publicRepos' in user) {
        this.updateElement('user-repos', (user as any).publicRepos?.toString() || '0');
      }
      if ('followers' in user) {
        this.updateElement('user-followers', (user as any).followers?.toString() || '0');
      }
      if ('following' in user) {
        this.updateElement('user-following', (user as any).following?.toString() || '0');
      }
      if ('createdAt' in user) {
        const createdDate = new Date((user as any).createdAt);
        this.updateElement('user-created', createdDate.toLocaleDateString('zh-CN'));
      }
      
      // 显示头像
      if ('avatar' in user && (user as any).avatar) {
        const avatarImg = document.getElementById('user-avatar') as HTMLImageElement;
        if (avatarImg) {
          avatarImg.src = (user as any).avatar;
          avatarImg.style.display = 'block';
        }
      }
      
      // 显示个人简介
      if ('bio' in user && (user as any).bio) {
        const bioElement = document.getElementById('user-bio');
        if (bioElement) {
          bioElement.textContent = (user as any).bio;
          bioElement.style.display = 'block';
        }
      }
      
      // 更新认证状态
      this.authStatus.innerHTML = `
        <div class="status success">
          <p><strong>已登录</strong></p>
          <p>欢迎回来，${user.name}！</p>
          <p style="font-size: 12px; margin-top: 10px;">已获取 GitHub 访问令牌，可以调用 API</p>
        </div>
      `;
      
    } else {
      // 显示未登录状态
      this.loginButton.style.display = 'inline-block';
      this.logoutButton.style.display = 'none';
      this.userInfo.style.display = 'none';
      
      // 重置认证状态
      this.authStatus.innerHTML = '<div class="placeholder">请先登录以查看详细状态...</div>';
    }
  }

  private showLoginStatus(message: string, type: 'info' | 'success' | 'error'): void {
    this.loginStatus.textContent = message;
    this.loginStatus.className = `status ${type}`;
    this.loginStatus.style.display = 'block';

    // 3秒后自动隐藏成功/错误消息
    if (type !== 'info') {
      setTimeout(() => {
        this.loginStatus.style.display = 'none';
      }, 3000);
    }
  }

  private async testIPC(): Promise<void> {
    try {
      this.showStatus('正在测试 IPC 通信...', 'info');
      this.testButton.disabled = true;

      if (!window.electronAPI) {
        throw new Error('Electron API 未就绪');
      }

      // 测试发送消息给主进程
      window.electronAPI.showMessage('来自渲染进程的测试消息');
      
      this.showStatus('IPC 通信测试成功！', 'success');
    } catch (error) {
      console.error('IPC 测试失败:', error);
      this.showStatus(`IPC 通信测试失败: ${(error as Error).message}`, 'error');
    } finally {
      this.testButton.disabled = false;
    }
  }

  private async getVersionInfo(): Promise<void> {
    try {
      this.showStatus('正在获取版本信息...', 'info');
      this.versionButton.disabled = true;

      if (!window.electronAPI) {
        throw new Error('Electron API 未就绪');
      }

      const version = await window.electronAPI.getVersion();
      this.updateElement('app-version', version);
      this.showStatus('版本信息获取成功！', 'success');
    } catch (error) {
      console.error('获取版本信息失败:', error);
      this.showStatus(`获取版本信息失败: ${(error as Error).message}`, 'error');
    } finally {
      this.versionButton.disabled = false;
    }
  }

  private updateElement(id: string, text: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    } else {
      console.warn(`元素 ${id} 不存在`);
    }
  }

  private showStatus(message: string, type: 'info' | 'success' | 'error'): void {
    this.testStatus.textContent = message;
    this.testStatus.className = `status ${type}`;
    this.testStatus.style.display = 'block';

    // 3秒后自动隐藏成功/错误消息
    if (type !== 'info') {
      setTimeout(() => {
        this.testStatus.style.display = 'none';
      }, 3000);
    }
  }
}

// 当 DOM 加载完成时初始化应用
document.addEventListener('DOMContentLoaded', () => {
  try {
    // 检查 electronAPI 是否可用
    if (!window.electronAPI) {
      throw new Error('Electron API 未就绪，请检查 preload 脚本配置');
    }
    
    new RendererApp();
  } catch (error) {
    console.error('初始化渲染进程应用失败:', error);
    
    // 显示错误信息给用户
    const errorDiv = document.createElement('div');
    errorDiv.className = 'status error';
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '20px';
    errorDiv.style.right = '20px';
    errorDiv.style.maxWidth = '400px';
    errorDiv.style.zIndex = '9999';
    errorDiv.innerHTML = `
      <strong>应用初始化失败</strong><br>
      ${(error as Error).message}<br>
      <small>请检查控制台获取详细信息</small>
    `;
    document.body.appendChild(errorDiv);
    
    // 5秒后自动隐藏错误信息
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 5000);
  }
});
