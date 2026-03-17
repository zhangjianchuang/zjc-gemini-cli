#!/bin/bash
#
# 更新本地 gemini 命令到全局安装位置
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUNDLE_JS="$ROOT_DIR/bundle/gemini.js"

# 检查 bundle 是否存在
if [ ! -f "$BUNDLE_JS" ]; then
    echo "bundle/gemini.js 不存在，正在构建..."
    cd "$ROOT_DIR"
    npm run bundle
fi

# 查找全局 gemini 安装位置
GEMINI_BIN=$(which gemini 2>/dev/null || echo "")

if [ -z "$GEMINI_BIN" ]; then
    echo "错误：未找到 gemini 命令"
    exit 1
fi

# 解析真实路径
GEMINI_REAL=$(realpath "$GEMINI_BIN" 2>/dev/null || readlink -f "$GEMINI_BIN" 2>/dev/null || echo "")

if [ -z "$GEMINI_REAL" ]; then
    echo "错误：无法解析 gemini 命令的真实路径"
    exit 1
fi

# 查找 bundle 目录
GEMINI_BUNDLE_DIR=$(dirname "$(dirname "$GEMINI_REAL")")/bundle

if [ ! -d "$GEMINI_BUNDLE_DIR" ]; then
    echo "错误：未找到 gemini bundle 目录：$GEMINI_BUNDLE_DIR"
    exit 1
fi

echo "正在更新 gemini 命令..."
echo "  源文件：$BUNDLE_JS"
echo "  目标目录：$GEMINI_BUNDLE_DIR"

# 复制文件
cp "$BUNDLE_JS" "$GEMINI_BUNDLE_DIR/gemini.js"
chmod +x "$GEMINI_BUNDLE_DIR/gemini.js"

# 获取版本信息
VERSION=$(node -e "console.log(require('$ROOT_DIR/package.json').version)" 2>/dev/null || echo "unknown")

echo ""
echo "更新完成！"
echo "  版本：$VERSION"
echo "  命令位置：$GEMINI_BIN"
echo ""
echo "运行 gemini --version 验证"
