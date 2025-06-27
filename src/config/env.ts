// src/config/env.ts

import * as dotenv from 'dotenv';
import * as path from 'path';

/**
 * 加载环境变量
 */
export function loadEnv(): void {
  // 查找 .env 文件的路径
  const envPath = path.join(__dirname, '../../.env');
  
  // 加载 .env 文件
  const result = dotenv.config({ path: envPath });
  
  if (result.error) {
    console.warn('⚠️  未找到 .env 文件或加载失败:', result.error.message);
    console.log('📋 请复制 .env.example 为 .env 并填入配置信息');
  } else {
    console.log('✅ 环境变量加载成功');
  }
}

/**
 * 获取环境变量，带默认值和验证
 */
export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`环境变量 ${key} 未设置`);
  }
  
  return value;
}

/**
 * 获取可选的环境变量
 */
export function getEnvOptional(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

/**
 * 获取布尔值环境变量
 */
export function getEnvBoolean(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * 获取数字环境变量
 */
export function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`环境变量 ${key} 未设置`);
  }
  
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`环境变量 ${key} 不是有效的数字: ${value}`);
  }
  
  return num;
}

/**
 * 验证必需的环境变量
 */
export function validateRequiredEnvVars(requiredVars: string[]): void {
  const missingVars: string[] = [];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }
  
  if (missingVars.length > 0) {
    throw new Error(`缺少必需的环境变量: ${missingVars.join(', ')}`);
  }
}

/**
 * 打印环境配置信息（隐藏敏感信息）
 */
export function printEnvInfo(): void {
  console.log('🔧 当前环境配置:');
  console.log(`   NODE_ENV: ${getEnvOptional('NODE_ENV', 'development')}`);
  console.log(`   LOG_LEVEL: ${getEnvOptional('LOG_LEVEL', 'info')}`);
  console.log(`   GITHUB_CLIENT_ID: ${process.env.GITHUB_CLIENT_ID ? '已设置' : '未设置'}`);
  console.log(`   GITHUB_CLIENT_SECRET: ${process.env.GITHUB_CLIENT_SECRET ? '已设置' : '未设置'}`);
  console.log(`   OAUTH_REDIRECT_URI: ${getEnvOptional('OAUTH_REDIRECT_URI', 'http://localhost:3000/auth/callback')}`);
}
