'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AiDocumentDropzone } from '@/components/intake/AiDocumentDropzone';
import { StagedManifestGrid, PublishConsignmentPayload } from '@/components/intake/StagedManifestGrid';
import {
  AiDocumentExtractionResponse,
  ArrivalType,
  ContainerSize,
  CountingMode,
  UserProfile,
} from '@/types/wms';
import { useAuth } from '@/context/AuthPermissionContext';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { containerNumberIssue } from '@/lib/validation/iso6346';
import { thrownMessage } from '@/lib/intake/pending';
import { collectPoNumbers, deriveConsignmentRef } from '@/lib/intake/naming';
import {
  ArrowLeft,
  Lock,
  PlusCircle,
  Truck,
  Box,
  Layers,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function IntakePage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const { hasPermission, cleanUserId, profile } = useAuth();

  const [extractedData, setExtractedData] = useState<AiDocumentExtractionResponse | null>(null);
  const [operators, setOperators] = useState<UserProfile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showUnannouncedModal, setShowUnannouncedModal] = useState(false);

  // Unannounced receipt form state
  const [unanConsignmentRef, setUnanConsignmentRef] = useState('');
  const [unanSupplierName, setUnanSupplierName] = useState('');
  const [unanArrivalType, setUnanArrivalType] = useState<ArrivalType>('CONTAINER');
  const [unanUnitNumber, setUnanUnitNumber] = useState('');
  const [unanContainerSize, setUnanContainerSize] = useState<ContainerSize>('40HC');
  const [unanDockDoor, setUnanDockDoor] = useState('DOOR-01');
  const [unanCountingMode] = useState<CountingMode>('GUIDED');
  const [unanAssignedOperator, setUnanAssignedOperator] = useState('ALL');

  // Check permission
  const canIntake = hasPermission('ai_intake');

  // Initialize unannounced defaults
  useEffect(() => {
    const reference = crypto.randomUUID();
    setUnanConsignmentRef(`UNAN-${reference}`);
    setUnanUnitNumber(`CONT-${reference}`);
  }, []);

  // Load operators list for assignment dropdown
  useEffect(() => {
    async function loadOperators() {
      const { data } = await supabase.from('users_profile').select('*');
      if (data) {
        setOperators(data as UserProfile[]);
      }
    }
    if (canIntake) {
      loadOperators();
    }
  }, [supabase, canIntake]);

  // Handle publishing complete consignment (1..N containers)
  // Phase 2: ONE server RPC transaction (publish_consignment) replaces the
  // old 6-step client loop — no more half-published consignments when step 4
  // failed, no client-asserted totals, no client-written audit rows, and no
  // client-side catalog auto-learning (governed server-side in Phase 7).
  const handlePublishConsignment = async (payload: PublishConsignmentPayload) => {
    setIsSubmitting(true);
    try {
      const rpcPayload = {
        consignment_ref: payload.consignmentRef,
        supplier_name: payload.supplierName || 'General Supplier',
        arrival_type: payload.arrivalType || 'CONTAINER',
        notes: payload.notes || null,
        // Phase 29: file the consignment under the PO numbers its
        // documents named (Phase 24), when those POs are on file.
        po_numbers: extractedData ? collectPoNumbers(extractedData) : [],
        containers: payload.containers.map((unit) => ({
          sequence_index: unit.sequenceIndex,
          container_number: unit.containerNumber,
          container_size: unit.containerSize || '40HC',
          document_ref: unit.documentRef || payload.consignmentRef || null,
          dock_door: unit.dockDoor || null,
          counting_mode: 'GUIDED',
          assigned_operator_user_id: unit.assignedOperatorUserId || cleanUserId,
          items: (payload.containers.length === 1
            ? payload.items
            : payload.items.filter((it) => (it.container_sequence || 1) === unit.sequenceIndex)
          ).map((item) => ({
            sku_code: item.sku_code,
            supplier_code: item.supplier_code || null,
            product_name: item.product_name || item.sku_code,
            expected_cartons: item.expected_cartons,
            pack_size: item.pack_size,
            expected_partial_qty: item.expected_partial_qty || 0,
            partial_cartons: item.partial_cartons || 0,
            uom: item.uom || 'EA',
            is_priority: item.is_priority || false,
          })),
        })),
      };

      const { data, error } = await supabase.rpc('publish_consignment', {
        p_payload: rpcPayload,
      });
      if (error) throw error;

      const result = data as unknown as { first_container_id?: string } | null;
      if (result?.first_container_id) {
        router.push(`/workbench/${result.first_container_id}`);
      } else {
        throw new Error('The server returned no container. Check the dashboard before publishing again.');
      }
    } catch (err: unknown) {
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Unannounced Direct Receipt submission
  const handleCreateUnannouncedReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const cleanConsignment = unanConsignmentRef.trim() || `UNAN-${crypto.randomUUID()}`;
      const cleanSupplier = unanSupplierName.trim() || 'Unannounced / Direct Delivery';
      const cleanUnit = unanUnitNumber.trim() || `CONT-${crypto.randomUUID()}`;

      // Phase 8: ISO 6346 check digit (the server enforces it too).
      const isoIssue = containerNumberIssue(cleanUnit, unanArrivalType);
      if (isoIssue) throw new Error(isoIssue);

      // Same single-transaction publish RPC as the staged flow (Phase 2).
      const { data, error } = await supabase.rpc('publish_consignment', {
        p_payload: {
          consignment_ref: cleanConsignment,
          supplier_name: cleanSupplier,
          arrival_type: unanArrivalType,
          notes: 'Unannounced floor receipt without pre-staged packing list.',
          containers: [
            {
              sequence_index: 1,
              container_number: cleanUnit,
              container_size: unanArrivalType === 'CONTAINER' ? unanContainerSize : 'LCL',
              document_ref: cleanConsignment,
              dock_door: unanDockDoor,
              counting_mode: unanCountingMode,
              assigned_operator_user_id: unanAssignedOperator,
              items: [],
            },
          ],
        },
      });

      if (error) throw error;
      const result = data as unknown as { first_container_id?: string } | null;
      if (!result?.first_container_id) throw new Error('Publish returned no container.');

      setShowUnannouncedModal(false);
      router.push(`/workbench/${result.first_container_id}`);
    } catch (err: unknown) {
      alert(`Failed to start unannounced receipt: ${thrownMessage(err, String(err))}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canIntake) {
    return (
      <div className="flex-1 max-w-md mx-auto p-8 my-auto text-center">
        <div className="p-6 bg-surface rounded-card shadow-rest space-y-4">
          <div className="p-3 bg-damage text-danger rounded-full w-12 h-12 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" strokeWidth={1.75} />
          </div>
          <h2 className="text-base font-bold text-ink">Security Clearance Required</h2>
          <p className="text-xs text-secondary">
            Your User ID (<strong>{cleanUserId}</strong>) does not currently hold delegated permissions for{' '}
            <strong>Consignment & Container Intake</strong>. Contact a Master Administrator to request access.
          </p>
          <Link href="/dashboard" className="inline-block pt-2">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
              Return to Inwards Consignments
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          New Consignment
        </h1>

        <div className="flex items-center gap-2">
          {!extractedData && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowUnannouncedModal(true);
              }}
              className="text-xs border-transparent bg-selection text-accent hover:bg-accent/15"
            >
              <PlusCircle className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
              Start Unannounced Receipt
            </Button>
          )}

          <Link href="/dashboard">
            <Button size="sm" variant="outline" className="text-xs">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
              Back to Registry
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Intake Flow */}
      {!extractedData ? (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <AiDocumentDropzone
            onExtractionSuccess={(data) => setExtractedData(data)}
            onManualEntry={() => {
              setShowUnannouncedModal(true);
            }}
            onDirectManualManifest={() => {
              const reference = crypto.randomUUID();
              setExtractedData({
                container_number: `CONT-${reference}`,
                supplier_name: 'Manual Consignment Entry',
                container_size: '40HC',
                document_ref: `PO-${reference}`,
                dock_door: 'DOOR-01',
                counting_mode: 'GUIDED',
                items: [],
              });
            }}
          />

          {/* Quick-Start Prompt Card for Unannounced Deliveries */}
          <div className="p-5 bg-surface rounded-card shadow-rest flex flex-col items-start gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-soft border border-line rounded-lg text-secondary">
                <Truck className="w-5 h-5 text-accent" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
                  No Packing List or Paperwork Available?
                </h3>
                <p className="text-[13px] text-muted">
                  Instantly open a receiving bench or pallet to count unannounced freight, emergency courier parcels, or blind transfers.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setShowUnannouncedModal(true);
              }}
              className="bg-ink hover:bg-ink text-white text-xs font-bold shrink-0"
            >
              Open Direct Floor Intake
            </Button>
          </div>
        </div>
      ) : (
        <StagedManifestGrid
          initialConsignmentRef={
            // Phase 24: the consignment is named by its PO number(s) when
            // the documents stated any; the document ref stays the fallback.
            deriveConsignmentRef(
              collectPoNumbers(extractedData),
              extractedData.document_ref || ''
            ) || undefined
          }
          initialArrivalType={extractedData.suggested_arrival_type || 'CONTAINER'}
          initialContainerNumber={extractedData.container_number}
          initialSupplierName={extractedData.supplier_name}
          initialContainerSize={extractedData.container_size || '40HC'}
          initialDocumentRef={extractedData.document_ref || ''}
          initialDockDoor={extractedData.dock_door || 'DOOR-01'}
          initialCountingMode="GUIDED"
          initialItems={extractedData.items}
          initialContainers={
            extractedData.containers && extractedData.containers.length > 0
              ? extractedData.containers.map((c, i) => ({
                  sequenceIndex: i + 1,
                  containerNumber: c.container_number,
                  containerSize: c.container_size || '40HC',
                  dockDoor: c.dock_door || 'DOOR-01',
                  documentRef: c.document_ref || '',
                  countingMode: 'GUIDED',
                  assignedOperatorUserId: 'ALL',
                  printedTotals: c.printed_totals,
                }))
              : undefined
          }
          initialPrintedTotals={extractedData.printed_totals}
          initialNotice={extractedData.warnings?.join(' ') || ''}
          operators={operators}
          onPublishConsignment={handlePublishConsignment}
          onReset={() => setExtractedData(null)}
          disabled={isSubmitting}
        />
      )}

      {/* Unannounced Direct Receipt Modal */}
      {showUnannouncedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface rounded-card shadow-rest w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 bg-soft border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-attention text-warning rounded-lg">
                  <Truck className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-ink uppercase tracking-tight">
                    Start Unannounced Floor Receipt
                  </h3>
                  <p className="text-[11px] text-muted font-medium">
                    Initialize receiving session without pre-staged paperwork
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowUnannouncedModal(false)}
                className="text-muted hover:text-secondary p-1 rounded-lg hover:bg-line transition-colors"
              >
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>

            <form onSubmit={handleCreateUnannouncedReceipt} className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1">
                    Consignment / Delivery Ref *
                  </label>
                  <input
                    type="text"
                    required
                    value={unanConsignmentRef}
                    onChange={(e) => setUnanConsignmentRef(e.target.value)}
                    placeholder="e.g. UNAN-202610-01"
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-soft border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1">
                    Supplier / Carrier Name
                  </label>
                  <input
                    type="text"
                    value={unanSupplierName}
                    onChange={(e) => setUnanSupplierName(e.target.value)}
                    placeholder="e.g. Mainfreight / DHL Express"
                    className="w-full px-3 py-2 text-xs bg-soft border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Arrival Mode Selector */}
              <div>
                <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1.5">
                  Arrival Mode *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setUnanArrivalType('CONTAINER')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      unanArrivalType === 'CONTAINER'
                        ? 'border-accent bg-selection/70 text-ink ring-1 ring-accent'
                        : 'border-line hover:bg-soft text-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Truck className="w-3.5 h-3.5 text-accent" strokeWidth={1.75} />
                      <span className="text-[11px] font-bold">FCL Container</span>
                    </div>
                    <p className="text-[10px] text-muted">Ocean Box (20/40ft)</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUnanArrivalType('PALLET_FREIGHT')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      unanArrivalType === 'PALLET_FREIGHT'
                        ? 'border-accent bg-selection/70 text-ink ring-1 ring-accent'
                        : 'border-line hover:bg-soft text-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Layers className="w-3.5 h-3.5 text-accent" strokeWidth={1.75} />
                      <span className="text-[11px] font-bold">Pallet Freight</span>
                    </div>
                    <p className="text-[10px] text-muted">LCL / Curtain-Sider</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUnanArrivalType('COURIER_PARCEL')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      unanArrivalType === 'COURIER_PARCEL'
                        ? 'border-positive bg-received text-positive ring-1 ring-positive'
                        : 'border-line hover:bg-soft text-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Box className="w-3.5 h-3.5 text-positive" strokeWidth={1.75} />
                      <span className="text-[11px] font-bold">Courier Parcel</span>
                    </div>
                    <p className="text-[10px] text-muted">Loose Bench Cartons</p>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1">
                    {unanArrivalType === 'COURIER_PARCEL' ? 'AWB / Tracking No *' : 'Container / Vehicle No *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={unanUnitNumber}
                    onChange={(e) => setUnanUnitNumber(e.target.value.toUpperCase())}
                    placeholder={unanArrivalType === 'COURIER_PARCEL' ? 'AWB-12345678' : 'MSKU-789012-3'}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-soft border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                {unanArrivalType === 'CONTAINER' ? (
                  <div>
                    <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1">
                      Container Size
                    </label>
                    <select
                      value={unanContainerSize}
                      onChange={(e) => setUnanContainerSize(e.target.value as ContainerSize)}
                      className="w-full px-3 py-2 text-xs bg-soft border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="40HC">40HC (High Cube)</option>
                      <option value="40FT">40FT Standard</option>
                      <option value="20FT">20FT Standard</option>
                      <option value="LCL">LCL Loose Cargo</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1">
                      Receiving Target
                    </label>
                    <div className="px-3 py-2 text-xs font-mono font-bold bg-soft border border-line rounded-lg text-secondary">
                      {unanArrivalType === 'COURIER_PARCEL' ? 'COURIER-BENCH' : 'PLT-001 (Auto)'}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1">
                    Dock Door
                  </label>
                  <input
                    type="text"
                    value={unanDockDoor}
                    onChange={(e) => setUnanDockDoor(e.target.value)}
                    placeholder="DOOR-01"
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-soft border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                {/* Phase 21 (Amendment 9): blind counting removed — the
                    unannounced-consignment form no longer offers a
                    counting mode; everything is guided. */}

                <div>
                  <label className="block text-[11px] font-bold text-secondary uppercase tracking-wider mb-1">
                    Assign Operator
                  </label>
                  <select
                    value={unanAssignedOperator}
                    onChange={(e) => setUnanAssignedOperator(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-soft border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="ALL">Any Available</option>
                    {operators.map((op) => (
                      <option key={op.user_id} value={op.user_id}>
                        {op.user_id} ({op.full_name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-line">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUnannouncedModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-ink hover:bg-ink text-white font-bold"
                >
                  {isSubmitting ? 'Opening Session...' : 'Open Workbench Now'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
