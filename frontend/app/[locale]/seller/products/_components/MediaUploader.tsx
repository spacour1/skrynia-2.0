import { CloudUpload, X } from "lucide-react";
import type { SelectedMedia } from "./types";

export function MediaUploader({ media, addMedia, removeMedia }: { media: SelectedMedia[]; addMedia: (files: FileList | File[]) => void; removeMedia: (id: string) => void }) {
  return (
    <div className="space-y-4 md:col-span-3">
      <label
        className="flex min-h-[112px] cursor-pointer items-center justify-center gap-4 rounded-lg border border-dashed border-line bg-card/45 px-4 text-center transition hover:border-brand/60 hover:bg-panel/50"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addMedia(event.dataTransfer.files);
        }}
      >
        <CloudUpload className="h-10 w-10 text-muted" />
        <span>
          <span className="block font-bold text-ink">Перетащите файлы сюда или нажмите для загрузки</span>
          <span className="mt-1 block text-sm text-muted">PNG, JPG, WEBP до 8 МБ, до 10 файлов.</span>
        </span>
        <input className="sr-only" name="media" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => event.target.files && addMedia(event.target.files)} />
      </label>
      {media.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {media.map((item) => (
            <div key={item.id} className="group relative overflow-hidden rounded-lg border border-line bg-panel">
              <img className="aspect-[4/3] w-full object-cover" src={item.previewUrl} alt={item.file.name} />
              <button className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-white opacity-100 transition hover:bg-rose-500 sm:opacity-0 sm:group-hover:opacity-100" type="button" onClick={() => removeMedia(item.id)}>
                <X className="h-4 w-4" />
              </button>
              <p className="truncate px-2 py-2 text-xs text-muted">{item.file.name}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
