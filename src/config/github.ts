// src/config/github.ts

import { OAuthConfig } from '../oauth/OAuthManager';
import { getEnv, getEnvOptional } from './env';

/**
 * GitHub OAuth 配置
 */
export function getGitHubOAuthConfig(): OAuthConfig {
  return {
    clientId: getEnv('GITHUB_CLIENT_ID'),
    clientSecret: getEnv('GITHUB_CLIENT_SECRET'),
    authUrl: 'https://github.com/login/oauth/authorize',
    redirectUri: getEnvOptional('OAUTH_REDIRECT_URI', 'http://localhost:3000/auth/callback'),
    scopes: ['user:email', 'read:user']
  };
}

/**
 * 验证 GitHub OAuth 配置
 */
export function validateGitHubConfig(config: OAuthConfig): void {
  if (!config.clientId) {
    throw new Error('GitHub Client ID 未配置。请在 .env 文件中设置 GITHUB_CLIENT_ID。');
  }

  if (!config.clientSecret) {
    throw new Error('GitHub Client Secret 未配置。请在 .env 文件中设置 GITHUB_CLIENT_SECRET。');
  }

  // 验证 Client ID 格式（GitHub Client ID 通常以特定前缀开头）
  if (config.clientId === 'your_github_client_id_here') {
    throw new Error('请将 .env 文件中的 GITHUB_CLIENT_ID 替换为真实的值。');
  }

  if (config.clientSecret === 'your_github_client_secret_here') {
    throw new Error('请将 .env 文件中的 GITHUB_CLIENT_SECRET 替换为真实的值。');
  }

  console.log('✅ GitHub OAuth 配置验证通过');
  console.log(`🔗 回调地址: ${config.redirectUri}`);
}

/**
 * 获取 GitHub OAuth App 设置指南
 */
export function getGitHubSetupInstructions(): string {
  const redirectUri = getEnvOptional('OAUTH_REDIRECT_URI', 'http://localhost:3000/auth/callback');
  
  return `
📋 GitHub OAuth App 设置步骤：

1. 访问 https://github.com/settings/applications/new
2. 填写应用信息：
   - Application name: Electron OAuth App
   - Homepage URL: http://localhost:3000
   - Authorization callback URL: ${redirectUri}

3. 创建应用后，获取 Client ID 和 Client Secret

4. 在项目根目录创建 .env 文件（或复制 .env.example）：
   GITHUB_CLIENT_ID=你的_client_id
   GITHUB_CLIENT_SECRET=你的_client_secret
   OAUTH_REDIRECT_URI=${redirectUri}

5. 重新启动应用

⚠️  重要提醒：
- 确保在 GitHub OAuth App 中设置的回调地址与 OAUTH_REDIRECT_URI 完全一致
- 回调服务器将在本地端口 3000 上运行
- 请确保端口 3000 未被其他应用占用

注意：请确保 .env 文件在 .gitignore 中，不要提交到版本控制系统！
  `;
}