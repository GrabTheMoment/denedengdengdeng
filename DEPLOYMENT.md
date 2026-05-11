# Silas-Chat 部署指南

## 📊 服务器信息
- **主机名**: C20260511149631
- **IP 地址**: 70.39.202.75
- **操作系统**: Ubuntu
- **用户**: root

---

## 🚀 部署方案（选择其一）

### 方案 A：自动化脚本部署（推荐）

**优点**: 一键部署，配置完整  
**缺点**: 直接修改系统配置

#### 步骤：

1. **连接到服务器**
```bash
ssh root@70.39.202.75
```

2. **下载部署脚本**
```bash
# 克隆项目
git clone https://github.com/your-username/silas-chat.git
cd silas-chat

# 或者上传 deploy.sh 文件

# 赋予执行权限
chmod +x deploy.sh
```

3. **运行部署脚本**
```bash
sudo bash deploy.sh
```

4. **配置环境变量**
```bash
nano /opt/silas-chat/.env
```
确保填入正确的值：
```
SUPABASE_URL=https://eiemscirhjupatfngmfq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_actual_key_here
OPENAI_API_KEY=your_actual_key_here
```

5. **重启应用**
```bash
pm2 restart silas-chat
pm2 logs silas-chat  # 查看日志
```

6. **访问应用**
```
http://70.39.202.75
```

---

### 方案 B：Docker 部署（更安全、推荐）

**优点**: 隔离环境、便于维护、方便迁移  
**缺点**: 需要先安装 Docker

#### 步骤：

1. **连接到服务器**
```bash
ssh root@70.39.202.75
```

2. **安装 Docker 和 Docker Compose**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 安装 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 验证
docker --version
docker-compose --version
```

3. **克隆项目**
```bash
git clone https://github.com/your-username/silas-chat.git
cd silas-chat
```

4. **创建 .env 文件**
```bash
cat > .env << 'EOF'
PORT=3000
SUPABASE_URL=https://eiemscirhjupatfngmfq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_actual_key_here
OPENAI_API_KEY=your_actual_key_here
OPENAI_MODEL=gpt-4o-mini
CHAT_BG_STORAGE_BUCKET=touxiang
SILAS_PROACTIVE_ENABLED=1
SILAS_PROACTIVE_TZ=Asia/Shanghai
EOF
```

5. **启动应用**
```bash
docker-compose up -d

# 查看日志
docker-compose logs -f silas-chat

# 查看容器状态
docker-compose ps
```

6. **访问应用**
```
http://70.39.202.75
```

---

## 📝 常用命令

### PM2 方案
```bash
# 查看进程
pm2 status

# 查看日志
pm2 logs silas-chat

# 重启应用
pm2 restart silas-chat

# 停止应用
pm2 stop silas-chat

# 删除应用
pm2 delete silas-chat

# 应用崩溃时自动重启
pm2 plus silas-chat  # 监控应用
```

### Docker 方案
```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 查看日志
docker-compose logs -f

# 进入容器
docker-compose exec silas-chat sh

# 更新应用
git pull origin master
docker-compose up -d --build
```

---

## 🔐 安全建议

1. **配置防火墙**
```bash
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS（如果使用）
ufw enable
```

2. **配置 HTTPS（Let's Encrypt）**
```bash
apt-get install -y certbot python3-certbot-nginx
certbot certonly --standalone -d your-domain.com
```

3. **定期备份**
```bash
# 备份数据库和配置
tar -czf silas-backup-$(date +%Y%m%d).tar.gz /opt/silas-chat
```

4. **监控应用**
```bash
# 使用 PM2 Plus（需要注册）
pm2 link secret-key public-key
```

---

## 🐛 故障排查

### 应用无法启动
```bash
# 查看详细日志
pm2 logs silas-chat --lines 100

# 检查端口占用
netstat -tlnp | grep 3000

# 检查 Node.js 版本
node --version  # 应该是 v20.x
```

### 无法连接到 Supabase
```bash
# 检查 .env 文件配置
cat /opt/silas-chat/.env

# 测试网络连接
curl -I https://eiemscirhjupatfngmfq.supabase.co
```

### Nginx 错误
```bash
# 测试配置
nginx -t

# 查看日志
tail -f /var/log/nginx/error.log

# 重启 Nginx
systemctl restart nginx
```

---

## 📈 性能优化

1. **增加 Node.js 进程数**
```bash
pm2 start src/app.js --instances 4 --name silas-chat
```

2. **启用 Nginx 缓存**
已在 nginx.conf 中配置

3. **使用 PM2 集群模式**
```bash
pm2 start src/app.js -i max --name silas-chat
```

---

## 🆘 需要帮助？

- 查看应用日志：`pm2 logs silas-chat`
- 检查服务器状态：`systemctl status nginx`
- SSH 连接测试：`ssh -v root@70.39.202.75`

---

**最后一步**：将项目推送到 GitHub（如果还未推送）
```bash
git add .
git commit -m "Add deployment files"
git push -u origin master
```
