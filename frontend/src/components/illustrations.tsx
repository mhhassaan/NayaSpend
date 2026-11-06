// Inline SVG scenes -- flat brand fills and rounded outlines matching icons.tsx.
import type { SVGProps } from "react";

export function HeroIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="140" viewBox="0 0 160 140" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <rect fill="#f0eaed" x="32" y="16" width="58" height="106" rx="12" />
        <path d="M51 24h20M54 113h14" />
        <rect fill="#fcf9fb" x="18" y="50" width="62" height="40" rx="7" />
        <path d="M19 62h60M28 79h15" />
        <circle fill="#ff5018" cx="104" cy="99" r="23" />
        <path d="M104 86v26m6-21h-9a5 5 0 0 0 0 10h6a5 5 0 0 1 0 10h-9" />
        <path d="M101 66h12a16 16 0 0 0 16-16V24m-11 11 11-11 11 11" />
      </g>
    </svg>
  );
}

export function MonthEmptyIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="140" height="120" viewBox="0 0 140 120" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <rect fill="#fcf9fb" x="20" y="22" width="84" height="78" rx="9" />
        <path fill="#ece8fd" d="M29 22h66a9 9 0 0 1 9 9v15H20V31a9 9 0 0 1 9-9Z" />
        <path d="M40 16v14m44-14v14M36 62h10m12 0h10M36 78h10m12 0h10" />
        <circle fill="#f0eaed" cx="102" cy="88" r="22" />
        <path d="M102 76v24m6-20h-9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8h-9" />
      </g>
    </svg>
  );
}

export function HistoryEmptyIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="144" height="120" viewBox="0 0 144 120" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <rect fill="#f0eaed" x="16" y="24" width="112" height="74" rx="10" />
        <path stroke="#8c8085" d="M28 83h88" />
        <path d="m29 66 22-5 22 5 23-7h17" />
        <circle fill="#ffc6d4" cx="113" cy="59" r="10" />
      </g>
    </svg>
  );
}

export function TransactionsEmptyIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="140" height="120" viewBox="0 0 140 120" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <path fill="#fcf9fb" d="m28 14 8 5 8-5 8 5 8-5 8 5 8-5 8 5 8-5v91l-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5Z" />
        <path d="M42 36h36M42 48h25M42 67h10m16 0h10M42 81h19" />
        <circle fill="#ece8fd" cx="102" cy="84" r="23" />
        <path d="M102 71v26m6-21h-9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8h-9" />
      </g>
    </svg>
  );
}

export function BudgetsEmptyIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="144" height="120" viewBox="0 0 144 120" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <circle fill="#f0eaed" cx="87" cy="32" r="18" />
        <path d="M87 22v20m-6-10h12" />
        <path fill="#fcf9fb" d="m24 42 77-13v24H24Z" />
        <rect fill="#c4b8ff" x="20" y="44" width="100" height="60" rx="10" />
        <path fill="#fcf9fb" d="M106 64h18v22h-18a11 11 0 0 1 0-22Z" />
        <path d="M107 75h2" />
      </g>
    </svg>
  );
}

export function BillsEmptyIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="144" height="120" viewBox="0 0 144 120" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <rect fill="#ffc6d4" x="18" y="23" width="78" height="73" rx="9" />
        <path d="M18 45h78M36 16v15m41-15v15M33 61h10m13 0h10M33 77h10" />
        <path fill="#fcf9fb" d="M78 53h46v54l-8-5-7 5-8-5-7 5-8-5-8 5Z" />
        <path d="M88 67h26M88 79h18M88 91h12" />
      </g>
    </svg>
  );
}

export function DedupEmptyIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <path fill="#f0eaed" stroke="#8c8085" d="M64 15 108 31v30c0 24-18 42-44 52-26-10-44-28-44-52V31Z" />
        <path fill="#1e8a4c" d="m64 25 34 13v23c0 18-13 33-34 42-21-9-34-24-34-42V38Z" />
        <path fill="#fcf9fb" d="m43 61 8-8 11 11 20-22 8 8-28 31Z" />
      </g>
    </svg>
  );
}

export function CaptureHealthEmptyIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="144" height="120" viewBox="0 0 144 120" {...props}>
      <g fill="none" stroke="#381d2a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <rect fill="#f0eaed" x="18" y="35" width="94" height="64" rx="9" />
        <path d="m20 39 45 34 45-34M20 95l30-28m60 28L80 67" />
        <path stroke="#8c8085" d="M96 23h16a12 12 0 0 1 12 12v9" />
        <circle fill="#9048c4" cx="124" cy="54" r="9" />
      </g>
    </svg>
  );
}

export function NotFoundIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="140" height="128" viewBox="0 0 140 128" {...props}>
      <g fill="none" stroke="#8c8085" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <path fill="#d9d2d5" d="M27 16h48l20 20v71H27Z" />
        <path d="M75 16v20h20" />
        <path fill="#8c8085" d="m93 83 10-10 22 22a7 7 0 0 1-10 10Z" />
        <circle fill="#d9d2d5" cx="82" cy="63" r="28" />
        <circle cx="82" cy="63" r="20" />
      </g>
    </svg>
  );
}
