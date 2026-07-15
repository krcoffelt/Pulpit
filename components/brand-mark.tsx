import Image from "next/image";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark ${compact ? "is-compact" : ""}`} aria-label="Circumvision">
      {compact ? (
        <span className="brand-symbol" aria-hidden="true">
          <Image src="/brand/circumvision-mark.png" width={1024} height={1024} alt="" priority />
        </span>
      ) : (
        <Image className="brand-lockup" src="/brand/circumvision-logo-lockup.png" width={1726} height={493} alt="" priority />
      )}
    </div>
  );
}
