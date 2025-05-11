require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');
const { 
  configureCors, 
  initiateMultipartUpload, 
  uploadPart, 
  completeMultipartUpload, 
  abortMultipartUpload,
  getSignedUrlForPart,
  listFiles,
  getDownloadUrl,
  deleteFile
} = require('./s3Service');

const app = express();
const PORT = process.env.PORT || 3001;

// ミドルウェア
app.use(cors({
  origin: '*', // すべてのオリジンを許可
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true,
  maxAge: 86400 // プリフライトリクエストのキャッシュ時間（秒）
}));
app.use(express.json({ limit: '50gb' }));
app.use(express.urlencoded({ extended: true, limit: '50gb' }));
app.use(morgan('dev'));
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50GB制限
  abortOnLimit: false,
  responseOnLimit: 'File size limit has been reached'
}));

// タイムアウト設定
app.use((req, res, next) => {
  // リクエストタイムアウトを30分に設定
  req.setTimeout(1800000);
  // レスポンスタイムアウトを30分に設定
  res.setTimeout(1800000);
  next();
});

// 一時ディレクトリの作成
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// ルート
app.get('/', (req, res) => {
  res.json({ message: 'S3 Uploader API is running' });
});

// CORSの設定
app.post('/api/configure-cors', async (req, res) => {
  try {
    await configureCors();
    res.json({ message: 'CORS configured successfully' });
  } catch (error) {
    console.error('Error configuring CORS:', error);
    res.status(500).json({ error: 'Failed to configure CORS' });
  }
});

// マルチパートアップロードの開始
app.post('/api/initiate-upload', async (req, res) => {
  try {
    let { fileName, contentType } = req.body;
    
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    // コンテンツタイプが指定されていない場合、ファイル名から推測
    if (!contentType) {
      // ファイル名から拡張子を取得
      const fileExtension = fileName.split('.').pop().toLowerCase();
      // 拡張子に基づいてMIMEタイプを設定
      switch (fileExtension) {
        case 'pdf':
          contentType = 'application/pdf';
          break;
        case 'jpg':
        case 'jpeg':
          contentType = 'image/jpeg';
          break;
        case 'png':
          contentType = 'image/png';
          break;
        case 'gif':
          contentType = 'image/gif';
          break;
        case 'txt':
          contentType = 'text/plain';
          break;
        case 'doc':
          contentType = 'application/msword';
          break;
        case 'docx':
          contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          break;
        case 'xls':
          contentType = 'application/vnd.ms-excel';
          break;
        case 'xlsx':
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          break;
        case 'zip':
          contentType = 'application/zip';
          break;
        default:
          // 拡張子がない場合や不明な拡張子の場合はバイナリとして扱う
          contentType = 'application/octet-stream';
      }
    }

    console.log(`Initiating upload for file: ${fileName}, Content type: ${contentType}`);
    const { uploadId, key } = await initiateMultipartUpload(fileName, contentType);
    
    res.json({
      uploadId,
      key,
      message: 'Multipart upload initiated successfully'
    });
  } catch (error) {
    console.error('Error initiating upload:', error);
    res.status(500).json({ error: 'Failed to initiate upload' });
  }
});

// 署名付きURLの取得（クライアント側でのアップロード用）
app.get('/api/get-signed-url', async (req, res) => {
  try {
    const { key, uploadId, partNumber } = req.query;
    
    if (!key || !uploadId || !partNumber) {
      return res.status(400).json({ error: 'key, uploadId, and partNumber are required' });
    }

    const signedUrl = await getSignedUrlForPart(key, uploadId, parseInt(partNumber, 10));
    
    res.json({
      signedUrl,
      partNumber: parseInt(partNumber, 10)
    });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: 'Failed to generate signed URL' });
  }
});

// サーバー側でのパートアップロード
app.post('/api/upload-part', async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { key, uploadId, partNumber } = req.body;
    
    if (!key || !uploadId || !partNumber) {
      return res.status(400).json({ error: 'key, uploadId, and partNumber are required' });
    }

    const file = req.files.file;
    const fileBuffer = fs.readFileSync(file.tempFilePath);
    
    const result = await uploadPart(key, uploadId, parseInt(partNumber, 10), fileBuffer);
    
    // 一時ファイルの削除
    fs.unlinkSync(file.tempFilePath);
    
    res.json({
      etag: result.ETag,
      partNumber: parseInt(partNumber, 10)
    });
  } catch (error) {
    console.error('Error uploading part:', error);
    res.status(500).json({ error: 'Failed to upload part' });
  }
});

// マルチパートアップロードの完了
app.post('/api/complete-upload', async (req, res) => {
  try {
    const { key, uploadId, parts } = req.body;
    
    if (!key || !uploadId || !parts || !Array.isArray(parts)) {
      return res.status(400).json({ error: 'key, uploadId, and parts array are required' });
    }

    // パートの数をチェック
    if (parts.length === 0) {
      return res.status(400).json({ error: 'No parts provided for completion' });
    }

    // パートの形式をチェック
    for (const part of parts) {
      if (!part.ETag || !part.PartNumber) {
        return res.status(400).json({ error: 'Invalid part format. Each part must have ETag and PartNumber' });
      }
    }

    console.log(`Completing upload for key: ${key}, uploadId: ${uploadId}, parts: ${parts.length}`);
    
    const location = await completeMultipartUpload(key, uploadId, parts);
    
    res.json({
      location,
      message: 'Upload completed successfully'
    });
  } catch (error) {
    console.error('Error completing upload:', error);
    
    // エラーメッセージをクライアントに返す
    let errorMessage = 'Failed to complete upload';
    if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

// マルチパートアップロードの中止
app.post('/api/abort-upload', async (req, res) => {
  try {
    const { key, uploadId } = req.body;
    
    if (!key || !uploadId) {
      return res.status(400).json({ error: 'key and uploadId are required' });
    }

    await abortMultipartUpload(key, uploadId);
    
    res.json({
      message: 'Upload aborted successfully'
    });
  } catch (error) {
    console.error('Error aborting upload:', error);
    res.status(500).json({ error: 'Failed to abort upload' });
  }
});

// ファイル一覧の取得
app.get('/api/files', async (req, res) => {
  try {
    const { prefix } = req.query;
    const files = await listFiles(prefix || '');
    
    res.json({
      files,
      count: files.length
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// ダウンロード用の署名付きURLの取得
app.get('/api/download-url', async (req, res) => {
  try {
    const { key } = req.query;
    
    if (!key) {
      return res.status(400).json({ error: 'key is required' });
    }

    const downloadUrl = await getDownloadUrl(key);
    
    res.json({
      downloadUrl
    });
  } catch (error) {
    console.error('Error generating download URL:', error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// ファイルの削除
app.delete('/api/files', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({ error: 'key is required' });
    }

    const result = await deleteFile(key);
    
    res.json(result);
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
