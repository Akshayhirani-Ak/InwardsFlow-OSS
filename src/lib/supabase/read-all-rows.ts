/** Read every row of a stable, ordered query before presenting a printable total. */
export async function readAllRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await read(rows.length, rows.length + 499);
    if (error) throw error;
    if (!data) throw new Error('The server did not return report rows.');
    if (!data.length) return rows;
    rows.push(...data);
  }
}
