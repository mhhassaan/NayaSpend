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
