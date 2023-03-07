# PlanetScale Serverless Driver for JavaScript

A Fetch API-compatible PlanetScale database driver for serverless and edge compute platforms that require HTTP external connections, such as Cloudflare Workers or Vercel Edge Functions

## Installation

```
npm install @planetscale/database
```

## Usage

```ts
import { connect } from '@planetscale/database'

const config = {
  host: '<host>',
  username: '<user>',
  password: '<password>'
}

const conn = connect(config)
const results = await conn.execute('select 1 from dual where 1=?', [1])
console.log(results)
```

### Database URL

A single database URL value can be used to configure the `host`, `username`, and `password` values.

```ts
import { connect } from '@planetscale/database'

const config = {
  url: process.env['DATABASE_URL'] || 'mysql://user:pass@host'
}

const conn = connect(config)
```

### Connection factory

Use the `Client` connection factory class to create fresh connections for each transaction or web request handler.

```ts
import { Client } from '@planetscale/database'

const client = new Client({
  host: '<host>',
  username: '<user>',
  password: '<password>'
})

const conn = client.connection()
const results = await conn.execute('select 1 from dual')
console.log(results)
```

### Transactions

Use the `transaction` function to safely perform database transactions. If any unhandled errors are thrown during execution of the transaction, the transaction will be rolled back.

The following example is based on [the Slotted Counter Pattern](https://planetscale.com/blog/the-slotted-counter-pattern).

```ts
import { connect } from '@planetscale/database'

const config = {
  host: '<host>',
  username: '<user>',
  password: '<password>'
}

const conn = connect(config)
const results = await conn.transaction(async (tx) => {
  const whenBranch = await tx.execute('INSERT INTO branches (database_id, name) VALUES (?, ?)', [42, "planetscale"])
  const whenCounter = await tx.execute('INSERT INTO slotted_counters(record_type, record_id, slot, count) VALUES (?, ?, RAND() * 100, 1) ON DUPLICATE KEY UPDATE count = count + 1', ['branch_count', 42])
  return [whenBranch, whenCounter]
})
console.log(results)
```

### Custom fetch function

Node.js version 18 includes a built-in global `fetch` function. When using an older version of Node.js, you can provide a custom fetch function implementation. We recommend the [`undici`][1] package on which Node's built-in fetch is based.

[1]: https://github.com/nodejs/undici

```ts
import { connect } from '@planetscale/database'
import { fetch } from 'undici'

const config = {
  fetch,
  host: '<host>',
  username: '<user>',
  password: '<password>'
}

const conn = connect(config)
const results = await conn.execute('select 1 from dual')
console.log(results)
```

To leverage HTTP/2, you can use the [`fetch-h2`][1] shim. `fetch-h2` also supports Node.js 12+.

[1]: https://www.npmjs.com/package/fetch-h2

```ts
import { connect } from '@planetscale/database'
import { context } from 'fetch-h2'
const { fetch, disconnectAll } = context()

const config = {
  fetch,
  host: '<host>',
  username: '<user>',
  password: '<password>'
}

const conn = connect(config)
const results = await conn.execute('select 1 from dual')
console.log(results)
await disconnectAll()
```

### Custom query parameter format function

Query replacement parameters identified with `?` are replaced with escaped values. Named replacement parameters are supported with a colon prefix.

```ts
const results1 = await conn.execute('select 1 from dual where 1=?', [42])
const results2 = await conn.execute('select 1 from dual where 1=:id', { id: 42 })
```

Providing a custom format function overrides the built-in escaping with an external library, like [`sqlstring`](https://github.com/mysqljs/sqlstring).

```ts
import { connect } from '@planetscale/database'
import SqlString from 'sqlstring'

const config = {
  format: SqlString.format,
  host: '<host>',
  username: '<user>',
  password: '<password>'
}

const conn = connect(config)
const results = await conn.execute('select 1 from dual where 1=?', [42])
console.log(results)
```

### Custom type casting function

Column values are converted to their corresponding JavaScript data types. This can be customized by providing a `cast` function.

```ts
import { connect, cast } from '@planetscale/database'

function inflate(field, value) {
  if (field.type === 'INT64' || field.type === 'UINT64') {
    return BigInt(value)
  }
  return cast(field, value)
}

const config = {
  cast: inflate,
  host: '<host>',
  username: '<user>',
  password: '<password>'
}

const conn = connect(config)
```

You can also pass a custom `cast` function to `execute`. If present, this will override the `cast` function set by the connection:

```ts
const result = await conn.execute(
  'SELECT userId, SUM(balance) AS balance FROM UserBalanceItem GROUP BY userId',
  {},
  {
    cast: (field, value) => {
      if (field.name === 'balance') {
        return BigInt(value)
      }
      return cast(field, value)
    }
  }
)
```

### Row return values

Rows can be returned as an object or an array of column values by passing an `as` option to `execute`.

```ts
const query = 'select 1 as one, 2 as two where 1=?'
const objects = conn.execute(query, [1], { as: 'object' })
// objects.rows => [{one: '1', two: '2'}]

const arrays = conn.execute(query, [1], { as: 'array' })
// arrays.rows => [['1', '2']]
```

## Development

```
npm install
npm test
```

## License

Distributed under the Apache 2.0 license. See LICENSE for details.
