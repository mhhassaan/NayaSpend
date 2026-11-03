export const cleanCsv = `Date,Description,Amount
2026-10-27,Starbucks Coffee,1250.00
2026-10-28,Daraz Online Store,500
2026-10-29,Refund - Returned Item,(50.00)
`;

export const unrecognizedColumnsCsv = `TxnDate,Memo,Balance
2026-10-27,Starbucks Coffee,5000.00
2026-10-28,Daraz Online Store,4500.00
`;

export const mixedCsv = `Date,Description,Amount
2026-10-27,Starbucks Coffee,1250.00
2026-10-28,Corrupted Row,not-a-number
`;

export const nonIsoDateCsv = `Date,Description,Amount
27/10/2026,Starbucks Coffee,1250.00
`;

export const trailingMinusCsv = `Date,Description,Amount
2026-10-27,Refund,50.00-
`;

export const drCrCsv = `Date,Description,Amount
2026-10-27,Debit Entry,1250.00 DR
2026-10-28,Credit Entry,500.00 CR
`;

export const garbageAmountCsv = `Date,Description,Amount
2026-10-27,Garbage Row,12abc
`;

export const rsFormatCsv = `Date,Description,Amount
2026-10-27,Starbucks Coffee,"Rs. 1,250.00"
`;

// Unquoted comma in the description shifts every field after it: Amount
// (positionally the 3rd field) lands on "24" -- numeric-looking, so a
// naive parser commits it as the amount instead of the real 1250.
// papaparse reports a TooManyFields error for this row (4 values for 3
// headers); the header row itself is unaffected.
export const columnShiftCsv = `Date,Description,Amount
2026-10-27,Shop, 24,1250
`;
