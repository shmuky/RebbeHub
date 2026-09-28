import type { Catalog, EntityView } from './catalog.js';
import { getFile } from './files.js';
import { RIGHTS_BY_LICENCE, mayExport, type EntityId, type Licence, type ScanData, type TextData, type TextLayerData } from '@rebbehub/model';

/**
 * What may leave RebbeHub - served by the API or put in the open exports. Catalog facts always do
 * (CC0). Words do when their rights allow: a text copied from a source
 * keeps that source's licence (site-terms and commercial texts stay home),
 * community text is CC-BY-SA, and a scan's OCR pages follow the scan's
 * file. Files themselves are never in the exports, only their hashes.
 */
export class ExportGate {
  private readonly texts = new Map<string, string | null>();
  private readonly layers = new Map<string, string | null>();

  /** `at`: the commit whose rights apply; leave it out for main as it is now. */
  constructor(
    private readonly catalog: Catalog,
    private readonly at?: number,
  ) {}

  private view(id: EntityId) {
    return this.catalog.get(id, this.at === undefined ? {} : { at: this.at });
  }

  /**
   * An item as it may be shown: a segment of a withheld text loses its
   * words, a withheld OCR page its lines, and either says why.
   */
  async redact<T extends EntityView>(view: T): Promise<T & { withheld?: string }> {
    if (view.type === 'segment') {
      const reason = await this.textWithheld((view.data as { text: EntityId }).text);
      if (reason) return { ...view, withheld: reason, data: { ...(view.data as object), content: '' } as T['data'] };
    } else if (view.type === 'text-page') {
      const reason = await this.layerWithheld((view.data as { layer: EntityId }).layer);
      if (reason) return { ...view, withheld: reason, data: { ...(view.data as object), lines: [] } as T['data'] };
    }
    return view;
  }

  /** Why a text's words are withheld, or null when they may be exported. */
  async textWithheld(textId: EntityId, data?: TextData): Promise<string | null> {
    if (this.texts.has(textId)) return this.texts.get(textId)!;
    const text = data ?? ((await this.view(textId))?.data as unknown as TextData | undefined);
    let reason: string | null = null;
    if (text?.licence && !mayExport(RIGHTS_BY_LICENCE[text.licence as Licence])) reason = `its source's terms (${text.licence}) do not allow copies`;
    this.texts.set(textId, reason);
    return reason;
  }

  /** Why a text layer's pages are withheld, or null. */
  async layerWithheld(layerId: EntityId): Promise<string | null> {
    if (this.layers.has(layerId)) return this.layers.get(layerId)!;
    let reason: string | null = null;
    const layer = (await this.view(layerId))?.data as unknown as TextLayerData | undefined;
    const scan = layer ? ((await this.view(layer.scan))?.data as unknown as ScanData | undefined) : undefined;
    const file = scan ? await getFile(this.catalog.db, scan.file) : null;
    if (!file || !mayExport(file.rights_state)) reason = `the scan's rights (${file?.rights_state ?? 'unknown'}) do not allow copies`;
    this.layers.set(layerId, reason);
    return reason;
  }
}
