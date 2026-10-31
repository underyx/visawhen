/** data as JSON indented by two spaces, with a final newline, as Python's
 * json.dump(indent=2) wrote it and as bun fmt keeps it. */
export async function writeJson(path: string, data: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readJson<T>(path: string): Promise<T> {
  return (await Bun.file(path).json()) as T;
}
