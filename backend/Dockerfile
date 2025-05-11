FROM node:18-alpine

WORKDIR /app

# npmのキャッシュをクリアするための環境変数
ENV npm_config_cache=/tmp/npm_cache

# 依存関係のインストール（キャッシュなし）
COPY package*.json ./
RUN npm install --no-cache && npm cache clean --force

# アプリケーションのコピー
COPY . .

# 一時ディレクトリの作成
RUN mkdir -p /app/temp /tmp

# ポートの公開
EXPOSE 3001

# アプリケーションの起動
CMD ["node", "server.js"]
