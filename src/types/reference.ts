import type { StyleAnalyzeResult } from './style';

export type ReferenceEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

export type ReferencePurpose = 'style' | 'research' | 'inspiration';

export type ReferenceSourceStatus = 'available' | 'outdated' | 'missing';

export type ReferenceDuplicateAction = 'skip' | 'createWork' | 'createVersion';

export interface ReferenceWork {
  id: string;
  novelId: string;
  title: string;
  purpose: ReferencePurpose;
  description?: string;
  activeImportId: string;
  activeSourceHash: string;
  revision: number;
  sourceStatus: ReferenceSourceStatus;
  sectionCount: number;
  totalChars: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceImport {
  id: string;
  workId: string;
  novelId: string;
  version: number;
  isCurrent: boolean;
  operationId: string;
  fileName: string;
  fileType: 'txt';
  sourceFilePath?: string;
  encoding: ReferenceEncoding;
  detectedEncoding?: ReferenceEncoding;
  encodingSource: ReferenceFileAnalysis['encodingSource'];
  sourceHash: string;
  decodedTextHash: string;
  sourceByteLength: number;
  decodedUtf8ByteLength: number;
  totalChars: number;
  sectionCount: number;
  parserVersion: string;
  sectionPlanHash: string;
  warnings: string[];
  importedAt: string;
}

export interface ReferenceSectionMetadata {
  id: string;
  importId: string;
  workId: string;
  novelId: string;
  orderIndex: number;
  title: string;
  contentHash: string;
  charCount: number;
  utf8ByteLength?: number;
  contentStorage?: 'inline' | 'large_text';
  sourceStartUtf16: number;
  sourceEndUtf16: number;
}

export interface ReferenceSection extends ReferenceSectionMetadata {
  content: string;
}

export interface ReferenceSectionPage {
  items: ReferenceSectionMetadata[];
  total: number;
  offset: number;
  limit: number;
}

export interface ReferenceWorkBundle {
  work: ReferenceWork;
  imports: ReferenceImport[];
  sections: ReferenceSectionMetadata[];
  sectionTotal: number;
  sectionOffset: number;
  sectionLimit: number;
}

/** Explicit compatibility DTO; never use this for a default library read. */
export interface ReferenceWorkBundleLegacy {
  work: ReferenceWork;
  imports: ReferenceImport[];
  sections: ReferenceSection[];
}

export interface ReferenceDuplicateMatch {
  workId: string;
  workTitle: string;
  importId: string;
  importVersion: number;
  isCurrent: boolean;
  importedAt: string;
}

export interface InspectReferenceDuplicateResult {
  novelId: string;
  sourceHash: string;
  matches: ReferenceDuplicateMatch[];
}

export interface ImportReferenceWorkInput {
  operationId: string;
  novelId: string;
  duplicateAction: ReferenceDuplicateAction;
  duplicateImportId?: string;
  workId?: string;
  title?: string;
  purpose?: ReferencePurpose;
  description?: string;
  sourceFilePath?: string;
  analysis: ReferenceFileAnalysis;
}

export interface ImportReferenceWorkResult {
  action: ReferenceDuplicateAction;
  bundle: ReferenceWorkBundle;
  created: boolean;
}

export interface ReferenceSectionDraft {
  orderIndex: number;
  title: string;
  content: string;
  contentHash: string;
  charCount: number;
  sourceStartUtf16: number;
  sourceEndUtf16: number;
}

export interface ReferenceFileAnalysis {
  fileName: string;
  encoding: ReferenceEncoding;
  encodingSource: 'bom' | 'utf8_valid' | 'fallback' | 'user_override';
  sourceHash: string;
  decodedTextHash: string;
  sourceByteLength: number;
  decodedUtf8ByteLength: number;
  totalChars: number;
  parserVersion: string;
  sectionPlanHash: string;
  sections: ReferenceSectionDraft[];
  warnings: string[];
  text: string;
}

export type StyleSampleLayer =
  'opening' | 'development' | 'dialogue_dense' | 'description_dense' | 'climax' | 'closing';

export interface StyleSampleRange {
  sectionId: string;
  sectionOrderIndex: number;
  sectionTitle: string;
  startUtf16: number;
  endUtf16: number;
  contentHash: string;
  layers: StyleSampleLayer[];
}

export interface LayeredStyleSample extends StyleSampleRange {
  sampleId: string;
  content: string;
  charCount: number;
  dialogueDensity: number;
}

export interface StyleMetricConfidence {
  overall: number;
  byField: Record<string, number>;
  lowConfidenceFields: string[];
}

export interface LayeredStyleResult {
  analyzerVersion: 'layered_style_analyzer_v1';
  promptVersion: string;
  model: {
    runtimeMode: 'mock' | 'api';
    provider: string;
    modelName: string;
  };
  sourceWorkId: string;
  sourceImportId: string;
  sourceHash: string;
  samples: StyleSampleRange[];
  layerResults: Array<{
    sampleId: string;
    layers: StyleSampleLayer[];
    profile: StyleAnalyzeResult;
  }>;
  mergedProfile: StyleAnalyzeResult;
  confidence: StyleMetricConfidence;
}
