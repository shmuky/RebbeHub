import type { Catalog, EntityView } from './catalog.js';
import { getFile } from './files.js';
import { withStructuredBody } from './legacyWords.js';
import { RIGHTS_BY_LICENCE, mayExport, type EntityId, type Licence, type RightsState, type ScanData, type TextData, type TextLayerData } from '@rebbehub/model';

/**
 * What may leave RebbeHub - served by the API or put in the open exports. Catalog facts always do
 * (CC0). Words do when their rights allow: a text copied from a source
 * keeps that source's licence (site-terms and commercial texts stay home),
 * community text is CC-BY-SA, and a scan's OCR pages follow the scan's
 * file. Files themselves are never in the exports, only their hashes.
 */
export class ExportGate {
  // What was asked is kept as the promise of its answer, so twenty segments of one text asked at once read it once.
  private readonly texts = new Map<string, Promise<string | null>>();
  private readonly layers = new Map<string, Promise<string | null>>();

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
    // A body from before words had structure is shown as structured words, like every other.
    const structured = withStructuredBody(view.data);
    if (structured !== view.data) view = { ...view, data: structured } as T;
    // A page's body keeps the rights of where it was imported from.
    const body = view.data as { body?: unknown; bodySource?: { rights?: RightsState; licence?: string } } | null;
    if (body?.body && body.bodySource?.rights && !mayExport(body.bodySource.rights)) {
      const { body: _withheld, ...rest } = view.data as Record<string, unknown>;
      return { ...view, withheld: `its source's terms (${body.bodySource.licence ?? body.bodySource.rights}) do not allow copies`, data: rest as T['data'] };
    }
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
  textWithheld(textId: EntityId, data?: TextData): Promise<string | null> {
    const known = this.texts.get(textId);
    if (known) return known;
    const asked = (async () => {
      const text = data ?? ((await this.view(textId))?.data as unknown as TextData | undefined);
      if (text?.licence && !mayExport(RIGHTS_BY_LICENCE[text.licence as Licence])) return `its source's terms (${text.licence}) do not allow copies`;
      return null;
    })();
    this.texts.set(textId, asked);
    return asked;
  }

  /** Why a text layer's pages are withheld, or null. */
  layerWithheld(layerId: EntityId): Promise<string | null> {
    const known = this.layers.get(layerId);
    if (known) return known;
    const asked = (async () => {
      const layer = (await this.view(layerId))?.data as unknown as TextLayerData | undefined;
      const scan = layer ? ((await this.view(layer.scan))?.data as unknown as ScanData | undefined) : undefined;
      const file = scan ? await getFile(this.catalog.db, scan.file) : null;
      return !file || !mayExport(file.rights_state) ? `the scan's rights (${file?.rights_state ?? 'unknown'}) do not allow copies` : null;
    })();
    this.layers.set(layerId, asked);
    return asked;
  }
}
