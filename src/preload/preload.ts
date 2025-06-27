// src/preload/preload.ts

import { contextBridge, ipcRenderer } from 'electron';

// 定义用户信息类型
interface UserInfo {
  id: string;
  name: string;
  email: string;
}

// 定义系统信息类型
interface SystemInfo {
  electron: string;
  node: string;
  platform: string;
}

// 定义令牌信息类型
interface TokenInfo {
  accessToken: string;
  tokenType: string;
  scope: string;
}

// 定义 OAuth 响应类型
interface OAuthLoginResult {
  success: boolean;
  error?: string;
  user?: UserInfo;
  tokens?: TokenInfo;
}

interface OAuthLogoutResult {
  success: boolean;
}

interface OAuthStatusResult {
  isLoggedIn: boolean;
  user?: UserInfo;
}

// 定义暴露给渲染进程的 API 接口
interface ElectronAPI {
  // 系统信息 API
  getSystemInfo(): SystemInfo;
  getVersion(): Promise<string>;
  showMessage(message: string): void;
  
  // OAuth 相关 API
  oauth: {
    login(): Promise<OAuthLoginResult>;
    logout(): Promise<OAuthLogoutResult>;
    getStatus(): Promise<OAuthStatusResult>;
  };
}

// 实现 API
const electronAPI: ElectronAPI = {
  // 获取系统信息
  getSystemInfo: () => {
    return {
      electron: process.versions.electron || '未知',
      node: process.versions.node || '未知',
      platform: process.platform || '未知'
    };
  },

  // 获取应用版本
  getVersion: () => {
    return ipcRenderer.invoke('app:get-version');
  },

  // 显示消息
  showMessage: (message: string) => {
    ipcRenderer.send('app:show-message', message);
  },

  // OAuth API
  oauth: {
    login: () => {
      return ipcRenderer.invoke('oauth:login');
    },
    
    logout: () => {
      return ipcRenderer.invoke('oauth:logout');
    },
    
    getStatus: () => {
      return ipcRenderer.invoke('oauth:get-status');
    }
  }
};

// 通过 contextBridge 安全地暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// 为 TypeScript 提供类型声明
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}