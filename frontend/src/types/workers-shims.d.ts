// The backend's AppType is imported by relative path (no npm workspace --
// see src/api/client.ts), which means TypeScript must fully resolve every
// type backend/src/index.ts touches, including Workers-runtime-only
// ambient globals (D1Database, Queue, etc.) that this frontend program
// never actually calls.
//
// Pulling in the real `@cloudflare/workers-types` package to satisfy those
// names conflicts with this program's own "DOM" lib: both declare
// incompatible global Crypto/BufferSource shapes, and type-checking
// backend/src/security.ts's crypto.subtle calls under the DOM definition
// fails even though backend's own (DOM-free) tsc build is clean. These
// loose shims exist only so the names resolve -- never used for anything
// frontend code actually calls, so `any` is correct here, not a shortcut.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type D1Database = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Queue = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ScheduledController = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ExecutionContext = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type MessageBatch<T = any> = any;
}

export {};
