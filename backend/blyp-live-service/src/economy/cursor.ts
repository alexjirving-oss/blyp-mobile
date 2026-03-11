export type LedgerCursor = { createdAt: string; ledgerId: string };

export function encodeCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
}

export function decodeCursor(raw?: string): LedgerCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed?.createdAt || !parsed?.ledgerId) return null;
    return { createdAt: String(parsed.createdAt), ledgerId: String(parsed.ledgerId) };
  } catch {
    return null;
  }
}
