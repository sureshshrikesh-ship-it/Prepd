import { photoFrom, readReceiptImage } from "@/lib/readReceipt";
import { gate } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const g = await gate(req);
  if (g instanceof Response) return g;
  const photo = await photoFrom(req);
  if (photo instanceof Response) return photo;
  const out = await readReceiptImage(g.db, photo.data, photo.mediaType);
  return out instanceof Response ? out : Response.json(out);
}
