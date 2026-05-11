#!/bin/bash

# Silas-Chat 部署脚本
# 用于 Ubuntu 服务器部署

set -e

echo "🚀 开始部署 Silas-Chat..."

# 更新系统
echo "📦 更新系统包..."
apt-get update
apt-get upgrade -y

# 安装 Node.js 20.x
echo "📝 安装 Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs

# 验证安装
echo "✅ Node.js 版本: $(node --version)"
echo "✅ npm 版本: $(npm --version)"

# 安装 Git（如果还没安装）
apt-get install -y git

# 创建应用目录
APP_DIR="/opt/silas-chat"
if [ ! -d "$APP_DIR" ]; then
    mkdir -p $APP_DIR
    echo "📁 创建应用目录: $APP_DIR"
fi

# 克隆或更新项目
if [ -d "$APP_DIR/.git" ]; then
    echo "📥 更新项目代码..."
    cd $APP_DIR
    git pull origin master
else
    echo "📥 克隆项目..."
    git clone https://github.com/your-username/silas-chat.git $APP_DIR
    cd $APP_DIR
fi

# 安装依赖
echo "📚 安装 npm 依赖..."
npm install --production

# 创建 .env 文件（如果不存在）
if [ ! -f "$APP_DIR/.env" ]; then
    echo "⚙️  创建 .env 文件..."
    cat > $APP_DIR/.env << 'EOF'
PORT=3000
SUPABASE_URL=https://eiemscirhjupatfngmfq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_***REDACTED***
OPENAI_API_KEY=sk-proj-***REDACTED***
OPENAI_MODEL=gpt-4o-mini
CHAT_BG_STORAGE_BUCKET=touxiang
SILAS_PROACTIVE_ENABLED=1
SILAS_PROACTIVE_TZ=Asia/Shanghai
EOF
    echo "⚠️  请编辑 $APP_DIR/.env 填入正确的密钥"
fi

# 安装 PM2 全局
echo "🔄 安装 PM2 进程管理器..."
npm install -g pm2

# 启动应用（如果没有运行）
cd $APP_DIR
pm2 stop silas-chat 2>/dev/null || true
pm2 start src/app.js --name silas-chat --instances 1 --env production
pm2 save

# 设置开机自启
pm2 startup ubuntu -u root --hp /root

echo "✅ 安装 Nginx..."
apt-get install -y nginx

# 配置 Nginx 反向代理
echo "⚙️  配置 Nginx..."
cat > /etc/nginx/sites-available/silas-chat << 'EOF'
server {
    listen 80;
    server_name 70.39.202.75;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 前端静态文件
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# 启用站点
ln -sf /etc/nginx/sites-available/silas-chat /etc/nginx/sites-enabled/silas-chat || true

# 移除默认配置
rm -f /etc/nginx/sites-enabled/default

# 测试 Nginx 配置
nginx -t

# 启动 Nginx
systemctl start nginx
systemctl enable nginx

echo "================================"
echo "✅ 部署完成！"
echo "================================"
echo "应用地址: http://70.39.202.75"
echo "应用目录: $APP_DIR"
echo "日志查看: pm2 logs silas-chat"
echo "进程状态: pm2 status"
echo ""
echo "💡 后续操作："
echo "1. SSH 连接后编辑 $APP_DIR/.env 填入正确的 API 密钥"
echo "2. 运行: pm2 restart silas-chat"
echo "3. 访问: http://70.39.202.75"
