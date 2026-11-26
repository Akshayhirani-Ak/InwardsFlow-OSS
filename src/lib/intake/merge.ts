// InwardsFlow — Phase 13 multi-document merge (pure, unit-tested).
// Phase 16: placeholder documents group by consignment identity.
//
// One consignment often arrives as 2–3 documents (invoice + packing list,
// or a packing list split across files). Each file is extracted on its
// own; this merge combines the extractions into ONE staged consignment:
//   * documents naming the same container merge their lines into it
//   * documents naming different containers become container 1..N of the
//     same consignment, their lines tagged with container_sequence
//   * documents with NO container number group by document/consignment
//     ref: portal bundles (e.g. Mainchain downloads) mix SEPARATE
//     shipments that share no container number, and folding them into
//     one container merged three real supplier consignments into one.
//     Same-ref parts of one shipment still merge; a placeholder doc
//     with no ref at all folds into the first group as a last resort.
// Header fields come from the first document that actually has them.

import type {
  AiDocumentExtractionResponse,
  AiExtractionContainer,
  StagedManifestItem,
} from '@/types/wms';
import { sumPrintedTotals } from './totals';

const PENDING = 'CONT-PENDING';

function containerKey(r: AiDocumentExtractionResponse): string {
  return (r.container_number || '').trim().toUpperCase();
}

function refKey(r: AiDocumentExtractionResponse): string {
  const ref = (r.document_ref || r.consignment_ref || '').trim().toUpperCase();
  return ref ? `REF:${ref}` : '';
}

/**
 * Phase 36: the normalised document identity used for duplicate
 * detection. Two extractions in one drop that carry the SAME document
 * number AND the same content fingerprint (supplier + line count +
 * total units, see the dropzone) are the same document twice — a portal
 * bundle downloaded twice, a file attached twice — and merging both
 * counts every line twice. Live case 22 Nov 2026: invoice 451036373
 * uploaded as two files staged 63 lines instead of 61, silently. A
 * shared number with DIFFERENT content (an invoice and its packing
 * list stating the same reference) is not a duplicate: both stage, and
 * the operator gets a warning to check them. Returns '' when the
 * document states no usable number — those are never deduped.
 */
export function documentRefKey(r: AiDocumentExtractionResponse): string {
  const ref = (r.document_ref || '').replace(/\s+/g, '').toUpperCase();
  return ref.length >= 4 ? ref : '';
}

export function mergeExtractions(
  results: AiDocumentExtractionResponse[]
): AiDocumentExtractionResponse {
  if (results.length === 0) {
    throw new Error('Nothing to merge.');
  }
  if (results.length === 1) return results[0];

  // Group results by container, preserving first-appearance order.
  // Real container numbers group by number. Placeholder documents group
  // by consignment ref (Phase 16) so separate shipments in one bundle
  // stay separate; a ref-less placeholder folds into the first group.
  const groups: AiDocumentExtractionResponse[][] = [];
  const groupKeys: string[] = [];
  for (const r of results) {
    const key = containerKey(r);
    if (key && key !== PENDING) {
      const idx = groupKeys.indexOf(key);
      if (idx >= 0) {
        groups[idx].push(r);
        continue;
      }
      groupKeys.push(key);
      groups.push([r]);
    } else {
      const rk = refKey(r);
      if (rk) {
        const idx = groupKeys.indexOf(rk);
        if (idx >= 0) {
          groups[idx].push(r);
          continue;
        }
        groupKeys.push(rk);
        groups.push([r]);
      } else {
        if (groups.length === 0) {
          groupKeys.push(PENDING);
          groups.push([]);
        }
        groups[0].push(r);
      }
    }
  }

  const first = results[0];
  const supplier =
    results.find((r) => r.supplier_name && r.supplier_name !== 'General Inbound')
      ?.supplier_name || first.supplier_name;
  const consignmentRef = results.find((r) => r.consignment_ref)?.consignment_ref;

  const items: StagedManifestItem[] = [];
  const containers: AiExtractionContainer[] = groups.map((group, gi) => {
    const head = group[0];
    for (const r of group) {
      for (const item of r.items) {
        items.push({ ...item, container_sequence: gi + 1 });
      }
    }
    return {
      container_number: head.container_number,
      container_size: head.container_size,
      document_ref: head.document_ref,
      po_number: head.po_number,
      // Phase 25: this unit's printed totals = the sum of its documents'.
      printed_totals: sumPrintedTotals(group.map((r) => r.printed_totals)),
      dock_door: head.dock_door,
      counting_mode: head.counting_mode,
    };
  });

  const warnings = results.flatMap((r) => r.warnings || []);

  return {
    ...first,
    supplier_name: supplier,
    consignment_ref: consignmentRef,
    po_number: containers[0].po_number || first.po_number,
    printed_totals: sumPrintedTotals(containers.map((c) => c.printed_totals)),
    container_number: containers[0].container_number,
    container_size: containers[0].container_size,
    document_ref: containers[0].document_ref,
    dock_door: containers[0].dock_door,
    counting_mode: containers[0].counting_mode,
    items,
    ...(containers.length > 1 ? { containers } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
