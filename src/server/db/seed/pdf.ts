/**
 * A very small PDF writer, for the demo's documents.
 *
 * The document hub is only convincing if the files in it open. Rather than
 * check binaries into the repository, the seed writes a real one-page PDF:
 * enough of the format to be valid, and nothing more. It is demo data, not a
 * document pipeline - nothing in the application depends on this.
 */

function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function simplePdf(title: string, lines: string[]): Buffer {
  const content = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    `(${escape(title)}) Tj`,
    '/F1 11 Tf',
    '0 -28 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? '' : '0 -16 Td',
      `(${escape(line.slice(0, 95))}) Tj`,
    ]),
    'ET',
  ]
    .filter(Boolean)
    .join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefAt = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}
