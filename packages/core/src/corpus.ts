// Text-only Hydra sketches used by tests in core and by every front-end's test-suite.
// The files live in packages/core/corpus/*.js (all written for this project; see corpus/README.md).

const files = import.meta.glob('../corpus/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export interface CorpusEntry {
  /** file name without extension, e.g. `09-variables` */
  name: string
  code: string
  /** true when the file is deliberately not valid JavaScript */
  broken: boolean
}

export const corpus: CorpusEntry[] = Object.entries(files)
  .map(([path, code]) => {
    const name = path.replace(/^.*\//, '').replace(/\.js$/, '')
    return { name, code, broken: name.includes('broken') }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

export function corpusByName(name: string): CorpusEntry | undefined {
  return corpus.find((c) => c.name === name)
}
