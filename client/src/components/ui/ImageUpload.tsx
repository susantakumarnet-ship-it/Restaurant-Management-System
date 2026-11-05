import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFiles } from '../../lib/api';
import { Img } from './core';

/** Upload one or many images (also accepts pasted URLs). Value is an array of URLs. */
export function ImageUpload({ value, onChange, max = 1, label = 'Upload image' }: { value: string[]; onChange: (urls: string[]) => void; max?: number; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const urls = await uploadFiles(Array.from(files).slice(0, max - value.length));
      onChange([...value, ...urls].slice(0, max));
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  const addUrl = () => {
    if (!/^https?:\/\//.test(url.trim())) return toast.error('Enter a valid http(s) image URL');
    onChange([...value, url.trim()].slice(0, max));
    setUrl('');
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((u, i) => (
          <div key={u + i} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-ink-200">
            <Img src={u} alt="" className="h-full w-full" />
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100" aria-label="Remove image">
              <X className="h-3.5 w-3.5" />
            </button>
            {i === 0 && max > 1 && <span className="absolute bottom-0 left-0 right-0 bg-brand-600/90 text-center text-[10px] font-semibold text-white">PRIMARY</span>}
          </div>
        ))}
        {value.length < max && (
          <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-ink-300 text-ink-500 transition hover:border-brand-500 hover:text-brand-600">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        )}
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple={max > 1} hidden onChange={(e) => pick(e.target.files)} />
      {value.length < max && (
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <input className="input pl-8 text-xs" placeholder="...or paste an image URL" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUrl())} />
          </div>
          <button type="button" className="rounded-lg border border-ink-200 px-3 text-xs font-medium hover:bg-ink-50" onClick={addUrl}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
