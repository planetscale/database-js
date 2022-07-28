import {Result, apiResult, unwrap} from "../utils/api"

type Credentials = {
  username: string
  password: string
  mysql_address: string

}

class Client {
  credentials: Credentials

  constructor(credentials: Credentials) {
    this.credentials = credentials
  }

  authorizationHeader() {
    const value = window.btoa(`${this.credentials.username}:${this.credentials.password}`)

    return {
      Authorization: `Basic ${value}`
    }
  }

  async postJSON<T>(url: string, body?: unknown): Promise<Result<T>> {
    try {
      const result = await apiResult<T>(
        fetch(url, {
          method: 'POST',
          body: body ? JSON.stringify(body) : undefined,
          headers: {
            'Content-Type': 'application/json',
            ...this.authorizationHeader()
          },
          credentials: 'include'
        })
      )
      return result.err ? { err: result.err } : { ok: unwrap(result.ok) }
    } catch (e) {
      // Catch error in case something goes awry with fetching auth header.
      return { err: e }
    }
  }
}

export default Client
