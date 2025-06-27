// src/oauth/OAuthManager.ts

import { shell } from 'electron';
import * as crypto from 'crypto';
import * as http from 'http';
import { URL } from 'url';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface AuthResult {
  success: boolean;
  code?: string;
  error?: string;
  state?: string;
}

export class OAuthManager {
  private config: OAuthConfig;
  private server: http.Server | null = null;
  private authPromise: { resolve: Function; reject: Function } | null = null;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  /**
   * 生成随机状态参数，用于防止 CSRF 攻击
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * 构建 OAuth 授权 URL
   */
  private buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state: state,
      response_type: 'code'
    });

    return `${this.config.authUrl}?${params.toString()}`;
  }

  /**
   * 启动本地服务器监听回调
   */
  private startCallbackServer(expectedState: string): Promise<AuthResult> {
    return new Promise((resolve, reject) => {
      // 解析回调 URI 获取端口
      const callbackUrl = new URL(this.config.redirectUri);
      const port = parseInt(callbackUrl.port) || 3000;

      console.log(`🌐 启动本地回调服务器，端口: ${port}`);

      this.server = http.createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }

        const url = new URL(req.url, `http://localhost:${port}`);
        
        // 只处理回调路径
        if (url.pathname === callbackUrl.pathname) {
          this.handleCallback(url, expectedState, res, resolve, reject);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      this.server.listen(port, 'localhost', () => {
        console.log(`✅ 回调服务器已启动: http://localhost:${port}${callbackUrl.pathname}`);
      });

      this.server.on('error', (error) => {
        console.error('❌ 回调服务器启动失败:', error);
        reject(new Error(`回调服务器启动失败: ${error.message}`));
      });

      // 设置超时（5分钟）
      setTimeout(() => {
        this.stopCallbackServer();
        reject(new Error('授权超时'));
      }, 300000);
    });
  }

  /**
   * 处理授权回调
   */
  private handleCallback(
    url: URL,
    expectedState: string,
    res: http.ServerResponse,
    resolve: Function,
    reject: Function
  ): void {
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      console.log('📋 收到回调参数:', {
        code: code ? '***已获取***' : null,
        state: state,
        error: error,
        errorDescription: errorDescription
      });

      // 发送响应页面给浏览器
      if (error) {
        this.sendErrorPage(res, error, errorDescription || undefined);
        this.stopCallbackServer();
        reject(new Error(`GitHub 授权错误: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`));
        return;
      }

      // 验证 state 参数
      if (state !== expectedState) {
        this.sendErrorPage(res, 'invalid_state', 'State 参数不匹配');
        this.stopCallbackServer();
        reject(new Error('State 参数不匹配，可能存在安全风险'));
        return;
      }

      // 检查授权码
      if (!code) {
        this.sendErrorPage(res, 'no_code', '未收到授权码');
        this.stopCallbackServer();
        reject(new Error('未收到授权码'));
        return;
      }

      console.log('🎉 成功获取授权码:', code);

      // 发送成功页面
      this.sendSuccessPage(res);
      this.stopCallbackServer();

      // 返回成功结果
      resolve({
        success: true,
        code: code,
        state: state
      });

    } catch (error) {
      this.sendErrorPage(res, 'callback_error', (error as Error).message);
      this.stopCallbackServer();
      reject(new Error(`处理回调失败: ${(error as Error).message}`));
    }
  }

  /**
   * 发送成功页面
   */
  private sendSuccessPage(res: http.ServerResponse): void {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>授权成功</title>
        <meta charset="UTF-8">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
            background-color: #f0f8ff; 
          }
          .container { 
            text-align: center; 
            background: white; 
            padding: 40px; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
          }
          .success { 
            color: #28a745; 
            font-size: 48px; 
            margin-bottom: 20px; 
          }
          .title { 
            color: #333; 
            font-size: 24px; 
            font-weight: 600;
            margin-bottom: 16px; 
          }
          .message { 
            color: #666; 
            font-size: 16px; 
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✅</div>
          <div class="title">授权成功</div>
          <div class="message">
            您已成功授权应用访问您的 GitHub 账户。<br>
            请返回应用程序继续操作。
          </div>
        </div>
      </body>
      </html>
    `;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
  }

  /**
   * 发送错误页面
   */
  private sendErrorPage(res: http.ServerResponse, error: string, description?: string): void {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>授权失败</title>
        <meta charset="UTF-8">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
            background-color: #fff5f5; 
          }
          .container { 
            text-align: center; 
            background: white; 
            padding: 40px; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
          }
          .error { 
            color: #dc3545; 
            font-size: 48px; 
            margin-bottom: 20px; 
          }
          .title { 
            color: #333; 
            font-size: 24px; 
            font-weight: 600;
            margin-bottom: 16px; 
          }
          .message { 
            color: #666; 
            font-size: 16px; 
            line-height: 1.5;
            margin-bottom: 20px;
          }
          .details {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            font-size: 14px;
            color: #666;
            text-align: left;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error">❌</div>
          <div class="title">授权失败</div>
          <div class="message">
            授权过程中出现了问题，请返回应用程序重试。
          </div>
          <div class="details">
            <strong>错误:</strong> ${error}<br>
            ${description ? `<strong>详情:</strong> ${description}` : ''}
          </div>
        </div>
      </body>
      </html>
    `;

    res.writeHead(400, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
  }

  /**
   * 停止回调服务器
   */
  private stopCallbackServer(): void {
    if (this.server) {
      this.server.close(() => {
        console.log('🔴 回调服务器已关闭');
      });
      this.server = null;
    }
  }

  /**
   * 启动 OAuth 登录流程
   */
  async login(): Promise<AuthResult> {
    return new Promise(async (resolve, reject) => {
      try {
        // 如果已有进行中的授权，先取消
        if (this.authPromise) {
          this.authPromise.reject(new Error('新的授权请求已开始'));
        }
        
        this.authPromise = { resolve, reject };

        // 生成状态参数
        const state = this.generateState();
        const authUrl = this.buildAuthUrl(state);

        console.log('🔗 构建的授权 URL:', authUrl);

        // 启动本地回调服务器
        const serverPromise = this.startCallbackServer(state);

        // 在默认浏览器中打开授权页面
        console.log('🌐 在默认浏览器中打开授权页面...');
        await shell.openExternal(authUrl);

        // 等待回调
        const result = await serverPromise;
        this.authPromise = null;
        resolve(result);

      } catch (error) {
        this.authPromise = null;
        this.stopCallbackServer();
        reject(error);
      }
    });
  }

  /**
   * 取消当前授权流程
   */
  cancelAuth(): void {
    if (this.authPromise) {
      this.authPromise.reject(new Error('授权已取消'));
      this.authPromise = null;
    }
    this.stopCallbackServer();
  }
}