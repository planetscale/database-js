
type Something<T> = { some: T; none: false }
type Nothing = { none: true }
export type Option<T> = Something<T> | Nothing

export function Some<T>(value: T): Option<T> {
  return Object.freeze({ some: value, none: false })
}

export const None: Nothing = Object.freeze({ none: true })

export function unwrap<T>(option: Option<T>): T {
  const value = 'some' in option ? option.some : undefined
  if (value == null) {
    throw new Error('cannot unwrap a None value')
  }
  return value
}

export type Result<T, E = Error> = {
  ok?: T
  err?: E
}

export type ApiError = {
  code: string
  message: string
}

class ServerError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ServerError'
  }
}

export class ClientError<T> extends Error {
  body: T
  status: number
  constructor(message: string, status: number, body: T) {
    super(message)
    this.status = status
    this.name = 'ClientError'
    this.body = body
  }
}

export async function apiResult<T>(whenResponse: Promise<Response>): Promise<Result<Option<T>>> {
  try {
    const response = await whenResponse
    if (response.status === 204) {
      return { ok: None }
    } else if (response.ok) {
      const body: T = await response.json()
      return { ok: Some(body) }
    } else if (response.status >= 400 && response.status < 500) {
      const body: ApiError = await response.json()
      const error = new ClientError(response.statusText, response.status, body)
      return { err: error }
    } else {
      const error = new ServerError(response.statusText, response.status)
      return { err: error }
    }
  } catch (e: any) {
    return { err: e }
  }
}

export function apiMessage(error: Error): string {
  return error instanceof ClientError
    ? error.body.message
    : 'There was an error contacting the server. Please try again.'
}
