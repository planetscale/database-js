# PlanetScale Edge client

A JavaScript client for the PlanetScale Edge API.

## Installation

```
$ npm install @planetscale/edge
```

## Usage

```ts
import { connect } from '@planetscale/edge'

const config = {
  host: 'aws.connect.psdb.cloud',
  username: '<user>',
  password: '<password>'
}

const conn = await connect(config)
const results = await conn.execute('select 1 from dual')
console.log(results)
```

### Connection factory

Use the `Client` connection factory class to create fresh connections for each transaction or web request handler.

```ts
import { Client } from '@planetscale/edge'

const client = new Client({
  host: 'aws.connect.psdb.cloud',
  username: '<user>',
  password: '<password>'
})

const conn = await client.connection()
const results = await conn.execute('select 1 from dual')
console.log(results)
```

### Custom fetch function

Node.js version 18 includes a built-in global `fetch` function. When using an older version of Node.js, you can provide a custom fetch function implementation. We recommend the [`undici`][1] package on which Node's built-in fetch is based.

[1]: https://github.com/nodejs/undici

```ts
import { connect } from '@planetscale/edge'
import { fetch } from 'undici'

const config = {
  fetch,
  host: 'aws.connect.psdb.cloud',
  username: '<user>',
  password: '<password>'
}

const conn = await connect(config)
const results = await conn.execute('select 1 from dual')
console.log(results)
```

## Development

```
npm install
npm test
```

## License

Distributed under the Apache 2.0 license. See LICENSE for details.
