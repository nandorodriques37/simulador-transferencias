import { describe, expect, it } from "vitest";
import { urlDeUploadValida } from "./upload";

describe("URL de upload direto", () => {
  it("aceita só arquivo do próprio Blob, na pasta de upload", () => {
    expect(urlDeUploadValida("https://abc.public.blob.vercel-storage.com/upload/base-1-x.csv")).toBe(true);
    expect(urlDeUploadValida("https://abc.public.blob.vercel-storage.com/plano/a1.tsv")).toBe(false);
    expect(urlDeUploadValida("http://abc.public.blob.vercel-storage.com/upload/x.csv")).toBe(false);
    expect(urlDeUploadValida("https://evil.com/upload/x.csv")).toBe(false);
    expect(urlDeUploadValida("https://blob.vercel-storage.com.evil.com/upload/x.csv")).toBe(false);
    expect(urlDeUploadValida("não é url")).toBe(false);
  });
});
