import { extractArchive } from "./archive-extractor"

export async function extractZip(archivePath: string, destDir: string): Promise<void> {
  await extractArchive(archivePath, destDir)
}
