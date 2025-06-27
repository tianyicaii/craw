// scripts/build.js

const fs = require('fs');
const path = require('path');

console.log('📦 开始构建静态文件...');

// 项目根目录
const root = path.join(__dirname, '..');

// 源文件和目标文件路径
const files = [
  {
    src: path.join(root, 'src/renderer/index.html'),
    dest: path.join(root, 'dist/renderer/index.html')
  }
];

// 创建必要的目录
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ 创建目录: ${dir}`);
  }
}

// 复制文件
let success = 0;
let total = files.length;

for (const file of files) {
  try {
    if (!fs.existsSync(file.src)) {
      console.error(`✗ 源文件不存在: ${file.src}`);
      continue;
    }
    
    ensureDir(file.dest);
    fs.copyFileSync(file.src, file.dest);
    console.log(`✓ 复制: ${path.basename(file.src)}`);
    success++;
    
  } catch (error) {
    console.error(`✗ 复制失败: ${file.src}`, error.message);
  }
}

console.log(`\n📊 完成: ${success}/${total} 文件复制成功`);

if (success === total) {
  console.log('✅ 构建完成！');
} else {
  console.log('❌ 构建过程中出现错误！');
  process.exit(1);
}
