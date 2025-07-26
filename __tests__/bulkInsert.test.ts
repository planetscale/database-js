import { createBulkInsert } from '../src/bulkInsert'

describe('createBulkInsert', () => {
  it('creates SQL and params for bulk insert', () => {
    const baseSql = 'INSERT INTO x VALUES'
    const rows = [ [1, 2, 3], [4, 5, 6] ]
    const { sql, params } = createBulkInsert(baseSql, rows)
    expect(sql).toBe('INSERT INTO x VALUES (?, ?, ?), (?, ?, ?)')
    expect(params).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('throws if no rows', () => {
    expect(() => createBulkInsert('INSERT INTO x VALUES', [])).toThrow('No rows provided')
  })
})
