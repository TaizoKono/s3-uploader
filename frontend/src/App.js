import React, { useState, useEffect } from 'react';
import { uploadFile, configureCors, listFiles, getDownloadUrl, deleteFile } from './s3UploadService';
import './App.css';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadedParts, setUploadedParts] = useState([]);
  const [totalParts, setTotalParts] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [error, setError] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' or 'files'
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [selectedFileUrl, setSelectedFileUrl] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [sortField, setSortField] = useState('fileName'); // ソートするフィールド
  const [sortDirection, setSortDirection] = useState('asc'); // ソートの方向
  const [searchTerm, setSearchTerm] = useState(''); // 検索キーワード

  // コンポーネントマウント時にCORS設定を適用
  useEffect(() => {
    const setupCors = async () => {
      try {
        await configureCors();
        console.log('CORS configured successfully');
      } catch (error) {
        console.error('Failed to configure CORS:', error);
        setError('CORS設定に失敗しました。管理者に連絡してください。');
      }
    };

    setupCors();
  }, []);

  // ファイル選択ハンドラ
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setProgress(0);
      setUploadStatus('');
      setUploadedParts([]);
      setTotalParts(0);
      setUploadedUrl('');
      setError('');
    }
  };

  // アップロードハンドラ
  const handleUpload = async () => {
    if (!selectedFile) {
      setError('ファイルを選択してください');
      return;
    }

    // ファイルサイズの制限（100GB）
    const MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024; // 100GB
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError('ファイルサイズが制限（100GB）を超えています。より小さいファイルを選択してください。');
      return;
    }

    setUploading(true);
    setProgress(0);
    setUploadStatus('アップロードを開始しています...');
    setError('');
    setUploadedParts([]);
    setTotalParts(0);

    try {
      // 進捗状況のコールバック
      const onProgress = (percent) => {
        setProgress(percent);
      };

      // パート完了のコールバック
      const onPartComplete = (partNumber, total) => {
        setUploadedParts((prev) => [...prev, partNumber]);
        setTotalParts(total);
        setUploadStatus(`パート ${partNumber}/${total} 完了`);
      };

      // ファイルアップロード
      const result = await uploadFile(selectedFile, onProgress, onPartComplete);
      
      setUploadStatus('アップロード完了！');
      setUploadedUrl(result.location);
    } catch (error) {
      console.error('Upload failed:', error);
      setError(`アップロードに失敗しました: ${error.message}`);
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  // ファイルサイズのフォーマット
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // ファイル一覧を取得
  const fetchFiles = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await listFiles();
      setFiles(response.files);
    } catch (error) {
      console.error('Error fetching files:', error);
      setError('ファイル一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // ファイルをダウンロード
  const handleDownload = async (key, fileName) => {
    try {
      const downloadUrl = await getDownloadUrl(key);
      
      // ダウンロードリンクを作成して自動クリック
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading file:', error);
      setError('ファイルのダウンロードに失敗しました');
    }
  };

  // 署名付きURLを取得して表示
  const handleGetUrl = async (key, fileName) => {
    try {
      setLoading(true);
      const downloadUrl = await getDownloadUrl(key);
      setSelectedFileUrl(downloadUrl);
      setSelectedFileName(fileName);
      setShowUrlModal(true);
    } catch (error) {
      console.error('Error getting download URL:', error);
      setError('ダウンロードURLの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // URLをクリップボードにコピー
  const handleCopyUrl = () => {
    // navigator.clipboardが利用可能かチェック
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(selectedFileUrl)
        .then(() => {
          alert('URLをクリップボードにコピーしました');
        })
        .catch(err => {
          console.error('URLのコピーに失敗しました:', err);
          // クリップボードAPIが失敗した場合は、手動でコピーするよう促す
          fallbackCopy();
        });
    } else {
      // クリップボードAPIが利用できない場合は、手動でコピーするよう促す
      fallbackCopy();
    }
  };

  // クリップボードAPIが利用できない場合の代替手段
  const fallbackCopy = () => {
    try {
      // URLの入力フィールドを取得
      const urlInput = document.querySelector('.url-input');
      if (urlInput) {
        // 入力フィールドを選択
        urlInput.select();
        // コピーコマンドを実行
        const successful = document.execCommand('copy');
        if (successful) {
          alert('URLをコピーしました。Ctrl+Vで貼り付けできます。');
        } else {
          alert('URLを選択しました。Ctrl+Cを押してコピーしてください。');
        }
      } else {
        alert('URLを手動で選択し、Ctrl+Cを押してコピーしてください。');
      }
    } catch (err) {
      console.error('手動コピーに失敗しました:', err);
      alert('URLを手動で選択し、Ctrl+Cを押してコピーしてください。');
      setError('URLのコピーに失敗しました。手動でコピーしてください。');
    }
  };

  // モーダルを閉じる
  const closeModal = () => {
    setShowUrlModal(false);
    setSelectedFileUrl('');
    setSelectedFileName('');
  };

  // ファイルを削除
  const handleDelete = async (key) => {
    if (window.confirm('このファイルを削除してもよろしいですか？')) {
      try {
        await deleteFile(key);
        // ファイル一覧を更新
        fetchFiles();
      } catch (error) {
        console.error('Error deleting file:', error);
        setError('ファイルの削除に失敗しました');
      }
    }
  };

  // タブ切り替え時にファイル一覧を取得
  useEffect(() => {
    if (activeTab === 'files') {
      fetchFiles();
    }
  }, [activeTab]);

  // 日付のフォーマット
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('ja-JP');
  };

  // アップロード完了後にファイル一覧を更新
  useEffect(() => {
    if (uploadedUrl && activeTab === 'upload') {
      // アップロード完了後、少し待ってからファイル一覧を更新
      const timer = setTimeout(() => {
        fetchFiles();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [uploadedUrl]);

  // ソート機能
  const handleSort = (field) => {
    // 同じフィールドをクリックした場合は、ソートの方向を切り替える
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // 異なるフィールドをクリックした場合は、そのフィールドで昇順ソート
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 検索機能
  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
  };

  // ファイル一覧のフィルタリングとソート
  const filteredAndSortedFiles = () => {
    // 検索フィルタリング
    let result = [...files];
    if (searchTerm) {
      result = result.filter(file => 
        file.fileName.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // ソート
    result.sort((a, b) => {
      let comparison = 0;
      
      // ソートフィールドに基づいて比較
      if (sortField === 'fileName') {
        comparison = a.fileName.localeCompare(b.fileName);
      } else if (sortField === 'size') {
        comparison = a.size - b.size;
      } else if (sortField === 'lastModified') {
        comparison = new Date(a.lastModified) - new Date(b.lastModified);
      }
      
      // ソート方向に基づいて結果を反転
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return result;
  };

  return (
    <div className="container">
      {/* タブ切り替え */}
      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          アップロード
        </button>
        <button 
          className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          ファイル一覧
        </button>
      </div>

      {/* アップロードタブ */}
      {activeTab === 'upload' && (
        <div className="card">
          <h2>ファイルアップロード</h2>
          <p>大容量ファイルを効率的にアップロードするためのツール</p>
          
          <div className="file-input">
            <input
              type="file"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {selectedFile && (
              <div>
                <p>選択されたファイル: {selectedFile.name}</p>
                <p>サイズ: {formatFileSize(selectedFile.size)}</p>
              </div>
            )}
          </div>
          
          <button
            className="btn"
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
          >
            {uploading ? 'アップロード中...' : 'アップロード'}
          </button>
          
          {progress > 0 && (
            <div className="progress-container">
              <div
                className="progress-bar"
                style={{ width: `${progress}%` }}
              >
                {progress}%
              </div>
            </div>
          )}
          
          {uploadStatus && <p>{uploadStatus}</p>}
          
          {totalParts > 0 && (
            <p>
              アップロード済みパート: {uploadedParts.length}/{totalParts}
            </p>
          )}
          
          {error && <p className="error">{error}</p>}
          
          {uploadedUrl && (
            <div className="success">
              <p>ファイルが正常にアップロードされました！</p>
              <p>URL: {uploadedUrl}</p>
            </div>
          )}
        </div>
      )}

      {/* ファイル一覧タブ */}
      {activeTab === 'files' && (
        <div className="card">
          <h2>アップロード済みファイル一覧</h2>
          
          <div className="files-controls">
            <button 
              className="btn refresh-btn"
              onClick={fetchFiles}
              disabled={loading}
            >
              更新
            </button>
            
            <div className="search-container">
              <input
                type="text"
                placeholder="ファイル名で検索..."
                value={searchTerm}
                onChange={handleSearch}
                className="search-input"
              />
            </div>
          </div>
          
          {loading ? (
            <p>読み込み中...</p>
          ) : files.length > 0 ? (
            <div className="files-table-container">
              <table className="files-table">
                <thead>
                  <tr>
                    <th 
                      className={`sortable ${sortField === 'fileName' ? 'sorted-' + sortDirection : ''}`}
                      onClick={() => handleSort('fileName')}
                    >
                      ファイル名
                      {sortField === 'fileName' && (
                        <span className="sort-indicator">
                          {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                        </span>
                      )}
                    </th>
                    <th 
                      className={`sortable ${sortField === 'size' ? 'sorted-' + sortDirection : ''}`}
                      onClick={() => handleSort('size')}
                    >
                      サイズ
                      {sortField === 'size' && (
                        <span className="sort-indicator">
                          {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                        </span>
                      )}
                    </th>
                    <th 
                      className={`sortable ${sortField === 'lastModified' ? 'sorted-' + sortDirection : ''}`}
                      onClick={() => handleSort('lastModified')}
                    >
                      最終更新日
                      {sortField === 'lastModified' && (
                        <span className="sort-indicator">
                          {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                        </span>
                      )}
                    </th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedFiles().map((file) => (
                    <tr key={file.key}>
                      <td>{file.fileName}</td>
                      <td>{formatFileSize(file.size)}</td>
                      <td>{formatDate(file.lastModified)}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-url"
                          onClick={() => handleGetUrl(file.key, file.fileName)}
                        >
                          URL取得
                        </button>
                        <button
                          className="btn btn-sm btn-delete"
                          onClick={() => handleDelete(file.key)}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>ファイルがありません</p>
          )}
          
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {/* URL表示モーダル */}
      {showUrlModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>ダウンロード用URL</h3>
              <button className="close-btn" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              <p>ファイル名: {selectedFileName}</p>
              <p>以下のURLを使用して、ファイルをダウンロードできます。このURLは3日間有効です。</p>
              <div className="url-container">
                <input
                  type="text"
                  value={selectedFileUrl}
                  readOnly
                  className="url-input"
                />
                <button className="btn btn-copy" onClick={handleCopyUrl}>
                  コピー
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={closeModal}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
