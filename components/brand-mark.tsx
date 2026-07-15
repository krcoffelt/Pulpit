import Image from "next/image";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="Pulpit Studio">
      <span className="brand-symbol" aria-hidden="true">
        <Image src="/brand/pulpit-mark.png" width={1024} height={1024} alt="" priority />
      </span>
      {!compact && <span className="brand-word">PULPIT<span>.</span></span>}
    </div>
  );
}
