/**
 * AI Novel Studio - 导入资产类型定义
 */

export interface ImportedAsset {
  id: string;
  novelId?: string;
  fileName: string;
  filePath?: string;
  fileType: 'txt' | 'json' | 'markdown' | 'other';
  assetType: 'style_reference' | 'novel_text' | 'config' | 'outline' | 'other';
  contentPreview?: string;
  parsedJson?: string;
  relatedStyleProfileId?: string;
  createdAt: string;
}

export interface CreateImportedAssetInput {
  novelId?: string;
  fileName: string;
  fileType: ImportedAsset['fileType'];
  assetType: ImportedAsset['assetType'];
  contentPreview?: string;
  parsedJson?: string;
}
