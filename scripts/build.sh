#!/bin/bash

echo "🧹 清理构建目录..."
rm -rf dist

echo "📦 编译 TypeScript..."
tsc

if [ $? -ne 0 ]; then
  echo "❌ TypeScript 编译失败"
  exit 1
fi

echo "📄 复制静态文件..."

# 复制 HTML 文件
cp src/renderer/index.html dist/renderer/
echo "✅ HTML 文件已复制"

# 如果有其他静态资源，可以在这里添加
# cp -r src/assets dist/ 2>/dev/null || true

echo "🎉 构建完成！"
echo "📁 输出目录: ./dist" 