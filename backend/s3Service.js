const { 
  S3Client, 
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutBucketCorsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// S3クライアントの初期化
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  useAccelerateEndpoint: true, // Transfer Accelerationを有効化
  requestHandler: {
    // タイムアウト設定を増やす
    connectionTimeout: 300000, // 5分
    socketTimeout: 300000 // 5分
  },
  // 再試行設定
  maxAttempts: 5
});

const bucketName = process.env.S3_BUCKET;

// CORSの設定
const configureCors = async () => {
  try {
    const corsParams = {
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['PUT', 'POST', 'GET'],
            AllowedOrigins: ['*'],
            ExposeHeaders: ['ETag']
          }
        ]
      }
    };

    const command = new PutBucketCorsCommand(corsParams);
    await s3Client.send(command);
    console.log('CORS configuration applied successfully');
  } catch (error) {
    console.error('Error configuring CORS:', error);
    throw error;
  }
};

// マルチパートアップロードの開始
const initiateMultipartUpload = async (fileName, contentType) => {
  try {
    // プレフィックス分散のためにランダムなプレフィックスを生成
    const prefix = uuidv4().substring(0, 8);
    const key = `${prefix}/${fileName}`;

    const command = new CreateMultipartUploadCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType
    });

    const response = await s3Client.send(command);
    return {
      uploadId: response.UploadId,
      key
    };
  } catch (error) {
    console.error('Error initiating multipart upload:', error);
    throw error;
  }
};

// パートのアップロード
const uploadPart = async (key, uploadId, partNumber, body) => {
  try {
    const command = new UploadPartCommand({
      Bucket: bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body
    });

    const response = await s3Client.send(command);
    return {
      ETag: response.ETag,
      PartNumber: partNumber
    };
  } catch (error) {
    console.error(`Error uploading part ${partNumber}:`, error);
    throw error;
  }
};

// マルチパートアップロードの完了
const completeMultipartUpload = async (key, uploadId, parts) => {
  try {
    // パートが正しくソートされているか確認
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
    
    // パート番号が連続しているか確認
    for (let i = 0; i < sortedParts.length; i++) {
      if (sortedParts[i].PartNumber !== i + 1) {
        console.error(`Missing part: expected part ${i + 1}, but got part ${sortedParts[i].PartNumber}`);
        throw new Error(`Missing part: expected part ${i + 1}, but got part ${sortedParts[i].PartNumber}`);
      }
    }
    
    console.log(`Completing multipart upload for key: ${key}, uploadId: ${uploadId}, with ${parts.length} parts`);
    
    const command = new CompleteMultipartUploadCommand({
      Bucket: bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts
      }
    });

    const response = await s3Client.send(command);
    console.log(`Multipart upload completed successfully for key: ${key}`);
    return response.Location;
  } catch (error) {
    console.error('Error completing multipart upload:', error);
    
    // アップロードを中止して、部分的にアップロードされたデータをクリーンアップ
    try {
      console.log(`Aborting failed multipart upload for key: ${key}`);
      await abortMultipartUpload(key, uploadId);
    } catch (abortError) {
      console.error('Error aborting failed multipart upload:', abortError);
    }
    
    throw error;
  }
};

// マルチパートアップロードの中止
const abortMultipartUpload = async (key, uploadId) => {
  try {
    const command = new AbortMultipartUploadCommand({
      Bucket: bucketName,
      Key: key,
      UploadId: uploadId
    });

    await s3Client.send(command);
    console.log(`Multipart upload aborted for key: ${key}`);
  } catch (error) {
    console.error('Error aborting multipart upload:', error);
    throw error;
  }
};

// 署名付きURLの生成（パートアップロード用）
const getSignedUrlForPart = async (key, uploadId, partNumber) => {
  try {
    const command = new UploadPartCommand({
      Bucket: bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber
    });

    // 24時間有効な署名付きURL（大きなファイルのアップロードに対応）
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
    console.log(`Generated signed URL for part ${partNumber}, key: ${key}`);
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
};

// S3バケット内のファイル一覧を取得
const listFiles = async (prefix = '') => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix
    });

    const response = await s3Client.send(command);
    
    // ファイル情報を整形
    const files = response.Contents ? response.Contents.map(item => {
      // キーからファイル名を抽出（プレフィックスを除去）
      const keyParts = item.Key.split('/');
      const fileName = keyParts[keyParts.length - 1];
      
      return {
        key: item.Key,
        fileName: fileName,
        size: item.Size,
        lastModified: item.LastModified,
        etag: item.ETag
      };
    }) : [];
    
    return files;
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
};

// ダウンロード用の署名付きURLを生成
const getDownloadUrl = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });

    // 3日間（72時間）有効な署名付きURL
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 259200 }); // 3日間 = 3 * 24 * 60 * 60 = 259200秒
    console.log(`Generated download URL for key: ${key}`);
    return signedUrl;
  } catch (error) {
    console.error('Error generating download URL:', error);
    throw error;
  }
};

// ファイルを削除
const deleteFile = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key
    });

    await s3Client.send(command);
    console.log(`File deleted: ${key}`);
    return { success: true, message: 'File deleted successfully' };
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};

module.exports = {
  configureCors,
  initiateMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  getSignedUrlForPart,
  listFiles,
  getDownloadUrl,
  deleteFile
};
