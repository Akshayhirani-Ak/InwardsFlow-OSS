// InwardsFlow Enterprise WMS â€” Catalog math helpers
// InwardsFlow Receiving & Inventory Engine
//
// Phase 7: the client-side auto-learning engine that used to live here
// (autoLearnPackSize / lookupSkuMaster) is DELETED. It learned pack sizes
// from a single unconfirmed receipt and wrote them straight into the
// catalog from the browser â€” the self-poisoning loop. Learning now happens
// exclusively inside the database at container finalize
// (apply_receipt_learning, migration 0004), under governance rules.
// What remains in this file is pure display math.

export interface BoxBreakdown {
  fullBoxes: number;
  partialBoxes: number;
  partialPcs: number;
  totalBoxes: number;
  formattedSummary: string;
}

/**
 * Calculates industrial box breakdown with Half-Box intelligence.
 * Never outputs confusing raw decimals like "9.5 boxes".
 * e.g., 950 pcs @ 100/box -> 10 Physical Boxes (9 Full Ã— 100 + 1 Partial Box of 50 pcs).
 */
export function calculateBoxBreakdown(totalQty: number, packSize: number): BoxBreakdown {
  if (totalQty <= 0) {
    return {
      fullBoxes: 0,
      partialBoxes: 0,
      partialPcs: 0,
      totalBoxes: 0,
      formattedSummary: '0 Boxes',
    };
  }

  const effectivePack = packSize > 0 ? packSize : 1;

  if (effectivePack === 1) {
    return {
      fullBoxes: totalQty,
      partialBoxes: 0,
      partialPcs: 0,
      totalBoxes: totalQty,
      formattedSummary: `${totalQty.toLocaleString()} Units (Loose / 1 per box)`,
    };
  }

  const fullBoxes = Math.floor(totalQty / effectivePack);
  const partialPcs = totalQty % effectivePack;
  const partialBoxes = partialPcs > 0 ? 1 : 0;
  const totalBoxes = fullBoxes + partialBoxes;

  let formattedSummary = '';
  if (partialPcs > 0) {
    formattedSummary = `${totalBoxes} Physical Boxes (${fullBoxes} Full Ã— ${effectivePack} + 1 Partial Box of ${partialPcs} pcs)`;
  } else {
    formattedSummary = `${fullBoxes} Full Boxes (${fullBoxes} Ã— ${effectivePack} = ${totalQty.toLocaleString()} pcs)`;
  }

  return {
    fullBoxes,
    partialBoxes,
    partialPcs,
    totalBoxes,
    formattedSummary,
  };
}
