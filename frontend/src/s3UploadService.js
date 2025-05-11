import axios from 'axios';

// タイムアウト設定を増やしたAxiosインスタンスを作成
const api = axios.create({
  timeout: 300000, // 5分
  maxContentLength: Infinity,
  maxBodyLength: Infinity
});

const API_URL = process.env.REACT_APP_API_URL || '/api';

// チャンクサイズ（S3のマルチパートアップロードでは最大10000パートまでしかアップロードできない）
// 100GBのファイルを10000パート以下にするには、チャンクサイズを最低10MBにする必要がある
// 安全のため、チャンクサイズを大きめに設定
const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

// 並列アップロード数の制限
const MAX_CONCURRENT_UPLOADS = 5;

// マルチパートアップロードの開始
export const initiateMultipartUpload = async (fileName, contentType) => {
  try {
    const response = await api.post(`${API_URL}/initiate-upload`, {
      fileName,
      contentType
    });
    return response.data;
  } catch (error) {
    console.error('Error initiating multipart upload:', error);
    throw error;
  }
};

// 署名付きURLの取得
export const getSignedUrl = async (key, uploadId, partNumber) => {
  try {
    const response = await api.get(`${API_URL}/get-signed-url`, {
      params: {
        key,
        uploadId,
        partNumber
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw error;
  }
};

// パートのアップロード（署名付きURL使用）
export const uploadPart = async (signedUrl, part, onProgress) => {
  try {
    // 署名付きURLへのアップロードには長いタイムアウトを設定
    const response = await api.put(signedUrl, part, {
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      timeout: 600000, // 10分
      onUploadProgress: (progressEvent) => {
        if (onProgress) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      }
    });
    
    return {
      ETag: response.headers.etag,
      PartNumber: parseInt(response.config.params?.partNumber || 1, 10)
    };
  } catch (error) {
    console.error('Error uploading part:', error);
    throw error;
  }
};

// マルチパートアップロードの完了
export const completeMultipartUpload = async (key, uploadId, parts) => {
  try {
    const response = await api.post(`${API_URL}/complete-upload`, {
      key,
      uploadId,
      parts
    });
    return response.data;
  } catch (error) {
    console.error('Error completing multipart upload:', error);
    throw error;
  }
};

// マルチパートアップロードの中止
export const abortMultipartUpload = async (key, uploadId) => {
  try {
    const response = await api.post(`${API_URL}/abort-upload`, {
      key,
      uploadId
    });
    return response.data;
  } catch (error) {
    console.error('Error aborting multipart upload:', error);
    throw error;
  }
};

// ファイルをチャンクに分割
export const sliceFile = (file, chunkSize = CHUNK_SIZE) => {
  const chunks = [];
  let start = 0;
  
  while (start < file.size) {
    const end = Math.min(start + chunkSize, file.size);
    chunks.push(file.slice(start, end));
    start = end;
  }
  
  return chunks;
};

// ファイルのアップロード（メイン関数）
export const uploadFile = async (file, onProgress, onPartComplete) => {
  try {
    // ファイルタイプの決定（空の場合はデフォルト値を設定）
    let contentType = file.type;
    if (!contentType || contentType === '') {
      // ファイル名から拡張子を取得
      const fileExtension = file.name.split('.').pop().toLowerCase();
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

    console.log(`File name: ${file.name}, Content type: ${contentType}`);
    
    // マルチパートアップロードの開始
    const { uploadId, key } = await initiateMultipartUpload(file.name, contentType);
    
    // ファイルをチャンクに分割
    const chunks = sliceFile(file);
    const totalChunks = chunks.length;
    
    console.log(`Uploading file: ${file.name}, Total chunks: ${totalChunks}`);
    
    // S3のマルチパートアップロードでは最大10000パートまでしかアップロードできない
    if (totalChunks > 10000) {
      throw new Error(`ファイルが大きすぎます。S3のマルチパートアップロードでは最大10000パートまでしかアップロードできません。現在のチャンク数: ${totalChunks}`);
    }
    
    // 各パートのアップロード結果を保存する配列
    const completedParts = [];
    
    // 並列アップロード数を制限するための関数
    const uploadPartsWithConcurrencyLimit = async () => {
      // 結果を保存する配列（インデックスはパート番号-1）
      const results = new Array(chunks.length);
      // 失敗したパートを追跡
      const failedParts = [];
      
      // チャンクを処理するための関数
      const processChunks = async () => {
        // チャンクを一定数ずつ処理
        for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_UPLOADS) {
          const chunkBatch = chunks.slice(i, i + MAX_CONCURRENT_UPLOADS);
          const startIndex = i;
          
          console.log(`Processing batch ${i / MAX_CONCURRENT_UPLOADS + 1} of ${Math.ceil(chunks.length / MAX_CONCURRENT_UPLOADS)}`);
          
          // バッチ内のチャンクを並列でアップロード
          const promises = chunkBatch.map(async (chunk, batchIndex) => {
            const index = startIndex + batchIndex;
            const partNumber = index + 1;
            
            try {
              // 署名付きURLの取得
              const { signedUrl } = await getSignedUrl(key, uploadId, partNumber);
              
              // パートのアップロード
              const partProgress = (percent) => {
                if (onProgress) {
                  // 全体の進捗を計算
                  const overallProgress = ((index + (percent / 100)) / totalChunks) * 100;
                  onProgress(Math.min(Math.round(overallProgress), 99)); // 完了前は99%まで
                }
              };
              
              const result = await uploadPart(signedUrl, chunk, partProgress);
              
              // 完了したパートの情報を保存
              const completedPart = {
                ETag: result.ETag,
                PartNumber: partNumber
              };
              
              completedParts.push(completedPart);
              
              if (onPartComplete) {
                onPartComplete(partNumber, totalChunks);
              }
              
              results[index] = completedPart;
              return { success: true, partNumber };
            } catch (error) {
              console.error(`Error uploading part ${partNumber}:`, error);
              failedParts.push(partNumber);
              return { success: false, partNumber, error };
            }
          });
          
          // バッチ内のすべてのアップロードが完了するのを待つ
          const batchResults = await Promise.all(promises);
          
          // 失敗したパートがあれば再試行
          const failedInBatch = batchResults.filter(r => !r.success);
          if (failedInBatch.length > 0) {
            console.log(`${failedInBatch.length} parts failed in this batch. Retrying...`);
            
            // 失敗したパートを最大3回まで再試行
            for (const failed of failedInBatch) {
              let retries = 0;
              let success = false;
              
              while (retries < 3 && !success) {
                try {
                  retries++;
                  console.log(`Retrying part ${failed.partNumber}, attempt ${retries}`);
                  
                  const partIndex = failed.partNumber - 1;
                  const chunk = chunks[partIndex];
                  
                  // 署名付きURLの再取得
                  const { signedUrl } = await getSignedUrl(key, uploadId, failed.partNumber);
                  
                  // パートの再アップロード
                  const result = await uploadPart(signedUrl, chunk, () => {});
                  
                  // 完了したパートの情報を保存
                  const completedPart = {
                    ETag: result.ETag,
                    PartNumber: failed.partNumber
                  };
                  
                  // 既存のエントリを更新または追加
                  const existingIndex = completedParts.findIndex(p => p.PartNumber === failed.partNumber);
                  if (existingIndex >= 0) {
                    completedParts[existingIndex] = completedPart;
                  } else {
                    completedParts.push(completedPart);
                  }
                  
                  if (onPartComplete) {
                    onPartComplete(failed.partNumber, totalChunks);
                  }
                  
                  results[partIndex] = completedPart;
                  success = true;
                  
                  // 失敗リストから削除
                  const failedIndex = failedParts.indexOf(failed.partNumber);
                  if (failedIndex >= 0) {
                    failedParts.splice(failedIndex, 1);
                  }
                } catch (error) {
                  console.error(`Retry failed for part ${failed.partNumber}, attempt ${retries}:`, error);
                  if (retries >= 3) {
                    console.error(`All retries failed for part ${failed.partNumber}`);
                  }
                }
              }
            }
          }
        }
      };
      
      // チャンクの処理を実行
      await processChunks();
      
      // 失敗したパートがあるかチェック
      if (failedParts.length > 0) {
        console.error(`${failedParts.length} parts failed after all retries`);
        throw new Error(`${failedParts.length} parts failed to upload after multiple retries`);
      }
      
      return results.filter(Boolean); // nullや未定義の要素を除去
    };
    
    // 並列アップロード数を制限してアップロード
    const uploadResults = await uploadPartsWithConcurrencyLimit();
    
    // アップロードされたパートの数をチェック
    if (uploadResults.length !== chunks.length) {
      console.error(`Not all parts were uploaded: ${uploadResults.length}/${chunks.length}`);
      throw new Error(`一部のパートのアップロードに失敗しました: ${uploadResults.length}/${chunks.length}`);
    }
    
    // パート番号でソート
    completedParts.sort((a, b) => a.PartNumber - b.PartNumber);
    
    // マルチパートアップロードの完了
    const result = await completeMultipartUpload(key, uploadId, completedParts);
    
    if (onProgress) {
      onProgress(100); // 完了
    }
    
    return result;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};

// CORSの設定
export const configureCors = async () => {
  try {
    const response = await api.post(`${API_URL}/configure-cors`);
    return response.data;
  } catch (error) {
    console.error('Error configuring CORS:', error);
    throw error;
  }
};

// ファイル一覧の取得
export const listFiles = async (prefix = '') => {
  try {
    const response = await api.get(`${API_URL}/files`, {
      params: { prefix }
    });
    return response.data;
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
};

// ダウンロード用の署名付きURLの取得
export const getDownloadUrl = async (key) => {
  try {
    const response = await api.get(`${API_URL}/download-url`, {
      params: { key }
    });
    return response.data.downloadUrl;
  } catch (error) {
    console.error('Error getting download URL:', error);
    throw error;
  }
};

// ファイルの削除
export const deleteFile = async (key) => {
  try {
    const response = await api.delete(`${API_URL}/files`, {
      data: { key }
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};
