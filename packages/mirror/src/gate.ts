import { getFile, type Catalog } from '@rebbehub/core';
import { RIGHTS_BY_LICENCE, mayExport, type EntityId, type Licence, type ScanData, type TextData, type TextLayerData } from '@rebbehub/model';

/**
 * What may leave RebbeHub in the open exports. Catalog facts always do
 * (CC0). Words do when their rights allow: a text copied from a source
 * keeps that source's licence (site-terms and commercial texts stay home),
 * community text is CC-BY-SA, and a scan's OCR pages follow the scan's
 * file. Files themselves are never in the exports, only their hashes.
 */
export class ExportGate {
  private readonly texts = new Map<string, string | null>();
  private readonly layers = new Map<string, string | null>();

  constructor(
    private readonly catalog: Catalog,
    private readonly at: number,
  ) {}

  /** Why a text's words are withheld, or null when they may be exported. */
  async textWithheld(textId: EntityId, data?: TextData): Promise<string | null> {
    if (this.texts.has(textId)) return this.texts.get(textId)!;
    const text = data ?? ((await this.catalog.get(textId, { at: this.at }))?.data as unknown as TextData | undefined);
    let reason: string | null = null;
    if (text?.licence && !mayExport(RIGHTS_BY_LICENCE[text.licence as Licence])) reason = `its source's terms (${text.licence}) do not allow copies`;
    this.texts.set(textId, reason);
    return reason;
  }

  /** Why a text layer's pages are withheld, or null. */
  async layerWithheld(layerId: EntityId): Promise<string | null> {
    if (this.layers.has(layerId)) return this.layers.get(layerId)!;
    let reason: string | null = null;
    const layer = (await this.catalog.get(layerId, { at: this.at }))?.data as unknown as TextLayerData | undefined;
    const scan = layer ? ((await this.catalog.get(layer.scan, { at: this.at }))?.data as unknown as ScanData | undefined) : undefined;
    const file = scan ? await getFile(this.catalog.db, scan.file) : null;
    if (!file || !mayExport(file.rights_state)) reason = `the scan's rights (${file?.rights_state ?? 'unknown'}) do not allow copies`;
    this.layers.set(layerId, reason);
    return reason;
  }
}
