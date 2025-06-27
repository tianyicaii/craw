// src/renderer/renderer.ts

// 使用与预加载脚本一致的类型定义
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

// 界面元素
let loginBtn: HTMLButtonElement;
let logoutBtn: HTMLButtonElement;
let refreshBtn: HTMLButtonElement;
let statusDiv: HTMLDivElement;
let userInfoDiv: HTMLDivElement;

let cleanupSessionListener: (() => void) | null = null;
let currentUser: any = null;

// 应用启动时检查登录状态
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🔍 应用启动，检查登录状态...');
  
  // 初始化DOM元素
  console.log('🔍 初始化DOM元素...');
  loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;
  logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement;
  refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
  statusDiv = document.getElementById('status') as HTMLDivElement;
  userInfoDiv = document.getElementById('userInfo') as HTMLDivElement;
  
  // 检查DOM元素是否存在
  const elements = [
    { name: 'loginBtn', element: loginBtn },
    { name: 'logoutBtn', element: logoutBtn },
    { name: 'refreshBtn', element: refreshBtn },
    { name: 'statusDiv', element: statusDiv },
    { name: 'userInfoDiv', element: userInfoDiv }
  ];
  
  for (const { name, element } of elements) {
    if (!element) {
      console.error(`❌ DOM元素不存在: ${name}`);
      return;
    } else {
      console.log(`✅ DOM元素存在: ${name}`);
    }
  }
  
  // 检查API是否可用
  if (!window.electronAPI) {
    console.error('❌ electronAPI 不可用!');
    return;
  }
  
  if (!window.electronAPI.oauth) {
    console.error('❌ oauth API 不可用!');
    return;
  }
  
  console.log('✅ API 可用，设置事件监听器...');
  setupEventListeners();
  console.log('✅ 开始检查登录状态...');
  await checkLoginStatus();
});

// 设置事件监听器
function setupEventListeners(): void {
  // 设置会话状态变化监听器
  cleanupSessionListener = window.electronAPI.onSessionStatusChange((data) => {
    console.log('📢 收到会话状态变化通知:', data);
    currentUser = data.user;
    updateUI(data.isLoggedIn, data.user);
    
    if (data.isLoggedIn && data.user) {
      showStatusMessage('✅ 信息已刷新', 'success');
    }
  });

  // 登录按钮
  loginBtn.addEventListener('click', async () => {
    await handleLogin();
  });

  // 退出登录按钮
  logoutBtn.addEventListener('click', async () => {
    await handleLogout();
  });

  // 手动刷新按钮
  refreshBtn.addEventListener('click', async () => {
    await handleManualRefresh();
  });
}

// 处理登录
async function handleLogin(): Promise<void> {
  console.log('🔐 开始登录流程...');
  
  try {
    loginBtn.disabled = true;
    loginBtn.textContent = '登录中...';
    showStatusMessage('⏳ 正在启动 GitHub OAuth 登录...', 'info');

    const result = await window.electronAPI.oauth.login();
    
    if (result.success && result.user) {
      console.log('🎉 登录成功！');
      currentUser = result.user;
      updateUI(true, result.user);
      showStatusMessage('🎉 登录成功！', 'success');
    } else {
      console.error('❌ 登录失败:', result.error);
      updateUI(false);
      showStatusMessage(`❌ 登录失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('❌ 登录过程中出错:', error);
    updateUI(false);
    showStatusMessage('❌ 登录过程中出现错误', 'error');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '使用 GitHub 登录';
  }
}

// 处理退出登录
async function handleLogout(): Promise<void> {
  console.log('🚪 开始退出登录...');
  
  try {
    logoutBtn.disabled = true;
    logoutBtn.textContent = '退出中...';
    showStatusMessage('⏳ 正在退出登录...', 'info');

        const result = await window.electronAPI.oauth.logout();

    if (result.success) {
      console.log('👋 退出登录成功');
      currentUser = null;
      updateUI(false);
      showStatusMessage('👋 已退出登录', 'success');
    } else {
      console.error('❌ 退出登录失败:', result.error);
      showStatusMessage(`❌ 退出登录失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('❌ 退出登录过程中出错:', error);
    showStatusMessage('❌ 退出登录过程中出现错误', 'error');
  } finally {
    logoutBtn.disabled = false;
    logoutBtn.textContent = '退出登录';
  }
}

// 处理手动刷新
async function handleManualRefresh(): Promise<void> {
  console.log('🔄 手动刷新用户信息...');
  
  try {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '刷新中...';
    showStatusMessage('🔄 正在刷新用户信息...', 'info');

    const result = await window.electronAPI.oauth.manualRefresh();

    if (result.success && result.user) {
      console.log('✅ 刷新成功！');
      currentUser = result.user;
      updateUI(true, result.user);
      showStatusMessage('✅ 信息已刷新', 'success');
    } else {
      console.error('❌ 刷新失败:', result.error);
      showStatusMessage(`❌ 刷新失败: ${result.error}`, 'error');
      
      // 如果刷新失败，可能是会话过期，更新UI
      currentUser = null;
      updateUI(false);
    }
  } catch (error) {
    console.error('❌ 刷新过程中出错:', error);
    showStatusMessage('❌ 刷新过程中出现错误', 'error');
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '刷新信息';
  }
}

// 检查登录状态
async function checkLoginStatus(): Promise<void> {
  try {
    console.log('🔍 开始检查登录状态...');
    
    console.log('📡 调用 getStatus API...');
    
    // 添加超时机制来调试
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('API调用超时')), 10000);
    });
    
    const apiPromise = window.electronAPI.oauth.getStatus();
    
    const status = await Promise.race([apiPromise, timeoutPromise]);
    console.log('📡 API 响应:', status);
    
    if (status.isLoggedIn && status.user) {
      console.log('✅ 用户已登录:', status.user.login);
      currentUser = status.user;
      updateUI(true, status.user);
      showStatusMessage('✅ 欢迎回来！', 'success');
      console.log('✅ UI 更新完成');
    } else {
      console.log('📭 用户未登录');
      currentUser = null;
      updateUI(false);
      showStatusMessage('👋 请登录以使用应用', 'info');
      console.log('✅ UI 更新完成（未登录状态）');
    }
  } catch (error) {
    console.error('❌ 检查登录状态失败:', error);
    console.error('错误详情:', error);
    currentUser = null;
    updateUI(false);
    showStatusMessage('❌ 无法检查登录状态', 'error');
  }
}

// 更新UI
function updateUI(isLoggedIn: boolean, user?: any): void {
  console.log(`🎨 开始更新UI - 登录状态: ${isLoggedIn}`);
  console.log('用户数据:', user);
  
  try {
    if (isLoggedIn && user) {
      console.log('🎨 显示已登录界面');
      // 用户已登录
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
      refreshBtn.style.display = 'inline-block';
      
      console.log('🎨 创建用户信息HTML');
      userInfoDiv.style.display = 'block';
      userInfoDiv.innerHTML = `
        <div class="user-info">
          <img src="${user.avatar_url}" alt="Avatar" class="avatar">
          <div class="user-details">
            <h3>${user.name || user.login}</h3>
            <p>@${user.login}</p>
            <p>📧 ${user.email || '未设置公开邮箱'}</p>
            <p>📚 ${user.public_repos} 个公开仓库</p>
          </div>
        </div>
      `;
      console.log('🎨 已登录界面更新完成');
    } else {
      console.log('🎨 显示未登录界面');
      // 用户未登录
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
      refreshBtn.style.display = 'none';
      
      userInfoDiv.style.display = 'none';
      userInfoDiv.innerHTML = '';
      console.log('🎨 未登录界面更新完成');
    }
  } catch (error) {
    console.error('❌ UI更新失败:', error);
  }
}

// 显示状态消息
function showStatusMessage(message: string, type: 'success' | 'error' | 'info'): void {
  // 清除所有现有的状态消息
  statusDiv.innerHTML = '';
  
  // 创建新的状态消息
  const messageElement = document.createElement('div');
  messageElement.className = `status-message ${type}`;
  messageElement.textContent = message;
  
  // 添加到状态容器
  statusDiv.appendChild(messageElement);
  
  // 触发显示动画
  setTimeout(() => {
    messageElement.classList.add('show');
  }, 10);
  
  // 3秒后自动隐藏并删除
  setTimeout(() => {
    messageElement.classList.remove('show');
    setTimeout(() => {
      if (messageElement.parentNode) {
        messageElement.parentNode.removeChild(messageElement);
      }
    }, 300);
  }, 3000);
}

// 清理资源
window.addEventListener('beforeunload', () => {
  console.log('🧹 页面卸载，清理资源...');
  if (cleanupSessionListener) {
    cleanupSessionListener();
  }
});
