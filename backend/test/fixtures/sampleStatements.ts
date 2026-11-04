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

// Reconstructed (labels, preamble shape, column names, date/amount
// formatting) from a real NayaPay account-statement CSV export -- names,
// account numbers and IBAN below are synthetic, not the real export's.
// The fixtures above assume the transaction table starts on line 1 with
// a clean 'Date,Description,Amount' header, which no real NayaPay export
// looks like. The real file has ~10 lines of account-summary preamble
// before the real header row (TIMESTAMP,TYPE,DESCRIPTION,AMOUNT,BALANCE),
// dates like '01 Oct 2026 03:32 PM' (not ISO), and incoming-transfer
// amounts with a leading '+' ('+4,000').
export const realWorldNayaPayCsv = `Customer Name,Jane Doe
Customer Address,"House 1/A, Example Society, Lahore, Pakistan"
NayaPay ID,janedoe99
NayaPay Account Number,'03001234567
NayaPay IBAN,PK00NAYA0000003001234567
Customer Support Number,(021) 111-222-729
Customer Support Email,support@nayapay.com


Account Statement for:,from 01 Oct 2026 to 31 Oct 2026

Opening Balance,"5,664.78",Closing Balance,"20,178.98",,Total Spent,"167,834.80",Total Income,"182,349"

TIMESTAMP,TYPE,DESCRIPTION,AMOUNT,BALANCE
01 Oct 2026 03:32 PM,Raast Out,"Outgoing fund transfer to John Smith
JazzCash/Mobilink MFB-1234|Nickname: Friend
Transaction ID 6abe36aa3718b43937622fef","-2,300","3,364.78"
01 Oct 2026 07:31 PM,POS,Paid to SAMPLE SWEETS AND BAKERY PK|Visa xxxx8978,-729,"1,835.78"
02 Oct 2026 03:39 PM,IBFT In,"Incoming fund transfer from
Sample Bank-0797|Transaction ID 817341","+4,000","5,835.78"
`;

// Unquoted comma in the description shifts every field after it: Amount
// (positionally the 3rd field) lands on "24" -- numeric-looking, so a
// naive parser commits it as the amount instead of the real 1250.
// papaparse reports a TooManyFields error for this row (4 values for 3
// headers); the header row itself is unaffected.
export const columnShiftCsv = `Date,Description,Amount
2026-10-27,Shop, 24,1250
`;
