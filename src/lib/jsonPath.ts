export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
export type Path = Array<string | number>

export function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function getAt(root: Json, path: Path): Json | undefined {
  let cur: Json | undefined = root
  for (const key of path) {
    if (cur === undefined || cur === null || typeof cur !== 'object') return undefined
    cur = (cur as any)[key]
  }
  return cur
}

/** Immutable set: returns a new root with `value` placed at `path`. */
export function setAt(root: Json, path: Path, value: Json): Json {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(root)) {
    const copy = root.slice()
    copy[head as number] = setAt(copy[head as number] ?? null, rest, value)
    return copy
  }
  const obj = isObject(root) ? root : {}
  return { ...obj, [head as string]: setAt(obj[head as string] ?? null, rest, value) }
}

/** Immutable delete of the key/index at `path`. */
export function deleteAt(root: Json, path: Path): Json {
  if (path.length === 0) return root
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  const parent = getAt(root, parentPath)
  if (Array.isArray(parent)) {
    const copy = parent.slice()
    copy.splice(key as number, 1)
    return setAt(root, parentPath, copy)
  }
  if (isObject(parent)) {
    const { [key as string]: _removed, ...restObj } = parent
    return setAt(root, parentPath, restObj)
  }
  return root
}

/** Immutable move of an array item at `path` (an array) from index `from` to `to`. */
export function moveAt(root: Json, arrayPath: Path, from: number, to: number): Json {
  const arr = getAt(root, arrayPath)
  if (!Array.isArray(arr) || to < 0 || to >= arr.length || from === to) return root
  const copy = arr.slice()
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item!)
  return setAt(root, arrayPath, copy)
}

/** Immutable insert into the array at `path` at index `index`. */
export function insertAt(root: Json, arrayPath: Path, index: number, value: Json): Json {
  const arr = getAt(root, arrayPath)
  const copy = Array.isArray(arr) ? arr.slice() : []
  copy.splice(index, 0, value)
  return setAt(root, arrayPath, copy)
}

/** Rename an object key while preserving key order. */
export function renameKey(root: Json, objectPath: Path, oldKey: string, newKey: string): Json {
  const obj = getAt(root, objectPath)
  if (!isObject(obj) || oldKey === newKey || newKey in obj) return root
  const next: JsonObject = {}
  for (const [k, v] of Object.entries(obj)) next[k === oldKey ? newKey : k] = v
  return setAt(root, objectPath, next)
}

export function clone<T extends Json>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export function typeOf(v: Json | undefined): 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'undefined' {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v as 'string' | 'number' | 'boolean' | 'object'
}

export function defaultFor(type: ReturnType<typeof typeOf>): Json {
  switch (type) {
    case 'string': return ''
    case 'number': return 0
    case 'boolean': return false
    case 'array': return []
    case 'object': return {}
    default: return null
  }
}
