import Image from "next/image";
import styles from "./brand.module.css";

type BrandMarkProps = {
  className?: string;
  /** Set when the mark is meaningful on its own; otherwise the visible wordmark names the brand. */
  label?: string;
};

export function BrandMark({ className, label }: BrandMarkProps) {
  return (
    <span className={[styles.brand, className].filter(Boolean).join(" ")}>
      <Image
        className={styles.symbol}
        src="/brand/hanip-mark.svg"
        alt={label ?? ""}
        aria-hidden={label ? undefined : true}
        width={40}
        height={40}
        priority
      />
      <span className={styles.wordmark} aria-hidden={label ? true : undefined}>
        한입
      </span>
    </span>
  );
}
