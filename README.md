![PlanetScale serverless driver for JavaScript](https://github.com/planetscale/database-js/assets/440926/0dfab33f-b01f-4814-ae40-c5fe5cbe94e3)

# PlanetScale serverless JavaScript driver for Vitess/MySQL

A Fetch API-compatible PlanetScale Vitess/MySQL database driver for serverless and edge compute platforms that require HTTP external connections, such as Cloudflare Workers or Vercel Edge Functions

> [!TIP]
> Connecting to a PlanetScale Postgres database? We support the Neon serverless driver, [read the documentation](https://planetscale.com/docs/postgres/connecting/neon-serverless-driver) to connect.

## Installation

```sh
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
const results = await conn.execute('select 1 from dual')
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
  const whenBranch = await tx.execute(`INSERT INTO branches (database_id, name) VALUES (42, 'planetscale')`)
  const whenCounter = await tx.execute(`INSERT INTO slotted_counters(record_type, record_id, slot, count) VALUES ('branch_count', 42, RAND() * 100, 1) ON DUPLICATE KEY UPDATE count = count + 1"`
  return [whenBranch, whenCounter]
})
console.log(results)
```

### Custom fetch function

The driver uses the global `fetch` function by default. You can provide a custom fetch function implementation, for example to configure proxies or connection pooling. We recommend the [`undici`][1] package on which Node's built-in fetch is based.

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

To leverage HTTP/2, you can use the [`fetch-h2`][2] shim.

[2]: https://www.npmjs.com/package/fetch-h2

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

### Query parameters

`execute` does not interpolate query parameters. Pass it a complete SQL string. Calling `execute` with an array or a named-parameter object throws an error.

Any values you include in a query must be escaped first, for example with [`sql-escaper`](https://github.com/mysqljs/sql-escaper):

```ts
import { format } from 'sql-escaper'

const results = await conn.execute(format('select 1 from dual where 1=?', [42]))
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
const query = 'select 1 as one, 2 as two'
const objects = conn.execute(query, { as: 'object' })
// objects.rows => [{one: '1', two: '2'}]

const arrays = conn.execute(query, { as: 'array' })
// arrays.rows => [['1', '2']]
```

## Development

```sh
npm install
npm test
```

## Need help?

Get help from [the PlanetScale support team](https://support.planetscale.com/), or [join our community on Discord](https://discord.gg/EqrcEf2dGv) or [GitHub discussion board](https://github.com/planetscale/discussion/discussions) to see how others are using PlanetScale.

## License

Distributed under the Apache 2.0 license. See LICENSE for details.
