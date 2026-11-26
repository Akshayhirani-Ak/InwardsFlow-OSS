'use client';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ProductMaster, SkuAlias } from '@/types/wms';
import { useAuth } from '@/context/AuthPermissionContext';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { rpcErrorMessage } from '@/lib/utils/errors';
import * as XLSX from 'xlsx';
import {
  Boxes,
  Search,
  Plus,
  Upload,
  Download,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  Edit2,
  Check,
  Star,
  FileSpreadsheet,
  Link as LinkIcon,
  Layers,
  ArrowUpDown,
} from 'lucide-react';

export default function ProductCatalogPage() {
  const supabase = createBrowserSupabaseClient();
  const { isMaster, cleanUserId } = useAuth();

  const [products, setProducts] = useState<ProductMaster[]>([]);
  const [aliases, setAliases] = useState<SkuAlias[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'catalog' | 'aliases'>('catalog');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState('ALL');

  // Modals
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<ProductMaster> | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [prodRes, aliasRes] = await Promise.all([
        supabase.from('product_master').select('*').order('sku_code', { ascending: true }),
        supabase.from('sku_aliases').select('*').order('supplier_name', { ascending: true }),
      ]);

      if (prodRes.error) throw prodRes.error;
      if (aliasRes.error) throw aliasRes.error;

      setProducts((prodRes.data as ProductMaster[]) || []);
      setAliases((aliasRes.data as SkuAlias[]) || []);
    } catch (err: unknown) {
      console.error('Failed to load catalog:', err);
      setFeedbackMessage({
        type: 'error',
        text: rpcErrorMessage(err, 'Failed to load catalog data.'),
      });
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
      if (confidenceFilter !== 'ALL' && p.pack_confidence !== confidenceFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchSku = p.sku_code.toLowerCase().includes(q);
        const matchName = p.product_name.toLowerCase().includes(q);
        const matchCat = (p.category || '').toLowerCase().includes(q);
        const matchNote = (p.inner_pack_note || '').toLowerCase().includes(q);
        if (!matchSku && !matchName && !matchCat && !matchNote) return false;
      }
      return true;
    });
  }, [products, categoryFilter, confidenceFilter, searchQuery]);

  // Filtered aliases
  const filteredAliases = useMemo(() => {
    if (!searchQuery.trim()) return aliases;
    const q = searchQuery.toLowerCase().trim();
    return aliases.filter(
      (a) =>
        a.supplier_name.toLowerCase().includes(q) ||
        a.supplier_sku_code.toLowerCase().includes(q) ||
        a.master_sku_code.toLowerCase().includes(q)
    );
  }, [aliases, searchQuery]);

  // Save/Upsert product code
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct?.sku_code?.trim()) return;

    try {
      const cleanSku = editingProduct.sku_code.trim().toUpperCase();
      const packSize = Number(editingProduct.standard_pack_size) || 1;

      // Phase 7: saves go through the governance RPC. Confidence is never
      // set here — VERIFIED is only reachable via the explicit Verify action.
      const { error } = await supabase.rpc('catalog_save_product', {
        p_sku_code: cleanSku,
        p_product_name: editingProduct.product_name?.trim() || cleanSku,
        p_category: editingProduct.category?.trim() || null,
        p_uom: (editingProduct.uom || 'EA').toUpperCase().trim(),
        p_standard_pack_size: Math.max(1, packSize),
        p_inner_pack_note: editingProduct.inner_pack_note?.trim() || null,
        p_is_default_priority: Boolean(editingProduct.is_default_priority),
      });

      if (error) throw error;

      setFeedbackMessage({
        type: 'success',
        text: `Product code ${cleanSku} saved with standard pack size ${packSize} pcs/box.`,
      });

      setIsEditModalOpen(false);
      setEditingProduct(null);
      loadData();
    } catch (err: unknown) {
      setFeedbackMessage({
        type: 'error',
        text: rpcErrorMessage(err, 'Unable to save this product.'),
      });
    }
  };

  // Quick Verify action
  const handleQuickVerify = async (sku: ProductMaster) => {
    try {
      // Phase 7: Verify is an explicit governed action — the RPC sets the
      // pack size being verified together with the VERIFIED stamp, and the
      // database trigger audits it.
      const { data, error } = await supabase.rpc('catalog_verify_product', {
        p_sku_code: sku.sku_code,
        p_pack_size: sku.standard_pack_size,
      });

      if (error) throw error;
      const updated = data as unknown as ProductMaster | null;
      if (!updated || updated.sku_code !== sku.sku_code || updated.pack_confidence !== 'VERIFIED') throw new Error('The server did not confirm verification. Refresh the catalog.');
      setProducts((prev) =>
        prev.map((p) => (p.sku_code === sku.sku_code ? updated : p))
      );
    } catch (err) {
      setFeedbackMessage({ type: 'error', text: rpcErrorMessage(err, 'Unable to verify this product.') });
    }
  };

  // Export Catalog as .xlsx
  const handleExportCatalog = () => {
    const rows = products.map((p) => ({
      'Product Code': p.sku_code,
      'Product Name': p.product_name,
      Category: p.category || '',
      UOM: p.uom,
      'Standard Pack Size (pcs/box)': p.standard_pack_size,
      'Inner Pack Description': p.inner_pack_note || '',
      'Pack Confidence': p.pack_confidence,
      'Times Received': p.times_received,
      'Priority Stock': p.is_default_priority ? 'YES' : 'NO',
      'Last Updated': new Date(p.updated_at).toLocaleDateString(),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Product Master Catalog');
    XLSX.writeFile(wb, `InwardsFlow_Product_Master_Catalog_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Parse Excel/CSV for Bulk Import
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        setImportPreview(data.slice(0, 10)); // preview first 10
      } catch (err) {
        setFeedbackMessage({ type: 'error', text: 'Failed to read spreadsheet file.' });
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExecuteImport = async () => {
    if (!importFile) return;
    try {
      setIsImporting(true);
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const rawRows: any[] = XLSX.utils.sheet_to_json(ws);

          const itemsToUpsert = rawRows
            .map((r) => {
              const sku = String(r['Product Code'] || r['product code Code'] || r['sku_code'] || r['product code'] || '').trim().toUpperCase();
              const name = String(r['Product Name'] || r['product_name'] || r['Description'] || sku).trim();
              const pack = Number(r['Standard Pack Size'] || r['standard_pack_size'] || r['Pack Size'] || r['pack_size'] || 1);
              const uom = String(r['UOM'] || r['uom'] || 'EA').trim().toUpperCase();
              const category = r['Category'] || r['category'] || null;
              const note = r['Inner Pack Description'] || r['inner_pack_note'] || null;

              if (!sku) return null;
              return {
                sku_code: sku,
                product_name: name,
                category,
                uom,
                standard_pack_size: Math.max(1, pack),
                inner_pack_note: note,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          if (itemsToUpsert.length === 0) {
            throw new Error('No valid product code rows found in spreadsheet.');
          }

          // Phase 7: the import RPC cannot mint trust — new product codes land as
          // AUTO_LEARNED, and existing rows keep their pack size,
          // confidence, and receipt history.
          const { data, error } = await supabase.rpc('catalog_import_products', {
            p_rows: itemsToUpsert,
          });

          if (error) throw error;

          const counts = (data as { inserted?: number; updated?: number } | null) ?? {};
          setFeedbackMessage({
            type: 'success',
            text: `Import complete: ${counts.inserted ?? 0} new product codes added as AUTO_LEARNED, ${counts.updated ?? 0} existing product codes updated (descriptive fields only).`,
          });
          setIsImportModalOpen(false);
          setImportFile(null);
          setImportPreview([]);
          loadData();
        } catch (err: unknown) {
          setFeedbackMessage({
            type: 'error',
            text: rpcErrorMessage(err, 'Import failed.'),
          });
        } finally {
          setIsImporting(false);
        }
      };
      reader.readAsBinaryString(importFile);
    } catch (err) {
      setIsImporting(false);
    }
  };

  // KPIs
  const verifiedCount = products.filter((p) => p.pack_confidence === 'VERIFIED').length;
  const autoLearnedCount = products.filter((p) => p.pack_confidence === 'AUTO_LEARNED').length;
  const priorityCount = products.filter((p) => p.is_default_priority).length;

  return (
    <div className="flex-1 max-w-[1536px] w-full mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Catalog
        </h1>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              loadData();
            }}
            className="text-xs border-line"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
            Sync
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCatalog}
            className="text-xs border-line font-semibold"
          >
            <Download className="w-3.5 h-3.5 mr-1.5 text-secondary" strokeWidth={1.75} />
            Export (.xlsx)
          </Button>

          {isMaster && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsImportModalOpen(true)}
                className="text-xs border-line font-semibold"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5 text-accent" strokeWidth={1.75} />
                Bulk Import
              </Button>

              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setEditingProduct({
                    sku_code: '',
                    product_name: '',
                    category: '',
                    uom: 'EA',
                    standard_pack_size: 50,
                    inner_pack_note: '',
                    pack_confidence: 'AUTO_LEARNED',
                    is_default_priority: false,
                  });
                  setIsEditModalOpen(true);
                }}
                className="text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
                Add Product code
              </Button>
            </>
          )}
        </div>
      </div>

      {feedbackMessage && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            feedbackMessage.type === 'success'
              ? 'bg-received border-received text-positive'
              : 'bg-damage border-damage text-danger'
          }`}
        >
          <span>{feedbackMessage.text}</span>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-muted hover:text-secondary ml-4 font-bold"
          >
            ×
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[[products.length, "product codes"], [verifiedCount, "verified box sizes"], [autoLearnedCount, "auto-learned (unverified)"], [priorityCount, "priority dispatch"]].map(([value, label]) => (
          <Card key={label} className="flex flex-col gap-2 p-5">
            <strong className="font-mono text-2xl font-semibold text-ink">{value}</strong>
            <span className="text-[13px] text-secondary">{label}</span>
          </Card>
        ))}
      </div>

      {/* Main Tabs: Catalog vs Supplier Aliases */}
      <div className="flex border-b border-line bg-white px-4 pt-3 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'catalog'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <Layers className="w-3.5 h-3.5" strokeWidth={1.75} />
          Master Product Catalog ({filteredProducts.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('aliases')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'aliases'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <LinkIcon className="w-3.5 h-3.5" strokeWidth={1.75} />
          Supplier product code Aliases ({aliases.length})
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-b-xl border-x border-b border-line flex flex-wrap items-center justify-between gap-3 -mt-6">
        <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap sm:min-w-[300px]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              placeholder={
                activeTab === 'catalog'
                  ? 'Search 1,000+ product codes, names, categories, or box descriptions...'
                  : 'Search Supplier name, Supplier part #, or Master product code...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-soft border border-line rounded-lg focus:outline-none focus:ring-1 focus:ring-accent font-mono"
            />
          </div>

          {activeTab === 'catalog' && (
            <>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="text-xs font-mono bg-soft border border-line rounded-lg px-2.5 py-1.5 text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="ALL">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={confidenceFilter}
                onChange={(e) => setConfidenceFilter(e.target.value)}
                className="text-xs font-mono bg-soft border border-line rounded-lg px-2.5 py-1.5 text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="ALL">All Confidence Levels</option>
                <option value="VERIFIED">VERIFIED</option>
                <option value="AUTO_LEARNED">AUTO_LEARNED</option>
                <option value="VARIABLE">VARIABLE</option>
              </select>
            </>
          )}
        </div>

        <span className="text-xs font-mono text-muted">
          Showing <strong>{activeTab === 'catalog' ? filteredProducts.length : filteredAliases.length}</strong> items
        </span>
      </div>

      {/* TAB 1: PRODUCT CATALOG TABLE */}
      {activeTab === 'catalog' && (
        <div className="bg-surface rounded-card shadow-rest overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-soft text-[11px] font-bold text-secondary uppercase tracking-wider">
                  <th className="py-3 px-4 font-mono">Product Code</th>
                  <th className="py-3 px-4">Product Name &amp; Category</th>
                  <th className="py-3 px-4 text-center">UOM</th>
                  <th className="py-3 px-4 text-right font-mono">Standard Pack Size</th>
                  <th className="py-3 px-4">Inner Pack Description / Notes</th>
                  <th className="py-3 px-4 text-center">Pack Confidence</th>
                  <th className="py-3 px-4 text-center font-mono">Times Received</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-soft text-xs">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted">
                      <Boxes className="w-8 h-8 mx-auto mb-2 text-line" strokeWidth={1.75} />
                      <p className="font-semibold text-xs text-ink">No product codes match your search query.</p>
                      <p className="text-[11px] text-muted mt-0.5">
                        product codes are automatically learned during floor receiving or can be added manually.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => {
                    const isVerified = p.pack_confidence === 'VERIFIED';
                    const isAutoLearned = p.pack_confidence === 'AUTO_LEARNED';

                    return (
                      <tr key={p.id} className="hover:bg-soft transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-ink bg-soft px-2 py-0.5 rounded border border-line text-xs">
                              {p.sku_code}
                            </span>
                            {p.is_default_priority && (
                              <span
                                title="Default Priority Stock"
                                className="p-0.5 bg-attention text-warning border border-attention rounded"
                              >
                                <Star className="w-3 h-3 fill-amber-500 text-warning" />
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-semibold text-ink">{p.product_name}</div>
                          {p.category && (
                            <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-soft text-secondary border border-line">
                              {p.category}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap font-mono font-bold text-secondary">
                          {p.uom}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono tabular-nums">
                          <span className="font-black text-ink text-sm">
                            {p.standard_pack_size.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-muted ml-1">pcs/box</span>
                        </td>

                        <td className="py-3 px-4 text-secondary font-mono text-[11px] max-w-xs truncate">
                          {p.inner_pack_note || '—'}
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {isVerified ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-received text-positive border border-received">
                              <CheckCircle2 className="w-3 h-3 mr-1" strokeWidth={1.75} />
                              VERIFIED
                            </span>
                          ) : isAutoLearned ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-selection text-accent border border-selection">
                              <Sparkles className="w-3 h-3 mr-1" strokeWidth={1.75} />
                              AUTO_LEARNED
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-attention text-warning border border-attention">
                              VARIABLE
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center font-mono tabular-nums text-secondary font-semibold whitespace-nowrap">
                          {p.times_received}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {!isVerified && isMaster && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleQuickVerify(p)}
                                className="text-[10px] h-6 px-2 text-positive border-received hover:bg-received"
                                title="Lock as Verified standard pack size"
                              >
                                <Check className="w-3 h-3 mr-1" strokeWidth={1.75} />
                                Verify
                              </Button>
                            )}
                            {isMaster && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingProduct(p);
                                  setIsEditModalOpen(true);
                                }}
                                className="text-[10px] h-6 px-2 border-line text-secondary hover:text-ink"
                                title="Edit Product"
                              >
                                <Edit2 className="w-3 h-3" strokeWidth={1.75} />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SUPPLIER product code ALIASES TABLE */}
      {activeTab === 'aliases' && (
        <div className="space-y-4">
          {/* Aliases List Table */}
          <div className="bg-surface rounded-card shadow-rest overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line bg-soft text-[11px] font-bold text-secondary uppercase tracking-wider">
                    <th className="py-3 px-4">Supplier Name</th>
                    <th className="py-3 px-4 font-mono">Supplier Part #</th>
                    <th className="py-3 px-4 text-center font-mono">Mapping</th>
                    <th className="py-3 px-4 font-mono">Master Catalog product code</th>
                    <th className="py-3 px-4 font-mono text-muted">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-soft text-xs">
                  {filteredAliases.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted">
                        <LinkIcon className="w-8 h-8 mx-auto mb-2 text-line" strokeWidth={1.75} />
                        <p className="font-semibold text-xs text-ink">No supplier aliases configured.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredAliases.map((a) => (
                      <tr key={a.id} className="hover:bg-soft transition-colors">
                        <td className="py-3 px-4 font-semibold text-ink">{a.supplier_name}</td>
                        <td className="py-3 px-4 font-mono font-bold text-accent bg-soft/50">
                          {a.supplier_sku_code}
                        </td>
                        <td className="py-3 px-4 text-center text-muted">
                          <ArrowUpDown className="w-3.5 h-3.5 mx-auto rotate-90" strokeWidth={1.75} />
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-positive">
                          <span className="bg-received text-positive border border-received px-2 py-0.5 rounded">
                            {a.master_sku_code}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-muted text-[11px]">
                          {new Date(a.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* EDIT / CREATE PRODUCT MODAL */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingProduct(null);
        }}
        title={editingProduct?.sku_code ? `Edit Master product code: ${editingProduct.sku_code}` : 'Register New Master product code'}
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Product Code"
              value={editingProduct?.sku_code || ''}
              onChange={(e) =>
                setEditingProduct((prev) => ({ ...prev, sku_code: e.target.value.toUpperCase() }))
              }
              placeholder="e.g. OS04"
              required
              className="font-mono uppercase font-bold"
            />

            <Input
              label="Product Name"
              value={editingProduct?.product_name || ''}
              onChange={(e) =>
                setEditingProduct((prev) => ({ ...prev, product_name: e.target.value }))
              }
              placeholder="e.g. Heavy-Duty Cordless Impact Driver Kit"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink mb-1">Category</label>
              <input
                type="text"
                value={editingProduct?.category || ''}
                onChange={(e) =>
                  setEditingProduct((prev) => ({ ...prev, category: e.target.value }))
                }
                placeholder="e.g. Power Tools"
                className="w-full px-3 py-2 bg-surface rounded-card shadow-rest rounded text-xs text-ink focus:outline-none focus:border-accent"
              />
            </div>

            <Input
              label="UOM (Unit of Measure)"
              value={editingProduct?.uom || 'EA'}
              onChange={(e) =>
                setEditingProduct((prev) => ({ ...prev, uom: e.target.value.toUpperCase() }))
              }
              placeholder="EA, PK, SET, PR, RL"
              required
              className="font-mono uppercase"
            />

            <Input
              label="Standard Pack Size (pcs/box)"
              type="number"
              min={1}
              value={editingProduct?.standard_pack_size || 1}
              onChange={(e) =>
                setEditingProduct((prev) => ({
                  ...prev,
                  standard_pack_size: Math.max(1, Number(e.target.value) || 1),
                }))
              }
              required
              className="font-mono font-bold"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink mb-1">
              Inner Pack Description / Packaging Ratio
            </label>
            <input
              type="text"
              value={editingProduct?.inner_pack_note || ''}
              onChange={(e) =>
                setEditingProduct((prev) => ({ ...prev, inner_pack_note: e.target.value }))
              }
              placeholder="e.g. 50 kits per master carton (5 inners of 10 kits)"
              className="w-full px-3 py-2 bg-surface rounded-card shadow-rest rounded text-xs text-ink focus:outline-none focus:border-accent font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-soft">
            <div>
              <label className="block text-xs font-bold text-ink mb-1">
                Pack Confidence Level
              </label>
              {/* Phase 7: confidence is governed server-side. It is shown,
                  never set here — VERIFIED comes only from the Verify action. */}
              <div className="w-full px-3 py-2 bg-soft border border-line rounded text-xs font-mono font-bold text-ink">
                {editingProduct?.pack_confidence || 'AUTO_LEARNED'}
              </div>
              <p className="text-[10px] text-muted mt-1">
                Set by the system: imports and receipts produce AUTO_LEARNED; a master&apos;s Verify action produces VERIFIED.
              </p>
            </div>

            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(editingProduct?.is_default_priority)}
                  onChange={(e) =>
                    setEditingProduct((prev) => ({
                      ...prev,
                      is_default_priority: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 text-accent rounded border-line focus:ring-accent"
                />
                <span className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-warning fill-amber-500" />
                  Default Priority Stock (Segregate upon devanning)
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-soft">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsEditModalOpen(false);
                setEditingProduct(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="font-bold">
              Save Master product code
            </Button>
          </div>
        </form>
      </Modal>

      {/* BULK EXCEL/CSV IMPORT MODAL */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportFile(null);
          setImportPreview([]);
        }}
        title="Bulk Import 1,000+ Master product codes (.xlsx / .csv)"
      >
        <div className="space-y-4">
          <p className="text-xs text-secondary">
            Upload your company ERP or Warehouse Master Product Catalog spreadsheet. Supports columns:
            <code className="mx-1 px-1.5 py-0.5 bg-soft border rounded font-mono text-[11px]">
              Product Code
            </code>
            ,
            <code className="mx-1 px-1.5 py-0.5 bg-soft border rounded font-mono text-[11px]">
              Product Name
            </code>
            ,
            <code className="mx-1 px-1.5 py-0.5 bg-soft border rounded font-mono text-[11px]">
              Standard Pack Size
            </code>
            ,
            <code className="mx-1 px-1.5 py-0.5 bg-soft border rounded font-mono text-[11px]">
              UOM
            </code>
            ,
            <code className="mx-1 px-1.5 py-0.5 bg-soft border rounded font-mono text-[11px]">
              Category
            </code>
            .
          </p>

          <div className="p-4 bg-soft border-2 border-dashed border-line rounded-control text-center">
            <FileSpreadsheet className="w-8 h-8 text-accent mx-auto mb-2" strokeWidth={1.75} />
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="text-xs text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-selection file:text-accent hover:file:bg-selection"
            />
          </div>

          {importPreview.length > 0 && (
            <div className="border border-line rounded-lg p-3 bg-white text-xs max-h-48 overflow-y-auto font-mono">
              <div className="font-bold text-secondary mb-2 font-sans">
                Spreadsheet Preview (First {importPreview.length} rows):
              </div>
              <pre className="text-[10px] text-secondary">{JSON.stringify(importPreview, null, 2)}</pre>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-soft">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsImportModalOpen(false);
                setImportFile(null);
                setImportPreview([]);
              }}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleExecuteImport}
              disabled={!importFile || isImporting}
              className="font-bold"
            >
              {isImporting ? 'Importing product codes...' : 'Execute Bulk Import'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
