import type { StyleSampleLayer } from './reference';

/** Library is an actual task scope: it never carries or borrows novel authority. */
export type TaskScope =
  { kind: 'novel'; novelId: string } | { kind: 'library'; sourceId: string; sourceHash: string };

export interface StyleSampleSnapshot {
  sampleId: string;
  /** Only explicit global TXT input includes content; project ranges are read natively. */
  content?: string;
  contentHash: string;
  utf8ByteLength: number;
  sectionId?: string;
  startUtf16?: number;
  endUtf16?: number;
  layers?: StyleSampleLayer[];
}

export interface StyleSourceSnapshot {
  sourceId: string;
  contentHash: string;
  utf8ByteLength: number;
  samples: StyleSampleSnapshot[];
  reference?: { novelId: string; workId: string; importId: string; sourceHash: string };
}

export interface StyleRuntimeEntry {
  kind: 'style_analyze';
  source: StyleSourceSnapshot;
}
