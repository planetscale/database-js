/**
 * Helper to create bulk insert SQL and parameters.
 * @param baseSql The base SQL, e.g. "INSERT INTO x VALUES"
 * @param rows Array of rows, e.g. [[1,2,3],[4,5,6]]
 * @returns { sql: string, params: any[] }
 */
export function createBulkInsert(baseSql: string, rows: any[][]) {
  if (!rows.length) throw new Error('No rows provided')
  const placeholders = rows.map(row => `(${row.map(() => '?').join(', ')})`).join(', ')
  const sql = `${baseSql} ${placeholders}`
  const params = rows.flat()
  return { sql, params }
} 


