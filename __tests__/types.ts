import type { Client, Connection, Transaction } from '../dist/index'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type CustomRow = { one: number }

export async function clientRows(client: Client) {
  const omitted = await client.execute('SELECT 1 AS one')
  const empty = await client.execute('SELECT 1 AS one', {})
  const object = await client.execute('SELECT 1 AS one', { as: 'object' })
  const array = await client.execute('SELECT 1 AS one', { as: 'array' })
  const castOnly = await client.execute('SELECT 1 AS one', { cast: (_field, value) => value })
  const custom = await client.execute<CustomRow>('SELECT 1 AS one')
  const customObject = await client.execute<CustomRow>('SELECT 1 AS one', { as: 'object' })
  const customArray = await client.execute<CustomRow>('SELECT 1 AS one', { as: 'array' })

  return [
    true satisfies Equal<typeof omitted.rows, Record<string, any>[]>,
    true satisfies Equal<typeof empty.rows, Record<string, any>[]>,
    true satisfies Equal<typeof object.rows, Record<string, any>[]>,
    true satisfies Equal<typeof array.rows, any[][]>,
    true satisfies Equal<typeof castOnly.rows, Record<string, any>[]>,
    true satisfies Equal<typeof custom.rows, CustomRow[]>,
    true satisfies Equal<typeof customObject.rows, CustomRow[]>,
    true satisfies Equal<typeof customArray.rows, CustomRow[]>
  ]
}

export async function connectionRows(connection: Connection) {
  const omitted = await connection.execute('SELECT 1 AS one')
  const empty = await connection.execute('SELECT 1 AS one', {})
  const object = await connection.execute('SELECT 1 AS one', { as: 'object' })
  const array = await connection.execute('SELECT 1 AS one', { as: 'array' })
  const castOnly = await connection.execute('SELECT 1 AS one', { cast: (_field, value) => value })
  const custom = await connection.execute<CustomRow>('SELECT 1 AS one')
  const customObject = await connection.execute<CustomRow>('SELECT 1 AS one', { as: 'object' })
  const customArray = await connection.execute<CustomRow>('SELECT 1 AS one', { as: 'array' })

  return [
    true satisfies Equal<typeof omitted.rows, Record<string, any>[]>,
    true satisfies Equal<typeof empty.rows, Record<string, any>[]>,
    true satisfies Equal<typeof object.rows, Record<string, any>[]>,
    true satisfies Equal<typeof array.rows, any[][]>,
    true satisfies Equal<typeof castOnly.rows, Record<string, any>[]>,
    true satisfies Equal<typeof custom.rows, CustomRow[]>,
    true satisfies Equal<typeof customObject.rows, CustomRow[]>,
    true satisfies Equal<typeof customArray.rows, CustomRow[]>
  ]
}

export async function transactionRows(transaction: Transaction) {
  const omitted = await transaction.execute('SELECT 1 AS one')
  const empty = await transaction.execute('SELECT 1 AS one', {})
  const object = await transaction.execute('SELECT 1 AS one', { as: 'object' })
  const array = await transaction.execute('SELECT 1 AS one', { as: 'array' })
  const castOnly = await transaction.execute('SELECT 1 AS one', { cast: (_field, value) => value })
  const custom = await transaction.execute<CustomRow>('SELECT 1 AS one')
  const customObject = await transaction.execute<CustomRow>('SELECT 1 AS one', { as: 'object' })
  const customArray = await transaction.execute<CustomRow>('SELECT 1 AS one', { as: 'array' })

  return [
    true satisfies Equal<typeof omitted.rows, Record<string, any>[]>,
    true satisfies Equal<typeof empty.rows, Record<string, any>[]>,
    true satisfies Equal<typeof object.rows, Record<string, any>[]>,
    true satisfies Equal<typeof array.rows, any[][]>,
    true satisfies Equal<typeof castOnly.rows, Record<string, any>[]>,
    true satisfies Equal<typeof custom.rows, CustomRow[]>,
    true satisfies Equal<typeof customObject.rows, CustomRow[]>,
    true satisfies Equal<typeof customArray.rows, CustomRow[]>
  ]
}
