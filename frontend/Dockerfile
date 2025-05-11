# ビルドステージ
FROM node:18-alpine as build

WORKDIR /app

# npmのキャッシュをクリアするための環境変数
ENV npm_config_cache=/tmp/npm_cache

# 依存関係のインストール（キャッシュなし）
COPY package*.json ./
RUN npm install --no-cache && npm cache clean --force

# アプリケーションのコピー
COPY . .

# 環境変数の設定
# .envファイルから環境変数を読み込む
# デフォルトでは/apiを使用（Nginxがプロキシする）
ENV REACT_APP_API_URL=/api

# アプリケーションのビルド
RUN npm run build

# 実行ステージ
FROM nginx:alpine

# ビルドしたアプリケーションをNginxのHTMLディレクトリにコピー
COPY --from=build /app/build /usr/share/nginx/html

# Nginxの設定ファイルをコピー
COPY nginx.conf /etc/nginx/conf.d/default.conf

# ポートの公開
EXPOSE 80

# Nginxの起動
CMD ["nginx", "-g", "daemon off;"]
