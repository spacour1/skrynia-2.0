import { apiFetch } from "./api";

export type StoragePurpose =
  | "avatar"
  | "product_media"
  | "chat_attachment"
  | "catalog_asset";

export type StorageUpload = {
  id: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
};

export async function uploadImage(
  file: File,
  purpose: StoragePurpose
): Promise<StorageUpload> {
  const body = new FormData();
  body.append("purpose", purpose);
  body.append("file", file);
  const response = await apiFetch<{ upload: StorageUpload }>(
    "/storage/upload",
    { method: "POST", body }
  );
  return response.upload;
}

export async function attachCatalogAsset(uploadId: string) {
  const response = await apiFetch<{ upload: StorageUpload }>(
    `/storage/catalog-assets/${uploadId}/attach`,
    { method: "POST" }
  );
  return response.upload;
}
