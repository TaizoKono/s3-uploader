# AWS S3 ファイルアップローダー

AWS S3にファイルをアップロードするためのDockerコンテナ化されたアプリケーションです。大容量ファイル（数十GB）の効率的なアップロードに対応しています。

## 機能

- マルチパートアップロード: 大きなファイルを複数の小さなパートに分割してアップロード
- プレフィックス分散: S3のパフォーマンス最適化のためのキー設計
- Amazon S3 Transfer Acceleration: 長距離ネットワーク転送の高速化
- 進捗表示: リアルタイムのアップロード進捗状況の表示
- Dockerコンテナ化: 簡単なデプロイと環境の一貫性を確保

## 技術スタック

- **フロントエンド**: React
- **バックエンド**: Node.js, Express
- **AWS SDK**: AWS SDK for JavaScript v3
- **コンテナ化**: Docker, Docker Compose
- **Webサーバー**: Nginx

## 前提条件

- Docker
- Docker Compose
- AWS S3バケット（Transfer Accelerationが有効化されていることが望ましい）

## セットアップと実行

### ローカル環境での実行

1. リポジトリをクローン

```bash
git clone <repository-url>
cd s3-uploader
```

2. 環境変数の設定

```bash
# バックエンドの環境変数を設定
cp backend/.env.example backend/.env
# .envファイルを編集して、AWS認証情報とS3バケット名を設定
```

3. アプリケーションのビルドと起動

```bash
docker-compose build
docker-compose up -d
```

4. ブラウザでアクセス

```
http://localhost
```

### EC2などの本番環境へのデプロイ

1. リポジトリをクローン

```bash
git clone <repository-url>
cd s3-uploader
```

2. 環境変数の設定

```bash
# バックエンドの環境変数を設定
cp backend/.env.example backend/.env
# .envファイルを編集して、AWS認証情報とS3バケット名を設定
```

3. アプリケーションのビルドと起動

```bash
docker-compose build
docker-compose up -d
```

4. ブラウザでアクセス

```
http://<EC2-インスタンスのIPアドレスまたはドメイン名>
```

### 更新とメンテナンス

アプリケーションを更新する場合は、以下のコマンドを実行します：

```bash
# 最新のコードを取得
git pull

# コンテナを停止
docker-compose down

# イメージを再ビルド（変更がある場合）
docker-compose build --no-cache

# コンテナを起動
docker-compose up -d
```

### キャッシュ管理

このアプリケーションは、ビルド時にDockerおよびnpmのキャッシュが蓄積しないように設計されています：

- Dockerfileでは、npmのキャッシュを一時ディレクトリに設定し、インストール後にキャッシュをクリアします
- docker-compose.ymlでは、ビルド時にDockerのキャッシュを使用しないように設定しています
- ビルド時に`--no-cache`オプションを使用することで、常に最新の依存関係がインストールされます

これにより、ディスク容量の節約とクリーンなビルド環境の維持が可能になります。

### トラブルシューティング

問題が発生した場合は、以下のコマンドでログを確認できます：

```bash
# すべてのコンテナのログを表示
docker-compose logs

# 特定のサービスのログを表示（例：バックエンド）
docker-compose logs backend

# リアルタイムでログを表示
docker-compose logs -f
```

## S3バケットの設定

このアプリケーションを使用するには、S3バケットに以下の設定が必要です：

1. **CORS設定**

```json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT", "POST", "GET"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": ["ETag"]
    }
  ]
}
```

2. **Transfer Acceleration**

S3バケットのプロパティから「Transfer Acceleration」を有効化することで、アップロード速度を向上させることができます。

## 環境変数

バックエンドサービスは以下の環境変数を使用します：

- `AWS_ACCESS_KEY_ID`: AWS IAMアクセスキー
- `AWS_SECRET_ACCESS_KEY`: AWS IAMシークレットアクセスキー
- `AWS_REGION`: AWSリージョン（デフォルト: ap-northeast-1）
- `S3_BUCKET`: S3バケット名
- `PORT`: バックエンドサーバーのポート（デフォルト: 3001）

### 環境変数の設定方法

1. バックエンドディレクトリに`.env.example`ファイルをコピーして`.env`ファイルを作成します：

```bash
cp backend/.env.example backend/.env
```

2. `.env`ファイルを編集して、実際の値を設定します：

```
# AWS認証情報
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=ap-northeast-1

# S3バケット設定
S3_BUCKET=your_bucket_name

# サーバー設定
PORT=3001
```

3. Docker Composeは自動的に`.env`ファイルから環境変数を読み込みます。

## アーキテクチャ

このアプリケーションは以下のコンポーネントで構成されています：

1. **フロントエンド（React）**
   - ファイル選択インターフェース
   - アップロード進捗表示
   - 完了通知

2. **バックエンド（Node.js/Express）**
   - S3マルチパートアップロードの管理
   - 署名付きURLの生成
   - CORSの設定

3. **Nginx**
   - 静的ファイルの配信
   - APIリクエストのプロキシ
   - 大容量ファイルのアップロード対応

## パフォーマンス最適化

- **チャンクサイズ**: デフォルトで5MBに設定されていますが、ネットワーク環境に応じて調整可能です
- **並列アップロード**: 複数のパートを同時にアップロードすることで転送速度を向上
- **プレフィックス分散**: ランダムなプレフィックスを使用してS3のパフォーマンスを最適化
- **Transfer Acceleration**: CloudFrontのエッジロケーションを活用して転送速度を向上

## 注意事項

- 認証情報はデモンストレーション目的で含まれています。実際の運用では環境変数や安全な認証情報管理サービスを使用してください。
- 大容量ファイルのアップロードはネットワーク帯域幅に依存します。
- EC2にデプロイする場合は、以下の点に注意してください：
  - セキュリティグループで必要なポート（80, 3001）を開放してください。
  - インスタンスタイプによってはディスク容量やメモリに制限があるため、大容量ファイルを扱う場合は適切なインスタンスタイプを選択してください。
  - 長時間のアップロードを行う場合は、EC2インスタンスの自動停止設定を無効にしてください。
  - EBSボリュームの容量が十分であることを確認してください。
- 本番環境では、HTTPS（SSL/TLS）を使用することを強く推奨します。Nginxの設定を変更して、SSL証明書を設定してください。
